// Checks that a shifted lens draws the matching crop of a wider view, on the GPU path that the
// switches ask for and with the lens that ?lens= names. With ?mode=view, one engine draws the wide
// camera, then adds a view of the narrow, shifted camera over its rectangle of the canvas: the two
// frames must match. With ?mode=canvas, one engine draws the wide camera on a canvas twice the size
// each way, and another draws the narrow camera alone on a canvas of the rectangle's size: its frame
// must match the wide frame's rectangle, pixel for pixel, shadows included, which the sun fits to
// each camera's own view. The page reports how many pixels differ, and by how much.
import { createEngine, type Engine } from '@null3d/engine';
import { LENS_SHIFT_RECT } from './lib/lens-shift';
import { run } from './lib/result';

const params = new URLSearchParams(location.search);
const MODE = params.get('mode') === 'canvas' ? 'canvas' : 'view';
const LENS = params.get('lens') === 'orthographic' ? 'orthographic' : 'perspective';
/** The narrow camera's canvas, in CSS pixels; the wide camera's is twice as large each way. */
const [WIDTH, HEIGHT] = [320, 240];
/** A channel that differs by more than this counts its pixel as different. */
const STEP = 16;

interface Frame {
	width: number;
	height: number;
	pixels: Uint8Array;
}

/** Starts an engine on a canvas of `width` by `height` CSS pixels at a pixel ratio of 1. */
async function start(canvas: HTMLCanvasElement, width: number, height: number): Promise<Engine> {
	canvas.style.width = `${width}px`;
	canvas.style.height = `${height}px`;
	const sketch = new URL('./sketches/lens-shift-sketch.ts', import.meta.url);
	sketch.searchParams.set('lens', LENS);
	const engine = await createEngine({
		canvas,
		sketch,
		maxPixelRatio: 1,
		antialias: 'none',
		preset: 'medium',
		stats: false,
	});
	await engine.firstFrame;
	await engine.presetChecked;
	return engine;
}

/** Sends the sketch a change, and captures a frame once the sketch says it has drawn. */
async function capture(engine: Engine, name: string, value: unknown): Promise<Frame> {
	const drawn = new Promise<void>((resolve) => {
		const off = engine.onSketchMessage((message) => {
			if (message !== 'drawn') return;
			off();
			resolve();
		});
	});
	engine.postToSketch(name, value);
	await drawn;
	return engine.captureFrame();
}

/**
 * Compares `frame` with the part of `wide` that starts at (`left`, `top`): the pixels whose largest
 * channel differs by more than `STEP`, the mean difference, and how far the frame's brightness
 * spreads, which shows that it holds a scene.
 */
function compare(frame: Frame, wide: Frame, left: number, top: number) {
	let differing = 0;
	let total = 0;
	let sum = 0;
	let squares = 0;
	for (let y = 0; y < frame.height; y++)
		for (let x = 0; x < frame.width; x++) {
			const at = 4 * (y * frame.width + x);
			const there = 4 * ((y + top) * wide.width + x + left);
			let most = 0;
			for (let c = 0; c < 3; c++) {
				const gap = Math.abs((frame.pixels[at + c] as number) - (wide.pixels[there + c] as number));
				most = Math.max(most, gap);
				total += gap;
			}
			if (most > STEP) differing++;
			const value = frame.pixels[at + 1] as number;
			sum += value;
			squares += value * value;
		}
	const count = frame.width * frame.height;
	const mean = sum / count;
	return {
		pixels: count,
		differing,
		meanDifference: total / (3 * count),
		spread: Math.sqrt(Math.max(0, squares / count - mean * mean)),
	};
}

run('lens-shift', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const [x, y] = LENS_SHIFT_RECT;
	if (MODE === 'view') {
		const engine = await start(canvas, WIDTH, HEIGHT);
		const plain = await capture(engine, 'view', false);
		const viewed = await capture(engine, 'view', true);
		const tier = engine.capabilities.tier;
		await engine.destroy();
		return {
			tier,
			mode: MODE,
			lens: LENS,
			size: [viewed.width, viewed.height],
			...compare(viewed, plain, 0, 0),
		};
	}
	const wideEngine = await start(canvas, 2 * WIDTH, 2 * HEIGHT);
	const wide = await capture(wideEngine, 'camera', 'wide');
	const tier = wideEngine.capabilities.tier;
	await wideEngine.destroy();
	const narrowEngine = await start(canvas, WIDTH, HEIGHT);
	const narrow = await capture(narrowEngine, 'camera', 'narrow');
	await narrowEngine.destroy();
	const left = Math.round(x * wide.width);
	const top = Math.round(y * wide.height);
	return {
		tier,
		mode: MODE,
		lens: LENS,
		size: [narrow.width, narrow.height],
		wideSize: [wide.width, wide.height],
		...compare(narrow, wide, left, top),
	};
});
