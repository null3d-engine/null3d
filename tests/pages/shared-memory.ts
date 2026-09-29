// Checks that the browser gets back the memory of a stopped engine, so a page can start the engine
// again and again. It counts how many shared memories with the engine's default maximum the page
// can hold at once: its room. It then starts and stops the engine, in the mode the page's switches
// ask for, more times than that where the room is small, and counts the room again soon after and a
// few seconds later. An engine whose memory the browser never gets back takes room that a later one
// needs, so a later start fails or the room after is smaller. The page also reports how many of the
// memories it gave to workers, and how many of those workers, it can still reach.
//
// ?kinds= tests other ways a thread holds a shared memory, such as a worker stopped inside a
// blocking wait (see ./lib/memory-holder.ts). ?cycles= sets the number of starts and stops, and
// ?room=off skips the counts of the room.
import { createEngine } from '@null3d/engine';
import { coreUrls, probeCapabilities } from '@null3d/engine/internal';
import { CORE_KINDS, type HoldKind, type HoldMessage, WOKEN_KINDS } from './lib/memory-holder';
import { progress, run } from './lib/result';

const params = new URLSearchParams(location.search);
/** The memories' maximum in 64 KiB pages: 1 GiB, the engine's default, unless ?maximum sets it. */
const MAXIMUM_PAGES = Number(params.get('maximum') ?? 16_384);
const INITIAL_PAGES = 18;
/** The most memories a count holds at once: a browser with room for this many has room to spare. */
const MOST_HELD = 64;
/** Cycles beyond the room: enough that memories the browser never gets back use it up. */
const EXTRA_CYCLES = 4;
/** The fewest and the most cycles: where the room is large, the counts after show a leak instead. */
const MIN_CYCLES = 3;
const MAX_CYCLES = 10;
/** How long the page waits after a worker is ready, so that a blocking worker is inside its wait. */
const SETTLE_MS = 50;
/** How long a worker may take to get ready, and the engine to start and to draw its first frame. */
const READY_TIMEOUT_MS = 5_000;
const ENGINE_TIMEOUT_MS = 20_000;
/** When the page counts the room again after the cycles: soon, and once late frees are done. */
const SOON_MS = 1_000;
const LATER_MS = 5_000;

/** The ways of holding a memory: the engine's start and stop, or one of the smaller tests. */
type Kind = 'engine' | 'dropped' | 'probe' | HoldKind;
const KINDS = (params.get('kinds')?.split(',') ?? ['engine']) as Kind[];
const COUNT_ROOM = params.get('room') !== 'off';

interface KindResult {
	cycles: number;
	error?: string;
	/** The page's steps in the cycle that failed. */
	trail?: string[];
	/** The room soon after the cycles, and a few seconds later. */
	roomAfter?: number;
	roomLater?: number;
	/** The memories the page gave workers, and those it can still reach. */
	memoriesGiven: number;
	memoriesReachable: number;
	/** The workers the page started, and those it can still reach, by name. */
	workersStarted: number;
	workersReachable: Record<string, number>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Fails after `ms` unless `promise` settles first. It clears its timer, which would keep the result. */
async function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new Error(`${what} took more than ${ms / 1000} s`)), ms);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

function allocate(): WebAssembly.Memory {
	return new WebAssembly.Memory({ initial: INITIAL_PAGES, maximum: MAXIMUM_PAGES, shared: true });
}

/** How many memories the page can hold at once, and the error that ended the count. */
function countRoom(): { room: number; error?: string } {
	const memories: WebAssembly.Memory[] = [];
	try {
		while (memories.length < MOST_HELD) memories.push(allocate());
		return { room: memories.length };
	} catch (e) {
		return { room: memories.length, error: (e as Error).message };
	}
}

let coreModule: Promise<WebAssembly.Module> | undefined;

/** Gives a new memory to a worker that holds it the way `kind` says, then stops the worker. */
async function holdAndStop(kind: HoldKind): Promise<void> {
	const memory = allocate();
	const flags = new Int32Array(new SharedArrayBuffer(2 * Int32Array.BYTES_PER_ELEMENT));
	coreModule ??= WebAssembly.compileStreaming(fetch(coreUrls('threaded').wasm));
	const message: HoldMessage = {
		memory,
		flags: flags.buffer as SharedArrayBuffer,
		kind,
		module: CORE_KINDS.includes(kind) ? await coreModule : undefined,
	};
	const worker = new Worker(new URL('./lib/memory-holder.ts', import.meta.url), { type: 'module' });
	worker.postMessage(message);
	const until = async (flag: number, what: string) => {
		const deadline = performance.now() + READY_TIMEOUT_MS;
		while (Atomics.load(flags, flag) === 0) {
			if (performance.now() > deadline) throw new Error(`the ${kind} worker never ${what}`);
			await sleep(5);
		}
	};
	await until(0, 'got ready');
	await sleep(SETTLE_MS);
	if (WOKEN_KINDS.includes(kind)) {
		const words = new Int32Array(memory.buffer);
		Atomics.store(words, 0, 1);
		Atomics.notify(words, 0);
		await until(1, 'woke');
	}
	worker.terminate();
}

