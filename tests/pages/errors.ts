// Reports the engine errors that reach a page and a sketch, in the thread mode that the URL's
// switches ask for. Four starts fail: one with a module that exports no sketch, one with a sketch
// whose setup throws an engine error, one whose memory option asks for too large a maximum, and one
// with a sketch module that does not load. A fifth start runs a sketch that catches four errors
// from the engine's API and one that it makes itself, and posts them. While it runs, a sixth start
// runs beside it: it fails where the mode runs the sketch on the page's thread, which serves one
// engine at a time. After the first frame, the fifth start's sketch also reports the errors of
// queries whose input is not finite in 32 bits, and the hits of the queries after them. The page
// then stops both and starts the engine again, which must draw.
// Each start takes a fresh canvas, as a canvas passes to the engine only once.
import { createEngine, type EngineOptions } from '@null3d/engine';
import { type ErrorFields, errorFields, noError } from './lib/error-fields';
import { run } from './lib/result';

const notASketch = new URL('./sketches/not-a-sketch.ts', import.meta.url);
const failingSetup = new URL('./sketches/failing-setup-sketch.ts', import.meta.url);
const errorSketch = new URL('./sketches/error-sketch.ts', import.meta.url);
/** A module that the server does not have, so its import fails. */
const missingSketch = new URL('missing-sketch.js', location.href);

function freshCanvas(): HTMLCanvasElement {
	const canvas = document.createElement('canvas');
	document.body.append(canvas);
	return canvas;
}

/** The error that a start rejects with, or a note that the start ran. */
async function failedStart(
	sketch: URL,
	options: Partial<EngineOptions> = {},
): Promise<ErrorFields> {
	try {
		const engine = await createEngine({ canvas: freshCanvas(), sketch, ...options });
		await engine.destroy();
		return noError('the engine started');
	} catch (e) {
		return errorFields(e);
	}
}

run('errors', async () => {
	const failedStarts = [
		await failedStart(notASketch),
		await failedStart(failingSetup),
		await failedStart(errorSketch, { memory: { maximumMiB: 8192 } }),
		await failedStart(missingSketch),
	];
	const engine = await createEngine({ canvas: freshCanvas(), sketch: errorSketch });
	// The sketch reports the errors that it caught at once, and again once the fixes' text has had
	// time to arrive.
	let raisedNow: (value: unknown) => void = () => {};
	let raisedFixed: (value: unknown) => void = () => {};
	const now = new Promise<unknown>((resolve) => {
		raisedNow = resolve;
	});
	const fixed = new Promise<unknown>((resolve) => {
		raisedFixed = resolve;
	});
	engine.onSketchMessage((name, data) => {
		if (name === 'raised') raisedNow(data);
		else if (name === 'patched') raisedFixed(data);
	});
	engine.postToSketch('raise');
	const inSketch = await now;
	const patched = await fixed;
	await engine.firstFrame;
	const queries = await new Promise<unknown>((resolve) => {
		engine.onSketchMessage((name, data) => {
			if (name === 'queried') resolve(data);
		});
		engine.postToSketch('query');
	});
	const beside = await failedStart(errorSketch);
	await engine.destroy();
	const again = await createEngine({ canvas: freshCanvas(), sketch: errorSketch });
	await again.firstFrame;
	// A slow GPU draws a frame in more than half a second, so the window repeats until one draws.
	let stats = await again.measure(0.5);
	for (let window = 1; window < 10 && stats.frames === 0; window++) {
		stats = await again.measure(0.5);
	}
	await again.destroy();
	return {
		mode: again.mode,
		notASketch: notASketch.href,
		missingSketch: missingSketch.href,
		failedStarts,
		inSketch,
		patched,
		queries,
		beside,
		framesAfterRestart: stats.frames,
	};
});
