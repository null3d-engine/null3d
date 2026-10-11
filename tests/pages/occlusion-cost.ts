// Measures what software occlusion culling costs and saves on this device: the occlusion city
// (sketches/occlusion-sketch.ts) fills the window at a render scale of 1, with the governor off.
// After a warm-up, the page measures play with the culling off and on in turns, ?rounds= times
// each (3 by default) for ?seconds= each (2 by default), and longer until a frame finishes in it.
// It reports the medians of each side's figures: the busiest thread's CPU time per frame, every
// thread's together, the sketch worker's time and its culling step, the render worker's time, the
// job workers' time together, the GPU time where the device has a timer, the frame interval, the
// draw calls, and the index list entries that the frame drew and that the culling hid. ?light
// draws a tenth of the city's spheres and boxes, as the image tests do. The device runner's
// occlusion plan runs it on WebGL2.
import { createEngine, type FrameSummary } from '@null3d/engine';
import { medianFigures, type OcclusionFigures } from './lib/occlusion';
import { occlusionFigures } from './lib/occlusion-figures';
import { run } from './lib/result';

/** Seconds of play before the first measurement. */
const WARM_UP_SECONDS = 2;

const params = new URLSearchParams(location.search);
const ROUNDS = Number(params.get('rounds') ?? '3');
const SECONDS = Number(params.get('seconds') ?? '2');

run('occlusion-cost', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const sketch = new URL('./sketches/occlusion-sketch.ts', import.meta.url);
	sketch.search = params.has('light') ? '?fixed&light' : '?fixed';
	const engine = await createEngine({ canvas, sketch });
	const failures: string[] = [];
	engine.onFailure((error) => failures.push(error.code));
	await engine.firstFrame;
	await new Promise((resolve) => setTimeout(resolve, WARM_UP_SECONDS * 1000));
	const set = (side: 'on' | 'off') =>
		new Promise<void>((resolve) => {
			const off = engine.onSketchMessage((name) => {
				if (name !== 'occlusion') return;
				off();
				resolve();
			});
			engine.postToSketch(`occlusion-${side}`, null);
		});
	// A measurement that holds no finished frame, as on a software GPU on a busy machine, measures
	// again for twice as long.
	const measure = async (): Promise<FrameSummary> => {
		for (let seconds = SECONDS; ; seconds *= 2) {
			const stats = await engine.measure(seconds);
			if (stats.frames > 0) return stats;
		}
	};
	const sides: Record<'off' | 'on', OcclusionFigures[]> = { off: [], on: [] };
	for (let round = 0; round < ROUNDS; round++) {
		for (const side of ['off', 'on'] as const) {
			await set(side);
			sides[side].push(occlusionFigures(await measure()));
		}
	}
	await engine.destroy();
	return {
		tier: engine.capabilities.tier,
		window: [innerWidth, innerHeight],
		devicePixelRatio,
		off: medianFigures(sides.off),
		on: medianFigures(sides.on),
		failures,
	};
});
