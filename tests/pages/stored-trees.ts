// Starts the engine with the stored trees sketch, on the GPU path the switches ask for, and reports
// how the hits of a model with stored trees compare with those of the same model without them.
import { createEngine } from '@null3d/engine';
import { run } from './lib/result';
import type { StoredTreeResults } from './lib/stored-trees';

run('stored-trees', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/stored-trees-sketch.ts', import.meta.url),
		maxPixelRatio: 1,
	});
	const failures: string[] = [];
	engine.onFailure((error) => failures.push(`${error.code} ${error.message}`));
	const results = await new Promise<StoredTreeResults>((resolve) => {
		engine.onSketchMessage((name, data) => {
			if (name === 'results') resolve(data as StoredTreeResults);
		});
		engine.postToSketch('results');
	});
	await engine.destroy();
	return { results, failures };
});
