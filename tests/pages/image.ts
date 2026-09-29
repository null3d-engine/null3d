// Draws one sketch of the image test manifest in the engine's hold mode and publishes the held
// frame. ?sketch= names the sketch module from the server's root, with the sketch's own query after
// it, and ?size= gives the canvas in pixels, such as 320x180. The engine reads its own switches:
// ?hold= the sketch time, ?gpu= the tier, and the thread mode's switches.
import { createEngine } from '@null3d/engine';
import { run, toBase64 } from './lib/result';

const params = new URLSearchParams(location.search);

/** The canvas size that ?size= gives, in pixels. */
function readSize(text: string | null): [number, number] {
	const [width = 0, height = 0] = (text ?? '').split('x').map(Number);
	if (!(Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0))
		throw new Error(
			`?size=${text ?? ''} is not a size in pixels: use a size such as ?size=320x180.`,
		);
	return [width, height];
}

run('image', async () => {
	const sketch = params.get('sketch');
	if (!sketch?.startsWith('/'))
		throw new Error('Add ?sketch= with the path of a sketch module from the server root.');
	if (!params.has('hold')) throw new Error('Add ?hold= with the sketch time to hold at.');
	const [width, height] = readSize(params.get('size'));
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	canvas.style.width = `${width}px`;
	canvas.style.height = `${height}px`;
	const engine = await createEngine({
		canvas,
		sketch: new URL(sketch, location.origin),
		maxPixelRatio: 1,
	});
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
