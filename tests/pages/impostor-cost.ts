// Measures what the impostor cards cost on this device: the field of cards of
// tests/pages/sketches/impostor-cost-sketch.ts fills the view, and the page draws it with the whole
// batch hidden and shown again, in turns. Both sides clear the same background and draw nothing
// else, so their difference is the card batch's frame cost, its three-view blend included. After a
// warm-up, the page measures play three times each, alternating the sides, and reports the medians
// of each side's GPU time per frame where the device has a timer, and of its frame interval and CPU
// time, with each thread's. Open it with ?gpu= for each path.
import { createEngine } from '@null3d/engine';
import { featureCost } from './lib/feature-cost';
import { run } from './lib/result';

run('impostor-cost', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const sketch = new URL('./sketches/impostor-cost-sketch.ts', import.meta.url);
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
	const { off, on } = await featureCost(
		engine,
		async (shown) => {
			const built = settled();
			engine.postToSketch(shown ? 'cards' : 'cards-off', null);
			await built;
		},
		undefined,
		{ alternate: true },
	);
	await engine.destroy();
	return {
		tier: engine.capabilities.tier,
		cards: 19 * 8,
		window: [innerWidth, innerHeight],
		devicePixelRatio,
		off,
		on,
		failures,
	};
});
