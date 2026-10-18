// Area lights: a narrow street after rain, at night. Two shop windows, a far strip and the neon
// sign are rectangle lights, and a tube light floats down the street or follows the pointer. The
// wet street shows each light's whole shape and mirrors the street through screen-space
// reflections. Each light has a glowing mesh, and one tube flickers. Its scenery is in street.ts.
import { defineSketch, math, quat, type Vec3, vec3 } from '@null3d/engine';
import { interact } from '../lib/interact';
import { enableReflections } from '../lib/ssr';
import { street } from './street';

/** A quarter turn about Y, which turns a plane that faces +Z to face +X. */
const QUARTER_Y = [0, Math.SQRT1_2, 0, Math.SQRT1_2] as const;
/** The shop windows on the left wall, which face +X: their middle's z, and their color. */
const WINDOWS = [
	[-2, '#ffc98a'],
	[-12, '#e2ecff'],
] as const;
/** The neon sign's tubes, on the face of its board that looks up the street: two ends each, and
 * the color. */
const NEON: readonly [Vec3, Vec3, string][] = [
	[[2.55, 2.5, -7.86], [2.55, 4.3, -7.86], '#ff3fa4'],
	[[3.55, 2.5, -7.86], [3.55, 4.3, -7.86], '#ff3fa4'],
	[[2.7, 3.0, -7.86], [3.4, 3.0, -7.86], '#3fe0ff'],
	[[2.7, 3.8, -7.86], [3.4, 3.8, -7.86], '#3fe0ff'],
];
/** A capsule's axis before it turns. */
const UP: Vec3 = [0, 1, 0];
/** Each tube's radius, and each light's brightness in nits. */
const TUBE = 0.04;
const WINDOW_NITS = 6;
const NEON_NITS = 60;
/** The sign's light: real neon is far brighter than a screen shows its tubes, and a picture of thin
 * tubes gives out only their share of its area, so the light is brighter than their glow. */
const SIGN_NITS = NEON_NITS * 4;

export default defineSketch(async (ctx) => {
	const { scene, geometry, materials, textures, post, time } = ctx;
	const exposure = await street(ctx);
	enableReflections(ctx);
	post.set({ exposure, bloom: { intensity: 0.35, threshold: 1 }, vignette: {} });
	post.set({ ssr: { maxDistance: 60, thickness: 1, maxRoughness: 0.35 } });
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
	const strip = { width: 3, height: 0.25, range: 14, color: '#bcd8ff', intensity: 15 };
	const panel = glow(strip.color, strip.intensity);
	scene.createMesh({ mesh: geometry.plane(strip), material: panel, position: [0, 3.2, -19.78] });
	scene.createRectAreaLight({ ...strip, position: [0, 3.2, -19.77], direction: [0, -0.2, 1] });

	// The neon sign, on its board: a glowing capsule for each tube, and one rectangle light over the
	// board that shows a picture of the tubes and a faint pink glow around them, so the sign costs
	// one area light, not four.
	const picture = new Uint8Array(32 * 32 * 4).map((_, i) => [89, 22, 57, 255][i % 4] as number);
	const tubes = NEON.map(([a, b, color]) => {
		const rgb = [1, 3, 5].map((at) => Number.parseInt(color.slice(at, at + 2), 16));
		for (let t = 0; t <= 1; t += 1 / 64) {
			const x = Math.floor(((a[0] + (b[0] - a[0]) * t - 3.05) / 1.2) * 32 + 15.5);
			const y = Math.floor(((3.4 - a[1] - (b[1] - a[1]) * t) / 2) * 32 + 15.5);
			for (const i of [0, 1, 32, 33]) picture.set([...rgb, 255], ((y * 32 + x + i) % 1024) * 4);
		}
		const middle: Vec3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
		const along: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
		const length = Math.hypot(...along);
		const rotation = quat.rotationTo(quat.create(), UP, vec3.normalize(vec3.create(), along));
		const capsule = { mesh: geometry.capsule({ radius: TUBE, height: length }), rotation };
		return scene.createMesh({ ...capsule, material: glow(color, NEON_NITS), position: middle });
	});
	const sign = scene.createRectAreaLight({
		position: [3.05, 3.4, -7.84],
		direction: [0, 0, 1],
		width: 1.2,
		height: 2,
		range: 10,
		intensity: SIGN_NITS,
		image: { width: 32, height: 32, data: picture },
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
	const camera = scene.createPerspectiveCamera({ fov: 60, position: [0, 1.7, 7], target: look });
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
			// The second neon tube stutters now and then, as old neon does, and the sign dims with it.
			const stutter = Math.sin(time.now * 23) > 0.2 && Math.sin(time.now * 1.3) > 0.85;
			tubes[1].setVisible(!stutter);
			sign.setIntensity(stutter ? SIGN_NITS * 0.75 : SIGN_NITS);
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
