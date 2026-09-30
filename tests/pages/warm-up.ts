// Starts the engine with the ten pipelines of the pipelines sketch, whose setup warms the scene up,
// in the mode and on the GPU path that the switches ask for. It measures play, then asks the sketch
// to add an object that needs a new pipeline, which the sketch warms up before it shows the object.
// It reports what each measurement built, and whether the capture shows the new object.
import { createEngine } from '@null3d/engine';
import { run } from './lib/result';

/** How long each measurement runs. */
const SECONDS = 0.5;
/** The added quad's color in the capture: unlit magenta. */
const MAGENTA = [255, 0, 255];

run('warm-up', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/pipelines-sketch.ts', import.meta.url),
		maxPixelRatio: 1,
	});
	const failures: string[] = [];
	engine.onFailure((error) => failures.push(error.code));
	// Play starts once the first frame, which built the scene's pipelines, is on screen.
	await engine.firstFrame;
	const play = await engine.measure(SECONDS);
	const warmed = new Promise<void>((resolve) => {
		const off = engine.onSketchMessage((name) => {
			if (name !== 'warmed') return;
			off();
			resolve();
		});
	});
	const adding = engine.measure(SECONDS * 2);
	engine.postToSketch('add');
	await warmed;
	const added = await adding;
	const after = await engine.measure(SECONDS);
	const capture = await engine.captureFrame();
	let magenta = 0;
	const { pixels } = capture;
	for (let at = 0; at < pixels.length; at += 4)
		if (pixels[at] === MAGENTA[0] && pixels[at + 1] === MAGENTA[1] && pixels[at + 2] === MAGENTA[2])
			magenta++;
	await engine.destroy();
	return {
		mode: engine.mode,
		tier: engine.capabilities.tier,
		hdr: engine.capabilities.hdr,
		firstFramePipelines: play.load.firstFramePipelines,
		warmUpMs: play.load.warmUpMs,
		engineStartMs: play.load.engineStartMs,
		firstFrameDoneMs: play.load.firstFrameDoneMs,
		playPipelines: play.pipelines,
		addedPipelines: added.pipelines,
		afterPipelines: after.pipelines,
		magenta,
		failures,
	};
});
