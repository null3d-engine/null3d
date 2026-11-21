// Temporary measuring sketch: the Island with its camera held at one pose from the query, as
// ?pose=x,y,z,tx,ty,tz. It exists for one rock check and is deleted when that check is done.
import { defineSketch } from '@null3d/engine';
import island from '../../../examples/showcase/island/sketch';

const params = new URL(import.meta.url).searchParams;
const pose = (params.get('pose') ?? '0,30,410,0,30,200').split(',').map(Number);

export default defineSketch(async (ctx) => {
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
	return island.setup(ctx);
}, island.options);
