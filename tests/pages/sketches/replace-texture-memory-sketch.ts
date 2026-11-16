// Replaces a live data texture with texels of another shape, again and again, for the memory test.
// The two shapes hold the same number of texels, so the texture's bytes never change: what the
// rounds test is the GPU texture that each move leaves, which the backend frees. Two textures of
// the two shapes stay in the scene, so both arrays hold a texture between the moves. Each round
// moves the one live texture to the other shape, draws frames, and posts a checkpoint with the
// scene's mesh and texture bytes. The page reads the engine's WebAssembly memory and the GPU
// texture bytes beside them.
import { defineSketch, type Texture } from '@null3d/engine';

/** Rounds in all. The first ones warm the engine's start-up; the test judges the rest. */
const ROUNDS = 40;
/** Frames that each round draws after it moved the texture. */
const FRAMES = 2;
/** The two shapes of the moved texture, in texels. Both hold 8,192 texels. */
const SHAPES = [
	[64, 128],
	[128, 64],
] as const;

export default defineSketch(({ scene, geometry, materials, textures, page }) => {
	scene.setActiveCamera(
		scene.createPerspectiveCamera({ position: [0, 0, 12], target: [0, 0, 0], far: 100 }),
	);
	scene.createAmbientLight({ intensity: 1 });
	const texels = (width: number, height: number) => {
		const data = new Uint8Array(width * height * 4);
		for (let k = 0; k < data.length; k += 4) {
			data[k] = (k * 7) & 0xff;
			data[k + 1] = (k * 13) & 0xff;
			data[k + 2] = (k * 29) & 0xff;
			data[k + 3] = 255;
		}
		return data;
	};
	const make = (width: number, height: number): Texture =>
		textures.fromData({
			width,
			height,
			data: texels(width, height),
			format: 'rgba8unorm',
			colorSpace: 'srgb',
			mipmaps: false,
		});
	// The texture that moves, and one that stays in each shape's array, so neither array empties and
	// frees its GPU texture between the moves.
	const moving = make(...(SHAPES[0] as [number, number]));
	const staying = SHAPES.map(([width, height], k) => {
		const texture = make(width, height);
		scene.createMesh({
			mesh: geometry.plane({ width: 2, height: 2 }),
			material: materials.unlit({ map: texture }),
			position: [k * 3 - 1.5, 0, 0],
		});
		return texture;
	});
	scene.createMesh({
		mesh: geometry.plane({ width: 2, height: 2 }),
		material: materials.unlit({ map: moving }),
		position: [0, 0, 1],
	});

	/** The shape of the image that the next round moves the live texture to. */
	const image = async (round: number) => {
		const [width, height] = SHAPES[round % SHAPES.length] as [number, number];
		const canvas = new OffscreenCanvas(width, height);
		const context = canvas.getContext('2d');
		if (!context) throw new Error('the page has no 2d context');
		context.fillStyle = round % 2 === 0 ? '#3f7fbf' : '#bf7f3f';
		context.fillRect(0, 0, width, height);
		return canvas.transferToImageBitmap();
	};

	let frameWaiters: (() => void)[] = [];
	const frames = async (count: number) => {
		for (let k = 0; k < count; k++)
			await new Promise<void>((resolve) => frameWaiters.push(resolve));
	};
	let go: (() => void) | undefined;
	page.onMessage((name) => {
		if (name === 'go') go?.();
	});
	const checkpoint = (round: number) =>
		new Promise<void>((resolve) => {
			go = resolve;
			page.post('checkpoint', {
				round,
				meshBytes: geometry.memoryBytes,
				textureBytes: textures.memoryBytes,
			});
		});

	(async () => {
		let moved = 0;
		try {
			for (let k = 1; k <= ROUNDS; k++) {
				moving.update(await image(k));
				moved++;
				await frames(FRAMES);
				await checkpoint(k);
			}
			page.post('done', { moved, rounds: ROUNDS, staying: staying.length });
		} catch (error) {
			page.post('done', { error: error instanceof Error ? error.message : String(error) });
		}
	})();

	return {
		onUpdate() {
			const waiting = frameWaiters;
			frameWaiters = [];
			for (const resolve of waiting) resolve();
		},
	};
});
