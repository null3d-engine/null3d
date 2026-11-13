// A ground drawn from its tree of cluster patches under spheres with levels of detail, at the start
// and after camera jumps (tests/pages/sketches/cluster-jump-sketch.ts). The spheres' buckets put
// draws and copies before the ground's, and each jump changes the levels that the spheres pick,
// which can move the slices of the view's compacted instances, the ground's copy among them. The
// cluster pass places the ground's patches by that copy and writes the ground's draw, so a pass that
// read another copy, or wrote the draw where the opaque pass does not read it, drew no ground. At
// the start and after each jump, the page reads a frame back through the engine and reports the
// share of the picture's lowest quarter that shows the background, which the ground covers.
import { createEngine, type Engine } from '@null3d/engine';
import { run } from './lib/result';

/** The camera's places: its start, then each jump, nearer the spheres, between, and back. */
const PLACES: [number, number, number][] = [
	[0, 7, 26],
	[0, 7, 14],
	[-300, 7, 26],
	[-300, 7, 14],
	[0, 7, 20],
	[-300, 7, 20],
	[0, 7, 26],
];

/** Frames that the page lets the engine draw at each place before it reads one back. */
const SETTLE_FRAMES = 10;

/** The color steps from the background within which a pixel counts as the background. */
const BACKGROUND_STEPS = 8;

/** Resolves after `count` of the page's animation frames. */
function frames(count: number): Promise<void> {
	return new Promise((resolve) => {
		const step = (left: number) =>
			left === 0 ? resolve() : requestAnimationFrame(() => step(left - 1));
		step(count);
	});
}

/** Moves the camera, and resolves once the thread that draws has taken a frame with the move. */
function jump(engine: Engine, place: [number, number, number]): Promise<void> {
	return new Promise((resolve) => {
		const off = engine.onSketchMessage((name) => {
			if (name !== 'jumped') return;
			off();
			resolve();
		});
		engine.postToSketch('jump', place);
	});
}

/**
 * The share of the lowest quarter of an RGBA frame whose color lies within a few steps of the
 * background, which the middle of the top row shows.
 */
function backgroundShare(pixels: Uint8Array, width: number, height: number): number {
	const top = Math.floor(width / 2) * 4;
	let count = 0;
	let total = 0;
	for (let y = Math.floor((height * 3) / 4); y < height; y++)
		for (let x = 0; x < width; x++) {
			const at = (y * width + x) * 4;
			let near = true;
			for (let c = 0; c < 3; c++)
				if (Math.abs((pixels[at + c] as number) - (pixels[top + c] as number)) > BACKGROUND_STEPS)
					near = false;
			if (near) count++;
			total++;
		}
	return count / total;
}

run('cluster-jump', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const sketch = new URL('./sketches/cluster-jump-sketch.ts', import.meta.url);
	const engine = await createEngine({ canvas, sketch, maxPixelRatio: 1 });
	const failures: string[] = [];
	engine.onFailure((error) => failures.push(error.code));
	await engine.firstFrame;
	try {
		const shares: number[] = [];
		for (const [k, place] of PLACES.entries()) {
			if (k > 0) await jump(engine, place);
			await frames(SETTLE_FRAMES);
			const { width, height, pixels } = await engine.captureFrame();
			shares.push(backgroundShare(pixels, width, height));
		}
		return { tier: engine.capabilities.tier, shares, failures };
	} finally {
		await engine.destroy();
	}
});
