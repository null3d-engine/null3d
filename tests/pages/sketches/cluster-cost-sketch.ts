// A heightfield drawn from its tree of cluster patches, for the page that measures what the tree
// costs at three distances (tests/pages/cluster-cost.ts). The camera moves when the page messages
// `distance`, in metres from the middle of the ground.
import { defineSketch } from '@null3d/engine';
import { AMBIENT, SUN } from '../../../bench/scenes/spec';

export default defineSketch(async ({ scene, assets, post, page }) => {
	post.set({ toneMapping: 'aces' });
	scene.setBackground('#8fa4b8');
	scene.createDirectionalLight(SUN);
	scene.createAmbientLight(AMBIENT);
	scene.instantiate(await assets.loadGltf('assets/models/cluster-terrain.glb'));
	const camera = scene.createPerspectiveCamera({
		fov: 50,
		near: 0.5,
		far: 300,
		position: [0, 7, 30],
		target: [0, 1, -24],
	});
	scene.setActiveCamera(camera);
	page.onMessage((type, data) => {
		if (type !== 'distance' || typeof data !== 'number') return;
		camera.setPosition(0, 7, data);
		camera.lookAt(0, 1, -data * 0.8);
		page.post('moved', data);
	});
	return {};
});
