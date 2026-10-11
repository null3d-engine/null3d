// Measures what levels of detail save on this device: a forest of ?count= pines, 40,000 by
// default, each with four levels, under the sun's shadows (tests/pages/sketches/lod-cost-sketch.ts;
// ?shadows=off casts none). After a warm-up, the page measures play with every tree at its base
// mesh, and with each tree at the level that its size on the screen picks, in turns, three times
// each. It reports the medians of each side's GPU time per frame, where the device has a GPU timer,
// and of its frame interval and CPU time, with each thread's. Open it with ?gpu= for each path.
import { createEngine } from '@null3d/engine';
import { featureCost } from './lib/feature-cost';
import { run } from './lib/result';

const params = new URLSearchParams(location.search);
const count = Number(params.get('count') ?? '40000');
const shadows = params.get('shadows') ?? 'on';

run('lod-cost', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const sketch = new URL('./sketches/lod-cost-sketch.ts', import.meta.url);
	sketch.search = `?count=${count}&shadows=${shadows}`;
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
	const { off, on } = await featureCost(engine, async (levels) => {
		const built = settled();
		engine.postToSketch(levels ? 'levels' : 'levels-off', null);
		await built;
	});
	await engine.destroy();
	return {
		tier: engine.capabilities.tier,
		count,
		shadows,
		window: [innerWidth, innerHeight],
		devicePixelRatio,
		off,
		on,
		failures,
	};
});
