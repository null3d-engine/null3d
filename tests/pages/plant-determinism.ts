// Grows every plant species in a job worker and publishes each grown variant's digest, which the
// plant determinism test compares with its own growth of the same species and seed. A task that
// reaches no worker never answers.
import { createEngine } from '@null3d/engine';
import type { GrownDigest } from './lib/plant-determinism';
import { progress, run } from './lib/result';

run('plant-determinism', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/plant-determinism-sketch.ts', import.meta.url),
		maxPixelRatio: 1,
	});
	await engine.firstFrame;
	progress('engine started');
	const species = await new Promise<GrownDigest[]>((resolve, reject) => {
		engine.onSketchMessage((name, data) => {
			if (name === 'grown') resolve((data as { species: GrownDigest[] }).species);
			else if (name === 'failed') reject(new Error((data as { message: string }).message));
		});
		setTimeout(() => reject(new Error('the sketch grew no plants')), 60_000);
	});
	await engine.destroy();
	return { species };
});
