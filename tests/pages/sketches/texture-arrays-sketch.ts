// Fifty textures that load over many frames, for the test of texture uploads. Each texture is 32 x
// 32 texels of its own hue, on a square of a grid of 10 x 5. The sketch sets a small upload budget,
// so the images go up a band of rows at a time, and it adds the textures in waves, one wave every
// few frames, so their array grows while it holds textures. It starts when the page sends
// `start`, and sends `waves` a few frames after its last wave, while most images still wait, once
// the frames that upload the new objects' tables are done. Until every image is on the GPU, it
// sends `frame` each frame with the frame's number since the start, the textures it made, the
// textures that wait for uploads and the bytes that the frame before uploaded, so a run that stalls
// shows where. Once every image is on the GPU, it sends the page `loaded` with its settings, the
// frames it took, the most bytes that any frame uploaded, the GPU memory of the textures, and the
// bytes of one texture. The scene keeps the whole canvas, so a slow GPU's frames do not lower the
// render scale of the image that the test compares.
import { defineSketch, type MeshArrays, type Texture } from '@null3d/engine';

/** The bytes that one frame may upload: half of one image. */
const UPLOAD_BUDGET = 2 * 1024;
const COUNT = 50;
const SIZE = 32;
const WAVE = 10;
/** Frames between two waves. */
const WAVE_FRAMES = 4;
/** Frames from the last wave to the `waves` message: those that upload the new objects. */
const SETTLE_FRAMES = 3;

const SQUARE: MeshArrays = {
	positions: [-0.4, -0.4, 0, 0.4, -0.4, 0, 0.4, 0.4, 0, -0.4, 0.4, 0],
	normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
	uvs: [0, 0, 1, 0, 1, 1, 0, 1],
	indices: [0, 1, 2, 0, 2, 3],
};

/** Texture `k`'s image, made in code: its hue, with a darker cross. */
function image(k: number): Promise<ImageBitmap> {
	const data = new Uint8ClampedArray(SIZE * SIZE * 4);
	const angle = (k / COUNT) * Math.PI * 2;
	const hue = [0, 2, 4].map((third) =>
		Math.round(127 + 120 * Math.cos(angle - (third * Math.PI) / 3)),
	);
	for (let y = 0; y < SIZE; y++)
		for (let x = 0; x < SIZE; x++) {
			const cross = Math.abs(x - SIZE / 2) < 3 || Math.abs(y - SIZE / 2) < 3;
			data.set([...hue.map((c) => (cross ? c >> 1 : c)), 255], (y * SIZE + x) * 4);
		}
	return createImageBitmap(new ImageData(data, SIZE, SIZE));
}

export default defineSketch(async (ctx) => {
	const { scene, materials, geometry, page, time, textures, quality } = ctx;
	quality.set({ minRenderScale: 1 });
	textures.setUploadBudget(UPLOAD_BUDGET);
	scene.setBackground('#181c20');
	const camera = scene.createPerspectiveCamera({
		fov: 45,
		near: 0.1,
		far: 50,
		position: [0, 0, 7.5],
		target: [0, 0, 0],
	});
	scene.setActiveCamera(camera);
	const square = geometry.fromArrays(SQUARE);
	const images = await Promise.all(Array.from({ length: COUNT }, (_, k) => image(k)));
	const made: Texture[] = [];
	let started = -1;
	let lastWave = -1;
	let loaded = false;
	page.onMessage((name) => {
		if (name === 'start') started = time.frame;
	});

	return {
		onUpdate() {
			if (started < 0 || loaded) return;
			const frames = time.frame - started;
			if (frames % WAVE_FRAMES === 0 && made.length < COUNT) {
				const first = made.length;
				for (let k = first; k < first + WAVE; k++) {
					const texture = textures.fromImageBitmap(images[k] as ImageBitmap);
					const position: [number, number, number] = [(k % 10) - 4.5, 2 - Math.floor(k / 10), 0];
					scene.createMesh({
						mesh: square,
						material: materials.unlit({ map: texture }),
						position,
					});
					made.push(texture);
				}
				if (made.length === COUNT) lastWave = frames;
			}
			if (lastWave >= 0 && frames === lastWave + SETTLE_FRAMES) page.post('waves', frames);
			const uploads = textures.uploads();
			page.post('frame', [frames, made.length, uploads.waiting, uploads.lastFrameBytes]);
			if (made.length === COUNT && uploads.waiting === 0) {
				loaded = true;
				page.post('loaded', {
					budget: UPLOAD_BUDGET,
					count: COUNT,
					size: SIZE,
					frames,
					largestFrameBytes: uploads.largestFrameBytes,
					memoryBytes: textures.memoryBytes,
					textureBytes: (made[0] as Texture).bytes,
				});
			}
		},
	};
});
