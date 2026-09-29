// Starts the engine on a canvas that CSS sizes to half the window, with the pixel ratio cap that
// ?maxPixelRatio= sets, then keeps it running. It offers `canvasSize()` on the window: the canvas's
// CSS size, and the size of its drawing buffer as the engine's capture reads it. A test resizes the
// window and asks again.
import { createEngine } from '@null3d/engine';
import { run } from './lib/result';

interface CanvasSize {
	css: { width: number; height: number };
	buffer: { width: number; height: number };
}

declare global {
	interface Window {
		canvasSize?: () => Promise<CanvasSize>;
	}
}

const cap = new URLSearchParams(location.search).get('maxPixelRatio');

run('resize', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/empty-sketch.ts', import.meta.url),
		maxPixelRatio: cap === null ? undefined : Number(cap),
	});
	await engine.firstFrame;
	window.canvasSize = async () => {
		const { width, height } = await engine.captureFrame();
		const box = canvas.getBoundingClientRect();
		return { css: { width: box.width, height: box.height }, buffer: { width, height } };
	};
	return { mode: engine.mode, tier: engine.capabilities.tier };
});
