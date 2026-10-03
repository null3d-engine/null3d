// Turns bloom on during play, on the GPU path that the switches ask for. In compatibility mode the
// engine starts on the 8-bit path for MSAA, and bloom moves it to HDR color with FXAA: new targets,
// pipelines and shader builds. The page measures play before the change, across it and after it,
// and reports the GPU objects and pipelines that each measurement made, the frames and time until
// bloom's pipelines were built, and the longest frame interval meanwhile, while the frame before
// stayed on screen.
import { createEngine } from '@null3d/engine';
import { run } from './lib/result';

/** How long each measurement runs. */
const SECONDS = 0.5;

run('bloom-switch', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/bloom-sketch.ts', import.meta.url),
		maxPixelRatio: 1,
	});
	const failures: string[] = [];
	engine.onFailure((error) => failures.push(error.code));
	await engine.firstFrame;
	const before = await engine.measure(SECONDS);
	const settled = new Promise<{ frames: number; ms: number }>((resolve) => {
		const off = engine.onSketchMessage((name, data) => {
			if (name !== 'settled') return;
			off();
			resolve(data as { frames: number; ms: number });
		});
	});
	const across = engine.measure(SECONDS * 3);
	engine.postToSketch('bloom', null);
	const switched = await settled;
	const during = await across;
	const after = await engine.measure(SECONDS);
	await engine.destroy();
	return {
		tier: engine.capabilities.tier,
		startedHdr: engine.capabilities.hdr,
		settledFrames: switched.frames,
		settledMs: switched.ms,
		beforeIntervalP99: before.intervalMs.p99,
		acrossIntervalP99: during.intervalMs.p99,
		acrossGpuObjects: during.gpuObjects,
		acrossPipelines: during.pipelines,
		afterGpuObjects: after.gpuObjects,
		afterPipelines: after.pipelines,
		failures,
	};
});
