// Checks that the browser gets back the memory of a stopped engine, so a page can start the engine
// again and again. It counts how many shared memories with the engine's default maximum the page
// can hold at once: its room. It then starts and stops the engine, in the mode the page's switches
// ask for, more times than that where the room is small, and counts the room again once they stop.
// An engine whose memory the browser never gets back takes room that a later one needs, so a later
// start fails or the room after is smaller. Safari gives a stopped engine's memory back only seconds
// later on a slow machine, so a start that Safari refuses waits and tries again, and the page waits
// for the room to come back, each within a bound, before it reports. The page also reports how many
// of the memories it gave to workers, and how many of those workers, it can still reach.
//
// Safari can also lose room once without holding any memory: the room is a count of free 1 GiB
// address ranges, and small buffers that land in freed ranges split them for good. So when the room
// does not come back, the page starts and stops the engines a second time from the room it has now.
// Engines whose memory the browser keeps take room on every round, and a range lost once does not.
//
// ?kinds= tests other ways a thread holds a shared memory, such as a worker stopped inside a
// blocking wait (see ./lib/memory-holder.ts). ?cycles= sets the number of starts and stops in each
// round, ?room=off skips the counts of the room, and ?room=each also counts it after each start.
import { createEngine, EngineError } from '@null3d/engine';
import { coreUrls, probeCapabilities } from '@null3d/engine/internal';
import type { EngineFrameMessage } from './engine-frame';
import { CORE_KINDS, type HoldKind, type HoldMessage, WOKEN_KINDS } from './lib/memory-holder';
import { progress, run } from './lib/result';
import { ROOM_KEPT } from './lib/room';

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
/**
 * The pauses before each count of the room after the cycles, until the room comes back. Safari
 * frees a memory only after a full collection finds it unused and its sweeper then reaches it. Each
 * count ends with a collection, and the pause gives Safari time to free what it found. The pauses
 * grow, because each collection starts the sweep again, and then hold at the longest. Safari frees
 * the memory of engines in removed frames late, at times long after the frames have gone, so the
 * wait in all is about twice the slowest return of the room seen in Safari, as the implementation
 * notes record. A shorter wait failed checks whose room came back later. Memory that engines keep
 * never comes back, so a real leak still fails, only later.
 */
const ROOM_PAUSES_MS = [1_000, 1_000, 2_000, 4_000, 8_000, 15_000, 15_000, 15_000, 15_000, 15_000];
/**
 * How long, in all, the starts that the browser refuses may wait for it to free the stopped
 * engines' memory, beyond the engine's own wait of about 10 seconds for each start.
 */
const LATE_STARTS_MS = 30_000;
/** The pause before the page tries a refused start again. */
const LATE_START_PAUSE_MS = 1_000;

/**
 * The ways of holding a memory: the engine's start and stop on this page, on a canvas that the page
 * removes after the stop or that stays in the page, the engine's start in a frame that the page
 * removes while the engine runs or after the engine stops, or one of the smaller tests.
 */
type Kind = 'engine' | 'canvas-kept' | 'frame' | 'frame-destroyed' | 'dropped' | 'probe' | HoldKind;
const KINDS = (params.get('kinds')?.split(',') ?? ['engine']) as Kind[];
const COUNT_ROOM = params.get('room') !== 'off';
const COUNT_EACH = params.get('room') === 'each';

/** One round of starts and stops, and the counts of the room after it. */
interface RoundResult {
	cycles: number;
	error?: string;
	/** The page's steps in the cycle that failed. */
	trail?: string[];
	/** Starts that the browser refused at first, and the time they waited for it, in all. */
	lateStarts: number;
	lateStartsMs: number;
	/** Each count of the room after the cycles, the last of them, and the time they took. */
	roomCounts?: number[];
	roomLater?: number;
	roomWaitMs?: number;
	/** Each start and stop of the engine on the page. */
	starts: StartRecord[];
}

