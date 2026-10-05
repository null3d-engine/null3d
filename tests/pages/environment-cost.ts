// Measures what the environment's light costs on this device: planes of the standard material fill
// the window, layer over layer, at the render scale that ?scale= fixes, 1 by default, with the
// governor off (tests/pages/sketches/environment-cost-sketch.ts). After a warm-up, the page measures
// play without and with the built-in room in turns, three times each, and reports the medians of
// each side's GPU time per frame, where the device has a GPU timer, and of its frame interval and
// CPU time. The difference over the layers is the lookup's cost for each plane's pixels. The
// device runner's environment plan runs it on each GPU path.
import { createEngine } from '@null3d/engine';
import { featureCost } from './lib/feature-cost';
import { run } from './lib/result';

const params = new URLSearchParams(location.search);
const scale = Number(params.get('scale') ?? '1');
const layers = Number(params.get('layers') ?? '8');

/** How long a switch may take to reach the frames on screen. */
const SETTLE_MS = 200;

run('environment-cost', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const sketch = new URL('./sketches/environment-cost-sketch.ts', import.meta.url);
	sketch.search = `?scale=${scale}&layers=${layers}`;
	const engine = await createEngine({ canvas, sketch });
	const failures: string[] = [];
	engine.onFailure((error) => failures.push(error.code));
	await engine.firstFrame;
	const { off, on } = await featureCost(engine, async (environment) => {
		engine.postToSketch(environment ? 'environment' : 'environment-off', null);
		await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
	});
	await engine.destroy();
	return {
		tier: engine.capabilities.tier,
		scale,
		layers,
		window: [innerWidth, innerHeight],
		devicePixelRatio,
		off,
		on,
		failures,
	};
});
