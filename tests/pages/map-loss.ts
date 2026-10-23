// Reads the middle pixel of a frame whose whole canvas is one image texture, waits for the upload
// to finish, takes the GPU away, and reads it again. With `keepTextureCopies` the map comes back,
// so the pixel keeps the map's magenta. Without it the texture draws with the material's color
// alone, so the pixel turns white. `?copies=on` and `?copies=off` set the option; without it the
// engine's default for the device runs. The pixel is read back through the engine each time.
import { createEngine, type Engine, type EngineError } from '@null3d/engine';
import { framesDrawn } from './lib/measure';
import { run } from './lib/result';

const params = new URLSearchParams(location.search);
/** The most times the page doubles its wait for the map, so a slow runner still finds it. */
const DOUBLINGS = 3;

/** The middle pixel of a frame, as four bytes, read back through the engine. */
async function middlePixel(engine: Engine): Promise<number[]> {
	const { width, height, pixels } = await engine.captureFrame();
	const at = (Math.floor(height / 2) * width + Math.floor(width / 2)) * 4;
	return [pixels[at], pixels[at + 1], pixels[at + 2], pixels[at + 3]] as number[];
}

/**
 * True for the map's magenta rather than the material's white: its green channel sits well below
 * its red and blue ones, where white's three channels agree. The map's magenta survives the tone
 * curve, which keeps green well below red and blue.
 */
function isMap(pixel: readonly number[]): boolean {
	const green = pixel[1] as number;
	return green + 40 < (pixel[0] as number) && green + 40 < (pixel[2] as number);
}

/**
 * Waits, measuring frames, until the middle pixel shows the map. A measurement is a frame at least,
 * and each waits twice as long as the one before, so a texture that uploads over several frames
 * still gets there.
 */
async function waitForMap(engine: Engine): Promise<number[]> {
	// A simulated loss destroys the device at once and returns, so a capture issued before the
	// engine has its replacement reads back from a device that is gone. It fails with "the GPU
	// device was lost during the readback (destroyed: Device was destroyed.)". A device that the
	// browser reclaims reports "unknown" where that one says "destroyed", so the word in the
	// message tells a loss the page asked for from one it did not. A frame drawn again means the
	// replacement is there to read back from.
	await framesDrawn(engine, 0.5);
	let pixel: number[] = [0, 0, 0, 0];
	let seconds = 0.25;
	for (let round = 0; round <= DOUBLINGS; round++) {
		await engine.measure(seconds);
		pixel = await middlePixel(engine);
		if (isMap(pixel)) return pixel;
		seconds *= 2;
	}
	return pixel;
}

run('map-loss', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const copies = params.get('copies');
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/map-loss-sketch.ts', import.meta.url),
		maxPixelRatio: 1,
		...(copies === null ? {} : { keepTextureCopies: copies === 'on' }),
	});
	let failure: EngineError | null = null;
	engine.onFailure((error) => {
		failure = error;
	});
	const before = await waitForMap(engine);
	// A second of frames after the map appeared, so the frame that releases its image has run.
	await engine.measure(1);
	engine.simulateGpuLoss();
	const after = await waitForMap(engine);
	await engine.destroy();
	return {
		tier: engine.capabilities.tier,
		mode: engine.mode,
		copies,
		before,
		after,
		code: (failure as EngineError | null)?.code ?? null,
	};
});
