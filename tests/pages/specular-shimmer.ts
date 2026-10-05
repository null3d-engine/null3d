// Measures specular shimmer: how much the highlights of small shiny shapes flicker from frame to
// frame as the camera moves (sketches/specular-shimmer-sketch.ts). The page steps the sketch's
// camera through a row of times a short step apart and captures a frame at each. It draws the
// row twice: at the canvas's size, and at SUPERSAMPLE times its width and height, averaged down to
// the canvas's pixels. The averaged frames are the truth: each pixel holds the mean light of its
// whole area, which moves smoothly with the camera. A highlight narrower than a pixel comes and
// goes in the frames of the canvas's size, and the averaged frames show it as a steady spot.
//
// A pixel's flicker is the size of its second difference over time, which a smooth change leaves
// near 0. The 8-bit frames round each value, and the final pass dithers, so a smooth change of a
// mid-tone pixel still steps by a level now and then. That noise grows with the area of soft
// highlights, not with their flicker. So the page counts only the part of each second difference
// beyond NOISE_LEVELS: a highlight that comes and goes jumps by far more. It reports that flicker
// for the canvas's frames and for the truth, their difference (the shimmer), and the mean
// distance from the truth, each over the whole frame and in steps of 1/255. ?scene= names the
// sketch's scene, ?frames= the number of frames, and ?step= the sketch time between them in
// seconds.
import { createEngine } from '@null3d/engine';
import { progress, run } from './lib/result';

const params = new URLSearchParams(location.search);
const FRAMES = Number(params.get('frames') ?? 48);
const STEP = Number(params.get('step') ?? 0.05);
const SCENE = params.get('scene') ?? 'small';
/**
 * The part of a second difference, in steps of 1/255, that rounding and dithering can give a pixel
 * that changes smoothly: a step of one level at each of three frames.
 */
const NOISE_LEVELS = 4;
/** The canvas's size in CSS pixels, which the page draws at one device pixel each. */
const WIDTH = 480;
const HEIGHT = 270;
/** How many times wider and taller the frames of the truth draw. */
const SUPERSAMPLE = 4;
/** How long the page waits after each move of the camera before it captures a frame. */
const SETTLE_MS = 150;

/**
 * Each pixel's luminance from RGBA8 pixels of `scale` times the canvas's size, averaged over each
 * square of `scale` by `scale` pixels, with the Rec. 709 weights, from 0 to 255.
 */
function luminance(pixels: Uint8Array, scale: number): Float32Array {
	const out = new Float32Array(WIDTH * HEIGHT);
	const width = WIDTH * scale;
	for (let y = 0; y < HEIGHT * scale; y++)
		for (let x = 0; x < width; x++) {
			const at = 4 * (y * width + x);
			const p = Math.floor(y / scale) * WIDTH + Math.floor(x / scale);
			out[p] =
				(out[p] as number) +
				(0.2126 * (pixels[at] as number) +
					0.7152 * (pixels[at + 1] as number) +
					0.0722 * (pixels[at + 2] as number)) /
					(scale * scale);
		}
	return out;
}

/** The frames of the camera's row, drawn at `scale` times the canvas's size. */
async function drawRow(scale: number): Promise<{ tier: string; frames: Float32Array[] }> {
	const canvas = document.createElement('canvas');
	canvas.style.width = `${WIDTH * scale}px`;
	canvas.style.height = `${HEIGHT * scale}px`;
	document.body.append(canvas);
	const engine = await createEngine({
		canvas,
		sketch: new URL(`./sketches/specular-shimmer-sketch.ts?scene=${SCENE}`, import.meta.url),
		maxPixelRatio: 1,
	});
	await engine.firstFrame;
	let placed: (() => void) | undefined;
	engine.onSketchMessage((name) => {
		if (name === 'placed') placed?.();
	});
	const frames: Float32Array[] = [];
	for (let k = 0; k < FRAMES; k++) {
		await new Promise<void>((resolve) => {
			placed = resolve;
			engine.postToSketch('at', k * STEP);
		});
		// Frames that were in flight when the camera moved still show it where it was, so the page
		// lets a few frames pass before it captures.
		await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
		frames.push(luminance((await engine.captureFrame()).pixels, scale));
		progress(`frame ${k} at ${scale}x`);
	}
	const tier = engine.capabilities.tier;
	await engine.destroy();
	canvas.remove();
	return { tier, frames };
}

/**
 * The mean size of each pixel's second difference over time beyond NOISE_LEVELS, over every
 * pixel.
 */
function flicker(frames: readonly Float32Array[]): number {
	let sum = 0;
	for (let k = 1; k + 1 < frames.length; k++) {
		const before = frames[k - 1] as Float32Array;
		const now = frames[k] as Float32Array;
		const after = frames[k + 1] as Float32Array;
		for (let p = 0; p < now.length; p++)
			sum += Math.max(
				Math.abs((after[p] as number) - 2 * (now[p] as number) + (before[p] as number)) -
					NOISE_LEVELS,
				0,
			);
	}
	return sum / ((frames.length - 2) * WIDTH * HEIGHT);
}

run('specular-shimmer', async () => {
	const drawn = await drawRow(1);
	const truth = await drawRow(SUPERSAMPLE);
	let error = 0;
	let light = 0;
	drawn.frames.forEach((frame, k) => {
		const exact = truth.frames[k] as Float32Array;
		for (let p = 0; p < frame.length; p++) {
			error += Math.abs((frame[p] as number) - (exact[p] as number));
			light += exact[p] as number;
		}
	});
	const samples = FRAMES * WIDTH * HEIGHT;
	const drawnFlicker = flicker(drawn.frames);
	const trueFlicker = flicker(truth.frames);
	return {
		tier: drawn.tier,
		scene: SCENE,
		frames: FRAMES,
		/** The mean luminance of the truth, for scale. */
		light: light / samples,
		/** The flicker of the frames at the canvas's size, and of the truth. */
		flicker: drawnFlicker,
		trueFlicker,
		/** How much the frames flicker beyond the truth: the shimmer. */
		shimmer: drawnFlicker - trueFlicker,
		/** How far the frames lie from the truth on average. */
		error: error / samples,
	};
});
