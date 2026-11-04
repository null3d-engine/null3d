// Measures what the terrain add-on's block morph costs in a frame: the valley of
// tests/pages/sketches/terrain-morph-cost-sketch.ts, with its quadtree following the camera, drawn
// with the morph on and off in turns over the same seconds. Both sides draw the same blocks and the
// same triangles, so their difference is the vertex offset that moves each block toward its
// parent's surface. After a warm-up, the page measures play with the morph off and on, three times
// each, and reports the medians of each side's GPU time per frame, where the device has a GPU timer,
// and of its frame interval and CPU time, with each thread's. Open it with ?gpu= for each path.
import { createEngine } from '@null3d/engine';
import { featureCost } from './lib/feature-cost';
import { run } from './lib/result';

run('terrain-morph-cost', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const sketch = new URL('./sketches/terrain-morph-cost-sketch.ts', import.meta.url);
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
	// The offset's cost is a few instructions a vertex, far under the machine's own drift between
	// one side and the next, so the sides swap turns every round and each gets four.
	const { off, on } = await featureCost(
		engine,
		async (morph) => {
			const built = settled();
			engine.postToSketch(morph ? 'morph' : 'morph-off', null);
			await built;
		},
		undefined,
		{ alternate: true, rounds: 4 },
	);
	await engine.destroy();
	return {
		tier: engine.capabilities.tier,
		window: [innerWidth, innerHeight],
		devicePixelRatio,
		off,
		on,
		failures,
	};
});
