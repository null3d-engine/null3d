// Measures what one relief feature costs on this device: the hillside of
// tests/pages/sketches/relief-cost-sketch.ts, with ?feature= naming displacement, parallax, bump or
// wireframe. After a warm-up, the page measures play with the feature off and on, in turns, three
// times each. It reports the medians of each side's GPU time per frame, where the device has a GPU
// timer, and of its frame interval and CPU time, with each thread's. Open it with ?gpu= for each path.
import { createEngine } from '@null3d/engine';
import { featureCost } from './lib/feature-cost';
import { run } from './lib/result';

const feature = new URLSearchParams(location.search).get('feature') ?? 'displacement';

run('relief-cost', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const sketch = new URL('./sketches/relief-cost-sketch.ts', import.meta.url);
	sketch.search = `?feature=${feature}`;
	const engine = await createEngine({ canvas, sketch });
	const failures: string[] = [];
	engine.onFailure((error) => failures.push(error.code));
	await engine.firstFrame;
	const { off, on } = await featureCost(engine, async (on) => {
		const settled = new Promise<void>((resolve) => {
			const stop = engine.onSketchMessage((name) => {
				if (name !== 'settled') return;
				stop();
				resolve();
			});
		});
		engine.postToSketch(on ? 'on' : 'off', null);
		await settled;
	});
	await engine.destroy();
	return {
		tier: engine.capabilities.tier,
		feature,
		window: [innerWidth, innerHeight],
		devicePixelRatio,
		off,
		on,
		failures,
	};
});
