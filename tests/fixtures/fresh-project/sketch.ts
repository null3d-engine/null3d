// The fresh project's sketch: a lit box on a floor, seen through orbit controls from the controls
// package. It poses the scene from the sketch time alone, so a hold at one time draws the same
// frame on every run.
import { createOrbitControls } from '@null3d/controls';
import { defineSketch } from '@null3d/engine';

/** How fast the box turns, in radians per second. */
const TURN_SPEED = 0.8;

export default defineSketch((ctx) => {
	const { scene, geometry, materials, time } = ctx;
	scene.setBackground('#101418');
	const camera = scene.createPerspectiveCamera({ fov: 60, position: [0, 2.5, 5] });
	scene.setActiveCamera(camera);
	const controls = createOrbitControls(ctx, camera, { target: [0, 0.5, 0] });
	scene.createDirectionalLight({ direction: [-1, -2, -1], intensity: 3 });
	scene.createAmbientLight({ intensity: 0.4 });

	const box = geometry.box();
	const cube = scene.createMesh({
		mesh: box,
		material: materials.standard({ color: '#e8554e' }),
		position: [0, 0.5, 0],
		dynamic: true,
	});
	scene.createMesh({
		mesh: box,
		material: materials.unlit({ color: '#2d3a4a' }),
		position: [0, -0.1, 0],
		scale: [6, 0.2, 6],
	});

	return {
		onUpdate(dt) {
			controls.update(dt);
			const angle = time.now * TURN_SPEED;
			cube.setRotation(0, Math.sin(angle / 2), 0, Math.cos(angle / 2));
		},
	};
});
