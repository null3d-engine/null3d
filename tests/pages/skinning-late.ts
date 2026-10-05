// The skinning scene with its characters held still in one pose. With ?late, it starts without
// them and adds them during play: their meshes are the page's first skinned meshes, so the engine
// downloads the skinning shader file then, and every pass leaves them out until their pipelines
// are built. The page captures the frame before the change and the frame after it settled, and
// measures play across the change: the draws that frames skipped there must be none. Without
// ?late, the characters stand from the first frame, which gives the image the change must reach.
import { createEngine } from '@null3d/engine';
import { run, toBase64 } from './lib/result';

const params = new URLSearchParams(location.search);
const LATE = params.has('late');
/** How long the page measures play across the change, and then lets frames settle. */
const ACROSS_SECONDS = 2;
const SETTLE_SECONDS = 0.5;

run('skinning-late', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const sketch = `./sketches/skinning-sketch.ts?still${LATE ? '&late' : ''}`;
	const engine = await createEngine({
		canvas,
		sketch: new URL(sketch, import.meta.url),
		maxPixelRatio: 1,
	});
	const failures: string[] = [];
	engine.onFailure((error) => failures.push(error.code));
	await engine.firstFrame;
	const before = await engine.captureFrame();
	let acrossSkippedDraws = 0;
	if (LATE) {
		const added = new Promise<void>((resolve) => {
			const off = engine.onSketchMessage((name) => {
				if (name !== 'added') return;
				off();
				resolve();
			});
		});
		const across = engine.measure(ACROSS_SECONDS);
		engine.postToSketch('characters', null);
		await added;
		acrossSkippedDraws = (await across).skippedDraws;
	}
	await engine.measure(SETTLE_SECONDS);
	const after = await engine.captureFrame();
	await engine.destroy();
	return {
		tier: engine.capabilities.tier,
		width: after.width,
		height: after.height,
		before: toBase64(before.pixels),
		after: toBase64(after.pixels),
		acrossSkippedDraws,
		failures,
	};
});
