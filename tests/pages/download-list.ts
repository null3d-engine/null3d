// Starts the engine live with a sketch that lists its files, in the thread mode that the page's
// switches ask for, and reports when its files started downloading against when its setup began.
import { createEngine } from '@null3d/engine';
import { run } from './lib/result';

run('download-list', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/download-list-sketch.ts', import.meta.url),
		maxPixelRatio: 1,
	});
	const recorded = await new Promise<unknown>((resolve) =>
		engine.onSketchMessage((name, data) => {
			if (name === 'result') resolve(data);
		}),
	);
	const mode = engine.mode;
	await engine.destroy();
	return { mode, recorded };
});
