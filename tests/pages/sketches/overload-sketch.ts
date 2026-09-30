// The GPU-bound page's scene: layers of detailed spheres in a grid that fills the view. The page's
// `load` message shows the first n spheres, and the sketch answers once it has. The spheres never
// move, so a frame's CPU work stays small at every count, and a large count leaves the GPU the
// slowest part of each frame.
import { defineSketch } from '@null3d/engine';
import { OVERLOAD_SCENE, OVERLOAD_SPHERES } from '../lib/overload';

export default defineSketch(({ scene, materials, geometry, page }) => {
	const { side, layers, widthSegments, heightSegments } = OVERLOAD_SCENE;
	scene.setBackground('#101418');
	// The grid's edge fills the height of a 60-degree view from this far away.
	const camera = scene.createPerspectiveCamera({
		fov: 60,
		near: 1,
		far: side * 2 + layers,
		position: [0, 0, side * 0.9],
		target: [0, 0, 0],
	});
	scene.setActiveCamera(camera);
	scene.createDirectionalLight({ direction: [-1, -2, -1], color: '#ffffff', intensity: 3 });
	scene.createAmbientLight({ color: '#ffffff', intensity: 0.4 });
	const sphere = geometry.sphere({ radius: 0.5, widthSegments, heightSegments });
	const spheres = scene.createInstances(sphere, OVERLOAD_SPHERES, {
		material: materials.standard({ color: '#5bc27a' }),
	});
	const { positions, rotations, scales } = spheres;
	const perLayer = side * side;
	for (let i = 0; i < OVERLOAD_SPHERES; i++) {
		const cell = i % perLayer;
		positions[i * 3] = (cell % side) - side / 2 + 0.5;
		positions[i * 3 + 1] = Math.floor(cell / side) - side / 2 + 0.5;
		positions[i * 3 + 2] = -Math.floor(i / perLayer);
		rotations[i * 4 + 3] = 1;
		scales.fill(1, i * 3, i * 3 + 3);
	}
	spheres.markDirty();
	spheres.setActiveCount(0);
	page.onMessage((name, data) => {
		if (name !== 'load') return;
		spheres.setActiveCount(Math.min(Number(data), OVERLOAD_SPHERES));
		page.post('load', data);
	});
	return {};
});
