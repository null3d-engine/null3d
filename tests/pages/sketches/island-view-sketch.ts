// Temporary measuring sketch: the Island with its camera held at a pose that the page posts. The
// page can hide the terrain's blocks: the sketch catches the objects and the instance batches that
// the terrain's material draws, keeps the visibility or the row count that the terrain asks of
// each, and draws none while hidden. Not kept in the repository.
import { defineSketch } from '@null3d/engine';
import island from '../../../examples/showcase/island/sketch';

export default defineSketch(async (ctx) => {
	const pose = [-70, 30, 410, -92, 30, 200];
	// biome-ignore lint/suspicious/noExplicitAny: temporary measuring code
	const walls: any[] = [];
	// biome-ignore lint/suspicious/noExplicitAny: temporary measuring code
	const ground = new Set<{ apply: () => void; drawn: () => number }>();
	let groundShown = true;
	let pending: { name: string; frames: number; value: unknown } | undefined;
	ctx.page.onMessage((name, data) => {
		if (name === 'pose') pose.splice(0, 6, ...(data as number[]));
		if (name === 'hide-walls') for (const w of walls) w.setActiveCount(0);
		if (name === 'ground') {
			groundShown = data as boolean;
			for (const block of ground) block.apply();
			pending = { name: 'groundn', frames: 4, value: true };
		}
		if (name === 'blocks')
			pending = {
				name: 'blocksn',
				frames: 1,
				value: [...ground].reduce((sum, b) => sum + b.drawn(), 0),
			};
	});
	// biome-ignore lint/suspicious/noExplicitAny: temporary measuring code
	const scene = ctx.scene as any;
	const create = scene.createPerspectiveCamera.bind(scene);
	scene.createPerspectiveCamera = (options: unknown) => {
		const camera = create(options);
		const setPosition = camera.setPosition.bind(camera);
		const lookAt = camera.lookAt.bind(camera);
		camera.setPosition = () => setPosition(pose[0], pose[1], pose[2]);
		camera.lookAt = () => lookAt(pose[3], pose[4], pose[5]);
		return camera;
	};
	// The terrain's material: the one custom material that maps a splat map.
	// biome-ignore lint/suspicious/noExplicitAny: temporary measuring code
	const materials = ctx.materials as any;
	const shader = materials.shader.bind(materials);
	let terrainMaterial: unknown;
	// biome-ignore lint/suspicious/noExplicitAny: temporary measuring code
	materials.shader = (options: any) => {
		const made = shader(options);
		if (options?.textures?.splatMap) terrainMaterial = made;
		return made;
	};
	const meshes = scene.createMesh.bind(scene);
	// biome-ignore lint/suspicious/noExplicitAny: temporary measuring code
	scene.createMesh = (options: any) => {
		const object = meshes(options);
		if (terrainMaterial && options?.material === terrainMaterial) {
			const set = object.setVisible.bind(object);
			const destroy = object.destroy.bind(object);
			let wants = true;
			const block = { apply: () => set(wants && groundShown), drawn: () => (wants ? 1 : 0) };
			object.setVisible = (visible: boolean) => {
				wants = visible;
				block.apply();
			};
			object.destroy = () => {
				ground.delete(block);
				destroy();
			};
			ground.add(block);
		}
		return object;
	};
	// The house walls: the first of each pair of batches of a mesh with one hand-set level, drawn
	// with colors and shadows; the second of each pair is the roofs.
	const instances = scene.createInstances.bind(scene);
	let houses = 0;
	// biome-ignore lint/suspicious/noExplicitAny: temporary measuring code
	scene.createInstances = (mesh: any, count: number, options: any) => {
		const batch = instances(mesh, count, options);
		if (terrainMaterial && options?.material === terrainMaterial) {
			const set = batch.setActiveCount.bind(batch);
			const destroy = batch.destroy.bind(batch);
			let wants = count;
			const rows = { apply: () => set(groundShown ? wants : 0), drawn: () => wants };
			batch.setActiveCount = (active: number) => {
				wants = active;
				rows.apply();
			};
			batch.destroy = () => {
				ground.delete(rows);
				destroy();
			};
			ground.add(rows);
		}
		if (options?.colors && options.castShadows && mesh.levels?.length === 1) {
			if (houses % 2 === 0) walls.push(batch);
			houses++;
		}
		return batch;
	};
	// A production build counts the triangles of draws that the GPU culls only while the sketch asks
	// for the frame figures. The render scale holds still, so the load does not change the picture.
	ctx.debug.frameStats();
	const callbacks = await island.setup(ctx);
	ctx.quality.set({ minRenderScale: 1, maxRenderScale: 1, governor: false });
	return {
		...callbacks,
		onUpdate(...args: unknown[]) {
			// biome-ignore lint/suspicious/noExplicitAny: temporary measuring code
			(callbacks as any)?.onUpdate?.(...args);
			if (pending && --pending.frames <= 0) {
				ctx.page.post(pending.name, pending.value);
				pending = undefined;
			}
		},
	};
}, island.options);
