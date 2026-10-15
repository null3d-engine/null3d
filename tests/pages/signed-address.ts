// Grows the engine's shared memory past 2 GiB, then draws and stops the engine, so the addresses
// the render worker and the page read from the shared Int32 slots pass 2 GiB and would read signed
// without `>>> 0` (hard rule 31, .dev/implementation-notes.md "Addresses above 2 GiB"). The page
// asks for the largest maximum a page may ask for (4096 MiB, D-04) and grows the memory itself,
// through the memory that the engine hands to its workers. The scene then fills the engine's low
// heap and grows its draw list until the list moves above 2 GiB, which the page reads from the
// control slots. It then draws and stops the engine, which ends the job workers through the wake
// and stop addresses.
import { createEngine, EngineError } from '@null3d/engine';
import * as Slot from '../../packages/engine/src/shared/slot';
import { progress, run } from './lib/result';

/** The memory's maximum that the page asks for, in MiB: the largest a page may ask for (D-04). */
const MAXIMUM_MIB = 4096;
/** The size the page grows the memory to, in MiB: above the 2 GiB that signed reads break at. */
const GROW_TO_MIB = 2052;
/** WebAssembly memory comes in pages of 64 KiB. */
const PAGE_BYTES = 65_536;
/** The hidden batches the sketch makes to fill the engine's low heap. */
const BATCHES = 250;
/** The address at or above which a signed 32-bit read is negative. */
const SIGNED_LIMIT = 2 ** 31;
/** How long the page waits for the draw list to move above 2 GiB. */
const MOVE_TIMEOUT_MS = 40_000;
/** The frames the renderer must draw after the draw list moved, and how long it may take. */
const FRAMES_AFTER_MOVE = 3;
const DRAW_TIMEOUT_MS = 20_000;
/** How long the engine may take to stop. */
const STOP_TIMEOUT_MS = 30_000;

