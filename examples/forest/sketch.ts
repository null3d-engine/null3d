// Levels of detail: a pine forest of 40,000 trees over rolling hills at golden hour, and 8,000 on
// phones, in one static instance batch. Each pine is made in code at four levels of detail, from
// 6,400 triangles down to 40 (../lib/pines.ts), and the base mesh names the other three with their
// errors. Every tree then picks its own level in each frame, on the GPU or on the job workers: the
// coarsest whose error covers less than a pixel. Near a switch the two levels share the pixels
// through a dither, so no tree pops, and the shadows draw a coarser level still. Press L to draw
// every tree at its full detail, and compare the stats.
import { defineSketch, timeOfDay } from '@null3d/engine';
import { interact } from '../lib/interact';
import { ground, hills, pineWithLevels, plantPines } from '../lib/pines';

/** Trees at each preset, and the width of the disc that they stand in, in meters. */
const TREES = { low: 8000, medium: 40_000, high: 40_000, ultra: 40_000 } as const;
const SIDE = 1200;

export default defineSketch(async (ctx) => {
	const { scene, assets, geometry, materials, post, quality, input, time } = ctx;
	// Golden hour: the sky lights the trees, and an amber haze glows toward the low sun.
	const day = timeOfDay('goldenHour', { heading: -2.2 });
	const sky = { intensity: day.skyIntensity };
	scene.setBackground({ sky: { ...day.sky, cloudCoverage: 0.25 } }, sky);
	scene.setEnvironment(await assets.skyEnvironment(), { intensity: day.skyIntensity * 0.8 });
	const haze = { color: [0.42, 0.3, 0.26], density: 0.003, heightFalloff: 0.05 } as const;
	scene.setFog({ ...haze, sunGlow: day.fog.sunGlow });
	post.set({ exposure: day.exposure * 1.2, bloom: { intensity: 0.2, threshold: 1 }, vignette: {} });
	const camera = scene.createPerspectiveCamera({ fov: 50, near: 0.5, far: 3000 });
	scene.setActiveCamera(camera);
	const view = interact(ctx, camera, { target: [0, 10, 0], groundY: 0 });
	scene.createDirectionalLight({ ...day.light, castShadows: true, shadow: { distance: 160 } });
	scene.createAmbientLight(day.ambient);
	const lit = (roughness: number) =>
		materials.standard({ color: '#ffffff', roughness, vertexColors: true });
	const hill = hills(geometry, SIDE * 1.6);
	scene.createMesh({ mesh: hill, material: lit(0.95), receiveShadows: true });

	// One batch of the pine with levels: each row picks its own level in every frame.
	const forest = scene.createInstances(pineWithLevels(geometry), TREES.high, {
		material: lit(0.85),
		castShadows: true,
		receiveShadows: true,
	});
	plantPines(forest, TREES.high, SIDE);
	const fit = () => forest.setActiveCount(TREES[quality.preset]);
	fit();
	quality.onChange(fit);
	// L draws every tree's base level, and the preset's threshold again on the next press.
	let threshold = quality.settings.lodThreshold;

	return {
		onUpdate(dt) {
			if (input.wasPressed('KeyL')) {
				const levels = quality.settings.lodThreshold > 0;
				if (levels) threshold = quality.settings.lodThreshold;
				quality.set({ lodThreshold: levels ? 0 : threshold });
			}
			// A slow flight above the canopy, looking out over the forest toward the sun.
			if (!view.userCamera) {
				const t = time.now * 0.03;
				const [x, z] = [Math.sin(t) * 120, Math.cos(t) * 120];
				camera.setPosition(x, ground(x, z) + 26, z);
				camera.lookAt(Math.sin(t + 0.6) * 260, 8, Math.cos(t + 0.6) * 260);
			}
			view.update(dt);
		},
	};
});
