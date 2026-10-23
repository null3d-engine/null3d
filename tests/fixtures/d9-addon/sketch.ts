// The fixture's sketch: one lit box on a background, which every GPU path draws the same way.
import { defineSketch } from '@null3d/engine';

export default defineSketch(({ scene, geometry, materials }) => {
	scene.setBackground('#101418');
	const camera = scene.createPerspectiveCamera({ fov: 60, position: [0, 1, 4] });
	scene.setActiveCamera(camera);
	scene.createDirectionalLight({ direction: [-1, -2, -1], intensity: 3 });
	scene.createAmbientLight({ intensity: 0.4 });
	scene.createMesh({
		mesh: geometry.box({ width: 1, height: 1, depth: 1 }),
		material: materials.standard({ color: '#88aaff' }),
	});
});
