// Draws one sketch of the first-use manifest in a live engine, for a feature whose first use needs
// frames that the engine draws: hold mode records a held frame without a live loop, so a pick there
// answers by ray before any draw. The sketch posts 'picked' with the outcome of its first use, and
// the page fails with a pick's error rather than passing green.
import { createEngine } from '@null3d/engine';
import { run } from './lib/result';

const params = new URLSearchParams(location.search);

/**
 * A sketch module's address from the server root. When it has a query, Vite's marker of the file's
 * extension goes last, as the image page gives it.
 */
function sketchUrl(path: string): URL {
	const url = new URL(path, location.origin);
	if (url.search) url.search += '&lang.ts';
	return url;
}

/** How long the page waits for the sketch's first use before it fails. */
const PICK_WAIT_MS = 30_000;

run('first-use-live', async () => {
	const sketch = params.get('sketch');
	if (!sketch?.startsWith('/'))
		throw new Error('Add ?sketch= with the path of a sketch module from the server root.');
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	canvas.style.width = '320px';
	canvas.style.height = '180px';
	// The sketch posts its outcome, and a sketch error counts as a failed use even when no outcome
	// arrives. Both settle the wait below.
	let settle: (error?: string) => void = () => {};
	const outcome = new Promise<string | undefined>((resolve) => {
		settle = resolve;
	});
	let sketchError: string | undefined;
	const engine = await createEngine({
		canvas,
		sketch: sketchUrl(sketch),
		maxPixelRatio: 1,
		onSketchError: (error) => {
			sketchError = error.message;
			settle(error.message);
		},
		onSketchMessage: (name, data) => {
			if (name !== 'picked') return;
			const error = (data as { error?: unknown } | null)?.error;
			settle(typeof error === 'string' ? error : undefined);
		},
	});
	const timer = setTimeout(
		() => settle("the sketch did not use its feature within the page's wait"),
		PICK_WAIT_MS,
	);
	const failure = await outcome;
	clearTimeout(timer);
	const tier = engine.capabilities.tier;
	await engine.destroy();
	if (failure !== undefined) throw new Error(failure);
	if (sketchError !== undefined) throw new Error(sketchError);
	return { tier };
});
