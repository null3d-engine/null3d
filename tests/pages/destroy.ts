// Draws the destroy sketch twice, one engine after another on canvases of the same size: once
// with the meshes and models it destroys, and once without them. Reports each picture, and the
// failures that each engine heard.
import { createEngine } from '@null3d/engine';
import { run, toBase64 } from './lib/result';

run('destroy', async () => {
	const canvases = document.querySelectorAll('canvas');
	const pictures: Record<string, { pixels: string; meshBytes: number; failures: string[] }> = {};
	for (const [k, mode] of ['destroy', 'reference'].entries()) {
		const canvas = canvases[k];
		if (!canvas) throw new Error('the page has fewer than two canvases');
		// The mode goes on after the address is made: Vite rewrites a template literal given to
		// new URL with import.meta.url, and its query would reach the sketch unfilled.
		const sketch = new URL('./sketches/destroy-sketch.ts', import.meta.url);
		sketch.searchParams.set('mode', mode);
		const engine = await createEngine({
			canvas,
			sketch,
			maxPixelRatio: 1,
		});
		const failures: string[] = [];
		engine.onFailure((error) => failures.push(`${error.code}: ${error.message}`));
		const ready = await new Promise<{ meshBytes: number }>((resolve) =>
			engine.onSketchMessage((name, data) => {
				if (name === 'ready') resolve(data as { meshBytes: number });
			}),
		);
		const capture = await engine.captureFrame();
		pictures[mode] = { pixels: toBase64(capture.pixels), meshBytes: ready.meshBytes, failures };
		await engine.destroy();
	}
	return { pictures };
});
