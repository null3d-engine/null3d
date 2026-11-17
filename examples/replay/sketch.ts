// Deterministic simulation: an orb hunt in a walled court at dusk. The simulation in sim.ts owns the
// run, and the page part in page.ts steps it from the player's input, which the page takes itself:
// the engine starts with `input: false`. This sketch draws what the simulation computed and decides
// nothing. Each frame it takes the latest view that the page sent, places the camera between its two
// poses, and dims the orbs caught. Until a view arrives, as in the held frame, it draws the run's
// start, which the simulation computes from the same seed. The court in court.ts is the sketch's
// own scenery, and the orbs' slow pulse is drawing only.
import type { Vec3 } from '@null3d/engine';
import { defineSketch, quat, vec3 } from '@null3d/engine';
import { buildCourt } from './court';
import { ORBS, startRun } from './sim';
import { BEFORE, BETWEEN, CAUGHT, NOW, VIEW_NUMBERS } from './view';

/** A point toward the sun: just over the horizon, at the left edge of the first view. */
const SUN = [-0.8, 0.07, -0.6] as const;
const GOLD = '#ffc864';

export default defineSketch(async (ctx) => {
	const { scene, assets, geometry, materials, post, page, time } = ctx;
	scene.setBackground({ sky: { sunPosition: SUN, turbidity: 7, cloudCoverage: 0.5 } });
	scene.setEnvironment(await assets.builtinEnvironment('room'), { intensity: 0.12 });
	scene.setFog({ color: '#3d3242', density: 0.018, heightFalloff: 0.35, sunGlow: 1 });
	post.set({ bloom: { intensity: 0.35, threshold: 1 }, ao: { radius: 0.5 }, vignette: {} });
	const run = startRun();
	const [x, y, z] = run.position as [number, number, number];
	const camera = scene.createPerspectiveCamera({
		fov: 70,
		near: 0.05,
		far: 2e3,
		position: [x, y, z],
	});
	camera.setRotation(...(run.look as [number, number, number, number]));
	scene.setActiveCamera(camera);
	const sun = { direction: [-SUN[0], -SUN[1], -SUN[2]], color: '#ff9466', intensity: 1.1 } as const;
	scene.createDirectionalLight({ ...sun, castShadows: true, shadow: { distance: 30 } });
	scene.createAmbientLight({ color: '#7a86c0', intensity: 0.08 });

	buildCourt(ctx);

	// The orbs, where the simulation placed them. A caught orb goes dark.
	const lit = materials.standard({ color: '#000000', emissive: GOLD, emissiveIntensity: 14 });
	const spent = materials.standard({ color: '#3b3d46', metalness: 0.7, roughness: 0.35 });
	const ball = geometry.sphere({ radius: 0.2 });
	const orbs = Array.from({ length: ORBS }, (_, i) => {
		const position: Vec3 = [
			run.orbs[i * 3] ?? 0,
			run.orbs[i * 3 + 1] ?? 0,
			run.orbs[i * 3 + 2] ?? 0,
		];
		const mesh = scene.createMesh({ mesh: ball, material: lit, position, dynamic: true });
		const light = scene.createPointLight({ parent: mesh, color: GOLD, intensity: 30, range: 4 });
		return { mesh, light };
	});

	// The latest view that the page sent, which the sketch copies as it arrives.
	const view = new Float64Array(VIEW_NUMBERS);
	let viewed = false;
	page.onMessage((type, data) => {
		if (type !== 'view') return;
		view.set(data as Float64Array);
		viewed = true;
	});
	const [from, to, at] = [vec3.create(), vec3.create(), vec3.create()];
	const [before, now, turned] = [quat.create(), quat.create(), quat.create()];
	let shown = 0;
	return {
		onUpdate() {
			// Drawing only: each orb that is still lit swells and shrinks a little.
			for (let i = 0; i < ORBS; i++) {
				const pulse = 1 + 0.08 * Math.sin(time.now * 2.2 + i);
				orbs[i]?.mesh.setScale(pulse, pulse, pulse);
			}
			if (!viewed) return;
			const between = view[BETWEEN] as number;
			vec3.set(
				from,
				view[BEFORE] as number,
				view[BEFORE + 1] as number,
				view[BEFORE + 2] as number,
			);
			vec3.set(to, view[NOW] as number, view[NOW + 1] as number, view[NOW + 2] as number);
			vec3.lerp(at, from, to, between);
			const r = BEFORE + 3;
			const s = NOW + 3;
			quat.set(
				before,
				view[r] as number,
				view[r + 1] as number,
				view[r + 2] as number,
				view[r + 3] as number,
			);
			quat.set(
				now,
				view[s] as number,
				view[s + 1] as number,
				view[s + 2] as number,
				view[s + 3] as number,
			);
			quat.slerp(turned, before, now, between);
			camera.setPosition(at[0], at[1], at[2]);
			camera.setRotation(turned[0], turned[1], turned[2], turned[3]);
			const caught = view[CAUGHT] as number;
			if (caught === shown) return;
			for (let i = 0; i < ORBS; i++) {
				const gone = (caught & (1 << i)) !== 0;
				orbs[i]?.mesh.setMaterial(gone ? spent : lit);
				orbs[i]?.light.setIntensity(gone ? 0 : 30);
			}
			shown = caught;
		},
	};
});
