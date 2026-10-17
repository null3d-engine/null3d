// The smallest case of a sprite batch with an origin (the sketch in
// sketches/sprite-origin-sketch.ts): four cards, one per frame of a four column atlas of flat
// colors, standing around an origin far from the world's. The page publishes the frame it drew, so
// a test reads each card's color from the middle row. ?origin=off draws the same four cards with no
// origin on the batch.
import { createEngine } from '@null3d/engine';
import { run, toBase64 } from './lib/result';

/** The frame's size in pixels, as the sketch's camera sees the row of cards. */
const SIZE = [320, 180] as const;

run('sprite-origin', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	canvas.style.width = `${SIZE[0]}px`;
	canvas.style.height = `${SIZE[1]}px`;
	const sketch = new URL('/tests/pages/sketches/sprite-origin-sketch.ts', location.origin);
	if (new URLSearchParams(location.search).get('origin') === 'off') sketch.search = 'origin=off';
	const engine = await createEngine({ canvas, sketch, maxPixelRatio: 1 });
	const frame = await engine.captureFrame();
	await engine.destroy();
	return {
		tier: engine.capabilities.tier,
		mode: engine.mode,
		width: frame.width,
		height: frame.height,
		pixels: toBase64(frame.pixels),
	};
});
