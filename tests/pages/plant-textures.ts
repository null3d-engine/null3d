// Starts the engine live with the plant textures sketch on the GPU path that the page's switches ask
// for. Once every texture is on the GPU, it reads a frame back through the engine and reports the
// mean colour of each strip of both planes, with what the sketch recorded of each texture.
import { createEngine } from '@null3d/engine';
import { run } from './lib/result';

/** The strips across each plane, as the sketch draws them. */
const STRIPS = 8;

run('plant-textures', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/plant-textures-sketch.ts', import.meta.url),
		maxPixelRatio: 1,
	});
	const recorded = await new Promise<unknown>((resolve) =>
		engine.onSketchMessage((name, data) => {
			if (name === 'result') resolve(data);
		}),
	);
	// A frame after the last upload, so every strip samples its texture.
	await engine.captureFrame();
	const { width, height, pixels } = await engine.captureFrame();
	const strips = ['full', 'half'].map((_, plane) =>
		Array.from({ length: STRIPS }, (_, strip) => {
			// The middle of the strip, away from its edges, over the plane's middle rows.
			const left = Math.round(((plane * STRIPS + strip + 0.3) * width) / (2 * STRIPS));
			const right = Math.round(((plane * STRIPS + strip + 0.7) * width) / (2 * STRIPS));
			const sum = [0, 0, 0];
			let n = 0;
			for (let y = Math.round(height * 0.3); y < Math.round(height * 0.7); y++)
				for (let x = left; x < right; x++) {
					const at = (y * width + x) * 4;
					for (let c = 0; c < 3; c++) sum[c] = (sum[c] as number) + (pixels[at + c] as number);
					n++;
				}
			return sum.map((v) => Math.round(v / n));
		}),
	);
	const { mode, capabilities } = engine;
	await engine.destroy();
	return { mode, tier: capabilities.tier, recorded, strips };
});
