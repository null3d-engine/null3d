// Grows every built-in vegetation species through the add-on's task on the engine's job worker,
// once on each GPU path. The page forces a path with ?gpu=, and the sketch compares each task-grown
// plant with the one that the same species and seed grow on the thread. A path that cannot start
// leaves the page with an error, and a task that reaches no worker never answers.
import { createEngine } from '@null3d/engine';
import { progress, run } from './lib/result';

/** One species as the task grew it. */
interface GrownSpecies {
	/** The species' id. */
	id: string;
	/** Its triangles at the level that the task built. */
	triangles: number;
	/** Its parts at that level. */
	parts: number;
	/** Whether it is the plant that the same species and seed grow on the thread. */
	matches: boolean;
}

/** What the sketch reported. */
interface GrownResult {
	species: GrownSpecies[];
}

run('vegetation-task', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/vegetation-task-sketch.ts', import.meta.url),
		maxPixelRatio: 1,
	});
	await engine.firstFrame;
	progress('engine started');
	const grown = await new Promise<GrownResult>((resolve, reject) => {
		engine.onSketchMessage((name, data) => {
			if (name === 'grown') resolve(data as GrownResult);
			else if (name === 'failed') reject(new Error((data as { message: string }).message));
		});
		setTimeout(() => reject(new Error('the sketch grew no plants')), 60_000);
	});
	const tier = engine.capabilities.tier;
	await engine.destroy();
	return { tier, species: grown.species };
});
