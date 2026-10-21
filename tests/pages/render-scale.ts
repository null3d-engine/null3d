// Starts the engine with the render scale sketch in the mode and on the GPU path that the switches
// ask for. After the first frame, it measures play at the start's render scale, then measures
// again while the sketch fixes a new render scale in each of several frames in a row, and once
// more after a new canvas size, which makes new targets. It reports the GPU objects that each
// measurement made, and the scale that each of the scaled frames drew at. ?bloom draws with bloom.
import { createEngine } from '@null3d/engine';
import { SCALES } from './lib/render-scale';
import { run } from './lib/result';

/** How long each measurement runs. */
const SECONDS = 0.5;
/**
 * How many measurements may pass before a resized canvas shows its new targets. A loaded software
 * GPU can take several seconds over a frame, so the window after the resize often holds none: the
 * measurement then runs again, so the check reads the resize rather than the machine's pace.
 */
const RESIZE_MEASUREMENTS = 8;

run('render-scale', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const sketch = new URL('./sketches/render-scale-sketch.ts', import.meta.url);
	if (new URL(location.href).searchParams.has('bloom')) sketch.search = '?bloom';
	const engine = await createEngine({
		canvas,
		sketch,
		maxPixelRatio: 1,
	});
	const failures: string[] = [];
	engine.onFailure((error) => failures.push(error.code));
	await engine.firstFrame;
	const steady = await engine.measure(SECONDS);
	const drawn = new Promise<number[]>((resolve) => {
		const off = engine.onSketchMessage((name, data) => {
			if (name !== 'drawn') return;
			off();
			resolve(data as number[]);
		});
	});
	const scaling = engine.measure(SECONDS * 2);
	engine.postToSketch('scales', SCALES);
	const scales = await drawn;
	const scaled = await scaling;
	canvas.style.width = '400px';
	let resized = await engine.measure(SECONDS);
	for (let tries = 1; resized.gpuObjects === 0 && tries < RESIZE_MEASUREMENTS; tries++)
		resized = await engine.measure(SECONDS);
	await engine.destroy();
	return {
		mode: engine.mode,
		tier: engine.capabilities.tier,
		steadyGpuObjects: steady.gpuObjects,
		scaledGpuObjects: scaled.gpuObjects,
		scaledPipelines: scaled.pipelines,
		resizedGpuObjects: resized.gpuObjects,
		scales,
		failures,
	};
});