interface KindResult extends RoundResult {
	/**
	 * The second round, which runs when the room did not come back after the first. It starts from
	 * the room that the first round left.
	 */
	again?: RoundResult & { room: number };
	/** For each frame that the page removed while its engine ran, the job workers still in the job loop. */
	jobsServingAtLeave: number[];
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

/**
 * Counts the room, then lets the browser find the counted memories unused. Once they are garbage,
 * the page asks for one more memory. The count filled the room, so Safari refuses it and runs a full
 * collection, which finds them. Otherwise Safari can keep them until a later refusal, and the next
 * count finds less room.
 */
async function countRoomAndRelease(): Promise<{ room: number; error?: string }> {
	const counted = countRoom();
	await sleep(0);
	try {
		allocate();
	} catch {
		// The refusal is the point: it makes the browser collect.
	}
	return counted;
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

/**
 * What each start and stop of the engine on the page did: when its first frame came and how long
 * its stop took, and how many job workers had reported ready by the stop and stopped by its end.
 */
interface StartRecord {
	firstFrameMs: number;
	stopMs: number;
	jobs: number;
	jobsReadyAtStop: number;
	jobsStopped: number;
	roomAfter?: number;
}
const starts: StartRecord[] = [];

/** The job workers that a slice of the page's trail names with `reply`. */
const jobsWith = (steps: readonly string[], reply: string) =>
	new Set(steps.flatMap((s) => s.match(new RegExp(`(null3d-job-\\d+): ${reply}$`))?.[1] ?? []))
		.size;

/**
 * Starts the engine on a new canvas, waits for its first frame, and stops it. With `keepCanvas`,
 * the canvas stays in the page, as an app may keep it for its next engine. A worker that drew on
 * it then stays with it, and must not keep the stopped engine's memory.
 */
async function startAndStopEngine(keepCanvas: boolean): Promise<void> {
	const canvas = document.createElement('canvas');
	canvases.push(canvas);
	document.body.append(canvas);
	const trail = window.__null3dProgress ?? [];
	const from = trail.length;
	const began = performance.now();
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
		let stopAt = 0;
		let stopIndex = 0;
		try {
			await withTimeout(engine.firstFrame, ENGINE_TIMEOUT_MS, 'the first frame');
		} finally {
			stopAt = performance.now();
			stopIndex = trail.length;
			await engine.destroy();
			const steps = trail.slice(from);
			starts.push({
				firstFrameMs: Math.round(stopAt - began),
				stopMs: Math.round(performance.now() - stopAt),
				jobs: jobsWith(steps, 'started'),
				jobsReadyAtStop: jobsWith(trail.slice(from, stopIndex), 'ready'),
				jobsStopped: jobsWith(steps, 'stopped'),
			});
		}
	} finally {
		if (!keepCanvas) canvas.remove();
	}
	if (COUNT_EACH) {
		const last = starts.at(-1);
		if (last) last.roomAfter = (await countRoomAndRelease()).room;
	}
}

/**
 * Starts the engine in a frame, in the mode the page's switches ask for, and removes the frame
 * once the engine has drawn its first frame. With `destroy`, the frame stops the engine first.
 */
async function startEngineInFrame(destroy: boolean): Promise<void> {
	const frame = document.createElement('iframe');
	const switches = new URLSearchParams(location.search);
	for (const name of ['kinds', 'cycles', 'room', 'maximum']) switches.delete(name);
	if (destroy) switches.set('stop', 'destroy');
	frame.src = `./engine-frame.html?${switches}`;
	try {
		const message = await withTimeout(
			new Promise<EngineFrameMessage>((resolve) => {
				const listen = ({ source, data }: MessageEvent) => {
					if (source !== frame.contentWindow || !(data as EngineFrameMessage)?.engineFrame) return;
					removeEventListener('message', listen);
					resolve(data);
				};
				addEventListener('message', listen);
				document.body.append(frame);
			}),
			ENGINE_TIMEOUT_MS,
			'the engine start in a frame',
		);
		if (message.engineFrame === 'failed')
			throw message.code === 'E1109'
				? new EngineError('E1109', message.error ?? 'refused')
				: new Error(message.error);
	} catch (e) {
		// The frame's own steps and the engine's control slots tell how far its start got.
		const view = frame.contentWindow as Window | null;
		for (const step of view?.__null3dProgress ?? []) progress(`in the frame: ${step}`);
		progress(`in the frame: control slots: ${view?.__engineFrameSlots?.() ?? 'out of reach'}`);
		throw e;
	} finally {
		frame.remove();
	}
}

/** The starts that the browser refused at first, and their time from the first try to the last. */
const late = { starts: 0, ms: 0 };

/**
 * Starts and stops the engine. When the browser refuses the engine's memory (E1109), Safari may not
 * have freed the stopped engines' memory yet, so the page waits and tries again while its budget for
 * late starts lasts. Memory that never comes back uses up the budget, and the start then fails.
 */
async function startAndStopEngineOnceFree(start: () => Promise<void>): Promise<void> {
	const started = performance.now();
	let refused = false;
	try {
		for (;;) {
			try {
				return await start();
			} catch (e) {
				const waited = performance.now() - started;
				if (!(e instanceof EngineError && e.code === 'E1109') || late.ms + waited > LATE_STARTS_MS)
					throw e;
				refused = true;
				progress('the browser refused the memory, so the page waits and starts the engine again');
				await sleep(LATE_START_PAUSE_MS);
			}
		}
	} finally {
		if (refused) {
			late.starts++;
			late.ms += performance.now() - started;
		}
	}
}

async function cycle(kind: Kind): Promise<void> {
	if (kind === 'engine') await startAndStopEngineOnceFree(() => startAndStopEngine(false));
	else if (kind === 'canvas-kept') await startAndStopEngineOnceFree(() => startAndStopEngine(true));
	else if (kind === 'frame') await startAndStopEngineOnceFree(() => startEngineInFrame(false));
	else if (kind === 'frame-destroyed')
		await startAndStopEngineOnceFree(() => startEngineInFrame(true));
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

/**
 * Starts and stops `cycles` times in the way `kind` says, then, given the room before, counts the
 * room after pauses until it comes back to within the room that the page may lose, or the pauses
 * end.
 */
async function round(kind: Kind, cycles: number, roomBefore?: number): Promise<RoundResult> {
	let done = 0;
	let cycleStart = 0;
	let failure: Pick<RoundResult, 'error' | 'trail'> = {};
	late.starts = 0;
	late.ms = 0;
	try {
		for (; done < cycles; done++) {
			cycleStart = window.__null3dProgress?.length ?? 0;
			progress(`${kind}: cycle ${done + 1}`);
			await cycle(kind);
		}
	} catch (e) {
		failure = { error: (e as Error).message, trail: window.__null3dProgress?.slice(cycleStart) };
	}
	let roomCounts: number[] | undefined;
	let roomWaitMs: number | undefined;
	if (roomBefore !== undefined) {
		const waitStart = performance.now();
		roomCounts = [];
		for (const pause of ROOM_PAUSES_MS) {
			await sleep(pause);
			const { room } = await countRoomAndRelease();
			roomCounts.push(room);
			if (room >= roomBefore - ROOM_KEPT) break;
		}
		roomWaitMs = Math.round(performance.now() - waitStart);
	}
	return {
		cycles: done,
		...failure,
		lateStarts: late.starts,
		lateStartsMs: Math.round(late.ms),
		roomCounts,
		roomLater: roomCounts?.at(-1),
		roomWaitMs,
		starts: starts.splice(0),
	};
}

run('shared-memory', async () => {
	const before = COUNT_ROOM ? await countRoomAndRelease() : undefined;
	const room = before?.room ?? MOST_HELD;
	// Stopped engines on kept canvases may hold their memory until a new engine needs it, so where
	// the browser limits the room, those starts go past it, to show that such memory never stops a
	// start.
	const most = KINDS.includes('canvas-kept') && room < MOST_HELD ? room + EXTRA_CYCLES : MAX_CYCLES;
	const cycles = Number(
		params.get('cycles') ?? Math.min(most, Math.max(MIN_CYCLES, room + EXTRA_CYCLES)),
	);
	const kinds: Partial<Record<Kind, KindResult>> = {};
	for (const kind of KINDS) {
		window.__jobsServingAtLeave = [];
		const first = await round(kind, cycles, before?.room);
		const left = first.roomLater;
		const again =
			before && left !== undefined && left < before.room - ROOM_KEPT && !first.error
				? { room: left, ...(await round(kind, cycles, left)) }
				: undefined;
		// Where the browser offers a collection, as Chrome does with --js-flags=--expose-gc.
		(globalThis as { gc?: () => void }).gc?.();
		kinds[kind] = {
			...first,
			again,
			jobsServingAtLeave: window.__jobsServingAtLeave,
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
