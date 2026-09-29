// A minimal client for Chrome's debugging protocol, for the tools that sample the engine's workers:
// it connects to a browser, attaches to a page and to its workers, and evaluates expressions in the
// page. The browser is a Chrome that Playwright started on this computer, or Chrome on a phone whose
// debugging socket adb forwards to a local port.

export interface TargetInfo {
	targetId: string;
	type: string;
	url: string;
}

/** A function in a profile: its name, and the script it comes from, empty for a built-in one. */
export interface CallFrame {
	functionName: string;
	url: string;
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** How long a browser that is starting may take to open its debugging port. */
const CONNECT_TIMEOUT_MS = 20_000;

export class DevTools {
	private next = 1;
	private readonly pending = new Map<
		number,
		{ method: string; resolve: (result: unknown) => void; reject: (error: Error) => void }
	>();
	private readonly listeners = new Map<string, ((params: unknown, sessionId?: string) => void)[]>();

	private constructor(private readonly socket: WebSocket) {
		socket.onmessage = (event) => {
			const message = JSON.parse(String(event.data)) as {
				id?: number;
				method?: string;
				params?: unknown;
				sessionId?: string;
				result?: unknown;
				error?: { message: string };
			};
			if (message.id === undefined) {
				for (const listener of this.listeners.get(message.method ?? '') ?? [])
					listener(message.params, message.sessionId);
				return;
			}
			const call = this.pending.get(message.id);
			this.pending.delete(message.id);
			if (message.error) call?.reject(new Error(`${call?.method}: ${message.error.message}`));
			else call?.resolve(message.result);
		};
	}

	/**
	 * Connects to the browser that listens on a local debugging port, waiting while a browser that
	 * is still starting opens it. A phone's Chrome reports an address without the forwarded port, so
	 * only the path of the address it reports is used.
	 */
	static async connect(port: number, timeoutMs = CONNECT_TIMEOUT_MS): Promise<DevTools> {
		const deadline = Date.now() + timeoutMs;
		let version: { webSocketDebuggerUrl: string } | undefined;
		while (!version) {
			try {
				version = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()) as {
					webSocketDebuggerUrl: string;
				};
			} catch (e) {
				if (Date.now() > deadline)
					throw new Error(`no browser answered on debugging port ${port}: ${(e as Error).message}`);
				await sleep(250);
			}
		}
		const path = new URL(version.webSocketDebuggerUrl).pathname;
		const socket = new WebSocket(`ws://127.0.0.1:${port}${path}`);
		await new Promise((resolve, reject) => {
			socket.onopen = resolve;
			socket.onerror = reject;
		});
		return new DevTools(socket);
	}

	send<T>(method: string, params: object = {}, sessionId?: string): Promise<T> {
		const id = this.next++;
		this.socket.send(JSON.stringify({ id, method, params, ...(sessionId && { sessionId }) }));
		return new Promise((resolve, reject) =>
			this.pending.set(id, { method, resolve: resolve as (result: unknown) => void, reject }),
		);
	}

	on(method: string, listener: (params: unknown, sessionId?: string) => void): void {
		this.listeners.set(method, [...(this.listeners.get(method) ?? []), listener]);
	}

	close(): void {
		this.socket.close();
	}
}

/**
 * A place in the code, by function and file. A named function with no file is one of the browser's
 * built-in functions, such as a promise's then or a WebGL call.
 */
export function placeName({ functionName, url }: CallFrame): string {
	const name = functionName || '(anonymous)';
	if (!url) return name.startsWith('(') ? name : `${name} (built-in)`;
	return `${name} ${url.split('/').slice(-2).join('/').replace(/\?.*$/, '')}`;
}

/** The debugging sessions of a page and of its named workers. */
export interface Attached {
	/** The debugging session of the page. */
	page: string;
	/** The debugging session of each named worker. */
	workers: Map<string, string>;
}

/** A worker that a debugging session attached to. */
export interface AttachedWorker {
	sessionId: string;
	/** The address of the worker's script. */
	url: string;
}

/** How long a page's workers may take to appear after the tool attaches to the page. */
const WORKERS_TIMEOUT_MS = 30_000;

/** The pages whose address holds the path of `url`. */
export async function pagesAt(devtools: DevTools, url: string): Promise<TargetInfo[]> {
	const path = new URL(url).pathname;
	const { targetInfos } = await devtools.send<{ targetInfos: TargetInfo[] }>('Target.getTargets');
	return targetInfos.filter((t) => t.type === 'page' && t.url.includes(path));
}

