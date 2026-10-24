// A still scene for the temporal resolve's capture proof: lit and unlit meshes, a hierarchy and a
// floor of instances, with a camera that does not move, so successive frames hold the same image.
// ?taa=0 starts with the resolve off, ?jitter=0 keeps the camera still, and the page may turn the
// resolve off and on again with the 'taa' and 'toggle' messages.
import { defineSketch } from '@null3d/engine';

const params = new URL(import.meta.url).searchParams;
const JITTER = params.get('jitter') !== '0';

export default defineSketch(({ scene, materials, geometry, post, page }) => {
	scene.setBackground('#101418');
	const camera = scene.createPerspectiveCamera({
		fov: 60,
		near: 0.1,
		far: 100,
		position: [0, 4, 10],
		target: [0, 0, 0],
	});
	scene.setActiveCamera(camera);
	scene.createDirectionalLight({ direction: [-1, -2, -1], color: '#ffffff', intensity: 3 });
	scene.createAmbientLight({ color: '#ffffff', intensity: 0.4 });

	const box = geometry.box();
	const ball = geometry.sphere({ radius: 0.6 });
	const red = materials.standard({ color: '#e8554e' });
	const blue = materials.unlit({ color: '#4a8cff' });
	const green = materials.standard({ color: '#5bc27a' });

	const group = scene.createGroup({ position: [-3, 0, 0], name: 'left' });
	scene.createMesh({ mesh: box, material: red, parent: group, name: 'box' });
	scene.createMesh({ mesh: ball, material: red, parent: group, position: [0, 1.5, 0] });
	scene.createMesh({ mesh: box, material: blue, position: [3, 0, 0], name: 'unlit' });

	const tiles = 5;
	const floor = scene.createInstances(box, tiles * tiles, { material: green });
	for (let i = 0; i < tiles * tiles; i++) {
		floor.positions.set(
			[
				((i % tiles) - (tiles - 1) / 2) * 1.2,
				-1.5,
				(Math.floor(i / tiles) - (tiles - 1) / 2) * 1.2,
			],
			i * 3,
		);
	}

	let on = params.get('taa') !== '0';
	const apply = () => post.set({ taa: on ? { feedback: 0.9, jitter: JITTER } : false });
	apply();
	page.onMessage((type, data) => {
		if (type === 'taa') {
			on = Boolean(data);
			apply();
		} else if (type === 'toggle') {
			on = !on;
			apply();
		}
	});
});
