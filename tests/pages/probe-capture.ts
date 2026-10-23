// Starts the engine live with a room, its mirror floor, and a glowing sphere that only the probe
// draws, and moves the sphere in three steps: to the right with probe.capture(), then back to the
// left without it. After each step it reads the sphere's reflection from a settled frame and notes
// the column that it stands in. So the test proves that a capture shows what moved, and that a
// probe that captures once keeps its map until a call asks for another.
import { createEngine, type Engine } from '@null3d/engine';
import { Slot } from '../../packages/engine/src/shared/control';
import { engineSlots, watchEngine } from './lib/engine-watch';
import { progress, run, toBase64 } from './lib/result';

/** One frame read back from the engine. */
interface Frame {
	width: number;
	height: number;
	pixels: Uint8Array;
}

/** The sphere's places, at the left and the right of the floor's reflection. */
const LEFT = -2.5;
const RIGHT = 2.5;
/**
 * The frames to let pass after a move before reading the floor. A probe captures in a frame after
 * the call, and its filter draws before the camera's passes.
 */
const AFTER_MOVE = 20;
/** The frames between the two reads that show a settled frame. */
const SETTLE_FRAMES = 2;
/** The most pairs of reads that a wait for a settled frame takes. */
const SETTLE_TRIES = 12;
/** The frames of a wait for the probe's first capture, and the most waits before the test fails. */
const FIRST_FRAMES = 30;
const FIRST_TRIES = 8;
/** The rows of the image that hold the floor, as shares of its height, from below the horizon to the near edge. */
const ROWS = [0.4, 1] as const;
/**
 * True for the sphere's color, a magenta that no wall or ceiling of the room holds. Its reflection
 * keeps the color, and every other surface of the floor is black or another hue.
 */
function isSphere([r, g, b]: readonly [number, number, number]): boolean {
	return r > g + 60 && b > g + 60;
}

/** Where the sphere reflects on the floor: the middle column of the reflection, as a share of the image's width, and its pixels' count. */
interface Reflection {
	x: number;
	count: number;
}

/** The middle column of the sphere's pixels between rows `ROWS`, and their count. */
function reflectionOf(frame: Frame): Reflection {
	const [top, bottom] = ROWS;
	let [x, count] = [0, 0];
	for (let row = Math.floor(top * frame.height); row < Math.floor(bottom * frame.height); row++)
		for (let column = 0; column < frame.width; column++) {
			const at = 4 * (row * frame.width + column);
			const pixel = [
				frame.pixels[at] as number,
				frame.pixels[at + 1] as number,
				frame.pixels[at + 2] as number,
			] as const;
			if (!isSphere(pixel)) continue;
			x += column;
			count++;
		}
	return count > 0 ? { x: x / count / frame.width, count } : { x: Number.NaN, count };
}

/** True when two frames hold the same pixels. */
function samePixels(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	for (let at = 0; at < a.length; at++) if (a[at] !== b[at]) return false;
	return true;
}

/**
 * Waits until the thread that draws has taken `count` frames after the one it holds now. Frames
 * pass without a readback, which a software GPU draws far faster than it reads one back.
 */
function framesLater(slots: Int32Array, count: number): Promise<void> {
	const from = Atomics.load(slots, Slot.FramesTaken);
	return new Promise((resolve) => {
		const check = () => {
			if (Atomics.load(slots, Slot.FramesTaken) - from >= count) resolve();
			else requestAnimationFrame(check);
		};
		requestAnimationFrame(check);
	});
}

/** Reads frames until two in a row agree, and returns the last. */
async function settled(engine: Engine, slots: Int32Array): Promise<Frame> {
	let frame = await engine.captureFrame();
	for (let tries = 0; tries < SETTLE_TRIES; tries++) {
		await framesLater(slots, SETTLE_FRAMES);
		const next = await engine.captureFrame();
		if (samePixels(next.pixels, frame.pixels)) return next;
		frame = next;
	}
	throw new Error('the floor showed no settled frame');
}

/**
 * Waits for the probe's first capture, whose map arrives a few frames after the sketch makes the
 * probe, and returns the settled frame that shows it.
 */
async function reflected(engine: Engine, slots: Int32Array): Promise<Frame> {
	for (let tries = 0; tries < FIRST_TRIES; tries++) {
		await framesLater(slots, FIRST_FRAMES);
		if (reflectionOf(await engine.captureFrame()).count > 0) return settled(engine, slots);
	}
	throw new Error('the floor showed no reflection of the sphere');
}

run('probe-capture', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const stopWatch = watchEngine();
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/probe-capture-sketch.ts', import.meta.url),
		maxPixelRatio: 1,
	});
	progress(`engine started: ${engine.mode.latency} latency, ${engine.mode.renderThread} draws`);
	await engine.firstFrame;
	const slots = engineSlots();
	if (!slots) throw new Error('the engine handed no control block to a worker');
	// The probe captures once when the sketch makes it, with the sphere at the left.
	const before = reflectionOf(await reflected(engine, slots));
	progress(`the sphere reflects at ${before.x.toFixed(3)} before it moves`);
	// A move that the page captures again: the floor reflects the sphere where it moved to.
	engine.postToSketch('move', { x: RIGHT, capture: true });
	await framesLater(slots, AFTER_MOVE);
	const afterFrame = await settled(engine, slots);
	const after = reflectionOf(afterFrame);
	progress(`the sphere reflects at ${after.x.toFixed(3)} after a capture`);
	// A move with no call: the probe keeps its map, so the floor still reflects the sphere at the
	// right, while the sphere itself stands at the left of the image.
	engine.postToSketch('move', { x: LEFT, capture: false });
	await framesLater(slots, AFTER_MOVE);
	const stale = reflectionOf(await settled(engine, slots));
	progress(`the sphere reflects at ${stale.x.toFixed(3)} without a capture`);
	await engine.destroy();
	progress('engine destroyed');
	stopWatch();
	console.log(
		`reflection columns: before ${before.x.toFixed(3)} of ${before.count} pixels, after ${after.x.toFixed(3)} of ${after.count}, stale ${stale.x.toFixed(3)} of ${stale.count}`,
	);
	return {
		tier: engine.capabilities.tier,
		mode: engine.mode,
		beforeX: before.x,
		afterX: after.x,
		staleX: stale.x,
		beforeCount: before.count,
		afterCount: after.count,
		staleCount: stale.count,
		// The reflection stood at the left, moved to the right when the page captured again, and
		// stayed at the right when the sphere moved back without a call.
		beforeLeft: before.x < 0.45,
		refreshed: after.x > 0.55,
		stale: stale.x > 0.55,
		width: afterFrame.width,
		height: afterFrame.height,
		pixels: toBase64(afterFrame.pixels),
	};
});
