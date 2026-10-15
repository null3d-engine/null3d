// The volumetric fog's sun scene in play, not held: each frame moves the cells' points a little
// and blends each cell with the last frame's grid, which hold mode never does. The page draws
// Medium's grid at a fixed render scale with the governor off, lets the blend settle, and
// publishes a frame. Every GPU path must then draw the same image, so a path that reads the last
// frame's grid from the wrong place, such as rows turned upside down, shows.
import { createEngine } from '@null3d/engine';
import { run, toBase64 } from './lib/result';

/** The frames the blend draws before the capture: well past the blend's ten frames. */
const SETTLE_FRAMES = 20;
/** The length of each window the page measures. */
const WINDOW_SECONDS = 0.5;
/** How long a slow device, such as the software renderer, may take to draw those frames. */
const SETTLE_LIMIT_SECONDS = 20;

run('fog-live', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const engine = await createEngine({
		canvas,
		sketch: new URL(
			'./sketches/fog-volume-sketch.ts?fog=on&slices=32&scale=1&fixed',
			import.meta.url,
		),
		maxPixelRatio: 1,
	});
	const failures: string[] = [];
	engine.onFailure((error) => failures.push(error.code));
	await engine.firstFrame;
	// The blend settles per frame, not per second, so wait for a count of frames. A software
	// renderer draws only a few frames a second, and a fixed time would capture too few.
	const started = performance.now();
	let frames = 0;
	while (frames < SETTLE_FRAMES && performance.now() - started < SETTLE_LIMIT_SECONDS * 1000)
		frames += (await engine.measure(WINDOW_SECONDS)).frames;
	const frame = await engine.captureFrame();
	await engine.destroy();
	return {
		tier: engine.capabilities.tier,
		width: frame.width,
		height: frame.height,
		frames,
		pixels: toBase64(frame.pixels),
		failures,
	};
});
