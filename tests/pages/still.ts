// Starts the engine live with the anti-aliasing tests' edges scene, which holds still, on the GPU
// tier that the switches ask for, with the still-camera accumulation on (?still=on). The view
// blends its frames and then rests: the thread that draws takes frames without drawing them, while
// the sketch keeps stepping. The page reports the frames until the view rested, then moves the box
// once and reports whether the next frames drew and whether the view rested again. With ?image it
// instead captures the converged frame of the resting view, for the image tests.
import { createEngine } from '@null3d/engine';
import { Slot } from '../../packages/engine/src/shared/control';
import { engineSlots, watchEngine } from './lib/engine-watch';
import { progress, run, toBase64 } from './lib/result';

/** Frames the thread that draws takes in a row without drawing, after which the view rests. */
const RESTING_FRAMES = 20;
/** The longest wait for the view to rest, which the software GPU's slow frames need. */
const REST_LIMIT_MS = 20_000;
/** The longest wait for a frame to draw after the scene changed. */
const DRAW_LIMIT_MS = 5000;

/** Frames taken and the time since the start of a wait, once the view rests. */
interface Rest {
	frames: number;
	ms: number;
}

/**
 * Waits until the thread that draws has taken `RESTING_FRAMES` frames in a row without drawing,
 * checking in each animation frame callback, and returns the frames it took until it last drew.
 * Gives `undefined` after `REST_LIMIT_MS`.
 */
function rest(slots: Int32Array): Promise<Rest | undefined> {
	const start = performance.now();
	const first = Atomics.load(slots, Slot.FramesTaken);
	let presented = Atomics.load(slots, Slot.FramePresented);
	let drewAt = first;
	return new Promise((resolve) => {
		const check = () => {
			const taken = Atomics.load(slots, Slot.FramesTaken);
			const shown = Atomics.load(slots, Slot.FramePresented);
			if (shown !== presented) {
				presented = shown;
				drewAt = taken;
			} else if (taken - drewAt >= RESTING_FRAMES) {
				resolve({ frames: drewAt - first, ms: performance.now() - start });
				return;
			}
			if (performance.now() - start > REST_LIMIT_MS) resolve(undefined);
			else requestAnimationFrame(check);
		};
		requestAnimationFrame(check);
	});
}

/** Waits until the thread that draws presents a frame after `frame`; false after the limit. */
function drawsAfter(slots: Int32Array, frame: number): Promise<boolean> {
	const start = performance.now();
	return new Promise((resolve) => {
		const check = () => {
			if (Atomics.load(slots, Slot.FramePresented) !== frame) resolve(true);
			else if (performance.now() - start > DRAW_LIMIT_MS) resolve(false);
			else requestAnimationFrame(check);
		};
		requestAnimationFrame(check);
	});
}

run('still', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const stopWatch = watchEngine();
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/edges-sketch.ts', import.meta.url),
		maxPixelRatio: 1,
	});
	await engine.firstFrame;
	const slots = engineSlots();
	if (!slots) throw new Error('the engine handed no control block to a worker');
	const first = await rest(slots);
	progress(first ? `rested after ${first.frames} frames` : 'did not rest');
	const reported = {
		tier: engine.capabilities.tier,
		mode: engine.mode,
		rested: first !== undefined,
	};
	if (new URLSearchParams(location.search).has('image')) {
		const { width, height, pixels } = await engine.captureFrame();
		await engine.destroy();
		stopWatch();
		return { ...reported, width, height, pixels: toBase64(pixels) };
	}
	const presented = Atomics.load(slots, Slot.FramePresented);
	engine.postToSketch('move', null);
	const drewAfterChange = await drawsAfter(slots, presented);
	const again = await rest(slots);
	await engine.destroy();
	stopWatch();
	return {
		...reported,
		restFrames: first?.frames,
		restMs: first?.ms,
		drewAfterChange,
		restedAgain: again !== undefined,
		restAgainFrames: again?.frames,
	};
});
