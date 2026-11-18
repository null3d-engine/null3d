// Plants in wind: a grove at the edge of a meadow, swaying in the wind add-on's one field. Oaks,
// birches and firs, bushes and ferns are made in code (./planting.ts, ./crowns.ts, ./plants.ts), and
// each kind's material reads the field at every copy's root (../lib/sway.ts). The bend grows toward
// each plant's tips, so trunks stay firm while crowns and fronds move, and each kind bends as its
// stiffness lets it. The meadow's grass comes from the grass add-on and bends in the same air. The
// wind's bearing sweeps slowly and its strength rises and falls, so the grove lifts and settles as
// it does in a real breeze. The sliders set the strength and the bearing, and Hold stills the air.
import { defineSketch, timeOfDay } from '@null3d/engine';
import { createGrass } from '@null3d/grass';
import { createWind } from '@null3d/wind';
import { interact } from '../lib/interact';
import { createSway } from '../lib/sway';
import type { woodTexture } from '../lib/trees';
import { BIRCH_LEAF, leafAtlas, NEEDLES, OAK_LEAF } from './crowns';
import { applyWindControl, postWindHud, type WindControls } from './hud';
import { land, landArrays, plantStand } from './planting';
import { fernTexture, meadowTexture } from './plants';

/** Meters a second at the field's top, at the strongest of the sweep. */
const GUST = 7;
/** The distance from the camera out to which the plants sway, in meters. */
const SWAY_DISTANCE = 90;

export default defineSketch(async (ctx) => {
	const { scene, assets, geometry, materials, textures, post, time, page } = ctx;
	const day = timeOfDay(15.2, { heading: 0.5 });
	scene.setBackground({ sky: { ...day.sky, cloudCoverage: 0.2 } }, { intensity: day.skyIntensity });
	scene.setEnvironment(await assets.skyEnvironment(), { intensity: day.skyIntensity * 1.25 });
	scene.setFog({ ...day.fog, density: 0.0012, heightFalloff: 0.02 });
	post.set({
		exposure: day.exposure * 1.3,
		bloom: { intensity: 0.15, threshold: 1 },
		vignette: {},
	});
	const shadow = { distance: SWAY_DISTANCE };
	scene.createDirectionalLight({ ...day.light, castShadows: true, shadow });
	scene.createAmbientLight(day.ambient);

	const camera = scene.createPerspectiveCamera({ fov: 55, near: 0.1, far: 3000 });
	camera.setPosition(0, land(0, 26) + 2.4, 26);
	camera.lookAt(0, 4.6, -14);
	scene.setActiveCamera(camera);
	const view = interact(ctx, camera, { target: [0, 4.6, -14], groundY: 0 });

	// Textures made in code: for each kind of tree, bark below and a cut-out spray of leaves or
	// needles above; a fern's frond; and the meadow's ground.
	const look = { colorSpace: 'srgb', mipmaps: true, anisotropy: 8 } as const;
	const atlas = (data: ReturnType<typeof woodTexture>) =>
		textures.fromData({ ...data, ...look, wrap: ['repeat', 'clamp'] });
	const needles = atlas(leafAtlas('furrowed', NEEDLES, 7));
	const oakLeaves = atlas(leafAtlas('furrowed', OAK_LEAF, 3));
	const birchLeaves = atlas(leafAtlas('birch', BIRCH_LEAF, 5, 512));
	const frond = textures.fromData({ ...fernTexture(), ...look, wrap: 'clamp' });
	const meadow = textures.fromData({ ...meadowTexture(), ...look, wrap: 'repeat' });
	scene.createMesh({
		mesh: geometry.fromArrays(landArrays(1500)),
		material: materials.standard({ map: meadow, vertexColors: true, roughness: 0.95 }),
		receiveShadows: true,
	});

	// The wind: one field for the whole page. Each kind bends as its build lets it: an oak's trunk
	// is stiff and its crown moves, a birch is whippy, a fir barely gives, and a fern's frond bends
	// along its whole length. The leaves flutter on top of the bend.
	const wind = createWind(ctx, { camera, box: 160 });
	const sway = createSway(ctx, { wind, swayDistance: SWAY_DISTANCE });
	const leafy = { perSize: true, cutout: true } as const;
	const stand = plantStand(ctx, {
		oak: sway.material({ ...leafy, map: oakLeaves, sway: 0.01, stiffness: 2.2, rustle: 0.003 }),
		birch: sway.material({
			...leafy,
			map: birchLeaves,
			sway: 0.016,
			stiffness: 1.7,
			rustle: 0.004,
		}),
		fir: sway.material({ ...leafy, map: needles, sway: 0.006, stiffness: 2.4, rustle: 0.0015 }),
		bush: sway.material({ ...leafy, map: oakLeaves, sway: 0.02, stiffness: 1.5, rustle: 0.005 }),
		fern: sway.material({
			...leafy,
			map: frond,
			weight: 'uv1',
			sway: 0.03,
			stiffness: 1.4,
			rustle: 0.006,
		}),
	});
	// The meadow's grass bends in the same air. The grass add-on keeps its tufts on the GPU, and
	// keeps them clear of the trunks.
	const grass = await createGrass(ctx, {
		height: land,
		area: { x: 0, z: -4, size: 96 },
		count: 90_000,
		seed: 11,
		blades: 14,
		where: (x, z) => stand.trunks.every(([tx, tz]) => (x - tx) ** 2 + (z - tz) ** 2 > 1.5),
		wind: wind.field,
		camera,
		swayDistance: SWAY_DISTANCE,
	});

	// The wind's own state: its strength in meters a second, its bearing in degrees, and whether it
	// is held still. The panel posts these.
	const controls: WindControls = { power: GUST, bearing: 35, still: false };
	const postHud = () => postWindHud(page, controls);
	page.onMessage((name, value) => {
		const next = applyWindControl(controls, name, value);
		if (next === controls) return;
		Object.assign(controls, next);
		postHud();
	});

	let announced = false;
	return {
		onUpdate(dt) {
			view.update(dt);
			// The set bearing turns slowly and the set strength breathes, so the crowns lift and
			// settle rather than holding one lean. A held wind stands still.
			const sweep = (controls.bearing * Math.PI) / 180 + time.now * 0.13;
			const strength = controls.still
				? 0
				: controls.power * (0.45 + 0.55 * (0.5 + 0.5 * Math.sin(time.now * 0.7)));
			wind.setBase(strength, sweep);
			wind.update();
			sway.update();
			grass.setWindLayer(wind.field);
			if (!announced) {
				announced = true;
				postHud();
			}
		},
	};
});
