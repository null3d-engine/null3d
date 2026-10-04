// Measures what bloom costs on this device: the bloom scene fills the window at the render scale
// that ?scale= fixes, 1 by default, with the governor off. After a warm-up, the page measures play
// with bloom off and on in turns, three times each, and reports the medians of each side's GPU time
// per frame, where the device has a GPU timer, and of its frame interval and CPU time. The device
// runner's bloom plan runs it on each GPU path at the scales of 1 and 0.5.
import { createEngine } from '@null3d/engine';
import { featureCost } from './lib/feature-cost';
import { run } from './lib/result';

const params = new URLSearchParams(location.search);
const scale = Number(params.get('scale') ?? '1');

run('bloom-cost', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const sketch = new URL('./sketches/bloom-sketch.ts', import.meta.url);
	sketch.search = `?scale=${scale}&fixed`;
	const engine = await createEngine({ canvas, sketch });
	const failures: string[] = [];
	engine.onFailure((error) => failures.push(error.code));
	await engine.firstFrame;
	const settled = () =>
		new Promise<void>((resolve) => {
			const off = engine.onSketchMessage((name) => {
				if (name !== 'settled') return;
				off();
				resolve();
			});
		});
	const { off, on } = await featureCost(engine, async (bloom) => {
		if (!bloom) {
			engine.postToSketch('bloom-off', null);
			return;
		}
		const built = settled();
		engine.postToSketch('bloom', null);
		await built;
	});
	await engine.destroy();
	return {
		tier: engine.capabilities.tier,
		hdr: engine.capabilities.hdr,
		scale,
		// The window in CSS pixels and the screen's pixel ratio: the preset's cap on the ratio sets
		// the drawing buffer's size from them.
		window: [innerWidth, innerHeight],
		devicePixelRatio,
		off,
		on,
		failures,
	};
});
