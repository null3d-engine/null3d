// Checks that no frame draws the scene without the built-in room's light. The sketch
// (sketches/room-light-sketch.ts) draws a metal sphere with no light on black. The page asks it for
// the room during play, and captures the newest frame again and again while the room is made, until
// it has a number of frames that use the room. The sketch sets the room and a blue background in
// the same step, so a capture with the blue background is a frame that uses the room. Each one
// should match the steady frame at the end. The page reports how many captures had each
// background, and how far each blue one lay from the steady frame.
import { createEngine } from '@null3d/engine';
import { run } from './lib/result';

/** The captures with the blue background that the page takes. */
const BLUE_FRAMES = 30;
/** The longest the page waits for the room. */
const LIMIT_MS = 20_000;
/** A channel that differs from the steady frame by more than this counts the pixel as changed. */
const CHANNEL_STEP = 4;

interface Frame {
	width: number;
	height: number;
	pixels: Uint8Array;
}

/** True when the frame's top left pixel is the blue background, which comes with the room. */
const isBlue = ({ pixels }: Frame) => (pixels[2] as number) > (pixels[0] as number) + 40;

/** The pixels of `frame` with any channel more than a step from `steady`'s. */
function changed(frame: Frame, steady: Frame): number {
	let count = 0;
	for (let at = 0; at < frame.pixels.length; at += 4)
		for (let c = 0; c < 3; c++)
			if (
				Math.abs((frame.pixels[at + c] as number) - (steady.pixels[at + c] as number)) >
				CHANNEL_STEP
			) {
				count++;
				break;
			}
	return count;
}

/** The mean of the red, green and blue channels over the middle tenth of the frame. */
function middle({ width, height, pixels }: Frame): number {
	let sum = 0;
	let count = 0;
	for (let y = Math.floor(0.45 * height); y < Math.ceil(0.55 * height); y++)
		for (let x = Math.floor(0.45 * width); x < Math.ceil(0.55 * width); x++) {
			const at = 4 * (y * width + x);
			sum += (pixels[at] as number) + (pixels[at + 1] as number) + (pixels[at + 2] as number);
			count += 3;
		}
	return sum / count;
}

run('room-light', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/room-light-sketch.ts', import.meta.url),
		maxPixelRatio: 1,
	});
	const failures: string[] = [];
	engine.onFailure((error) => failures.push(error.code));
	await engine.firstFrame;
	let set = false;
	const off = engine.onSketchMessage((name) => {
		if (name === 'set') set = true;
	});
	engine.postToSketch('room', null);
	let firstBlack: Frame | undefined;
	let blackFrames = 0;
	const blue: Frame[] = [];
	const started = performance.now();
	while (blue.length < BLUE_FRAMES && performance.now() - started < LIMIT_MS) {
		const frame = await engine.captureFrame();
		if (isBlue(frame)) blue.push(frame);
		else {
			firstBlack ??= frame;
			blackFrames++;
		}
	}
	off();
	await new Promise((resolve) => setTimeout(resolve, 300));
	const steady = await engine.captureFrame();
	await engine.destroy();
	return {
		tier: engine.capabilities.tier,
		set,
		steadyBlue: isBlue(steady),
		pixels: steady.width * steady.height,
		blackFrames,
		blueFrames: blue.length,
		/** The changed pixels of each blue frame, against the steady frame. */
		blueChanged: blue.map((frame) => changed(frame, steady)),
		/** The sphere's middle, lit by the room in the steady frame and unlit in the first frame. */
		litMiddle: middle(steady),
		unlitMiddle: firstBlack ? middle(firstBlack) : null,
		failures,
	};
});
