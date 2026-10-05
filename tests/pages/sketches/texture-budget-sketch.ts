// Textures past a small texture memory budget, for the test of the budget. Two planes show the same
// 512 x 512 image from a PNG file, and a third shows a 64 x 64 one. Each quarter of the large image
// is a checker of single texels at full and half brightness, so its first smaller mip level is one
// flat color: the frame shows at a glance which textures lost their largest level.
//
// Once every image is on the GPU, the sketch sets a budget of 1 MiB, under the 2.8 MiB that the
// textures take. When the textures fit, it sends `dropped` with what it measured, and draws on until
// the page sends `next`, so the page captures the frame with the levels dropped. Then it raises the
// budget to 64 MiB, so the dropped levels load again from the file, and records what came back.
// Last, it loads the same picture from a KTX2 file, which takes a compressed format where the
// device has one, and sets a budget of 64 KiB, under what any texture keeps: the compressed
// texture loads again without its largest level, as no GPU path copies compressed texels. It sends
// `result` with every phase's figures.
import { defineSketch, type MeshArrays, type Texture } from '@null3d/engine';

/** Frames in a row with the same figures and no upload waiting, after which a phase has settled. */
const STEADY_FRAMES = 8;
/** Frames that a phase may take to settle, at most. */
const MOST_FRAMES = 1200;

const SQUARE: MeshArrays = {
	positions: [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0],
	normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
	uvs: [0, 0, 1, 0, 1, 1, 0, 1],
	indices: [0, 1, 2, 0, 2, 3],
};

export default defineSketch(async (ctx) => {
	const { scene, materials, geometry, page, textures, assets, quality } = ctx;
	quality.set({ minRenderScale: 1, governor: false });
	scene.setBackground('#181c20');
	const camera = scene.createPerspectiveCamera({
		fov: 45,
		near: 0.1,
		far: 50,
		position: [0, 0, 4.2],
		target: [0, 0, 0],
	});
	scene.setActiveCamera(camera);
	const square = geometry.fromArrays(SQUARE);
	const [left, right, small] = await Promise.all([
		assets.loadTexture('assets/textures/budget-checker.png'),
		assets.loadTexture('assets/textures/budget-checker.png'),
		assets.loadTexture('assets/textures/quadrants.png'),
	]);
	const show = (texture: Texture, x: number, size: number) =>
		scene.createMesh({
			mesh: square,
			material: materials.unlit({ map: texture }),
			position: [x, 0, 0],
			scale: [size, size, 1],
		});
	show(left as Texture, -1.05, 1);
	show(right as Texture, 1.05, 1);
	show(small as Texture, 0, 0.3);
	let changes = 0;
	quality.onChange(() => changes++);

	/** What a phase measured. */
	const figures = () => {
		const memory = quality.textureMemory;
		return {
			bytes: memory.bytes,
			budgetBytes: memory.budgetBytes,
			droppedLevels: memory.droppedLevels,
			droppedTextures: memory.droppedTextures,
			left: (left as Texture).droppedLevels,
			right: (right as Texture).droppedLevels,
			small: (small as Texture).droppedLevels,
			leftBytes: (left as Texture).bytes,
			leftWidth: (left as Texture).width,
			smallBytes: (small as Texture).bytes,
		};
	};

	// Each phase waits until the figures hold still with no upload waiting.
	let phase: { done: (value: unknown) => void; ready: () => boolean } | undefined;
	let steady = 0;
	let frames = 0;
	let last = '';
	const settle = (ready: () => boolean = () => true) =>
		new Promise((done) => {
			phase = { done, ready };
			steady = 0;
			frames = 0;
		});
	let next: (() => void) | undefined;
	page.onMessage((name) => {
		if (name === 'next') next?.();
	});

	(async () => {
		await settle();
		const loaded = figures();
		changes = 0;
		textures.setMemoryBudget(1024 * 1024);
		await settle(() => figures().droppedLevels > 0);
		const dropped = { ...figures(), changes };
		page.post('dropped', dropped);
		await new Promise<void>((resolve) => {
			next = resolve;
		});
		quality.set({ textureMemoryMiB: 64 });
		await settle(() => figures().droppedLevels === 0);
		const restored = figures();
		const compressed = await assets.loadTexture('assets/textures/budget-checker-etc1s.ktx2');
		show(compressed, 0, 0.6);
		await settle();
		const compressedBytes = compressed.bytes;
		textures.setMemoryBudget(64 * 1024);
		await settle(() => compressed.droppedLevels > 0);
		page.post('result', {
			loaded,
			dropped,
			restored,
			least: figures(),
			compressed: {
				format: compressed.format,
				bytes: compressedBytes,
				dropped: compressed.droppedLevels,
				droppedBytes: compressed.bytes,
			},
		});
	})().catch((error: unknown) => page.post('error', String(error)));

	return {
		onUpdate() {
			if (!phase) return;
			const now = JSON.stringify(figures());
			steady = now === last && textures.uploads().waiting === 0 && phase.ready() ? steady + 1 : 0;
			last = now;
			frames++;
			if (steady >= STEADY_FRAMES || frames >= MOST_FRAMES) {
				const { done } = phase;
				phase = undefined;
				done(undefined);
			}
		},
	};
});
