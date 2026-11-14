// The fixture's sketch: one lit box that turns, so the page keeps drawing, and a call into the
// add-on's own code in every frame, which makes objects there. The add-on check's allocation gate
// reports the bytes per frame that the call allocates.
import { defineSketch } from '@null3d/engine';
import { trail } from './src/index';

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
			trail(1 + Math.floor(time.now * 4));
			const angle = time.now * TURN_SPEED;
			cube.setRotation(0, Math.sin(angle / 2), 0, Math.cos(angle / 2));
		},
	};
});
