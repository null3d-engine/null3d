// Levels of detail: a mixed forest of 56,000 trees over rolling hills at golden hour, climbing to
// wooded ridges in the haze, in one static instance batch per kind of tree. Three firs and a
// broadleaf tree are made in code at four levels of detail each (./woods.ts), and each base mesh
// names its three coarser levels with their errors. Every tree then picks its own level in each
// frame, on the GPU or on the job workers: the coarsest whose error covers less than a pixel. Near
// a switch the two levels share the pixels through a dither, so no tree pops, and the shadows draw
// a coarser level still. An understory of bushes hides the ground between the trunks, in a batch of
// its own. On phones, the nearest 8,000 trees draw in full and the rest as cut-out cards. Press L to
// draw every tree at its full detail, and compare the stats.
import { defineSketch, timeOfDay } from '@null3d/engine';
import { interact } from '../lib/interact';
import {
	BUSH,
	bushRows,
	cardArrays,
	cardTexture,
	countRows,
	fillRows,
	ground,
	KINDS,
	landArrays,
	litterTexture,
	meshOf,
	plantRows,
	woodTexture,
} from './woods';

/** Trees in all, the trees that draw in full on Low, and the radius of the forest in meters. */
const TREES = 56_000;
const NEAR = 8000;
const RADIUS = 650;
/** Bushes of the understory, the bushes that draw on Low, and how far out they cover, in meters. */
const BUSHES = 30_000;
const BUSH_NEAR = 12_000;
const BUSH_RADIUS = 360;

export default defineSketch(async (ctx) => {
	const { scene, assets, geometry, materials, textures, post, quality, input, time } = ctx;
	// Golden hour: the sky lights the trees, and a thin amber haze lies over the far ridges.
	const day = timeOfDay('goldenHour', { heading: -2.2 });
	const sky = { intensity: day.skyIntensity };
	scene.setBackground({ sky: { ...day.sky, cloudCoverage: 0.25 } }, sky);
	scene.setEnvironment(await assets.skyEnvironment(), { intensity: day.skyIntensity * 0.8 });
	const haze = { color: [0.34, 0.26, 0.23], density: 0.0005, heightFalloff: 0.01 } as const;
	scene.setFog({ ...haze, sunGlow: day.fog.sunGlow * 0.5 });
	post.set({ exposure: day.exposure * 1.2, bloom: { intensity: 0.2, threshold: 1 }, vignette: {} });
	const camera = scene.createPerspectiveCamera({ fov: 50, near: 0.5, far: 6000 });
	scene.setActiveCamera(camera);
	const view = interact(ctx, camera, { target: [0, 10, 0], groundY: 0 });
	scene.createDirectionalLight({ ...day.light, castShadows: true, shadow: { distance: 160 } });
	scene.createAmbientLight(day.ambient);

	// Textures made in code: bark, needles and leaves for the trees, litter for the land, and a
	// cut-out picture of each kind of tree for the far cards.
	const look = { colorSpace: 'srgb', mipmaps: true, anisotropy: 8 } as const;
	const wood = textures.fromData({ ...woodTexture(), ...look, wrap: ['repeat', 'clamp'] });
	const litter = textures.fromData({ ...litterTexture(), ...look, wrap: 'repeat' });
	const pictures = textures.fromData({ ...cardTexture(KINDS), ...look });
	const land = materials.standard({ map: litter, vertexColors: true, roughness: 0.95 });
	scene.createMesh({
		mesh: geometry.fromArrays(landArrays(5500, RADIUS)),
		material: land,
		receiveShadows: true,
	});
	const bark = materials.standard({
		map: wood,
		roughness: 0.85,
		vertexColors: true,
		doubleSided: true,
	});
	const card = materials.standard({
		map: pictures,
		roughness: 0.9,
		alphaMode: 'mask',
		alphaCutoff: 0.4,
		doubleSided: true,
	});

	// One batch per kind of tree, whose base mesh names its coarser levels: each row picks its own
	// level in every frame. A second batch per kind holds the far rows as cards, for Low.
	const rows = plantRows(TREES, RADIUS);
	const { before, all } = countRows(rows, NEAR);
	const kinds = KINDS.map((kind, n) => {
		const count = all[n] as number;
		const near = before[n] as number;
		const trees = scene.createInstances(meshOf(geometry, kind), count, {
			material: bark,
			castShadows: true,
			receiveShadows: true,
			colors: true,
		});
		fillRows(trees, rows, n);
		const cards = scene.createInstances(
			geometry.fromArrays(cardArrays(kind, n, KINDS.length)),
			count - near,
			{
				material: card,
				colors: true,
			},
		);
		fillRows(cards, rows, n, near);
		return { trees, cards, count, near };
	});
	// The understory: broad bushes that cover the ground between the trunks, at their own levels.
	const undergrowth = scene.createInstances(meshOf(geometry, BUSH), BUSHES, {
		material: bark,
		castShadows: true,
		receiveShadows: true,
		colors: true,
	});
	fillRows(undergrowth, bushRows(BUSHES, BUSH_RADIUS), 0);
	const fit = () => {
		const low = quality.preset === 'low';
		for (const { trees, cards, count, near } of kinds) {
			trees.setActiveCount(low ? near : count);
			cards.setActiveCount(low ? count - near : 0);
		}
		undergrowth.setActiveCount(low ? BUSH_NEAR : BUSHES);
	};
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
			// A slow flight above the canopy, looking out over the forest toward the ridges.
			if (!view.userCamera) {
				const t = time.now * 0.03;
				const [x, z] = [Math.sin(t) * 120, Math.cos(t) * 120];
				camera.setPosition(x, ground(x, z) + 30, z);
				camera.lookAt(Math.sin(t + 0.6) * 260, 8, Math.cos(t + 0.6) * 260);
			}
			view.update(dt);
		},
	};
});
