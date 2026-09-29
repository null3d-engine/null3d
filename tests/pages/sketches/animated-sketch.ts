// An animated scene for hold mode's tests. Setup scatters boxes with Math.random. Each update turns
// a box by the frame's step, moves a ball with the sketch time, and lifts one box that Math.random
// picks, while the camera circles. Only fixed steps and seeded random numbers draw the same frame
// on every run. On the message `state`, the sketch sends its time, its frame, its updates, its
// smallest and largest steps after the first frame, and the first random numbers its setup drew.
import { defineSketch } from '@null3d/engine';

const BOXES = 24;
/** How fast the red box turns, in radians per second. */
const TURN_SPEED = 1.2;
/** How fast the camera circles the scene, in radians per second. */
const ORBIT_SPEED = 0.4;
/** How far the box that an update picks rises. */
const LIFT = 0.02;

export default defineSketch(({ scene, materials, geometry, page, time }) => {
	const firstRandom = [Math.random(), Math.random(), Math.random()];
	scene.setBackground('#101418');
	const camera = scene.createPerspectiveCamera({ fov: 60, near: 0.1, far: 100 });
	scene.setActiveCamera(camera);
	scene.createDirectionalLight({ direction: [-1, -2, -1], color: '#ffffff', intensity: 3 });
	scene.createAmbientLight({ color: '#ffffff', intensity: 0.4 });

	const box = geometry.box();
	const boxes = scene.createInstances(box, BOXES, {
		material: materials.standard({ color: '#4a8cff' }),
		dynamic: true,
	});
	for (let i = 0; i < BOXES; i++) {
		const size = 0.3 + Math.random() * 0.5;
		boxes.positions.set(
			[(Math.random() - 0.5) * 8, Math.random() - 1, (Math.random() - 0.5) * 8],
			i * 3,
		);
		boxes.rotations.set([0, 0, 0, 1], i * 4);
		boxes.scales.set([size, size, size], i * 3);
	}
	const spinner = scene.createMesh({
		mesh: box,
		material: materials.standard({ color: '#e8554e' }),
		position: [0, 0.5, 0],
		dynamic: true,
	});
	const ball = scene.createMesh({
		mesh: geometry.sphere({ radius: 0.5 }),
		material: materials.standard({ color: '#5bc27a' }),
		dynamic: true,
	});

	let angle = 0;
	let updates = 0;
	let smallestStep = Number.POSITIVE_INFINITY;
	let largestStep = 0;
	page.onMessage((name) => {
		if (name === 'state')
			page.post('state', {
				now: time.now,
				frame: time.frame,
				updates,
				smallestStep,
				largestStep,
				firstRandom,
			});
	});
	return {
		onUpdate(dt) {
			updates++;
			if (time.frame > 1) {
				smallestStep = Math.min(smallestStep, dt);
				largestStep = Math.max(largestStep, dt);
			}
			angle += dt * TURN_SPEED;
			spinner.setRotation(0, Math.sin(angle / 2), 0, Math.cos(angle / 2));
			ball.setPosition(Math.sin(time.now * 2) * 2.5, 0.6, Math.cos(time.now * 2) * 2.5);
			const lifted = Math.floor(Math.random() * BOXES);
			const positions = boxes.positions;
			positions[lifted * 3 + 1] = (positions[lifted * 3 + 1] ?? 0) + LIFT;
			const orbit = time.now * ORBIT_SPEED;
			camera.setPosition(Math.cos(orbit) * 9, 4, Math.sin(orbit) * 9);
			camera.lookAt(0, 0, 0);
		},
	};
});
