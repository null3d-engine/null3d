// Checks that no frame draws the scene without an environment's light: the built-in room, or with
// ?source=<address> an HDR file that the engine reads and filters at load. The sketch
// (sketches/room-light-sketch.ts) draws a metal sphere with no light on black. The page asks it for
// the environment during play, and captures the newest frame again and again while the map is made,
// until it has a number of frames that use it. The sketch sets the environment and a blue
// background in the same step, so a capture with the blue background is a frame that uses it. Each
// one should match the steady frame at the end. The page reports how many captures had each
// background, how far each blue one lay from the steady frame, and how long the environment took:
// until it resolved, and until the first frame that uses it.
import { createEngine } from '@null3d/engine';
import { run } from './lib/result';

/** The captures with the blue background that the page takes. */
const BLUE_FRAMES = 30;
/**
 * The longest the page waits for the environment to resolve, and then for its frames. A software
 * GPU on a busy machine takes many seconds for the map's frame, and for each capture.
 */
const SET_LIMIT_MS = 60_000;
const FRAMES_LIMIT_MS = 120_000;
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
	let setMs: number | null = null;
	const started = performance.now();
	let sketchFrames = 0;
	const off = engine.onSketchMessage((name, data) => {
		if (name === 'frame') sketchFrames = data as number;
		if (name !== 'set') return;
		set = true;
		setMs = performance.now() - started;
	});
	engine.postToSketch('room', new URLSearchParams(location.search).get('source'));
	let firstBlack: Frame | undefined;
	let blackFrames = 0;
	let lightMs: number | null = null;
	const blue: Frame[] = [];
	// Every frame is captured from the request on, so the first frames that use the environment
	// are among those checked, however long the map takes.
	const waiting = () => {
		const now = performance.now() - started;
		return setMs === null ? now < SET_LIMIT_MS : now - setMs < FRAMES_LIMIT_MS;
	};
	// A capture replays the last frame that the thread that draws took. On a slow software GPU a
	// capture blocks that thread for seconds, so captures back to back would leave it no turn to
	// take a new frame. After each capture, the page waits for the sketch's next frame: the sketch
	// runs at most a frame or two ahead of the thread that draws, so its count moves on only as
	// that thread takes frames.
	const nextSketchFrame = async (after: number) => {
		while (sketchFrames <= after && waiting())
			await new Promise((resolve) => requestAnimationFrame(resolve));
	};
	while (blue.length < BLUE_FRAMES && waiting()) {
		const frame = await engine.captureFrame();
		const before = sketchFrames;
		if (isBlue(frame)) {
			lightMs ??= performance.now() - started;
			blue.push(frame);
		} else {
			firstBlack ??= frame;
			blackFrames++;
		}
		await nextSketchFrame(before);
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
		/**
		 * Milliseconds from the request until the environment resolved, and until the first capture
		 * that uses it: the download, the reading and the shaders, then the map and its frame.
		 */
		setMs,
		lightMs,
		failures,
	};
});
