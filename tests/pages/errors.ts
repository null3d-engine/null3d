// Reports the engine errors that reach a page and a sketch, in the thread mode that the URL's
// switches ask for. Two starts fail: one with a module that exports no sketch, and one with a sketch
// whose setup throws an engine error. A third start runs a sketch that catches four errors from the
// engine's API and one that it makes itself, and posts them. The page then stops that engine and
// starts it again, which must draw. Each start takes a fresh canvas, as a canvas passes to the
// engine only once.
import { createEngine } from '@null3d/engine';
import { type ErrorFields, errorFields, noError } from './lib/error-fields';
import { run } from './lib/result';

const notASketch = new URL('./sketches/not-a-sketch.ts', import.meta.url);
const failingSetup = new URL('./sketches/failing-setup-sketch.ts', import.meta.url);
const errorSketch = new URL('./sketches/error-sketch.ts', import.meta.url);

function freshCanvas(): HTMLCanvasElement {
	const canvas = document.createElement('canvas');
	document.body.append(canvas);
	return canvas;
}

/** The error that a start rejects with, or a note that the start ran. */
async function failedStart(sketch: URL): Promise<ErrorFields> {
	try {
		const engine = await createEngine({ canvas: freshCanvas(), sketch });
		await engine.destroy();
		return noError('the engine started');
	} catch (e) {
		return errorFields(e);
	}
}

run('errors', async () => {
	const failedStarts = [await failedStart(notASketch), await failedStart(failingSetup)];
	const engine = await createEngine({ canvas: freshCanvas(), sketch: errorSketch });
	const inSketch = await new Promise<unknown>((resolve) => {
		engine.onSketchMessage((name, data) => {
			if (name === 'raised') resolve(data);
		});
		engine.postToSketch('raise');
	});
	await engine.destroy();
	const again = await createEngine({ canvas: freshCanvas(), sketch: errorSketch });
	await again.firstFrame;
	const stats = await again.measure(0.5);
	await again.destroy();
	return {
		mode: again.mode,
		notASketch: notASketch.href,
		failedStarts,
		inSketch,
		framesAfterRestart: stats.frames,
	};
});
