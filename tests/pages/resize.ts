// Starts the engine on a canvas that CSS sizes to half the window, with the pixel ratio cap that
// ?maxPixelRatio= sets, then keeps it running. With ?css=none no CSS sizes the canvas, and with
// ?css=<width>x<height> CSS gives it that size in CSS pixels. The page offers `canvasSize()` on the
// window: the canvas's CSS size, and the size of its drawing buffer as the engine's capture reads
// it. A test resizes the window and asks again. `setMaxPixelRatio(ratio)` on the window has the
// sketch change its cap through `ctx.quality`, and resolves once the sketch has heard of the change.
// `maxDrawingSize(gpu)` gives the largest drawing buffer of the GPU path that the ?gpu= switch
// names, from the browser's limits: on WebGPU the texture size of a device requested as the engine
// requests it, and on WebGL2 the smallest of the texture, renderbuffer and viewport limits. `maxCanvasSize` holds the engine's own figure for its GPU path, and
// `engineFailure` the message of a failure after the start.
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
		maxDrawingSize?: (gpu: string) => Promise<number>;
		maxCanvasSize?: number;
		engineFailure?: string;
	}
}

const query = new URLSearchParams(location.search);
const cap = query.get('maxPixelRatio');
const css = query.get('css');

run('resize', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	if (css !== null) {
		canvas.classList.remove('half');
		const [width, height] = css.split('x');
		if (width && height) canvas.style.cssText = `width: ${width}px; height: ${height}px`;
	}
	let heardChange = () => {};
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/quality-sketch.ts', import.meta.url),
		maxPixelRatio: cap === null ? undefined : Number(cap),
		onSketchMessage: (name) => {
			if (name === 'changed') heardChange();
		},
	});
	engine.onFailure((error) => {
		window.engineFailure ??= error.message;
	});
	await engine.firstFrame;
	window.maxCanvasSize = engine.capabilities.maxCanvasSize;
	window.canvasSize = async () => {
		const { width, height } = await engine.captureFrame();
		const box = canvas.getBoundingClientRect();
		return { css: { width: box.width, height: box.height }, buffer: { width, height } };
	};
	window.maxDrawingSize = async (gpu) => {
		if (gpu === 'webgl2') {
			const gl = new OffscreenCanvas(1, 1).getContext('webgl2');
			if (!gl) throw new Error('the browser has no WebGL2');
			const [viewportWidth = 0, viewportHeight = 0] = gl.getParameter(
				gl.MAX_VIEWPORT_DIMS,
			) as Int32Array;
			return Math.min(
				gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
				gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number,
				viewportWidth,
				viewportHeight,
			);
		}
		const adapter = await navigator.gpu.requestAdapter({ featureLevel: 'compatibility' });
		if (!adapter) throw new Error('the browser has no WebGPU adapter');
		const core = gpu === 'webgpu' ? ['core-features-and-limits' as GPUFeatureName] : [];
		const device = await adapter.requestDevice({ requiredFeatures: core });
		const size = device.limits.maxTextureDimension2D;
		device.destroy();
		return size;
	};
	window.setMaxPixelRatio = (ratio) =>
		new Promise((resolve) => {
			heardChange = resolve;
			engine.postToSketch('set', { maxPixelRatio: ratio });
		});
	return { mode: engine.mode, tier: engine.capabilities.tier };
});
