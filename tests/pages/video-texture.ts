// Plays a video element on the page into a texture in the sketch, through `engine.registerVideo`
// and `textures.fromVideo`. The video comes from a canvas's stream, so the page needs no video
// file and the frame's colours are the colours that the page paints: a band at the top and another
// at the bottom, which tell a picture that is upside down from one that is not. The page measures
// two seconds while the video plays and two while it is paused: the frames that play must stay
// within the preset's upload budget, and a paused video must upload nothing. It then reads the
// frame back and compares each band with a data texture of the same colour, which shows whether
// the frame's colours arrive as they are, and the sketch reports the texture's size, which the
// page scales to the size that the options allow.
import { createEngine } from '@null3d/engine';
import { watchEngine } from './lib/engine-watch';
import { progress, run } from './lib/result';

/** The video's size in the test, which is the size of the canvas that it plays. */
const WIDTH = 640;
const HEIGHT = 360;
/** The most texels of a frame's widest side, which makes a 640 x 360 video a 512 x 288 frame. */
const MAX_SIZE = 512;
/** The colour of the video's top band and of its bottom band, which the sketch's data textures hold too. */
const TOP = [96, 160, 224] as const;
const BOTTOM = [224, 160, 64] as const;

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
	// The sketch reports the upload budget at once, and the texture's size once its first frame is
	// on the GPU. A video that never plays keeps the texture at its first size, so the wait ends.
	let budget = 0;
	const texture = { width: 1, height: 1 };
	engine.onSketchMessage((name, data) => {
		if (name === 'ready') budget = (data as { budget: number }).budget;
		if (name === 'frame') Object.assign(texture, data as { width: number; height: number });
	});
	// A canvas's stream is a video without a file: the bands are the colours that the page paints.
	const source = document.createElement('canvas');
	source.width = WIDTH;
	source.height = HEIGHT;
	const context = source.getContext('2d');
	if (!context) throw new Error('the source canvas has no 2D context');
	/** Paints the two bands and a dot half way down, which moves so that every frame differs. */
	const paint = (phase: number) => {
		context.fillStyle = `rgb(${TOP.join(', ')})`;
		context.fillRect(0, 0, WIDTH, HEIGHT / 2);
		context.fillStyle = `rgb(${BOTTOM.join(', ')})`;
		context.fillRect(0, HEIGHT / 2, WIDTH, HEIGHT / 2);
		// The dot sits between the two bands, where the test reads no colour: a stream of a canvas
		// that never changes may send one frame and then stall.
		context.fillStyle = '#ffffff';
		context.fillRect(phase * (WIDTH - 34), HEIGHT / 2 - 8, 32, 16);
	};
	paint(0);
	// The source canvas stays in the page out of sight too: some browsers may capture a stream only
	// from a canvas that has a place in the layout.
	source.style.position = 'absolute';
	source.style.left = '-10000px';
	source.style.width = '1px';
	source.style.height = '1px';
	document.body.append(source);
	if (typeof source.captureStream !== 'function') {
		throw new Error('this browser cannot play a canvas as a video: captureStream is missing');
	}
	const video = document.createElement('video');
	video.muted = true;
	video.playsInline = true;
	video.srcObject = source.captureStream(30);
	// The element stays in the page but out of sight. A hidden video element, display: none, may
	// decode no frames in some browsers, so it keeps its place in the layout and hides.
	video.style.position = 'absolute';
	video.style.left = '-10000px';
	video.style.width = '1px';
	video.style.height = '1px';
	document.body.append(video);
	// A stream gives its size with the metadata; a video that never reports it still plays, and the
	// frames then tell whether the browser read them.
	await Promise.race([
		new Promise<void>((resolve) => {
			video.onloadedmetadata = () => resolve();
		}),
		new Promise<void>((resolve) => setTimeout(resolve, 2000)),
	]);
	engine.registerVideo(video, { name: 'video-test', maxSize: MAX_SIZE });
	progress('the video is registered');
	// The page's share of a frame is the copy that `createImageBitmap` makes from the video, which
	// scales it. The test times each copy, so a run records what a frame costs the page's thread.
	const copies: number[] = [];
	const realCreate = globalThis.createImageBitmap;
	globalThis.createImageBitmap = ((source: ImageBitmapSource, options?: ImageBitmapOptions) => {
		if (source !== video) return realCreate(source, options);
		const started = performance.now();
		return realCreate(source, options).then((image) => {
			copies.push(performance.now() - started);
			return image;
		});
	}) as typeof createImageBitmap;
	// A browser may refuse to play a video, as its autoplay policy does. The engine then sends no
	// frame and the texture draws with its material's colour alone, so the run reports it.
	let played = true;
	try {
		await video.play();
	} catch (error) {
		played = false;
		progress(`the browser refused to play the video: ${String(error)}`);
	}
	progress(`video playing at ${video.videoWidth} x ${video.videoHeight}`);
	// The canvas changes on every display frame while the video plays, so its stream sends frames
	// that differ. The dot moves across the middle, where the test reads no colour.
	let painting = 0;
	const animate = () => {
		if (video.paused) return;
		paint(((performance.now() / 16) % 100) / 100);
		painting = requestAnimationFrame(animate);
	};
	if (played) painting = requestAnimationFrame(animate);
	// A frame goes from the video to the sketch, and then to the GPU, in a frame or two.
	await presented(video);
	await new Promise((resolve) => setTimeout(resolve, 500));
	const playing = await engine.measure(2);
	progress('measured while playing');

	video.pause();
	cancelAnimationFrame(painting);
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
	progress(`the texture is ${texture.width} x ${texture.height}`);
	await engine.destroy();
	progress('engine destroyed');
	stopWatch();
	const sorted = [...copies].sort((a, b) => a - b);
	const copy = {
		count: sorted.length,
		medianMs: sorted[Math.floor(sorted.length / 2)] ?? 0,
		p95Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0,
	};
	// The video's half lies over the left of the view, and the data's half over the right, so each
	// band is read from both halves at the same height.
	const colour = (x: number, y: number) => pixelAt(frame, frame.width * x, frame.height * y);
	const samples = [
		{ at: 'the top half', video: colour(0.25, 0.25), data: colour(0.75, 0.25) },
		{ at: 'the bottom half', video: colour(0.25, 0.75), data: colour(0.75, 0.75) },
	];
	console.log(
		`video texture: ${(playing.uploadBytes.mean / 1024).toFixed(1)} KiB a frame on average, ${(playing.uploadBytes.p99 / 1024).toFixed(1)} KiB at p99 of a budget of ${(budget / 1024).toFixed(0)} KiB; paused: ${paused.uploadBytes.p99} bytes at p99; the page's copy of a frame: ${copy.medianMs.toFixed(2)} ms at the median, ${copy.p95Ms.toFixed(2)} ms at p95 of ${copy.count}; the texture is ${texture.width} x ${texture.height} of a ${video.videoWidth} x ${video.videoHeight} video; ${samples.map(({ at: where, video: shown, data }) => `${where} shows rgb(${shown.join(', ')}) against rgb(${data.join(', ')}) from data`).join(', ')}`,
	);
	return {
		tier: engine.capabilities.tier,
		mode: engine.mode,
		budget,
		width: video.videoWidth,
		height: video.videoHeight,
		maxSize: MAX_SIZE,
		frame: texture,
		played,
		copy,
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
		samples,
	};
});
