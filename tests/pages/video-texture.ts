// Plays a video element on the page into a texture in the sketch, through `engine.registerVideo`
// and `textures.fromVideo`. The video comes from a canvas's stream, so the page needs no video
// file and the frame's colour is the colour that the page paints. The page measures two seconds
// while the video plays and two while it is paused: the frames that play must stay within the
// preset's upload budget, and a paused video must upload nothing. It then reads the frame back and
// compares the video's half with a data texture of the same grey, which shows whether the frame's
// colours arrive as they are.
import { createEngine } from '@null3d/engine';
import { watchEngine } from './lib/engine-watch';
import { progress, run } from './lib/result';

/** The video's size in the test, which is the size of the canvas that it plays. */
const WIDTH = 320;
const HEIGHT = 180;
/** The grey that the video shows, which the sketch's data texture holds too. */
const GREY = 128;
/** How far a channel of the video's half may sit from the reference half's channel. */
const TOLERANCE = 24;
/** How many steps of 255 a channel holds, for a message. */
const STEPS = [0, 1, 2] as const;

/** A colour of one pixel of the captured frame. */
type Rgb = [number, number, number];

/** The colour of the frame's pixel at `x` and `y`, from its top-left corner. */
function pixelAt(
	frame: { width: number; height: number; pixels: Uint8Array },
	x: number,
	y: number,
): Rgb {
	const at = (Math.round(y) * frame.width + Math.round(x)) * 4;
	const pixels = frame.pixels;
	return [pixels[at] as number, pixels[at + 1] as number, pixels[at + 2] as number];
}

/** Waits for the next frame that the video presents, or for the time limit. */
function presented(video: HTMLVideoElement): Promise<void> {
	return new Promise((resolve) => {
		const limit = setTimeout(resolve, 2000);
		if (typeof video.requestVideoFrameCallback !== 'function') return;
		video.requestVideoFrameCallback(() => {
			clearTimeout(limit);
			resolve();
		});
	});
}

run('video-texture', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const stopWatch = watchEngine();
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/video-texture-sketch.ts', import.meta.url),
		maxPixelRatio: 1,
	});
	progress(`engine started: ${engine.mode.latency} latency, ${engine.mode.renderThread} draws`);
	const ready = new Promise<{ budget: number }>((resolve) =>
		engine.onSketchMessage((name, data) => {
			if (name === 'ready') resolve(data as { budget: number });
		}),
	);
	const { budget } = await ready;
	progress('the sketch follows the video');

	// A canvas's stream is a video without a file: every frame is the grey that the page paints.
	const source = document.createElement('canvas');
	source.width = WIDTH;
	source.height = HEIGHT;
	const context = source.getContext('2d');
	if (!context) throw new Error('the source canvas has no 2D context');
	context.fillStyle = `rgb(${GREY}, ${GREY}, ${GREY})`;
	context.fillRect(0, 0, WIDTH, HEIGHT);
	if (typeof source.captureStream !== 'function') {
		throw new Error('this browser cannot play a canvas as a video: captureStream is missing');
	}
	const video = document.createElement('video');
	video.muted = true;
	video.playsInline = true;
	video.srcObject = source.captureStream(30);
	video.style.display = 'none';
	document.body.append(video);
	// A stream gives its size with the metadata; a video that never reports it still plays, and the
	// frames then tell whether the browser read them.
	await Promise.race([
		new Promise<void>((resolve) => {
			video.onloadedmetadata = () => resolve();
		}),
		new Promise<void>((resolve) => setTimeout(resolve, 2000)),
	]);
	engine.registerVideo(video, { name: 'video-test', maxSize: 512 });
	await video.play();
	progress(`video playing at ${video.videoWidth} x ${video.videoHeight}`);
	// A frame goes from the video to the sketch, and then to the GPU, in a frame or two.
	await presented(video);
	await new Promise((resolve) => setTimeout(resolve, 500));
	const playing = await engine.measure(2);
	progress('measured while playing');

	video.pause();
	// The last frame before the pause finishes its upload before this window opens.
	await new Promise((resolve) => setTimeout(resolve, 500));
	const paused = await engine.measure(2);
	progress('measured while paused');

	// Two captures that agree, so the frame that the test reads is not caught mid-draw.
	let frame = await engine.captureFrame();
	for (let again = 0; again < 4; again++) {
		const next = await engine.captureFrame();
		if (next.pixels.every((value, at) => value === frame.pixels[at])) break;
		frame = next;
	}
	progress('frame captured');
	await engine.destroy();
	progress('engine destroyed');
	stopWatch();
	const left = pixelAt(frame, frame.width * 0.25, frame.height * 0.5);
	const right = pixelAt(frame, frame.width * 0.75, frame.height * 0.5);
	const off = Math.max(
		...STEPS.map((channel) => Math.abs((left[channel] ?? 0) - (right[channel] ?? 0))),
	);
	console.log(
		`video texture: ${(playing.uploadBytes.mean / 1024).toFixed(1)} KiB a frame on average, ${(playing.uploadBytes.p99 / 1024).toFixed(1)} KiB at p99 of a budget of ${(budget / 1024).toFixed(0)} KiB; paused: ${paused.uploadBytes.p99} bytes at p99; the video's half shows rgb(${left.join(', ')}) against rgb(${right.join(', ')})`,
	);
	return {
		tier: engine.capabilities.tier,
		mode: engine.mode,
		budget,
		width: video.videoWidth,
		height: video.videoHeight,
		playing: {
			mean: playing.uploadBytes.mean,
			p99: playing.uploadBytes.p99,
			frames: playing.frames,
		},
		paused: {
			mean: paused.uploadBytes.mean,
			p99: paused.uploadBytes.p99,
			frames: paused.frames,
		},
		left,
		right,
		off,
		withinTolerance: off <= TOLERANCE,
	};
});
