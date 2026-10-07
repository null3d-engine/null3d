// Loads and destroys models again and again, for the memory test: a skinned and animated fox with
// its texture, a face with morph targets, and a scene whose file stores raycast trees. Each round
// loads the three, makes copies and an instance batch, plays the fox's clip, casts rays that build
// the meshes' trees, draws some frames, then destroys it all. After WARM_ROUNDS rounds and after
// the last one, the sketch posts 'checkpoint' with the GPU bytes of meshes and textures, and waits
// for the page's 'go', so the page can read the engine's memory while nothing changes.
import { defineSketch, type RaycastHit, vec3 } from '@null3d/engine';
import { blenderMorphBuilder } from '../lib/gltf-files';

/** Rounds before the first checkpoint, and in all. */
const WARM_ROUNDS = 10;
const ROUNDS = 100;
/** Frames that each round draws with its copies, and after it destroys them. */
const FRAMES = 2;

const FOX = '/samples/sources/khronos/Fox/glTF-Binary/Fox.glb';
const TREES = 'assets/models/optimized/asset-scene-trees.glb';

export default defineSketch(({ scene, assets, geometry, textures, page }) => {
	scene.setActiveCamera(
		scene.createPerspectiveCamera({ position: [0, 3, 12], target: [0, 1, 0], far: 500 }),
	);
	scene.createDirectionalLight({ direction: [-1, -2, -1], intensity: 3 });
	const face = URL.createObjectURL(
		new Blob([blenderMorphBuilder().glb() as Uint8Array<ArrayBuffer>], {
			type: 'model/gltf-binary',
		}),
	);
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
	const hit: RaycastHit = {
		object: null,
		instance: -1,
		point: vec3.create(),
		normal: vec3.create(),
		distance: 0,
		triangle: -1,
	};
	const down = vec3.set(vec3.create(), 0, -1, 0);

	const round = async () => {
		const [fox, morph, trees] = await Promise.all([
			assets.loadGltf(FOX),
			assets.loadGltf(face),
			assets.loadGltf(TREES),
		]);
		const foxCopy = scene.instantiate(fox, { scale: [0.02, 0.02, 0.02] });
		foxCopy.animator().play(fox.clips[0] as string);
		const faceCopy = scene.instantiate(morph, { position: [-3, 1, 0] });
		const treeCopy = scene.instantiate(trees, { position: [3, 0, 0] });
		const rows = scene.createInstances(morph, 3);
		await frames(FRAMES);
		let hits = 0;
		for (let x = -4; x <= 4; x += 0.5)
			if (scene.raycast(vec3.set(vec3.create(), x, 10, 0), down, {}, hit)) hits++;
		for (const made of [foxCopy, faceCopy, treeCopy, rows]) made.destroy();
		for (const prefab of [fox, morph, trees]) prefab.destroy();
		await frames(FRAMES);
		return hits;
	};

	(async () => {
		let hits = 0;
		try {
			for (let k = 1; k <= ROUNDS; k++) {
				hits += await round();
				if (k === WARM_ROUNDS || k === ROUNDS) await checkpoint(k);
			}
			page.post('done', { hits, rounds: ROUNDS });
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
