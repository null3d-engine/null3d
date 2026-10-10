// Measures what row values cost on this device: a field of ?count= grass blades, 100,000 by
// default, under the sun's shadows (tests/pages/sketches/grass-sketch.ts). After a warm-up, the
// page measures play with the blades still, in the standard material, and swaying out of step
// with a tint each, from their rows' values, in turns, three times each. It reports the medians of
// each side's GPU time per frame, where the device has a GPU timer, and of its frame interval and
// CPU time, with each thread's. The device runner's grass plan runs it on each GPU path.
import { createEngine } from '@null3d/engine';
import { featureCost } from './lib/feature-cost';
import { run } from './lib/result';

const params = new URLSearchParams(location.search);
const count = Number(params.get('count') ?? '100000');

run('grass-cost', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const sketch = new URL('./sketches/grass-sketch.ts', import.meta.url);
	sketch.search = `?count=${count}`;
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
	const { off, on } = await featureCost(engine, async (swaying) => {
		const built = settled();
		engine.postToSketch(swaying ? 'sway' : 'sway-off', null);
		await built;
	});
	await engine.destroy();
	return {
		tier: engine.capabilities.tier,
		count,
		window: [innerWidth, innerHeight],
		devicePixelRatio,
		off,
		on,
		failures,
	};
});
