// Levels of detail: a mixed forest of 56,000 trees over rolling hills at golden hour, climbing to
// wooded ridges in the haze. The nearest 8,000 draw as the vegetation add-on's plants, each in no
// more triangles than the preset allows for one tree, and the rest draw as cut-out cards. An
// understory of bushes hides the ground between the trunks, in a batch of its own with four levels.
// The add-on's plants pick their own level in each frame, and the levels share the pixels through a
// dither at a switch, so no tree pops. Press L to draw every tree at its nearest level, and compare
// the stats.
import { defineSketch, timeOfDay } from '@null3d/engine';
import { createWind } from '@null3d/wind';
import { interact } from '../lib/interact';
import { plantAddon } from './addon';
import { plantForest, RADIUS, TREES } from './planting';
import { createSway } from './sway';
import {
	cardTexture,
	ground,
	KINDS,
	landArrays,
	litterTexture,
	plantRows,
	woodTexture,
} from './woods';

/** The most triangles one near tree may draw at each preset. */
const TREE_TRIANGLES = { low: 400, medium: 700, high: 1100, ultra: 1500 } as const;

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

	// Textures made in code: bark, needles and leaves for the understory, litter for the land, and a
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
	// The forest's one wind field. The add-on's plants and the understory read it at their roots,
	// and the understory's offset fades out by the sway distance so the far bushes and their cached
	// shadow cascades stand still.
	const wind = createWind(ctx, { camera, box: 256 });
	const sway = createSway(ctx, { wood, wind });
	const bark = sway.material;
	const card = materials.standard({
		map: pictures,
		roughness: 0.9,
		alphaMode: 'mask',
		alphaCutoff: 0.4,
		doubleSided: true,
	});

	const rows = plantRows(TREES, RADIUS);
	const forest = plantForest(ctx, { bark, card, rows });
	// The near trees are grown to the preset's ceiling, so a preset change grows them again: the old
	// placement comes down before the new one stands, and a frame between the two draws none.
	let addon: Awaited<ReturnType<typeof plantAddon>> | undefined;
	const regrow = async (): Promise<void> => {
		const previous = addon;
		addon = undefined;
		previous?.destroy();
		addon = await plantAddon(ctx, {
			rows,
			wind: wind.field,
			maxTriangles: TREE_TRIANGLES[quality.preset],
		});
	};
	await regrow();
	quality.onChange(() => {
		forest.fit();
		void regrow().catch((error: unknown) => console.error(error));
	});
	// L draws every plant's nearest level, and the preset's threshold again on the next press.
	let threshold = quality.settings.lodThreshold;

	return {
		onUpdate(dt) {
			// The field's box follows the camera, so it steps before the trees read it.
			wind.update();
			addon?.setWindLayer(wind.field);
			sway.update();

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
