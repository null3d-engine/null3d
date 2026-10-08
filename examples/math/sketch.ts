// Math helpers: 300 drones chase a light that loops through the air. In each frame, each drone
// eases toward its own place near the light with vec3.lerp, and turns toward the way it moves with
// quat.lookAt and quat.slerp. The helpers write into arrays made once in the setup, so the frame
// loop allocates nothing. A seeded math.random places the drones the same way on every run. The
// pointer can lead the light over the floor.
import { defineSketch, math, quat, vec3 } from '@null3d/engine';
import { interact } from '../lib/interact';

const DRONES = 300;

export default defineSketch((ctx) => {
	const { scene, geometry, materials, time } = ctx;
	scene.setBackground('#10131a');
	const camera = scene.createPerspectiveCamera({
		fov: 55,
		position: [0, 5, 11],
		target: [0, 1.5, 0],
	});
	scene.setActiveCamera(camera);
	// The pointer leads the light over the floor, at the light's mean height.
	const view = interact(ctx, camera, {
		target: [0, 1.5, 0],
		groundY: 2.5,
		bounds: [-7, 0, -7, 7, 5, 7],
	});
	scene.createDirectionalLight({ direction: [-0.5, -2, -1], intensity: 2.5 });
	scene.createAmbientLight({ intensity: 0.5 });

	const light = scene.createMesh({
		mesh: geometry.sphere({ radius: 0.35 }),
		material: materials.unlit({ color: '#ffd166' }),
		dynamic: true,
	});
	const drones = scene.createInstances(
		geometry.box({ width: 0.4, height: 0.1, depth: 0.8 }),
		DRONES,
		{ material: materials.standard({ color: '#9aa7b8' }), dynamic: true },
	);
	scene.createMesh({
		mesh: geometry.box({ width: 16, height: 0.2, depth: 16 }),
		material: materials.standard({ color: '#2a3140' }),
		position: [0, -1, 0],
	});

	// Each drone keeps an offset from the light and a speed, from the seeded generator.
	math.seed(7);
	const offsets = new Float32Array(DRONES * 3);
	const speeds = new Float32Array(DRONES);
	for (let i = 0; i < DRONES; i++) {
		offsets[i * 3] = math.randFloatSpread(5);
		offsets[i * 3 + 1] = math.randFloatSpread(2);
		offsets[i * 3 + 2] = math.randFloatSpread(5);
		speeds[i] = math.randFloat(0.8, 3);
	}

	// Scratch arrays: made once, reused in every frame.
	const lightAt = vec3.create();
	const goal = vec3.create();
	const from = vec3.create();
	const to = vec3.create();
	const facing = quat.create();
	const turn = quat.create();

	return {
		onUpdate(dt) {
			const t = time.now;
			vec3.set(
				lightAt,
				Math.sin(t * 0.7) * 4.5,
				2.5 + Math.sin(t * 1.3) * 1.5,
				Math.sin(t * 1.4) * 3,
			);
			view.update(dt);
			view.steer(lightAt);
			light.setPosition(lightAt[0], lightAt[1], lightAt[2]);
			// Read the arrays in each frame: they are views of engine memory, which moves when it grows.
			const positions = drones.positions;
			const rotations = drones.rotations;
			for (let i = 0; i < DRONES; i++) {
				vec3.set(goal, offsets[i * 3], offsets[i * 3 + 1], offsets[i * 3 + 2]);
				vec3.add(goal, goal, lightAt);
				vec3.set(from, positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
				// Close a share of the gap that suits the frame's step, as math.damp does for one number.
				vec3.lerp(to, from, goal, 1 - Math.exp(-speeds[i] * dt));
				positions.set(to, i * 3);
				if (vec3.squaredDistance(from, to) < 1e-8) continue;
				quat.lookAt(turn, from, to);
				quat.set(
					facing,
					rotations[i * 4],
					rotations[i * 4 + 1],
					rotations[i * 4 + 2],
					rotations[i * 4 + 3],
				);
				quat.slerp(facing, facing, turn, math.clamp(8 * dt, 0, 1));
				rotations.set(facing, i * 4);
			}
		},
	};
});
