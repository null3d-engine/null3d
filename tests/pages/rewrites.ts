// Starts the engine with the rewrites sketch, waits until its boxes have stopped moving and the
// engine has drawn them still, and reads the frame back. ?settled starts the sketch with each box
// where the moves leave it. A fixed preset skips the preset check, so both runs draw at the same
// quality on a busy machine.
import { createEngine } from '@null3d/engine';
import { run, toBase64 } from './lib/result';

/** A frame of the sketch after both bursts of moves, with frames to spare for drawing. */
const STILL_FRAME = 160;

run('rewrites', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	// Vite rewrites an address it can read whole, so the query goes on afterwards.
	const sketch = new URL('./sketches/rewrites-sketch.ts', import.meta.url);
	if (new URLSearchParams(location.search).has('settled')) sketch.searchParams.set('settled', '');
	const engine = await createEngine({ canvas, sketch, maxPixelRatio: 1, preset: 'medium' });
	await engine.firstFrame;
	for (;;) {
		const frame = await new Promise<number>((resolve) => {
			const off = engine.onSketchMessage((name, data) => {
				if (name !== 'frame') return;
				off();
				resolve(data as number);
			});
			engine.postToSketch('frame');
		});
		if (frame >= STILL_FRAME) break;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	const frame = await engine.captureFrame();
	await engine.destroy();
	return {
		tier: engine.capabilities.tier,
		width: frame.width,
		height: frame.height,
		pixels: toBase64(frame.pixels),
	};
});
