// Checks that the browser gets back the memory of a stopped engine, so a page can start the engine
// again and again. It counts how many shared memories with the engine's default maximum the page
// can hold at once, its room, up to a cap: a count holds what it counts until the browser frees it,
// and Safari frees it late, so a count of a large room left the pages after it none. The page then
// starts and stops the engine, in the mode the page's switches ask for, more times than the room
// holds, and counts the room again once they stop. Where the count reached its cap, the starts go
// past the most room that Safari on a Mac has had. An engine whose memory the browser never gets
// back takes room that a later one needs, so a later start fails or the room after is smaller.
// Safari gives a stopped engine's memory back only seconds later on a slow machine, so a start that
// Safari refuses waits and tries again, and the page waits for the room to come back, each within a
// bound, before it reports. The page also reports how many of the memories it gave to workers, and
// how many of those workers, it can still reach.
//
// Safari can also lose room once without holding any memory: the room is a count of free 1 GiB
// address ranges, and small buffers that land in freed ranges split them for good. So when the room
// does not come back, the page starts and stops the engines a second time from the room it has now.
// Engines whose memory the browser keeps take room on every round, and a range lost once does not.
//
// ?kinds= tests other ways a thread holds a shared memory, such as a worker stopped inside a
// blocking wait (see ./lib/memory-holder.ts). ?cycles= sets the number of starts and stops in each
// round, ?room=off skips the counts of the room, ?room=each also counts it after each start, and
// ?room=full counts the whole room, as the memory plan does.
import { createEngine, EngineError } from '@null3d/engine';
import { coreUrls, probeCapabilities } from '@null3d/engine/internal';
import type { EngineFrameMessage } from './engine-frame';
import { CORE_KINDS, type HoldKind, type HoldMessage, WOKEN_KINDS } from './lib/memory-holder';
import { progress, run } from './lib/result';
import {
	allocateMemory,
	countRoom,
	DEFAULT_MAXIMUM_PAGES,
	FULL_COUNT,
	MOST_ROOM_SEEN,
	ROOM_CAP,
	ROOM_KEPT,
	roomAfterPauses,
} from './lib/room';

const params = new URLSearchParams(location.search);
/** The memories' maximum in 64 KiB pages: 1 GiB, the engine's default, unless ?maximum sets it. */
const MAXIMUM_PAGES = Number(params.get('maximum') ?? DEFAULT_MAXIMUM_PAGES);
/** Cycles beyond the room: enough that memories the browser never gets back use it up. */
const EXTRA_CYCLES = 4;
/** The fewest cycles, and the cycles of a page that counts no room. */
const MIN_CYCLES = 3;
const UNCOUNTED_CYCLES = 10;
/** How long the page waits after a worker is ready, so that a blocking worker is inside its wait. */
const SETTLE_MS = 50;
/** How long a worker may take to get ready, and the engine to start and to draw its first frame. */
const READY_TIMEOUT_MS = 5_000;
const ENGINE_TIMEOUT_MS = 20_000;
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
/** The cap of each count of the room. */
const CAP = params.get('room') === 'full' ? FULL_COUNT : ROOM_CAP;
/**
 * True when the engine's threads share its memory. The single-threaded build takes no shared
 * memory, so its starts never go past the room: they would only split the address space.
 */
const THREADED = params.get('threads') !== 'off';

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

let coreModule: Promise<WebAssembly.Module> | undefined;

/** Gives a new memory to a worker that holds it the way `kind` says, then stops the worker. */
async function holdAndStop(kind: HoldKind): Promise<void> {
	const memory = allocateMemory(MAXIMUM_PAGES);
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
		if (last) last.roomAfter = (await countRoom(CAP, MAXIMUM_PAGES)).room;
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
	else if (kind === 'dropped') allocateMemory(MAXIMUM_PAGES);
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
	const wait =
		roomBefore === undefined
			? undefined
			: await roomAfterPauses(roomBefore - ROOM_KEPT, CAP, MAXIMUM_PAGES);
	return {
		cycles: done,
		...failure,
		lateStarts: late.starts,
		lateStartsMs: Math.round(late.ms),
		roomCounts: wait?.counts,
		roomLater: wait?.counts.at(-1),
		roomWaitMs: wait?.waitMs,
		starts: starts.splice(0),
	};
}

run('shared-memory', async () => {
	const before = COUNT_ROOM ? await countRoom(CAP, MAXIMUM_PAGES) : undefined;
	// The starts go past the room, so memory that engines keep stops a later start. Stopped engines
	// on kept canvases may hold their memory until a new engine needs it, and those starts show that
	// such memory never stops one. A count that the browser refused below its cap is the whole room;
	// one that reached the cap is not, so the starts then go past the most room seen.
	const room = before?.error === undefined ? MOST_ROOM_SEEN : before.room;
	const past = Math.max(MIN_CYCLES, room + EXTRA_CYCLES);
	const cycles = Number(
		params.get('cycles') ??
			(before ? (THREADED ? past : Math.min(past, UNCOUNTED_CYCLES)) : UNCOUNTED_CYCLES),
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
