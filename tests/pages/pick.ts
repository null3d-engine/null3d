// Opens the pick scene and publishes which object each probe pixel shows, and what a raycast at
// the mask's hole finds. The engine picks on the GPU where every source has a pick build, so a
// masked card answers by its mask and the pixel under the pointer decides.
import { createEngine } from '@null3d/engine';
import { run } from './lib/result';

interface PickAnswer {
	name: string;
	expect: string | null;
	got: string | null;
}

interface PickResult {
	answers: PickAnswer[];
	/** What a raycast at the card's hole finds, which is the card because rays ignore masks. */
	raysCard: string | null;
}

run('pick', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const sketch = new URL('./sketches/pick-sketch.ts', import.meta.url);
	const engine = await createEngine({ canvas, sketch, maxPixelRatio: 1 });
	const failures: string[] = [];
	engine.onFailure((error) => failures.push(`${error.code}: ${error.message}`));
	const mode = { ...engine.mode };
	const picks = await new Promise<PickResult>((resolve) => {
		engine.onSketchMessage((name, data) => {
			if (name === 'picks') resolve(data as PickResult);
		});
	});
	await engine.destroy();
	return { picks, failures, mode };
});
