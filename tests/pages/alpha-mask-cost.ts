// Measures what an alpha-masked lit fragment costs under MSAA on this device: the curtain of lit
// quads of tests/pages/sketches/alpha-mask-cost-sketch.ts, drawn with ?aa=msaa or ?aa=none and with
// every quad masked or opaque in turns. The two sides shade the same pixels of the same geometry
// with the same map, so their difference is the masked build's alpha test and discard: with MSAA,
// a fragment shader that discards runs once per sample instead of once per pixel. After a warm-up,
// the page measures play with the mask off and on, in turns, three times each, and reports the
// medians of each side's GPU time per frame, where the device has a GPU timer, and of its frame
// interval and CPU time, with each thread's. Open it with ?gpu= for each path.
import { createEngine } from '@null3d/engine';
import { featureCost } from './lib/feature-cost';
import { run } from './lib/result';

const params = new URLSearchParams(location.search);
const antialias = params.get('aa') === 'none' ? 'none' : 'msaa';

run('alpha-mask-cost', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const sketch = new URL('./sketches/alpha-mask-cost-sketch.ts', import.meta.url);
	const engine = await createEngine({ canvas, sketch, antialias });
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
	const { off, on } = await featureCost(engine, async (masked) => {
		const built = settled();
		engine.postToSketch(masked ? 'mask' : 'mask-off', null);
		await built;
	});
	await engine.destroy();
	return {
		tier: engine.capabilities.tier,
		antialias,
		window: [innerWidth, innerHeight],
		devicePixelRatio,
		off,
		on,
		failures,
	};
});
