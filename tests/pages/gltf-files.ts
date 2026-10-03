// Starts the engine live with the glTF files sketch, in the thread mode that the page's switches ask
// for, and reports what the sketch found, with the thread mode. ?meshopt runs the sketch of files
// with meshopt compression instead. Each sketch's address is a literal, so a production build ships
// both.
import { createEngine } from '@null3d/engine';
import { run } from './lib/result';

const params = new URLSearchParams(location.search);

run('gltf-files', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const engine = await createEngine({
		canvas,
		sketch: params.has('meshopt')
			? new URL('./sketches/gltf-meshopt-sketch.ts', import.meta.url)
			: new URL('./sketches/gltf-files-sketch.ts', import.meta.url),
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
