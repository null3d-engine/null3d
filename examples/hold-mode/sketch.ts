// Hold mode: 400 balls drop from random places into a pen and bounce. Math.random picks where each
// ball starts and how it flies, and each frame moves the balls by the frame's step, so every live
// run differs. With ?hold=3 in the page's address, the engine seeds Math.random and runs the
// sketch in fixed steps of 1/60 second up to 3 seconds. The held frame is then the same on every
// run, which is what an image test needs. The pointer brings up a paddle that kicks balls up.
import { defineSketch } from '@null3d/engine';
import { interact } from '../lib/interact';

const BALLS = 400;
const RADIUS = 0.25;
/** Half the width of the pen, in meters. */
const HALF = 4;
const GRAVITY = 9.8;
/** The share of a ball's speed that it keeps when it bounces. */
const BOUNCE = 0.75;
/** The paddle's radius, and the upward speed that it gives a ball on it. */
const PADDLE = 0.8;
const KICK = 6;

export default defineSketch((ctx) => {
	const { scene, geometry, materials } = ctx;
	scene.setBackground('#141a22');
	const camera = scene.createPerspectiveCamera({
		fov: 50,
		position: [0, 9, 13],
		target: [0, 1.5, 0],
	});
	scene.setActiveCamera(camera);
	const edge = HALF - PADDLE;
	const view = interact(ctx, camera, {
		target: [0, 1.5, 0],
		groundY: 0,
		bounds: [-edge, 0, -edge, edge, 0, edge],
	});
	scene.createDirectionalLight({ direction: [-1, -2, -1], intensity: 3 });
	scene.createAmbientLight({ intensity: 0.4 });

	const stone = materials.standard({ color: '#4b5566' });
	scene.createMesh({
		mesh: geometry.box({ width: 2 * HALF, height: 0.2, depth: 2 * HALF }),
		material: stone,
		position: [0, -0.1, 0],
	});
	// Four low walls, each turned a quarter turn from the one before.
	const wall = geometry.box({ width: 2 * HALF, height: 0.6, depth: 0.1 });
	for (let side = 0; side < 4; side++) {
		const angle = (side * Math.PI) / 2;
		const out = HALF + 0.05;
		const position: [number, number, number] = [Math.sin(angle) * out, 0.3, Math.cos(angle) * out];
		scene.createMesh({ mesh: wall, material: stone, position }).setRotationEuler(0, angle, 0);
	}

	const balls = scene.createInstances(
		geometry.sphere({ radius: RADIUS, widthSegments: 16, heightSegments: 12 }),
		BALLS,
		{
			material: materials.standard({ color: '#f2a93b' }),
			dynamic: true,
		},
	);
	const velocities = new Float32Array(BALLS * 3);
	const start = balls.positions;
	for (let i = 0; i < BALLS * 3; i += 3) {
		start[i] = (Math.random() * 2 - 1) * (HALF - RADIUS);
		start[i + 1] = 2 + Math.random() * 8;
		start[i + 2] = (Math.random() * 2 - 1) * (HALF - RADIUS);
		velocities[i] = (Math.random() * 2 - 1) * 3;
		velocities[i + 2] = (Math.random() * 2 - 1) * 3;
	}
	// The paddle shows only while the pointer steers it.
	const paddle = scene.createMesh({
		mesh: geometry.cylinder({ radiusTop: PADDLE, radiusBottom: PADDLE, height: 0.06 }),
		material: materials.standard({ color: '#4a8cff' }),
		dynamic: true,
	});
	paddle.setVisible(false);
	let shown = false;

	return {
		onUpdate(dt) {
			view.update(dt);
			const { point, steering } = view;
			if (shown !== steering > 0) {
				shown = steering > 0;
				paddle.setVisible(shown);
			}
			if (shown) {
				paddle.setPosition(point[0], 0.03, point[2]);
				paddle.setScale(steering, 1, steering);
			}
			// Read the array in each frame: it is a view of engine memory, which moves when it grows.
			const positions = balls.positions;
			for (let i = 0; i < BALLS * 3; i += 3) {
				velocities[i + 1] -= GRAVITY * dt;
				// The paddle kicks a ball on it up, and away from its middle.
				const dx = positions[i] - point[0];
				const dz = positions[i + 2] - point[2];
				if (steering > 0.5 && positions[i + 1] < 2 * RADIUS && dx * dx + dz * dz < PADDLE ** 2) {
					velocities[i] += dx * 3;
					velocities[i + 1] = KICK;
					velocities[i + 2] += dz * 3;
				}
				for (let axis = 0; axis < 3; axis++) {
					// The floor stops a ball from below, and the walls keep it in the pen.
					const low = axis === 1 ? RADIUS : RADIUS - HALF;
					const high = axis === 1 ? Number.POSITIVE_INFINITY : HALF - RADIUS;
					const at = positions[i + axis] + velocities[i + axis] * dt;
					if (at < low || at > high) velocities[i + axis] *= -BOUNCE;
					positions[i + axis] = Math.min(Math.max(at, low), high);
				}
			}
		},
	};
});