/**
 * Attaches to a page and then to its workers, which Chrome reports only to a session that asks to
 * attach to a page's related targets. It waits until `enough` accepts the workers so far, or for
 * a while at most.
 */
async function attachPage(
	devtools: DevTools,
	targetId: string,
	enough: (workers: readonly AttachedWorker[]) => boolean,
): Promise<{ page: string; workers: AttachedWorker[] }> {
	const { sessionId } = await devtools.send<{ sessionId: string }>('Target.attachToTarget', {
		targetId,
		flatten: true,
	});
	const workers: AttachedWorker[] = [];
	devtools.on('Target.attachedToTarget', (params, parent) => {
		const { sessionId: worker, targetInfo } = params as {
			sessionId: string;
			targetInfo: TargetInfo;
		};
		if (parent === sessionId && targetInfo.type === 'worker')
			workers.push({ sessionId: worker, url: targetInfo.url });
	});
	await devtools.send(
		'Target.setAutoAttach',
		{ autoAttach: true, waitForDebuggerOnStart: false, flatten: true },
		sessionId,
	);
	const deadline = Date.now() + WORKERS_TIMEOUT_MS;
	while (!enough(workers) && Date.now() < deadline) await sleep(100);
	return { page: sessionId, workers };
}

/** Attaches to a page and to its named workers. A worker is named by a part of its script's address. */
export async function attachWorkers(
	devtools: DevTools,
	targetId: string,
	names: readonly string[],
): Promise<Attached> {
	const named = (workers: readonly AttachedWorker[]) =>
		new Map(
			names.flatMap((name) => {
				const worker = workers.findLast((w) => w.url.includes(name));
				return worker ? [[name, worker.sessionId] as const] : [];
			}),
		);
	const { page, workers } = await attachPage(
		devtools,
		targetId,
		(attached) => named(attached).size === names.length,
	);
	const found = named(workers);
	const missing = names.filter((w) => !found.has(w));
	if (missing.length > 0) throw new Error(`no worker target appeared for ${missing.join(', ')}`);
	return { page, workers: found };
}

/** Attaches to a page and to every one of its workers, of which `count` must appear. */
export async function attachEveryWorker(
	devtools: DevTools,
	targetId: string,
	count: number,
): Promise<{ page: string; workers: AttachedWorker[] }> {
	const attached = await attachPage(devtools, targetId, (workers) => workers.length >= count);
	if (attached.workers.length < count)
		throw new Error(`${attached.workers.length} of the page's ${count} workers appeared`);
	return attached;
}

/**
 * The bytes of every WebAssembly memory that a page or worker holds. It finds the memories through
 * the debugger, as the engine keeps its memory out of the page's global scope.
 */
export async function wasmMemoryBytes(devtools: DevTools, sessionId: string): Promise<number> {
	const objectGroup = 'null3d-wasm-memory';
	try {
		const { result: prototype } = await devtools.send<{ result: { objectId: string } }>(
			'Runtime.evaluate',
			{ expression: 'WebAssembly.Memory.prototype', objectGroup },
			sessionId,
		);
		const { objects } = await devtools.send<{ objects: { objectId: string } }>(
			'Runtime.queryObjects',
			{ prototypeObjectId: prototype.objectId, objectGroup },
			sessionId,
		);
		const { result } = await devtools.send<{ result: { value: number } }>(
			'Runtime.callFunctionOn',
			{
				objectId: objects.objectId,
				functionDeclaration:
					'function () { return this.reduce((sum, memory) => sum + memory.buffer.byteLength, 0); }',
				returnByValue: true,
			},
			sessionId,
		);
		return result.value;
	} finally {
		await devtools.send('Runtime.releaseObjectGroup', { objectGroup }, sessionId);
	}
}

/** Evaluates an expression in a page or worker and returns its value, copied out as JSON. */
export async function evaluate<T>(
	devtools: DevTools,
	sessionId: string,
	expression: string,
): Promise<T> {
	const { result, exceptionDetails } = await devtools.send<{
		result: { value?: T };
		exceptionDetails?: { text: string };
	}>('Runtime.evaluate', { expression, returnByValue: true }, sessionId);
	if (exceptionDetails) throw new Error(`${expression}: ${exceptionDetails.text}`);
	return result.value as T;
}
