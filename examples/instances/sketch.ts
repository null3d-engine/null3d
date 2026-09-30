// Instance batches: a field of 10,000 boxes in one dynamic batch. Each frame the sketch writes the
// height of every row straight into the batch's arrays, with no call per row. The engine then
// computes, culls and draws the rows in bulk.
import { defineSketch } from '@null3d/engine';

/** Boxes along each side of the field. */
const SIDE = 100;
/** The distance between the centers of neighboring boxes, in meters. */
const SPACING = 0.5;
/** The distance from the field's center to its outer rows. */
const HALF = ((SIDE - 1) * SPACING) / 2;

export default defineSketch(({ scene, geometry, materials, time }) => {
	scene.setBackground('#0d1117');
	const camera = scene.createPerspectiveCamera({ fov: 50, near: 0.5, far: 200 });
	scene.setActiveCamera(camera);
	scene.createDirectionalLight({ direction: [-1, -2, -0.5], intensity: 3 });
	scene.createAmbientLight({ intensity: 0.35 });

	const field = scene.createInstances(geometry.box({ width: 0.4, depth: 0.4 }), SIDE * SIDE, {
		material: materials.standard({ color: '#4a8cff' }),
		dynamic: true,
	});

	return {
		onUpdate() {
			const t = time.now;
			camera.setPosition(Math.sin(t * 0.2) * 34, 20, Math.cos(t * 0.2) * 34);
			camera.lookAt(0, 0, 0);
			// Read the arrays in each frame: they are views of engine memory, which moves when it grows.
			const positions = field.positions;
			const scales = field.scales;
			for (let row = 0; row < SIDE * SIDE; row++) {
				const x = (row % SIDE) * SPACING - HALF;
				const z = Math.floor(row / SIDE) * SPACING - HALF;
				const wave = Math.sin(Math.sqrt(x * x + z * z) * 0.4 - t * 2);
				const height = 1.6 + wave + 0.4 * Math.sin(x * 0.3 + t);
				positions[row * 3] = x;
				positions[row * 3 + 1] = height / 2;
				positions[row * 3 + 2] = z;
				scales[row * 3 + 1] = height;
			}
		},
	};
});