/**
 * Each start's canvas, which the page keeps as an app may keep its canvas elements: a stopped
 * engine must let go of its memory while its canvas lives on.
 */
const canvases: HTMLCanvasElement[] = [];

/** Starts the engine on a new canvas, waits for its first frame, and stops it. */
async function startAndStopEngine(): Promise<void> {
	const canvas = document.createElement('canvas');
	canvases.push(canvas);
	document.body.append(canvas);
	try {
		const engine = await withTimeout(
			createEngine({
				canvas,
				sketch: new URL('./sketches/empty-sketch.ts', import.meta.url),
				onProgress: progress,
			}),
			ENGINE_TIMEOUT_MS,
			'the engine start',
		);
		try {
			await withTimeout(engine.firstFrame, ENGINE_TIMEOUT_MS, 'the first frame');
		} finally {
			await engine.destroy();
		}
	} finally {
		canvas.remove();
	}
}

async function cycle(kind: Kind): Promise<void> {
	if (kind === 'engine') await startAndStopEngine();
	else if (kind === 'dropped') allocate();
	else if (kind === 'probe') await probeCapabilities('high-performance');
	else await holdAndStop(kind);
}

/** Weak references to each memory the page gives a worker, to learn whether the page still holds it. */
const given: WeakRef<WebAssembly.Memory>[] = [];
const post = Worker.prototype.postMessage;
Worker.prototype.postMessage = function (this: Worker, message: unknown, ...rest: unknown[]) {
	const memory = (message as { memory?: unknown } | null)?.memory;
	if (memory instanceof WebAssembly.Memory && !given.some((ref) => ref.deref() === memory))
		given.push(new WeakRef(memory));
	return (post as (...args: unknown[]) => void).call(this, message, ...rest);
};

/** Weak references to each worker the page starts, with its name. */
const started: { name: string; ref: WeakRef<Worker> }[] = [];
const PageWorker = globalThis.Worker;
globalThis.Worker = class extends PageWorker {
	constructor(url: string | URL, options?: WorkerOptions) {
		super(url, options);
		const name = options?.name ?? String(url).split('/').pop()?.split('?')[0] ?? 'worker';
		started.push({ name, ref: new WeakRef(this) });
	}
};

/** The workers the page can still reach, by name without the job workers' numbers. */
function reachableWorkers(): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const { name, ref } of started) {
		if (!ref.deref()) continue;
		const role = name.replace(/-\d+$/, '');
		counts[role] = (counts[role] ?? 0) + 1;
	}
	return counts;
}

run('shared-memory', async () => {
	const before = COUNT_ROOM ? countRoom() : undefined;
	const room = before?.room ?? MOST_HELD;
	const cycles = Number(
		params.get('cycles') ?? Math.min(MAX_CYCLES, Math.max(MIN_CYCLES, room + EXTRA_CYCLES)),
	);
	const kinds: Partial<Record<Kind, KindResult>> = {};
	for (const kind of KINDS) {
		let done = 0;
		let cycleStart = 0;
		let failure: Pick<KindResult, 'error' | 'trail'> = {};
		try {
			for (; done < cycles; done++) {
				cycleStart = window.__null3dProgress?.length ?? 0;
				progress(`${kind}: cycle ${done + 1}`);
				await cycle(kind);
			}
		} catch (e) {
			failure = { error: (e as Error).message, trail: window.__null3dProgress?.slice(cycleStart) };
		}
		let roomAfter: number | undefined;
		let roomLater: number | undefined;
		if (COUNT_ROOM) {
			await sleep(SOON_MS);
			roomAfter = countRoom().room;
			await sleep(LATER_MS);
			roomLater = countRoom().room;
		}
		// Where the browser offers a collection, as Chrome does with --js-flags=--expose-gc.
		(globalThis as { gc?: () => void }).gc?.();
		kinds[kind] = {
			cycles: done,
			...failure,
			roomAfter,
			roomLater,
			memoriesGiven: given.length,
			memoriesReachable: given.filter((ref) => ref.deref() !== undefined).length,
			workersStarted: started.length,
			workersReachable: reachableWorkers(),
		};
	}
	return {
		maximumPages: MAXIMUM_PAGES,
		room: before?.room,
		roomError: before?.error,
		cycles,
		kinds,
	};
});
