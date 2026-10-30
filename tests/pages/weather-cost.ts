// Measures what the weather add-on costs on this device: the ground of tests/pages/sketches/
// weather-cost-sketch.ts, timed with the wet surface off and on, and with ?mirror=1 with the planar
// reflection off and on. ?scale= draws at that render scale, and ?fixed holds it with the governor
// off. It runs only in a quiet window on a computer with a GPU of its own: NULL3D_WEATHER_COST=1
// bun run test:browser -- weather-cost.spec.ts.
import { createEngine } from '@null3d/engine';
import { featureCost } from './lib/feature-cost';
import { run } from './lib/result';

const params = new URLSearchParams(location.search);
const scale = Number(params.get('scale') ?? '1');
const fixed = params.has('fixed');
const mirror = params.get('mirror') === '1';

run('weather-cost', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const sketch = new URL('./sketches/weather-cost-sketch.ts', import.meta.url);
	sketch.search = `?scale=${scale}${fixed ? '&fixed' : ''}${mirror ? '&mirror=1' : ''}`;
	const engine = await createEngine({ canvas, sketch });
	const failures: string[] = [];
	engine.onFailure((error) => failures.push(error.code));
	await engine.firstFrame;
	const settled = () =>
		new Promise<void>((resolve) => {
			// A message that the sketch sent before this handler waited is handed over as this call
			// registers it, so the stop call must already exist when the handler first runs.
			let stop: () => void = () => {};
			stop = engine.onSketchMessage((name) => {
				if (name !== 'settled') return;
				stop();
				resolve();
			});
		});
	const { off, on } = await featureCost(engine, async (drawn) => {
		if (!drawn) {
			engine.postToSketch('off', null);
			return;
		}
		const built = settled();
		engine.postToSketch('on', null);
		await built;
	});
	await engine.destroy();
	return {
		tier: engine.capabilities.tier,
		hdr: engine.capabilities.hdr,
		scale,
		mirror,
		window: [innerWidth, innerHeight],
		devicePixelRatio,
		off,
		on,
		failures,
	};
});
