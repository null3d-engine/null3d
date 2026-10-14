// The volumetric fog's sun scene in play, not held: each frame moves the cells' points a little
// and blends each cell with the last frame's grid, which hold mode never does. The page draws
// Medium's grid at a fixed render scale with the governor off, lets the blend settle, and
// publishes a frame. Every GPU path must then draw the same image, so a path that reads the last
// frame's grid from the wrong place, such as rows turned upside down, shows.
import { createEngine } from '@null3d/engine';
import { run, toBase64 } from './lib/result';

/** How long the frames blend before the capture: well past the blend's ten frames. */
const SETTLE_SECONDS = 2;

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
	const play = await engine.measure(SETTLE_SECONDS);
	const frame = await engine.captureFrame();
	await engine.destroy();
	return {
		tier: engine.capabilities.tier,
		width: frame.width,
		height: frame.height,
		frames: play.frames,
		pixels: toBase64(frame.pixels),
		failures,
	};
});
