// The project's sketch: a box that turns and a ball that circles it over a floor of tiles, lit by
// a sun and ambient light. It poses the scene from the sketch time alone, so a hold at one time
// draws the same frame on every run. Input moves the stage box and puts a marker where the pointer
// pressed, which a timed script drives and a plain hold never does.
import { defineSketch } from '@null3d/engine';

/** The floor's tiles along each side. */
const TILES = 7;
/** How fast the box turns, in radians per second. */
const TURN_SPEED = 0.8;
/** How fast the ball circles, in radians per second. */
const ORBIT_SPEED = 1.5;
/** How fast the box slides to the right while the forward key is held, in meters per second. */
const SLIDE_SPEED = 1.2;
/** The farthest right that the box slides, in meters. */
const SLIDE_LIMIT = 2;

export default defineSketch(({ scene, geometry, materials, time, input }) => {
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
		name: 'cube',
		mesh: box,
		material: materials.standard({ color: '#e8554e' }),
		position: [0, 0.5, 0],
		dynamic: true,
	});
	const ball = scene.createMesh({
		name: 'ball',
		mesh: geometry.sphere({ radius: 0.4 }),
		material: materials.standard({ color: '#5bc27a' }),
		dynamic: true,
	});
	const marker = scene.createMesh({
		name: 'marker',
		mesh: geometry.sphere({ radius: 0.25 }),
		material: materials.unlit({ color: '#ffd166' }),
		dynamic: true,
	});
	marker.setVisible(false);
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

	/** How far right the box has slid. */
	let slide = 0;

	return {
		onUpdate(dt) {
			const angle = time.now * TURN_SPEED;
			cube.setRotation(0, Math.sin(angle / 2), 0, Math.cos(angle / 2));
			if (input.isDown('KeyW')) {
				slide = Math.min(slide + SLIDE_SPEED * dt, SLIDE_LIMIT);
				cube.setPosition(slide, 0.5, 0);
			}
			const orbit = time.now * ORBIT_SPEED;
			ball.setPosition(Math.cos(orbit) * 2, 0.6, Math.sin(orbit) * 2);
			if (input.wasPressed('Mouse0')) {
				marker.setPosition(input.pointer.ndcX * 3, 0.5 + input.pointer.ndcY * 2, 2);
				marker.setVisible(true);
			}
		},
	};
});
