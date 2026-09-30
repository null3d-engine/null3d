// The project's sketch: a box that turns and a ball that circles it over a floor of tiles, lit by
// a sun and ambient light. It poses the scene from the sketch time alone, so a hold at one time
// draws the same frame on every run.
import { defineSketch } from '@null3d/engine';

/** The floor's tiles along each side. */
const TILES = 7;
/** How fast the box turns, in radians per second. */
const TURN_SPEED = 0.8;
/** How fast the ball circles, in radians per second. */
const ORBIT_SPEED = 1.5;

export default defineSketch(({ scene, geometry, materials, time }) => {
	scene.setBackground('#101418');
	const camera = scene.createPerspectiveCamera({
		fov: 60,
		position: [0, 2.5, 6],
		target: [0, 0.5, 0],
	});
	scene.setActiveCamera(camera);
	scene.createDirectionalLight({ direction: [-1, -2, -1], intensity: 3 });
	scene.createAmbientLight({ intensity: 0.4 });

	const box = geometry.box();
	const cube = scene.createMesh({
		mesh: box,
		material: materials.standard({ color: '#e8554e' }),
		position: [0, 0.5, 0],
		dynamic: true,
	});
	const ball = scene.createMesh({
		mesh: geometry.sphere({ radius: 0.4 }),
		material: materials.standard({ color: '#5bc27a' }),
		dynamic: true,
	});
	const floor = scene.createInstances(box, TILES * TILES, {
		material: materials.unlit({ color: '#2d3a4a' }),
	});
	for (let i = 0; i < TILES * TILES; i++) {
		const x = (i % TILES) - (TILES - 1) / 2;
		const z = Math.floor(i / TILES) - (TILES - 1) / 2;
		floor.positions.set([x * 1.1, -0.1, z * 1.1], i * 3);
		floor.scales.set([1, 0.2, 1], i * 3);
	}
	floor.markDirty();

	return {
		onUpdate() {
			const angle = time.now * TURN_SPEED;
			cube.setRotation(0, Math.sin(angle / 2), 0, Math.cos(angle / 2));
			const orbit = time.now * ORBIT_SPEED;
			ball.setPosition(Math.cos(orbit) * 2, 0.6, Math.sin(orbit) * 2);
		},
	};
});
