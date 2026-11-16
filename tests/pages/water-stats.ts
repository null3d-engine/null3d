// Starts the engine on a small lake drawn by @null3d/water with the stats overlay open. The page
// waits until the overlay's water row shows the Medium cadence and budget, its memory and, where
// the device times passes, its GPU time. It then switches to Low and waits for the row to follow.
import { createEngine } from '@null3d/engine';
import { run } from './lib/result';

/** How long the page waits for a window and the overlay's refresh after it. */
const WAIT_MS = 20_000;

/** The water row's text, read through the overlay's shadow root. */
function waterRow(): string {
	const host = document.querySelector<HTMLElement>('[data-null3d-stats]');
	const row = host?.shadowRoot?.querySelector<HTMLElement>('[data-figure="feature:water"]');
	return row?.textContent ?? '';
}

/** Waits until the water row matches `holds`, and returns it. */
async function waitRow(holds: (row: string) => boolean, what: string): Promise<string> {
	const until = performance.now() + WAIT_MS;
	let row = waterRow();
	while (!holds(row) && performance.now() < until) {
		await new Promise((resolve) => setTimeout(resolve, 100));
		row = waterRow();
	}
	if (!holds(row))
		throw new Error(
			`the water row did not show ${what} within ${WAIT_MS / 1000} s: ${JSON.stringify(row)}`,
		);
	return row;
}

/** Waits until the water row holds `text`. */
const waitText = (text: string, what: string) => waitRow((row) => row.includes(text), what);

run('water-stats', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/water-stats-sketch.ts', import.meta.url),
		maxPixelRatio: 1,
		stats: true,
	});
	await engine.firstFrame;
	const tier = engine.capabilities.tier;
	// Only WebGPU times passes one by one. WebGL2 times the whole frame, so its row has no figure.
	const stepTimer = tier === 'webgpu' && engine.capabilities.features.includes('timestamp-query');
	await waitText('reflectionEvery 2', 'the Medium cadence');
	// The row's memory is the arrays and foam texture that the add-on made. The GPU time needs a
	// window whose timed frame held the reflection pass.
	const row = await waitRow(
		(row) => /memory \d+\.\d MiB/.test(row) && (!stepTimer || /gpu \d+\.\d+ ms/.test(row)),
		'its memory and, where the device times passes, the GPU time of its reflection pass',
	);
	const applied = new Promise<unknown>((resolve) => {
		const off = engine.onSketchMessage((name, data) => {
			if (name !== 'preset') return;
			off();
			resolve(data);
		});
	});
	engine.postToSketch('preset', 'low');
	const answer = await Promise.race([
		applied,
		new Promise((resolve) => setTimeout(() => resolve('no answer'), WAIT_MS)),
	]);
	const low = await waitText(
		'reflectionEvery 3',
		`the Low cadence after the sketch answered ${JSON.stringify(answer)}`,
	);
	await engine.destroy();
	return { tier, stepTimer, row, low };
});
