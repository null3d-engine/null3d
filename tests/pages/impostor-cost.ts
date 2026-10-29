// Measures what the impostor cards cost on this device, and what their three-view blend costs
// against one view: the field of cards of tests/pages/sketches/impostor-cost-sketch.ts fills the
// view, and the page draws it with the whole batch hidden and shown again, in turns, then with
// the batch drawn from its three nearest views and from its nearest view alone. Every side clears
// the same background and draws nothing else, so the first difference is the card batch's frame
// cost and the second is the blend's. After a warm-up, the page measures each side three times,
// alternating the sides, and reports the medians of each side's GPU time per frame where the
// device has a timer, and of its frame interval and CPU time, with each thread's. Open it with
// ?gpu= for each path.
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
	const turn = (on: string, off: string) => async (shown: boolean) => {
		const built = settled();
		engine.postToSketch(shown ? on : off, null);
		await built;
	};
	const batch = await featureCost(engine, turn('cards', 'cards-off'), undefined, {
		alternate: true,
	});
	const views = await featureCost(engine, turn('cards-one', 'cards'), undefined, {
		alternate: true,
	});
	await engine.destroy();
	return {
		tier: engine.capabilities.tier,
		cards: 19 * 8,
		window: [innerWidth, innerHeight],
		devicePixelRatio,
		off: batch.off,
		on: batch.on,
		// The blend's sides: the three nearest views against the nearest view alone.
		blend: views.off,
		one: views.on,
		failures,
	};
});
