// Instance batches: a field of 10,000 boxes in one dynamic batch. Each frame the sketch writes the
// height of every row straight into the batch's arrays, with no call per row. The engine then
// computes, culls and draws the rows in bulk. The pointer moves the center of the wave.
import { defineSketch, vec3 } from '@null3d/engine';
import { interact } from '../lib/interact';

/** Boxes along each side of the field. */
const SIDE = 100;
/** The distance between the centers of neighboring boxes, in meters. */
const SPACING = 0.5;
/** The distance from the field's center to its outer rows. */
const HALF = ((SIDE - 1) * SPACING) / 2;

export default defineSketch((ctx) => {
	const { scene, geometry, materials, time } = ctx;
	scene.setBackground('#0d1117');
	const camera = scene.createPerspectiveCamera({ fov: 50, near: 0.5, far: 200 });
	scene.setActiveCamera(camera);
	// The pointer points at the boxes' mean height.
	const view = interact(ctx, camera, {
		target: [0, 0, 0],
		groundY: 1.6,
		bounds: [-HALF, 0, -HALF, HALF, 2, HALF],
	});
	const center = vec3.create();
	scene.createDirectionalLight({ direction: [-1, -2, -0.5], intensity: 3 });
	scene.createAmbientLight({ intensity: 0.35 });

	const field = scene.createInstances(geometry.box({ width: 0.4, depth: 0.4 }), SIDE * SIDE, {
		material: materials.standard({ color: '#4a8cff' }),
		dynamic: true,
	});

	return {
		onUpdate(dt) {
			const t = time.now;
			if (!view.userCamera) {
				camera.setPosition(Math.sin(t * 0.2) * 34, 20, Math.cos(t * 0.2) * 34);
				camera.lookAt(0, 0, 0);
			}
			view.update(dt);
			view.steer(vec3.set(center, 0, 0, 0));
			// Read the arrays in each frame: they are views of engine memory, which moves when it grows.
			const positions = field.positions;
			const scales = field.scales;
			for (let row = 0; row < SIDE * SIDE; row++) {
				const x = (row % SIDE) * SPACING - HALF;
				const z = Math.floor(row / SIDE) * SPACING - HALF;
				const dx = x - center[0];
				const dz = z - center[2];
				const wave = Math.sin(Math.sqrt(dx * dx + dz * dz) * 0.4 - t * 2);
				const height = 1.6 + wave + 0.4 * Math.sin(x * 0.3 + t);
				positions[row * 3] = x;
				positions[row * 3 + 1] = height / 2;
				positions[row * 3 + 2] = z;
				scales[row * 3 + 1] = height;
			}
		},
	};
});
