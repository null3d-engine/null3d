// The sketch module, in the sketch worker: it builds the scene and updates it every frame.
import { defineSketch } from '@null3d/engine';

export default defineSketch(({ scene, geometry, materials }) => {
	scene.setBackground('#101418');

	const camera = scene.createPerspectiveCamera({
		fov: 60,
		position: [0, 1.5, 4],
		target: [0, 0, 0],
	});
	scene.setActiveCamera(camera);

	scene.createDirectionalLight({ direction: [-1, -2, -1], intensity: 3 });
	scene.createAmbientLight({ intensity: 0.4 });

	const cube = scene.createMesh({
		mesh: geometry.box({ width: 1, height: 1, depth: 1 }),
		material: materials.standard({ color: '#4a8cff' }),
		dynamic: true,
	});

	let angle = 0;
	return {
		onUpdate(dt) {
			angle += dt * 0.8;
			cube.setRotationEuler(0, angle, 0);
		},
	};
});
