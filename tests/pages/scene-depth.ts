// Starts the engine with the water sheet whose custom material reads the copy of the opaque scene's
// depth (sketches/scene-depth-sketch.ts), and publishes the frame it drew. The image test draws it
// on both GPU paths and in every thread mode, so the binding of the depth copy is compared on each
// of them.
import { createEngine } from '@null3d/engine';
import { run, toBase64 } from './lib/result';

run('scene-depth', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	// The page's own switches reach the sketch, so a test can fix its render scale.
	const sketch = new URL('./sketches/scene-depth-sketch.ts', import.meta.url);
	sketch.search = location.search;
	const engine = await createEngine({
		canvas,
		sketch,
		maxPixelRatio: 1,
	});
	const frame = await engine.captureFrame();
	await engine.destroy();
	return {
		tier: engine.capabilities.tier,
		mode: engine.mode,
		width: frame.width,
		height: frame.height,
		pixels: toBase64(frame.pixels),
	};
});
