// Starts the engine on a canvas that CSS sizes to half the window, with the pixel ratio cap that
// ?maxPixelRatio= sets, then keeps it running. It offers `canvasSize()` on the window: the canvas's
// CSS size, and the size of its drawing buffer as the engine's capture reads it. A test resizes the
// window and asks again. `setMaxPixelRatio(ratio)` on the window has the sketch change its cap
// through `ctx.quality`, and resolves once the sketch has heard of the change.
import { createEngine } from '@null3d/engine';
import { run } from './lib/result';

interface CanvasSize {
	css: { width: number; height: number };
	buffer: { width: number; height: number };
}

declare global {
	interface Window {
		canvasSize?: () => Promise<CanvasSize>;
		setMaxPixelRatio?: (ratio: number) => Promise<void>;
	}
}

const cap = new URLSearchParams(location.search).get('maxPixelRatio');

run('resize', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	let heardChange = () => {};
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/quality-sketch.ts', import.meta.url),
		maxPixelRatio: cap === null ? undefined : Number(cap),
		onSketchMessage: (name) => {
			if (name === 'changed') heardChange();
		},
	});
	await engine.firstFrame;
	window.canvasSize = async () => {
		const { width, height } = await engine.captureFrame();
		const box = canvas.getBoundingClientRect();
		return { css: { width: box.width, height: box.height }, buffer: { width, height } };
	};
	window.setMaxPixelRatio = (ratio) =>
		new Promise((resolve) => {
			heardChange = resolve;
			engine.postToSketch('set', { maxPixelRatio: ratio });
		});
	return { mode: engine.mode, tier: engine.capabilities.tier };
});
