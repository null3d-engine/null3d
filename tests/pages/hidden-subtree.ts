// Draws the hidden subtree sketch twice, one engine after another on canvases of the same size:
// once with the rig and the camera's body hidden while they move, and once with the rig shown and
// the camera placed alone. Reports each engine's picture while the scene holds still, every frame
// drawn after the page asks for the show, the picture once the sketch says the show is over, and
// the failures that each engine heard.
import { createEngine } from '@null3d/engine';
import { run, toBase64 } from './lib/result';

run('hidden-subtree', async () => {
	const canvases = document.querySelectorAll('canvas');
	const pictures: Record<
		string,
		{ still: string; after: string; during: string[]; latency: string; failures: string[] }
	> = {};
	for (const [k, mode] of ['hide', 'reference'].entries()) {
		const canvas = canvases[k];
		if (!canvas) throw new Error('the page has fewer than two canvases');
		// The mode goes on after the address is made: Vite rewrites a template literal given to
		// new URL with import.meta.url, and its query would reach the sketch unfilled.
		const sketch = new URL('./sketches/hidden-subtree-sketch.ts', import.meta.url);
		sketch.searchParams.set('mode', mode);
		const engine = await createEngine({ canvas, sketch, maxPixelRatio: 1 });
		const failures: string[] = [];
		engine.onFailure((error) => failures.push(`${error.code}: ${error.message}`));
		const message = (wanted: string) =>
			new Promise<void>((resolve) => {
				const off = engine.onSketchMessage((name) => {
					if (name !== wanted) return;
					off();
					resolve();
				});
			});
		await message('still');
		// A frame or two after the message can still show the last move.
		await engine.captureFrame();
		await engine.captureFrame();
		const still = toBase64((await engine.captureFrame()).pixels);
		let done = false;
		const after = message('after').then(() => {
			done = true;
		});
		engine.postToSketch('show', null);
		// Frames back to back from the show on: each one shows the rig in its last place, or not
		// yet at all.
		const during: string[] = [];
		while (!done) during.push(toBase64((await engine.captureFrame()).pixels));
		await after;
		const picture = toBase64((await engine.captureFrame()).pixels);
		pictures[mode] = { still, after: picture, during, latency: engine.mode.latency, failures };
		await engine.destroy();
	}
	return { pictures };
});
