// Math helpers: a flock of 300 drones circles a lamp over a landing pad at dusk. Each drone holds a
// slot in a wide ring below the lamp, and the whole ring turns, so the flock keeps its spacing. Its
// place, its lean and bank and the spin of its rotors come from time.now alone, through vec3 and
// quat helpers that write into arrays made once, so a frame allocates nothing. A drone in front of
// the lamp steps aside from the camera's line of sight, so the lamp stays in view. Each drone
// carries a small point light. The lamp is a point light too, which casts the crates' shadows on
// the presets with point light shadows. The pointer can lead the lamp.

import type { InstanceBatch, Material, MeshGeometry, Vec3 } from '@null3d/engine';
import { defineSketch, math, quat, vec3 } from '@null3d/engine';
import { interact } from '../lib/interact';

const DRONES = 300;
/** The point that the camera looks at, and the box that the pointer leads the lamp in. */
const TARGET = [0, 1.5, 0] as const;
const PAD = [-7, 0, -7, 7, 5, 7] as const;
/** A point toward the sun: just over the horizon, to the camera's left. */
const SUN = [-0.95, 0.05, 0.3] as const;
const GOLD = '#ffd166';
/** How close to the lamp, across the view, a drone in front of it may come, in meters. */
const CLEAR = 1.3;
/** The parts' places on a drone: the middle, a rotor at the end of each arm, the tail light. */
const MIDDLE = [0, 0, 0] as const;
const ROTORS = [-0.2, 0.2].flatMap((x) => [-0.2, 0.2].map((z) => [x, 0.045, z] as const));
const TAIL = [0, 0, -0.16] as const;
const UP = [0, 1, 0] as const;

