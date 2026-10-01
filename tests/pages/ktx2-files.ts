// Starts the engine live with the KTX2 sketch, in the thread mode that the page's switches ask
// for, and reports the GPU path's features with what the sketch recorded once every texture is on
// the GPU.
import { createEngine } from '@null3d/engine';
import { run } from './lib/result';

run('ktx2-files', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/ktx2-formats-sketch.ts', import.meta.url),
		maxPixelRatio: 1,
	});
	const recorded = await new Promise<unknown>((resolve) =>
		engine.onSketchMessage((name, data) => {
			if (name === 'result') resolve(data);
		}),
	);
	const { mode, capabilities } = engine;
	await engine.destroy();
	return { mode, tier: capabilities.tier, features: capabilities.features, recorded };
});
