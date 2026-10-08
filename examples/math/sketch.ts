// Math helpers: 300 drones chase a lamp that loops over a landing pad at dusk. Each drone's place
// comes from time.now alone: it flies the lamp's path a moment behind the lamp, and circles it at
// its own radius and speed. vec3 helpers build the place, quat.lookAt turns the drone the way it
// moves, and vec3.transformQuat puts its tail light behind it. The helpers write into arrays made
// once in the setup, so the frame loop allocates nothing. A seeded math.random gives each drone the
// same lag, radius and speed on every run. The lamp is a point light, which casts the shadows of
// the pylons and crates on the presets with point light shadows. The pointer can lead the lamp.

import type { Material, Vec3, Vec3Like } from '@null3d/engine';
import { defineSketch, math, quat, vec3 } from '@null3d/engine';
import { interact } from '../lib/interact';

const DRONES = 300;
/** The point that the camera looks at. */
const TARGET = [0, 1.5, 0] as const;
/** A point toward the sun: just over the horizon, to the camera's left. */
const SUN = [-0.95, 0.05, 0.3] as const;
/** The tail light's place on a drone, behind its hull. */
const TAIL = [0, 0, -0.42] as const;

export default defineSketch(async (ctx) => {
	const { scene, assets, geometry, materials, textures, post, time } = ctx;
	scene.setBackground({ sky: { sunPosition: SUN, turbidity: 6, cloudCoverage: 0.45 } });
	scene.setEnvironment(await assets.builtinEnvironment('room'), { intensity: 0.15 });
	scene.setFog({ color: '#3a3028', density: 0.015, heightFalloff: 0.3, sunGlow: 1 });
	post.set({ bloom: { intensity: 0.3, threshold: 1 }, ao: { radius: 0.5 }, vignette: {} });
	const camera = scene.createPerspectiveCamera({ far: 5e3, position: [0, 5, 11], target: TARGET });
	scene.setActiveCamera(camera);
	// The pointer leads the lamp over the pad, at the lamp's mean height.
	const view = interact(ctx, camera, {
		target: TARGET,
		groundY: 3,
		bounds: [-7, 0, -7, 7, 5, 7],
	});
	scene.createDirectionalLight({
		direction: [-SUN[0], -SUN[1], -SUN[2]],
		color: '#ff9a62',
		intensity: 1.2,
		castShadows: true,
		shadow: { distance: 40 },
	});
	scene.createAmbientLight({ color: '#8090c0', intensity: 0.08 });
	// Light that a surface gives off itself, above white, so that bloom spreads it.
	const glow = (emissive: string, emissiveIntensity: number) =>
		materials.standard({ color: '#000000', emissive, emissiveIntensity });
	const gold = '#ffd166';
	const sphere = geometry.sphere({ radius: 0.2 });
	const bulb = scene.createMesh({ mesh: sphere, material: glow(gold, 12), dynamic: true });
	scene.createPointLight({
		parent: bulb,
		color: gold,
		intensity: 120,
		range: 18,
		castShadows: true,
	});
	const box = geometry.box();
	const solid = { castShadows: true, receiveShadows: true };
	const block = (material: Material, position: Vec3, scale: Vec3) =>
		scene.createMesh({ mesh: box, material, position, scale, ...solid });

	// The floor: concrete grain with a painted line along two edges, a grid of lines as it repeats.
	math.seed(7);
	const data = new Uint8Array(64 * 64 * 4);
	for (let i = 0; i < 64 * 64; i++) {
		const shade = math.randFloat(120, 150);
		const line = i % 64 === 0 || i < 64;
		data.set(line ? [150, 120, 45, 255] : [shade, shade, shade * 1.06, 255], i * 4);
	}
	const look = { colorSpace: 'srgb', wrap: 'repeat', mipmaps: true, anisotropy: 8 } as const;
	const map = textures.fromData({ width: 64, height: 64, data, ...look });
	const concrete = materials.standard({ map, roughness: 0.6, uvTransform: { repeat: [2e3, 2e3] } });
	block(concrete, [0, -1.1, 0], [1e4, 0.2, 1e4]);

	// Pylons with red beacons around the pad, and a crate inside each: the lamp casts their shadows.
	const steel = materials.standard({ color: '#5a606c', metalness: 0.6, roughness: 0.45 });
	const wood = materials.standard({ color: '#8a6f4e', roughness: 0.8 });
	const beacon = glow('#ff3b30', 8);
	for (let k = 1; k < 6; k++) {
		const x = Math.sin((k * Math.PI) / 3);
		const z = Math.cos((k * Math.PI) / 3);
		const size = 0.5 + 0.15 * k;
		block(steel, [x * 10, 2, z * 10], [0.5, 6, 0.5]);
		block(beacon, [x * 10, 5.1, z * 10], [0.3, 0.2, 0.3]);
		block(wood, [x * 6.5, size / 2 - 1, z * 6.5], [size, size, size]);
	}

	// Each drone: a metal hull, and a tail light bright enough to bloom.
	const hull = geometry.box({ width: 0.4, height: 0.1, depth: 0.8 });
	const metal = materials.standard({ color: '#7c8796', metalness: 0.85, roughness: 0.25 });
	const light = geometry.box({ width: 0.44, height: 0.05, depth: 0.05 });
	const drones = scene.createInstances(hull, DRONES, { material: metal, dynamic: true });
	const tails = scene.createInstances(light, DRONES, {
		material: glow('#4fd8ff', 6),
		dynamic: true,
	});
	// Each drone's lag behind the lamp, and the radius, speed, start and height of its circle.
	const flights = Array.from({ length: DRONES }, (_, i) => ({
		lag: math.randFloat(0.1, 1.2),
		radius: math.randFloat(0.5, 2.5),
		spin: math.randFloat(0.6, 2) * (i % 2 ? 1 : -1),
		phase: math.randFloat(0, Math.PI * 2),
		rise: math.randFloatSpread(1.5),
	}));

	// Scratch arrays: made once, reused in every frame.
	const lampAt = vec3.create();
	const ring = vec3.create();
	const from = vec3.create();
	const to = vec3.create();
	const tail = vec3.create();
	const facing = quat.create();
	/** Writes the lamp's place at time t into out, moved toward the pointed point while it steers. */
	const lamp = (out: Vec3Like, t: number) =>
		view.steer(
			vec3.set(out, Math.sin(t * 0.7) * 4.5, 3 + Math.sin(t * 1.3) * 1.5, Math.sin(t * 1.4) * 3),
		);
	/** Writes drone i's place at time t into out: on the lamp's path a moment late, on its circle. */
	const drone = (out: Vec3Like, i: number, t: number) => {
		const { lag, radius, spin, phase, rise } = flights[i];
		const angle = t * spin + phase;
		const height = rise + Math.sin(angle * 2) * 0.8;
		vec3.set(ring, Math.cos(angle) * radius, height, Math.sin(angle) * radius);
		return vec3.add(out, lamp(out, t - lag), ring);
	};

	return {
		onUpdate(dt) {
			const t = time.now;
			view.update(dt);
			lamp(lampAt, t);
			bulb.setPosition(lampAt[0], lampAt[1], lampAt[2]);
			// Read the arrays in each frame: they are views of engine memory, which moves when it grows.
			const { positions, rotations } = drones;
			const tailPositions = tails.positions;
			const tailRotations = tails.rotations;
			for (let i = 0; i < DRONES; i++) {
				// Face the way the drone moves: from where it was a moment ago to where it is now.
				quat.lookAt(facing, drone(from, i, t - 0.05), drone(to, i, t));
				positions.set(to, i * 3);
				rotations.set(facing, i * 4);
				vec3.add(tail, vec3.transformQuat(tail, TAIL, facing), to);
				tailPositions.set(tail, i * 3);
				tailRotations.set(facing, i * 4);
			}
		},
	};
});
