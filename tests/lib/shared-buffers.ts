// Counts the SharedArrayBuffer objects that each thread of a page holds, from heap snapshots that
// Chrome's debugging protocol takes in the page and in each of its workers. A shared memory's
// `buffer` gives a new object after each growth, and Chrome's page memory figure counts each such
// object at its own length, so a thread should hold one object per memory, the newest. Playwright's
// own sessions reach only pages and frames, so the workers' sessions go through the page's session:
// it attaches to the page's workers without flattening, and sends each worker's commands inside
// `Target.sendMessageToTarget`.
import type { CDPSession, Page } from '@playwright/test';
import type { HeapSnapshot } from './heap-retainers.ts';

/** A worker's debugging session, reached through its page's session. */
export class WorkerSession {
	private next = 1;
	private readonly waiting = new Map<number, (message: WorkerReply) => void>();
	private readonly chunks: string[] = [];

	constructor(
		private readonly cdp: CDPSession,
		readonly sessionId: string,
		readonly url: string,
	) {}

	/** Takes a message that the worker sent to its session. */
	receive(message: WorkerReply): void {
		if (message.method === 'HeapProfiler.addHeapSnapshotChunk')
			this.chunks.push((message.params as { chunk: string }).chunk);
		if (message.id === undefined) return;
		this.waiting.get(message.id)?.(message);
		this.waiting.delete(message.id);
	}

	/** Sends a command to the worker and resolves with its result. */
	async send<T>(method: string, params: object = {}): Promise<T> {
		const id = this.next++;
		const reply = new Promise<WorkerReply>((resolve) => this.waiting.set(id, resolve));
		await this.cdp.send('Target.sendMessageToTarget', {
			sessionId: this.sessionId,
			message: JSON.stringify({ id, method, params }),
		});
		const { result, error } = await reply;
		if (error) throw new Error(`${method} in ${this.url}: ${error.message}`);
		return result as T;
	}

	/** Collects the worker's garbage, then takes a heap snapshot of it. */
	async heapSnapshot(): Promise<HeapSnapshot> {
		await this.send('HeapProfiler.enable');
		await this.send('HeapProfiler.collectGarbage');
		this.chunks.length = 0;
		await this.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
		return JSON.parse(this.chunks.splice(0).join('')) as HeapSnapshot;
	}
}

/** A message from a worker's session: a reply to a command, or an event. */
interface WorkerReply {
	id?: number;
	method?: string;
	params?: unknown;
	result?: unknown;
	error?: { message: string };
}

/**
 * The debugging sessions of the page's workers whose script addresses hold one of `names`, once each
 * of them has one. Job workers wait in `Atomics.wait` between jobs and never answer, so a caller
 * names only the workers that return to their event loop.
 */
export async function workerSessions(
	page: Page,
	names: readonly string[],
	timeoutMs = 20_000,
): Promise<{ cdp: CDPSession; workers: Map<string, WorkerSession> }> {
	const cdp = await page.context().newCDPSession(page);
	const sessions = new Map<string, WorkerSession>();
	cdp.on('Target.attachedToTarget', ({ sessionId, targetInfo }) => {
		if (targetInfo.type === 'worker')
			sessions.set(sessionId, new WorkerSession(cdp, sessionId, targetInfo.url));
	});
	cdp.on('Target.receivedMessageFromTarget', ({ sessionId, message }) =>
		sessions.get(sessionId)?.receive(JSON.parse(message) as WorkerReply),
	);
	await cdp.send('Target.setAutoAttach', {
		autoAttach: true,
		waitForDebuggerOnStart: false,
		flatten: false,
	});
	const named = () =>
		new Map(
			names.flatMap((name) => {
				const found = [...sessions.values()].findLast((worker) => worker.url.includes(name));
				return found ? [[name, found] as const] : [];
			}),
		);
	const deadline = Date.now() + timeoutMs;
	while (named().size < names.length && Date.now() < deadline)
		await new Promise((resolve) => setTimeout(resolve, 100));
	const workers = named();
	const missing = names.filter((name) => !workers.has(name));
	if (missing.length > 0) throw new Error(`no worker appeared for ${missing.join(', ')}`);
	return { cdp, workers };
}

/** One backing store of shared memory in a heap, and the SharedArrayBuffer objects that view it. */
export interface SharedStore {
	/** The store's size in bytes, as the snapshot gives it. */
	bytes: number;
	/** The SharedArrayBuffer objects over the store that the heap holds. */
	objects: number;
}

/** Each backing store of shared memory that the SharedArrayBuffer objects of a heap view. */
export function sharedStores(heap: HeapSnapshot): SharedStore[] {
	const { meta } = heap.snapshot;
	const nodeFields = meta.node_fields.length;
	const edgeFields = meta.edge_fields.length;
	const [type, name, size, edgeCount] = ['type', 'name', 'self_size', 'edge_count'].map((field) =>
		meta.node_fields.indexOf(field),
	) as [number, number, number, number];
	const [edgeName, edgeTo] = ['name_or_index', 'to_node'].map((field) =>
		meta.edge_fields.indexOf(field),
	) as [number, number];
	const edgeType = meta.edge_fields.indexOf('type');
	const nodeTypes = meta.node_types[0];
	const edgeTypes = meta.edge_types[0];
	const stores = new Map<number, SharedStore>();
	for (let node = 0, edge = 0; node < heap.nodes.length; node += nodeFields) {
		const edges = heap.nodes[node + edgeCount] as number;
		// Chrome lists a SharedArrayBuffer object as an object or as a native one.
		const kind = nodeTypes[heap.nodes[node + type] as number];
		const shared =
			(kind === 'object' || kind === 'native') &&
			heap.strings[heap.nodes[node + name] as number] === 'SharedArrayBuffer';
		for (let k = 0; k < edges; k++, edge += edgeFields) {
			if (!shared) continue;
			const named = edgeTypes[heap.edges[edge + edgeType] as number];
			if (named === 'element' || named === 'hidden') continue;
			if (heap.strings[heap.edges[edge + edgeName] as number] !== 'backing_store') continue;
			const to = heap.edges[edge + edgeTo] as number;
			const store = stores.get(to) ?? { bytes: heap.nodes[to + size] as number, objects: 0 };
			store.objects++;
			stores.set(to, store);
		}
	}
	return [...stores.values()];
}
