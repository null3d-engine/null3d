// What both pages share: the canvas size, the timed run's seconds, the switches they read from the
// address, and the summary of a list of numbers.

/** The canvas in device pixels; both pages draw at a pixel ratio of 1. */
export const CANVAS = { width: 1920, height: 1080 };

const params = new URLSearchParams(location.search);

/** The page's switches. */
export const options = {
	view: params.get('view') ?? 'walk',
	shadows: params.get('shadows') === '1',
	warmupSeconds: Number(params.get('warmup') ?? 8),
	measureSeconds: Number(params.get('seconds') ?? 40),
	params,
};

/** The median and the 95th percentile of a list of numbers, or null for an empty list. */
export function summary(values) {
	const known = values.filter((v) => v != null && Number.isFinite(v));
	if (known.length === 0) return null;
	const sorted = [...known].sort((a, b) => a - b);
	const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
	return { median: at(0.5), p95: at(0.95), samples: sorted.length };
}

/** Makes the canvas of the run's size at one device pixel per canvas pixel. */
export function makeCanvas() {
	const canvas = document.createElement('canvas');
	canvas.width = CANVAS.width;
	canvas.height = CANVAS.height;
	canvas.style.width = `${CANVAS.width / devicePixelRatio}px`;
	canvas.style.height = `${CANVAS.height / devicePixelRatio}px`;
	canvas.style.display = 'block';
	document.body.append(canvas);
	return canvas;
}

/** Shows the run's state, and publishes the result for the runner. */
export function finish(result) {
	globalThis.__result = result;
	document.querySelector('#status').textContent = JSON.stringify(result);
}

/** Runs the page's work and publishes its result, or its error. */
export async function run(work) {
	try {
		finish(await work());
	} catch (error) {
		console.error(error);
		finish({ error: String(error?.stack ?? error) });
	}
}
