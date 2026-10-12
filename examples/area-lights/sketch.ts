// Area lights: a narrow street after rain, at night. Two shop windows on the left are rectangle
// lights, and a neon sign on the right is made of tube lights. The wet street shows each light's
// whole shape, stretched toward the camera, where a point light would leave a dot. Each light has
// a glowing mesh of the same shape, size and color, since a light itself draws nothing. One neon
// tube flickers, and a loose tube light floats down the street, or follows the pointer. Each
// window light shows a picture of its shelves, which the puddles reflect. The shelves come from
// code, and the street around them is in street.ts.
import { defineSketch, math, quat, type Vec3, vec3 } from '@null3d/engine';
import { interact } from '../lib/interact';
import { street } from './street';

/** A quarter turn about Y, which turns a plane that faces +Z to face +X. */
const QUARTER_Y = [0, Math.SQRT1_2, 0, Math.SQRT1_2] as const;
/** The shop windows on the left wall, which face +X: their middle's z, and their color. */
const WINDOWS = [
	[-3.5, '#ffc98a'],
	[-11, '#ffe2b8'],
] as const;
/** The neon sign's tubes on the right wall: two ends each, and the color. */
const NEON: readonly [Vec3, Vec3, string][] = [
	[[3.9, 3.1, -2.2], [3.9, 3.1, 0.2], '#ff3fa4'],
	[[3.9, 2.3, -2.2], [3.9, 2.3, 0.2], '#ff3fa4'],
	[[3.9, 2.0, 1.0], [3.9, 3.4, 1.0], '#3fe0ff'],
	[[3.9, 2.0, 1.6], [3.9, 3.4, 2.5], '#3fe0ff'],
];
/** A capsule's axis before it turns. */
const UP: Vec3 = [0, 1, 0];
/** Each tube's radius, and each light's brightness in nits. */
const TUBE = 0.04;
const WINDOW_NITS = 16;
const NEON_NITS = 160;

export default defineSketch((ctx) => {
	const { scene, geometry, materials, textures, post, time } = ctx;
	street(ctx);
	post.set({ bloom: { intensity: 0.35, threshold: 1 }, vignette: {} });
	const glow = (emissive: string, emissiveIntensity: number) =>
		materials.standard({ color: '#000000', emissive, emissiveIntensity });

	// The shop windows: shelves of goods made in code glow behind the glass, and a rectangle light
	// of the window's size shows the same picture, so the wet street reflects the shelves.
	const shelves = new Uint8Array(32 * 32 * 4);
	for (let i = 0; i < 32 * 32; i++) {
		const [x, y] = [i % 32, i >> 5];
		const lit = y % 10 > 1 && !(y % 10 > 6 && x % 5 === 0) ? math.randFloat(0.6, 1) : 0.15;
		shelves.set([255 * lit, 220 * lit, 170 * lit, 255], i * 4);
	}
	const goods = textures.fromData({ width: 32, height: 32, data: shelves, colorSpace: 'srgb' });
	const pane = geometry.plane({ width: 2.4, height: 1.6 });
	const frame = materials.standard({ color: '#18181a', roughness: 0.4 });
	for (const [z, color] of WINDOWS) {
		const look = { color: '#000000', emissive: color, emissiveIntensity: WINDOW_NITS };
		const material = materials.standard({ ...look, emissiveMap: goods });
		scene.createMesh({ mesh: pane, material, position: [-3.96, 1.6, z], rotation: QUARTER_Y });
		const sill = { mesh: geometry.box(), material: frame, scale: [0.06, 1.8, 2.6] as Vec3 };
		scene.createMesh({ ...sill, position: [-4, 1.6, z] });
		scene.createRectAreaLight({
			position: [-3.95, 1.6, z],
			direction: [1, 0, 0],
			width: 2.4,
			height: 1.6,
			range: 12,
			color,
			intensity: WINDOW_NITS,
			image: { width: 32, height: 32, data: shelves },
		});
	}

	// A cold strip light over the doorway at the far end, which faces down the street.
	const strip = { width: 3, height: 0.25, range: 14, color: '#bcd8ff', intensity: 40 };
	const panel = materials.standard({
		color: '#000000',
		emissive: strip.color,
		emissiveIntensity: 40,
	});
	scene.createMesh({
		mesh: geometry.plane({ width: 3, height: 0.25 }),
		material: panel,
		position: [0, 3.2, -19.78],
	});
	scene.createRectAreaLight({ ...strip, position: [0, 3.2, -19.77], direction: [0, -0.2, 1] });

	// The neon sign: a glowing capsule and a tube light for each tube.
	const tubes = NEON.map(([a, b, color]) => {
		const middle: Vec3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
		const along: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
		const length = Math.hypot(...along);
		const rotation = quat.rotationTo(quat.create(), UP, vec3.normalize(vec3.create(), along));
		const capsule = { mesh: geometry.capsule({ radius: TUBE, height: length }), rotation };
		scene.createMesh({ ...capsule, material: glow(color, NEON_NITS), position: middle });
		const light = { position: middle, direction: along, length, radius: TUBE, range: 8, color };
		return scene.createTubeLight({ ...light, intensity: NEON_NITS });
	});

	// A loose tube that floats down the street, or follows the pointer.
	const loose = { length: 1.2, radius: TUBE, range: 7, color: '#9dff6a', intensity: NEON_NITS };
	const wand = scene.createTubeLight({ ...loose, direction: [1, 0, 0], position: [0, 0.6, 0] });
	const capsule = geometry.capsule({ radius: TUBE, height: 1.2 });
	const stick = scene.createMesh({
		mesh: capsule,
		material: glow('#9dff6a', NEON_NITS),
		dynamic: true,
	});

	const look: Vec3 = [0, 1.4, -3];
	const camera = scene.createPerspectiveCamera({
		fov: 55,
		position: [0.6, 1.7, 6.5],
		target: look,
	});
	scene.setActiveCamera(camera);
	const limits = { maxPolarAngle: Math.PI * 0.49, minDistance: 2, maxDistance: 14 };
	const view = interact(ctx, camera, {
		target: look,
		...limits,
		groundY: 0.6,
		bounds: [-3, 0.6, -14, 3, 0.6, 5],
	});

	const [at, axis, spin] = [vec3.create(), vec3.create(), quat.create()];
	return {
		onUpdate(dt) {
			view.update(dt);
			// The second neon tube stutters now and then, as old neon does.
			const stutter = Math.sin(time.now * 23) > 0.2 && Math.sin(time.now * 1.3) > 0.85;
			tubes[1].setIntensity(stutter ? NEON_NITS * 0.15 : NEON_NITS);
			// The loose tube drifts down the street and back, turning slowly, or follows the pointer.
			vec3.set(at, Math.sin(time.now * 0.4) * 1.5, 0.6, -4 + Math.sin(time.now * 0.25) * 5);
			view.steer(at);
			vec3.set(axis, Math.cos(time.now * 0.5), 0, Math.sin(time.now * 0.5));
			wand.setPosition(at[0], at[1], at[2]);
			wand.setDirection(axis[0], axis[1], axis[2]);
			quat.rotationTo(spin, UP, axis);
			stick.setPosition(at[0], at[1], at[2]);
			stick.setRotation(spin[0], spin[1], spin[2], spin[3]);
		},
	};
});
