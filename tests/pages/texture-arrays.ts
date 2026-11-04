// Starts the engine live with fifty textures that load in waves under a small upload budget, and
// captures the frame once every image is on the GPU. Besides the image, it reports whether each
// frame kept to the budget, and whether the GPU memory count matches the textures' arrays. The
// budget holds on the sketch thread's count of texture bytes in every frame, and on the count of
// every byte the thread that draws uploads in the frames after the last wave of new objects,
// whose tables upload whole. Beside the textures, those frames upload the scene's own per-frame
// data, which the page measures once every image is on the GPU, and the material row that a
// texture rewrites when its image lands. The page notes each of its steps, each frame of the
// sketch and the engine's frame counters in its trail, so a run that stalls shows where it stopped.
import { createEngine } from '@null3d/engine';
import { watchEngine } from './lib/engine-watch';
import { progress, run, toBase64 } from './lib/result';

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

/**
 * Bytes for the material rows that one frame rewrites as its textures land. A texture whose image
 * reaches the GPU rewrites the row of the material that shows it, and the budget is less than one
 * texture, so at most one texture lands in a frame. One row of the material table fits in this
 * with room for the row to grow. A frame that uploaded a texture's band twice, or a texture whole,
 * goes past it by at least the budget.
 */
const LANDED_ROW_BYTES = 1024;
/** Seconds to measure the thread that draws, while the textures load and once they have loaded. */
const MEASURE_SECONDS = 1;

run('texture-arrays', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const stopWatch = watchEngine();
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/texture-arrays-sketch.ts', import.meta.url),
		maxPixelRatio: 1,
	});
	const { latency, renderThread, jobWorkers } = engine.mode;
	progress(`engine started: ${latency} latency, ${renderThread} draws, ${jobWorkers} job workers`);
	let measured: ReturnType<typeof engine.measure> | undefined;
	const loaded = new Promise<Loaded>((resolve) =>
		engine.onSketchMessage((name, data) => {
			if (name === 'frame') {
				const [frame, made, waiting, bytes] = data as number[];
				progress(`sketch frame ${frame}: ${made} textures, ${waiting} wait, ${bytes} bytes up`);
			} else if (name === 'waves') {
				progress(`last wave uploaded by frame ${String(data)}: measuring`);
				measured = engine.measure(MEASURE_SECONDS);
			} else if (name === 'loaded') {
				progress(`every texture loaded in ${(data as Loaded).frames} frames`);
				resolve(data as Loaded);
			}
		}),
	);
	engine.postToSketch('start');
	progress('start sent');
	const stats = await loaded;
	if (!measured) throw new Error('the sketch loaded every texture without its last wave');
	const frames = await measured;
	progress('measured');
	// With every image on the GPU, a frame uploads only the scene's own per-frame data: its
	// uniforms and tables, and on a device that draws directly, each visible object's instance.
	const steady = await engine.measure(MEASURE_SECONDS);
	if (steady.uploadBytes.count === 0) throw new Error('no frame drew once the textures loaded');
	progress(`measured the loaded scene: ${steady.uploadBytes.max} bytes a frame at most`);
	const capture = await engine.captureFrame();
	progress('frame captured');
	const directDraws = engine.capabilities.directDraws;
	await engine.destroy();
	progress('engine destroyed');
	stopWatch();
	// A layer holds every mip level of a texture, 4 bytes a texel, down to 1 x 1. The array doubles
	// from 4 layers until it holds every texture.
	let layerBytes = 0;
	for (let side = stats.size; side >= 1; side >>= 1) layerBytes += side * side * 4;
	let layers = 4;
	while (layers < stats.count) layers *= 2;
	const imageBytes = stats.count * stats.size * stats.size * 4;
	const otherUploads = steady.uploadBytes.max + LANDED_ROW_BYTES;
	return {
		tier: engine.capabilities.tier,
		mode: engine.mode,
		directDraws,
		stats,
		uploadBytes: frames.uploadBytes,
		loadedUploadBytes: steady.uploadBytes,
		rebuilds: frames.rebuilds,
		// No frame uploads more than the budget, so the images take many frames.
		withinBudget:
			stats.largestFrameBytes <= stats.budget &&
			frames.uploadBytes.p99 <= stats.budget + otherUploads &&
			stats.frames >= imageBytes / stats.budget,
		memoryCounted: stats.textureBytes === layerBytes && stats.memoryBytes === layers * layerBytes,
		width: capture.width,
		height: capture.height,
		pixels: toBase64(capture.pixels),
	};
});
