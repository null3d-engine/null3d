// Starts the engine with a sketch that shows the stats overlay from its setup, and reads its frame
// figures every frame. Once the overlay and the sketch both show a window's figures, it reports the
// overlay's text, its place on the canvas and its pointer events, and the sketch's figures. The
// window then gets `showStats(show)`, which asks the sketch to show or hide the overlay, and
// `stopEngine()`.
import { createEngine } from '@null3d/engine';
import type { StatsFigures, StatsResult } from '../lib/stats-checks';
import { run } from './lib/result';

declare global {
	interface Window {
		showStats?: (show: boolean) => void;
		stopEngine?: () => Promise<void>;
	}
}

/** How long the page waits for the figures of a window. */
const WAIT_MS = 10_000;

run('stats', async (): Promise<StatsResult> => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/stats-sketch.ts', import.meta.url),
		maxPixelRatio: 1,
	});
	await engine.firstFrame;
	window.showStats = (show) => engine.postToSketch('show', show);
	window.stopEngine = () => engine.destroy();
	const askFigures = () =>
		new Promise<StatsFigures>((resolve) => {
			const off = engine.onSketchMessage((name, data) => {
				if (name !== 'figures') return;
				off();
				resolve(data as StatsFigures);
			});
			engine.postToSketch('figures');
		});
	const element = () => document.querySelector<HTMLElement>('[data-null3d-stats]');
	const until = performance.now() + WAIT_MS;
	let figures = await askFigures();
	while (
		(figures.frames === 0 || !element()?.textContent?.includes('fps presented')) &&
		performance.now() < until
	) {
		await new Promise((resolve) => setTimeout(resolve, 100));
		figures = await askFigures();
	}
	const overlay = element();
	const box = overlay?.getBoundingClientRect();
	const corner = canvas.getBoundingClientRect();
	return {
		tier: engine.capabilities.tier,
		mode: engine.mode,
		overlay:
			overlay && box
				? {
						text: overlay.textContent ?? '',
						offset: [box.left - corner.left, box.top - corner.top],
						pointerEvents: getComputedStyle(overlay).pointerEvents,
					}
				: null,
		figures,
	};
});
