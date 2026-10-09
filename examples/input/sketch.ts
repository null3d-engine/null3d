// Input and actions: an action map gives each move a name, and the keyboard and a gamepad both
// press it. A robot made from the geometry generators walks and jumps, and swings its legs and arms
// on joints, groups that turn. The camera follows it, and orbits it from the user's first gesture.
import type { Material, MeshGeometry, Object3D, Vec3 } from '@null3d/engine';
import { defineSketch, math, timeOfDay, vec3 } from '@null3d/engine';
import { interact } from '../lib/interact';

/** Walking speed in meters per second, a jump's upward speed, and the pull of gravity. */
const SPEED = 4;
const JUMP = 7;
const GRAVITY = 20;
/** How far from the center the robot can walk, and the camera's distance from it at first. */
const BOUNDS = 7;
const DISTANCE = 7;
/** The swing of each leg, in radians, and the strides per meter. */
const SWING = 0.6;
const STRIDE = 3.5;

export default defineSketch(async (ctx) => {
	const { scene, assets, geometry, materials, textures, post, input, time } = ctx;
	const day = timeOfDay(16.2, { heading: -0.5 });
	const sky = { ...day.sky, cloudCoverage: 0.35 };
	scene.setBackground({ sky }, { intensity: day.skyIntensity });
	scene.setEnvironment(await assets.skyEnvironment(), { intensity: day.skyIntensity });
	scene.setFog({ color: day.fog.color, density: 0.004, sunGlow: day.fog.sunGlow });
	post.set({ exposure: day.exposure, bloom: { threshold: 1 }, ao: {}, vignette: {} });
	scene.createDirectionalLight({ ...day.light, castShadows: true, shadow: { distance: 30 } });
	const camera = scene.createPerspectiveCamera({ fov: 55, near: 0.1, far: 1000 });
	scene.setActiveCamera(camera);
	// The point that the camera looks at: the robot, at the height of its middle.
	const look = vec3.set(vec3.create(), 0, 1, 0);
	const limits = { maxPolarAngle: Math.PI * 0.48, minDistance: 3, maxDistance: 25 };
	const view = interact(ctx, camera, { target: look, ...limits });

	// Warm gray floor panels in two shades with dark seams, in a texture made in code.
	const data = new Uint8Array(64 * 64 * 4).fill(255);
	for (let i = 0; i < 64 * 64; i++) {
		const [x, y] = [i % 64, i >> 6];
		const shade = x % 32 === 0 || y % 32 === 0 ? 77 : ((x >> 5) + (y >> 5)) % 2 ? 153 : 190;
		data.set([shade, shade * 0.95, shade * 0.88], i * 4);
	}
	const tiles = { colorSpace: 'srgb', wrap: 'repeat', mipmaps: true, anisotropy: 8 } as const;
	const map = textures.fromData({ width: 64, height: 64, data, ...tiles });
	scene.createMesh({
		mesh: geometry.plane({ width: 2000, height: 2000 }),
		material: materials.standard({ map, uvTransform: { repeat: [1e3, 1e3] }, doubleSided: true }),
		rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
		receiveShadows: true,
	});

	// The robot: shapes from the generators, with legs and arms on joints at hips and shoulders.
	const steel = materials.standard({ color: '#a7b0ba', metalness: 1, roughness: 0.3 });
	const dark = materials.standard({ color: '#2b2f36', metalness: 0.6, roughness: 0.45 });
	const glow = (emissive: string) => materials.standard({ emissive, emissiveIntensity: 5 });
	const colors = ['#e8554e', '#5bc27a', '#f2c14e', '#4a8cff'].map((color) =>
		materials.standard({ color, metalness: 0.3, roughness: 0.35 }),
	);
	const robot = scene.createGroup({ dynamic: true });
	const part = (mesh: MeshGeometry, material: Material, position: Vec3, parent: Object3D = robot) =>
		scene.createMesh({ mesh, material, position, parent, castShadows: true, receiveShadows: true });
	const joint = (position: Vec3) => scene.createGroup({ parent: robot, position, dynamic: true });
	const body = part(geometry.capsule({ radius: 0.32, height: 0.35 }), colors[0], [0, 1.05, 0]);
	part(geometry.box({ width: 0.5, height: 0.36, depth: 0.42 }), steel, [0, 1.62, 0]);
	part(geometry.box({ width: 0.4, height: 0.1, depth: 0.04 }), glow('#4ad8ff'), [0, 1.65, 0.2]);
	part(geometry.capsule({ radius: 0.015, height: 0.3 }), dark, [0, 1.92, 0]);
	part(geometry.sphere({ radius: 0.05 }), glow('#ff3b30'), [0, 2.08, 0]);
	const limb = geometry.capsule({ radius: 0.09, height: 0.32 });
	const foot = geometry.box({ width: 0.2, height: 0.1, depth: 0.3 });
	// In order: the left hip, the left shoulder, the right hip and the right shoulder.
	const joints = [-1, 1].flatMap((side) => {
		const hip = joint([side * 0.17, 0.62, 0]);
		part(limb, dark, [0, -0.27, 0], hip);
		part(foot, steel, [0, -0.55, 0.05], hip);
		const shoulder = joint([side * 0.44, 1.3, 0]);
		part(limb, steel, [0, -0.25, 0], shoulder);
		part(geometry.sphere({ radius: 0.1 }), dark, [0, -0.48, 0], shoulder);
		return [hip, shoulder];
	});

	input.actions.define({
		left: ['KeyA', 'ArrowLeft', 'GamepadLeftStickLeft'],
		right: ['KeyD', 'ArrowRight', 'GamepadLeftStickRight'],
		forward: ['KeyW', 'ArrowUp', 'GamepadLeftStickUp'],
		back: ['KeyS', 'ArrowDown', 'GamepadLeftStickDown'],
		jump: ['Space', 'GamepadA'],
		paint: ['KeyE', 'GamepadX'],
		turnLeft: ['GamepadRightStickLeft'],
		turnRight: ['GamepadRightStickRight'],
	});

	// Where the robot is, its height and upward speed in a jump, the way it faces, the phase of its
	// walk, how much it walks, from 0 standing to 1, and its paint.
	let [x, z, height, rise, heading, phase, walking, color] = [0, 0, 0, 0, 0, 0, 0, 0];
	// The camera's angle around the robot, until the user turns it.
	let yaw = 0.6;

	return {
		onUpdate(dt) {
			// The right stick turns the camera, before and after the user takes it.
			const stick = (input.value('turnRight') - input.value('turnLeft')) * 2.5 * dt;
			if (view.userCamera) view.controls.rotateLeft(-stick);
			yaw = view.userCamera ? view.controls.getAzimuthalAngle() : yaw + stick;

			// Walk relative to the camera: forward goes away from it.
			const across = input.value('right') - input.value('left');
			const ahead = input.value('forward') - input.value('back');
			const dx = (across * Math.cos(yaw) - ahead * Math.sin(yaw)) * SPEED * dt;
			const dz = -(across * Math.sin(yaw) + ahead * Math.cos(yaw)) * SPEED * dt;
			x = math.clamp(x + dx, -BOUNDS, BOUNDS);
			z = math.clamp(z + dz, -BOUNDS, BOUNDS);

			if (input.wasPressed('jump') && height === 0) rise = JUMP;
			rise -= GRAVITY * dt;
			height = Math.max(0, height + rise * dt);
			if (height === 0) rise = 0;

			// The robot turns the shorter way toward where it walks, and swings its legs and arms
			// by the distance it walks. Standing, its arms sway a little; in a jump, they go up.
			const moved = Math.hypot(dx, dz);
			const turn = math.euclideanModulo(Math.atan2(dx, dz) - heading + Math.PI, 2 * Math.PI);
			if (moved > 0) heading += (turn - Math.PI) * (1 - Math.exp(-12 * dt));
			phase += moved * STRIDE;
			walking = math.damp(walking, moved > 0 && height === 0 ? 1 : 0, 10, dt);
			const swing = Math.sin(phase) * SWING * walking;
			const sway = 0.06 * Math.sin(time.now * 2) * (1 - walking);
			for (let k = 0; k < 4; k++) {
				const side = k < 2 ? 1 : -1;
				const angle = k % 2 === 0 ? side * swing : -side * swing * 0.8 + sway;
				joints[k].setRotationEuler(height > 0 && k % 2 === 1 ? -2.4 : angle, 0, 0);
			}
			robot.setPosition(x, height + Math.abs(Math.sin(phase)) * 0.05 * walking, z);
			robot.setRotationEuler(0, heading, 0);

			if (input.wasPressed('paint')) body.setMaterial(colors[++color % colors.length]);
		},
		onLateUpdate(dt) {
			// The camera follows the robot. Until the user takes it, the script places it. From then
			// on, the user's camera and its target move with the robot.
			if (!view.userCamera) {
				camera.setPosition(x + Math.sin(yaw) * DISTANCE, 5, z + Math.cos(yaw) * DISTANCE);
				camera.lookAt(x, 1, z);
			}
			view.shift(x - look[0], 0, z - look[2]);
			vec3.set(look, x, 1, z);
			view.update(dt);
		},
	};
});