export default defineSketch(async (ctx) => {
	const { scene, assets, geometry, materials, textures, post, time } = ctx;
	scene.setBackground({ sky: { sunPosition: SUN, turbidity: 6, cloudCoverage: 0.45 } });
	scene.setEnvironment(await assets.builtinEnvironment('room'), { intensity: 0.15 });
	scene.setFog({ color: '#3a3028', density: 0.015, heightFalloff: 0.3, sunGlow: 1 });
	post.set({ bloom: { intensity: 0.3, threshold: 1 }, ao: { radius: 0.5 }, vignette: {} });
	const camera = scene.createPerspectiveCamera({ far: 5e3, position: [0, 5, 11], target: TARGET });
	scene.setActiveCamera(camera);
	// The pointer leads the lamp over the pad, at the lamp's mean height.
	const view = interact(ctx, camera, { target: TARGET, groundY: 2, bounds: PAD });
	const sun = { direction: [-SUN[0], -SUN[1], -SUN[2]], color: '#ff9a62', intensity: 1.2 } as const;
	scene.createDirectionalLight({ ...sun, castShadows: true, shadow: { distance: 40 } });
	scene.createAmbientLight({ color: '#8090c0', intensity: 0.08 });
	// Light that a surface gives off itself, above white, so that bloom spreads it.
	const glow = (emissive: string, emissiveIntensity: number) =>
		materials.standard({ color: '#000000', emissive, emissiveIntensity });
	const ball = geometry.sphere({ radius: 0.3 });
	const orb = scene.createMesh({ mesh: ball, material: glow(GOLD, 16), dynamic: true });
	scene.createPointLight({ parent: orb, color: GOLD, intensity: 99, range: 20, castShadows: true });

	// The floor: concrete grain with a painted line along two edges, a grid of lines as it repeats.
	math.seed(7);
	const data = new Uint8Array(64 * 64 * 4);
	for (let i = 0; i < 64 * 64; i++) {
		const [shade, paint] = [math.randFloat(120, 150), i % 64 === 0 || i < 64];
		data.set(paint ? [150, 120, 45, 255] : [shade, shade, shade * 1.06, 255], i * 4);
	}
	const look = { colorSpace: 'srgb', wrap: 'repeat', mipmaps: true, anisotropy: 8 } as const;
	const map = textures.fromData({ width: 64, height: 64, data, ...look });
	const box = geometry.box();
	const solid = { castShadows: true, receiveShadows: true };
	const block = (material: Material, position: Vec3, scale: Vec3) =>
		scene.createMesh({ mesh: box, material, position, scale, ...solid });
	const concrete = materials.standard({ map, roughness: 0.6, uvTransform: { repeat: [2e3, 2e3] } });
	block(concrete, [0, -1.1, 0], [1e4, 0.2, 1e4]);
	// Crates around the pad, whose shadows the lamp casts.
	const wood = materials.standard({ color: '#8a6f4e', roughness: 0.8 });
	for (let k = 0; k < 6; k++) {
		const [x, z, size] = [Math.sin(k + 0.5) * 11, Math.cos(k + 0.5) * 11, 0.6 + 0.12 * k];
		block(wood, [x, size / 2 - 1, z], [size, size, size]);
	}

	// A drone: a body, two crossed arms, four rotors and a tail light, one instance batch per part.
	const batch = (mesh: MeshGeometry, rows: number, material: Material) =>
		scene.createInstances(mesh, rows, { material, dynamic: true });
	const metal = materials.standard({ color: '#aab4c2', metalness: 0.8, roughness: 0.3 });
	const dark = materials.standard({ color: '#2a2e35', roughness: 0.5 });
	const cyan = glow('#4fd8ff', 8);
	const bodies = batch(geometry.box({ width: 0.2, height: 0.07, depth: 0.26 }), DRONES, metal);
	const arms = batch(geometry.box({ width: 0.56, height: 0.025, depth: 0.04 }), DRONES * 2, dark);
	const rotors = batch(geometry.box({ width: 0.22, height: 0.01, depth: 0.03 }), DRONES * 4, dark);
	const tails = batch(geometry.box({ width: 0.1, height: 0.03, depth: 0.03 }), DRONES, cyan);
	const torch = { color: '#7fdcff', intensity: 1, range: 2, dynamic: true };
	const torches = Array.from({ length: DRONES }, () => scene.createPointLight(torch));
	// Each drone's slot, spread evenly over the ring by the golden angle: an angle and a distance
	// outside the lamp's clear space, a height over the pad, and a start for its bob.
	const slots = Array.from({ length: DRONES }, (_, i) => ({
		angle: i * 2.4,
		far: 2.2 + 3.8 * Math.sqrt((i + 0.5) / DRONES),
		height: math.randFloat(-0.4, 1.4),
		bob: i * 0.7,
	}));

	// Scratch arrays: made once, reused in every frame.
	const [lampAt, before, here, after] = Array.from({ length: 4 }, vec3.create);
	const [offset, side, toEye, at] = Array.from({ length: 4 }, vec3.create);
	const [facing, part, blade, none] = Array.from({ length: 4 }, quat.create);
	const crossed = [Math.PI / 4, -Math.PI / 4].map((a) => quat.setAxisAngle(quat.create(), UP, a));
	/** Writes the lamp's place at time t into out, moved toward the pointed point while it steers. */
	const lamp = (out: typeof here, t: number) =>
		view.steer(vec3.set(out, Math.sin(t * 0.7) * 3, 2 + Math.sin(t * 1.3), Math.sin(t * 1.4) * 2));
	/** Writes drone i's place at time t into out: its slot on the turning ring around the lamp. */
	const drone = (out: typeof here, i: number, t: number) => {
		const { angle, far, height, bob } = slots[i];
		const [x, z] = [Math.cos(angle + t * 0.35) * far, Math.sin(angle + t * 0.35) * far];
		vec3.set(offset, x, height + Math.sin(t * 1.7 + bob) * 0.15 - lamp(out, t)[1], z);
		// In front of the lamp, keep out of the cylinder between the lamp and the camera.
		const front = vec3.dot(offset, toEye);
		const across = vec3.length(vec3.scaleAndAdd(side, offset, toEye, -front));
		if (front > 0 && across < CLEAR) {
			vec3.scale(side, side, CLEAR / Math.max(across, 1e-3));
			vec3.scaleAndAdd(offset, side, toEye, front);
		}
		return vec3.add(out, out, offset);
	};
	/** Writes one part of the drone at `here`, facing `facing`, into a row of its batch. */
	const put = (parts: InstanceBatch, row: number, place: Vec3, turn: typeof none) => {
		parts.positions.set(vec3.add(at, vec3.transformQuat(at, place, facing), here), row * 3);
		parts.rotations.set(quat.multiply(part, facing, turn), row * 4);
	};
	return {
		onUpdate(dt) {
			const t = time.now;
			view.update(dt);
			lamp(lampAt, t);
			orb.setPosition(lampAt[0], lampAt[1], lampAt[2]);
			camera.getPosition(toEye);
			vec3.normalize(toEye, vec3.sub(toEye, toEye, lampAt));
			for (let i = 0; i < DRONES; i++) {
				// Where it was, is and will be a moment apart: it faces the way it flies, leans forward
				// with its speed, and banks into the turn.
				vec3.sub(before, drone(here, i, t), drone(before, i, t - 0.1));
				vec3.sub(after, drone(after, i, t + 0.1), here);
				const [a, b] = [vec3.length(before), vec3.length(after)];
				const yaw = Math.atan2(before[0] + after[0], before[2] + after[2]);
				const lean = math.clamp((a + b) * 0.25, 0, 0.35);
				const turn = vec3.cross(at, before, after)[1] / (a * b + 1e-6);
				const bank = math.clamp(-8 * turn, -0.6, 0.6);
				quat.fromEuler(facing, lean, yaw, bank, 'YXZ');
				put(bodies, i, MIDDLE, none);
				put(tails, i, TAIL, none);
				put(arms, i * 2, MIDDLE, crossed[0]);
				put(arms, i * 2 + 1, MIDDLE, crossed[1]);
				for (let k = 0; k < 4; k++)
					put(rotors, i * 4 + k, ROTORS[k], quat.setAxisAngle(blade, UP, t * 30 + k));
				torches[i].setPosition(here[0], here[1] - 0.15, here[2]);
			}
		},
	};
});