interface SignedAddressResult extends Record<string, unknown> {
	threaded?: boolean;
	skipped?: string;
	memoryBeforeMiB?: number;
	memoryAfterMiB?: number;
	/** The highest draw list address the page read from the control slots, as an unsigned number. */
	drawListAddress?: number;
	/** The words of the draw list that the page read last. */
	drawListWords?: number;
	made?: number;
	/** The frame the renderer had drawn when the draw list moved, from the control slots. */
	presentedAtMove?: number;
	/** The frame the renderer drew last before the stop, from the control slots. */
	presented?: number;
	stopMs?: number;
	failures?: string[];
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Resolves, or rejects after `ms`, so a stop that hangs fails instead of waiting for good. */
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

run('signed-address', async (): Promise<SignedAddressResult> => {
	// The engine hands its shared memory and its control block to each worker it starts. The page
	// reads the same memory and the same slots, so it captures them from those messages.
	let capturedMemory: WebAssembly.Memory | undefined;
	let capturedControl: ArrayBufferLike | undefined;
	const post = Worker.prototype.postMessage;
	Worker.prototype.postMessage = function (this: Worker, message: unknown, ...rest: unknown[]) {
		const handoff = message as { memory?: WebAssembly.Memory; control?: ArrayBufferLike } | null;
		if (handoff?.memory instanceof WebAssembly.Memory && !capturedMemory)
			capturedMemory = handoff.memory;
		if (handoff?.control !== undefined && !capturedControl) capturedControl = handoff.control;
		return (post as (...args: unknown[]) => void).call(this, message, ...rest);
	};

	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	let engine: Awaited<ReturnType<typeof createEngine>>;
	try {
		engine = await createEngine({
			canvas,
			sketch: new URL('./sketches/signed-address-sketch.ts', import.meta.url),
			maxPixelRatio: 1,
			memory: { maximumMiB: MAXIMUM_MIB },
		});
	} catch (e) {
		if (e instanceof EngineError && e.code === 'E1109')
			return { threaded: true, skipped: `the browser refused the memory: ${e.message}` };
		throw e;
	}
	const failures: string[] = [];
	engine.onFailure((error) => failures.push(`${error.code}: ${error.message}`));
	await engine.firstFrame;
	if (engine.mode.build !== 'threaded') {
		await engine.destroy();
		return { threaded: false, skipped: 'the page is not isolated, so the engine shares no memory' };
	}
	const shared = capturedMemory;
	const controlBuffer = capturedControl;
	if (!shared || !controlBuffer) {
		await engine.destroy();
		throw new Error('the page saw the engine hand no shared memory to a worker');
	}
	const slots = new Int32Array(controlBuffer);

	const memoryBeforeMiB = Math.round(shared.buffer.byteLength / 2 ** 20);
	// Grow the memory itself, in steps, so a slow grow does not stall one call.
	const targetPages = (GROW_TO_MIB * 2 ** 20) / PAGE_BYTES;
	try {
		while (shared.buffer.byteLength / PAGE_BYTES < targetPages)
			shared.grow(Math.min(4096, targetPages - shared.buffer.byteLength / PAGE_BYTES));
	} catch (e) {
		await engine.destroy();
		return {
			threaded: true,
			memoryBeforeMiB,
			skipped: `the browser refused the memory: ${(e as Error).message}`,
		};
	}
	const memoryAfterMiB = Math.round(shared.buffer.byteLength / 2 ** 20);
	progress(`the memory is ${memoryAfterMiB} MiB`);
	if (memoryAfterMiB < 2048) {
		await engine.destroy();
		return {
			threaded: true,
			memoryBeforeMiB,
			memoryAfterMiB,
			skipped: 'the memory did not pass 2 GiB',
		};
	}

	// The scene fills the engine's low heap with hidden batches, then grows its draw list, which
	// must then grow from the memory's new end, above 2 GiB.
	let made = 0;
	engine.onSketchMessage((name, data) => {
		if (name === 'grow-received') progress(`the sketch heard the grow: ${JSON.stringify(data)}`);
		if (name === 'batches')
			progress(`the filling batches left: ${(data as { left: number }).left}`);
		if (name === 'made') made = (data as { made: number }).made;
	});
	engine.postToSketch('grow', { batches: BATCHES });
	const deadline = performance.now() + MOVE_TIMEOUT_MS;
	let drawListAddress = 0;
	let drawListWords = 0;
	let noted = 0;
	while (performance.now() < deadline) {
		drawListAddress = Math.max(
			drawListAddress,
			Atomics.load(slots, Slot.DrawListAddress0) >>> 0,
			Atomics.load(slots, Slot.DrawListAddress1) >>> 0,
		);
		drawListWords = Math.max(
			drawListWords,
			Atomics.load(slots, Slot.DrawListWords0) >>> 0,
			Atomics.load(slots, Slot.DrawListWords1) >>> 0,
		);
		if (performance.now() - noted > 4_000) {
			noted = performance.now();
			progress(
				`the draw list is ${drawListAddress} bytes, ${drawListWords} words, after ${made} objects`,
			);
		}
		if (drawListAddress >= SIGNED_LIMIT) break;
		await sleep(25);
	}
	progress(
		`the draw list is ${drawListAddress} bytes, ${drawListWords} words, after ${made} objects`,
	);

	// The renderer must go on drawing from the moved list: the frame it drew last must move on. A
	// frame that failed to replay raises through `onFailure`, which `failures` collects. The frame
	// counter needs no page measurement, which with a memory this size can hold a job worker's
	// thread for a while.
	const framePresented = () => Atomics.load(slots, Slot.FramePresented) >>> 0;
	const presentedAtMove = framePresented();
	const drawDeadline = performance.now() + DRAW_TIMEOUT_MS;
	while (framePresented() < presentedAtMove + FRAMES_AFTER_MOVE && performance.now() < drawDeadline)
		await sleep(25);
	engine.postToSketch('stop');
	const presented = framePresented();
	progress(`the renderer drew frame ${presented}, and frame ${presentedAtMove} at the move`);
	const stopStart = performance.now();
	await withTimeout(engine.destroy(), STOP_TIMEOUT_MS, 'the engine stop');
	const stopMs = Math.round(performance.now() - stopStart);
	return {
		threaded: true,
		memoryBeforeMiB,
		memoryAfterMiB,
		drawListAddress,
		drawListWords,
		made,
		presentedAtMove,
		presented,
		stopMs,
		failures,
	};
});
