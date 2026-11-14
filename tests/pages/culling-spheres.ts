// Reports how many culling spheres the debug switch drew over a row of level meshes. The sketch of
// tests/pages/sketches/culling-spheres-sketch.ts draws five copies whose mesh has levels, turns the
// spheres on with ?spheres=on, and reports the count a few frames in, so the test reads a figure
// that moves rather than a page that drew nothing.
import { createEngine } from '@null3d/engine';
import { run } from './lib/result';

run('culling-spheres', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	// The sketch's address is a literal, which the bundler turns into a module of the page's own, and
	// the page's switches are then added to it.
	const sketch = new URL('./sketches/culling-spheres-sketch.ts', import.meta.url);
	sketch.search = location.search;
	const engine = await createEngine({ canvas, sketch });
	const failures: string[] = [];
	engine.onFailure((error) => failures.push(error.code));
	const reported = new Promise<{ drawn: number; frames: number }>((resolve) => {
		const off = engine.onSketchMessage((name, data) => {
			if (name !== 'spheres') return;
			off();
			resolve(data as { drawn: number; frames: number });
		});
	});
	const result = await reported;
	await engine.destroy();
	return { tier: engine.capabilities.tier, ...result, failures };
});
