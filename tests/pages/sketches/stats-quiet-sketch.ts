// Draws a box and reads no frame figures, so that only the stats overlay turns the engine's
// sampling on.
import { defineSketch } from '@null3d/engine';

export default defineSketch(({ scene, geometry, materials }) => {
	scene.createDirectionalLight({ direction: [-1, -2, -1] });
	scene.createMesh({ mesh: geometry.box(), material: materials.standard({ color: '#4e8ae8' }) });
	scene.setActiveCamera(scene.createPerspectiveCamera({ position: [2, 2, 3], target: [0, 0, 0] }));
});
