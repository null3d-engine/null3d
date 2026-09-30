// Starts a sketch whose tagged WGSL does not compile, and publishes the error that the start fails
// with. On a dev server, the null3D plugin's error reaches Vite's overlay on this page too.
import { createEngine } from '@null3d/engine';
import { errorFields, noError } from './lib/error-fields';
import { run } from './lib/result';

const sketch = new URL('./sketches/broken-shader-sketch.ts', import.meta.url);

run('shader-error', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	try {
		const engine = await createEngine({ canvas, sketch });
		await engine.destroy();
		return { start: noError('the engine started') };
	} catch (e) {
		return { start: errorFields(e) };
	}
});
