// Temporary measuring sketch: the Island with its camera held at a pose that the page posts.
import { defineSketch } from '@null3d/engine';
import island from '../../../examples/showcase/island/sketch';

export default defineSketch(async (ctx) => {
	const pose = [-70, 30, 410, -92, 30, 200];
	// biome-ignore lint/suspicious/noExplicitAny: temporary measuring code
	const walls: any[] = [];
	ctx.page.onMessage((name, data) => {
		if (name === 'pose') pose.splice(0, 6, ...(data as number[]));
		if (name === 'hide-walls') for (const w of walls) w.setActiveCount(0);
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
	// The house walls: the first of each pair of batches of a mesh with one hand-set level, drawn
	// with colors and shadows; the second of each pair is the roofs.
	const instances = scene.createInstances.bind(scene);
	let houses = 0;
	// biome-ignore lint/suspicious/noExplicitAny: temporary measuring code
	scene.createInstances = (mesh: any, count: number, options: any) => {
		const batch = instances(mesh, count, options);
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
	return callbacks;
}, island.options);
