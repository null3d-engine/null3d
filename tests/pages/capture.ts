// Starts the engine with the boxes sketch, a still scene, in the thread mode and on the GPU tier
// that the URL's switches ask for, and reads a frame back both ways: its pixels with captureFrame,
// and a PNG file with capture. With ?hold=, both give the held frame. Then it stops the engine, and
// reports the error code of a capture after the stop.
import { createEngine, EngineError } from '@null3d/engine';
import { run, toBase64 } from './lib/result';

run('capture', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/boxes-sketch.ts', import.meta.url),
		maxPixelRatio: 1,
	});
	if (engine.mode.hold === null) await engine.firstFrame;
	const frame = await engine.captureFrame();
	const image = await engine.capture();
	await engine.destroy();
	const afterStop = await engine.capture().then(
		() => 'an image',
		(error: unknown) => (error instanceof EngineError ? error.code : String(error)),
	);
	return {
		tier: engine.capabilities.tier,
		mode: engine.mode,
		width: frame.width,
		height: frame.height,
		pixels: toBase64(frame.pixels),
		image: toBase64(new Uint8Array(await image.arrayBuffer())),
		imageType: image.type,
		afterStop,
	};
});
