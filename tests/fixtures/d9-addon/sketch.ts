// The fixture's sketch: one lit box on a background, which every GPU path draws the same way. The
// box turns, because the engine rests a still view and draws no frames once the scene stops
// changing, and the add-on check's cost gate measures the frames that a running page draws.
import { defineSketch } from '@null3d/engine';

/** How fast the box turns, in radians per second. */
const TURN_SPEED = 0.8;

export default defineSketch(({ scene, geometry, materials, time }) => {
	scene.setBackground('#101418');
	const camera = scene.createPerspectiveCamera({ fov: 60, position: [0, 1, 4] });
	scene.setActiveCamera(camera);
	scene.createDirectionalLight({ direction: [-1, -2, -1], intensity: 3 });
	scene.createAmbientLight({ intensity: 0.4 });
	const cube = scene.createMesh({
		mesh: geometry.box({ width: 1, height: 1, depth: 1 }),
		material: materials.standard({ color: '#88aaff' }),
		dynamic: true,
	});

	return {
		onUpdate() {
			const angle = time.now * TURN_SPEED;
			cube.setRotation(0, Math.sin(angle / 2), 0, Math.cos(angle / 2));
		},
	};
});
