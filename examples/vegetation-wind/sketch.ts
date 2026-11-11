// Vegetation in wind: the add-on's plants under the wind add-on's field, close enough to see the
// crowns move. Every species the registry holds is planted in a clump, the wind's direction sweeps
// slowly, and its strength rises and falls, so the leaves lift and settle as they do in a real
// breeze. Press W to hold the wind still for comparison, and R to grow the clump again.
import { defineSketch, timeOfDay } from '@null3d/engine';
import {
	createGrass,
	grassCover,
	loadSpecies,
	type PlantMaterial,
	setWindLayer,
} from '@null3d/vegetation';
import { createWind } from '@null3d/wind';
import { interact } from '../lib/interact';
import { applyWindControl, postWindHud, type WindControls } from './hud';
import { plantWindClump } from './planting';

/** Metres a second at the field's top, at the strongest of the sweep. */
const GUST = 7;

export default defineSketch(async (ctx) => {
	const { scene, assets, post, input, time, page } = ctx;
	const day = timeOfDay('afternoon', { heading: 2.1 });
	scene.setBackground({ sky: day.sky }, { intensity: day.skyIntensity });
	scene.setEnvironment(await assets.skyEnvironment(), { intensity: day.skyIntensity * 0.8 });
	scene.setFog({ ...day.fog, density: 0.0005 });
	post.set({ exposure: day.exposure });
	scene.createDirectionalLight({ ...day.light, castShadows: true, shadow: { distance: 90 } });
	scene.createAmbientLight(day.ambient);

	scene.createMesh({
		mesh: ctx.geometry.plane({ width: 400, height: 400 }),
		material: ctx.materials.standard({ color: [0.3, 0.34, 0.16], roughness: 0.95 }),
		rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
		receiveShadows: true,
	});

	const camera = scene.createPerspectiveCamera({ fov: 50, near: 0.1, far: 400 });
	camera.setPosition(0, 12, 34);
	scene.setActiveCamera(camera);
	// The wind: one field for the whole page, read at each plant's root.
	const wind = createWind(ctx, { camera, box: 160 });
	// The meadow's grass, which bends in the same air as the plants. The cover takes the meadow
	// grass's own blade and colour, so a plant of that species stands in it without a seam.
	const meadow = await loadSpecies('meadow-grass');
	// The cover fills the ground that the camera sees, and each blade bends in the field's air.
	const grass = await createGrass(ctx, {
		height: () => 0,
		area: { x: 0, z: 0, size: 120 },
		count: 100_000,
		seed: 11,
		blades: 14,
		...grassCover(meadow.record),
		wind: wind.field,
	});
	// The wind's own state: its strength in metres a second, its bearing in degrees, and whether it
	// is held still. The controls post these, and the H key holds it too.
	const controls: WindControls = { power: GUST, bearing: 35, still: false };
	const postHud = () => postWindHud(page, controls);
	page.onMessage((name, value) => {
		const next = applyWindControl(controls, name, value);
		if (next === controls) return;
		Object.assign(controls, next);
		postHud();
	});
	const view = interact(ctx, camera, { target: [0, 6, 0], groundY: 1.7 });

	let planted: { destroy(): void }[] = [];
	/** Every plant material, so each frame gives the plants the field's newest air. */
	let plantMats: PlantMaterial[] = [];
	const seed = 11;
	const plant = async () => {
		for (const piece of planted) piece.destroy();
		const clump = await plantWindClump(ctx, wind.field, seed);
		planted = clump.planted;
		plantMats = clump.materials;
	};
	// The clump grows while the meadow draws, so a live start shows its first frame without waiting
	// for every species and the plants appear as each one finishes. A held picture waits for the
	// whole clump, so its frame shows the finished scene.
	if (ctx.engine.held) await plant();
	else plant().catch((error: unknown) => console.error(error));

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
			setWindLayer(plantMats, wind.field);
			grass.setWindLayer(wind.field);
			if (!announced) {
				announced = true;
				postHud();
			}
		},
	};
});
