// Starts the engine live with fifty textures that load in waves under a small upload budget, and
// captures the frame once every image is on the GPU. Besides the image, it reports whether each
// frame kept to the budget, and whether the GPU memory count matches the textures' arrays. The
// budget holds on the sketch thread's count of texture bytes in every frame, and on the count of
// every byte the thread that draws uploads in the frames after the last wave of new objects,
// whose tables upload whole.
import { createEngine } from '@null3d/engine';
import { run, toBase64 } from './lib/result';

/** What the sketch sends once every image is on the GPU. */
interface Loaded {
	/** The bytes one frame may upload, the textures, and the texels on each side of one. */
	budget: number;
	count: number;
	size: number;
	frames: number;
	largestFrameBytes: number;
	memoryBytes: number;
	textureBytes: number;
}

/** Bytes that the thread that draws uploads besides the textures in a frame of this scene. */
const OTHER_UPLOADS = 4 * 1024;
/** Seconds to measure the thread that draws while the textures load. */
const MEASURE_SECONDS = 1;

run('texture-arrays', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/texture-arrays-sketch.ts', import.meta.url),
		maxPixelRatio: 1,
	});
	let measured: ReturnType<typeof engine.measure> | undefined;
	const loaded = new Promise<Loaded>((resolve) =>
		engine.onSketchMessage((name, data) => {
			if (name === 'waves') measured = engine.measure(MEASURE_SECONDS);
			if (name === 'loaded') resolve(data as Loaded);
		}),
	);
	engine.postToSketch('start');
	const stats = await loaded;
	if (!measured) throw new Error('the sketch loaded every texture without its last wave');
	const frames = await measured;
	const capture = await engine.captureFrame();
	await engine.destroy();
	// A layer holds every mip level of a texture, 4 bytes a texel, down to 1 x 1. The array doubles
	// from 4 layers until it holds every texture.
	let layerBytes = 0;
	for (let side = stats.size; side >= 1; side >>= 1) layerBytes += side * side * 4;
	let layers = 4;
	while (layers < stats.count) layers *= 2;
	const imageBytes = stats.count * stats.size * stats.size * 4;
	return {
		tier: engine.capabilities.tier,
		mode: engine.mode,
		stats,
		uploadBytes: frames.uploadBytes,
		rebuilds: frames.rebuilds,
		// No frame uploads more than the budget, so the images take many frames.
		withinBudget:
			stats.largestFrameBytes <= stats.budget &&
			frames.uploadBytes.p99 <= stats.budget + OTHER_UPLOADS &&
			stats.frames >= imageBytes / stats.budget,
		memoryCounted: stats.textureBytes === layerBytes && stats.memoryBytes === layers * layerBytes,
		width: capture.width,
		height: capture.height,
		pixels: toBase64(capture.pixels),
	};
});
