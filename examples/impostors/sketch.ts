// Impostors and merged far geometry: a pine forest on rolling hills at golden hour, drawn three
// ways by distance. The nearest trees are level-of-detail meshes in one instance batch. The middle
// band is the same pine at its coarsest level, merged into one mesh per grid cell, so a whole cell
// draws in one call. The far band is one batch of impostor cards, baked from the pine's own mesh,
// and the far trees hand over from their meshes to their cards through a shared distance band.
// Press L to draw the far band as detail meshes instead, and compare the stats.
import { defineSketch, timeOfDay } from '@null3d/engine';
import { createImpostors, farCellGroups, mergeFarGeometry } from '@null3d/impostors';
import { handOverToCards } from '@null3d/vegetation';
import { interact } from '../lib/interact';
import {
	bands,
	CARD_EDGE,
	CELL,
	fillTrees,
	fly,
	hills,
	impostorAtlases,
	pineArrays,
	pineWithLevels,
	place,
	SIDE,
	type Tree,
	turnSun,
} from './forest';

/** The sun's direction, from the sky to the ground: low, and to the left of the opening view. */
const SUN = [0.55, -0.32, 0.77] as const;

export default defineSketch(async (ctx) => {
	const { scene, assets, geometry, materials, textures, post, input, time } = ctx;
	const day = timeOfDay('goldenHour', { heading: 2.2 });
	scene.setBackground({ sky: { ...day.sky, cloudCoverage: 0.3 } }, { intensity: day.skyIntensity });
	scene.setEnvironment(await assets.skyEnvironment(), { intensity: day.skyIntensity * 0.7 });
	scene.setFog({ color: [0.36, 0.29, 0.24], density: 0.00045, heightFalloff: 0.01 });
	post.set({
		exposure: day.exposure * 1.15,
		bloom: { intensity: 0.18, threshold: 1 },
		vignette: {},
	});
	const camera = scene.createPerspectiveCamera({ fov: 52, near: 0.5, far: 4000 });
	scene.setActiveCamera(camera);
	const view = interact(ctx, camera, { target: [0, 10, 0], groundY: 0 });
	const sun = scene.createDirectionalLight({
		...day.light,
		direction: SUN,
		castShadows: true,
		shadow: { distance: 120 },
	});
	scene.createAmbientLight(day.ambient);

	const wood = materials.standard({ vertexColors: true, roughness: 0.9, doubleSided: true });
	scene.createMesh({
		mesh: hills(geometry, SIDE),
		material: materials.standard({ vertexColors: true, roughness: 0.95 }),
		receiveShadows: true,
	});
	const { near, middle, far } = bands();

	// The near band: one batch whose base mesh names its coarser levels, so each tree picks its
	// own level every frame.
	const pines = scene.createInstances(pineWithLevels(geometry), near.length, {
		material: wood,
		castShadows: true,
		receiveShadows: true,
	});
	fillTrees(pines, near);

	// The middle band: the coarsest level of the same pine, merged into one mesh per grid cell.
	const coarsest = pineArrays(3);
	const centers = middle.map((tree) => [tree.x, tree.y, tree.z] as const);
	for (const group of farCellGroups(centers, CELL)) {
		const parts = group.map((k) => ({ arrays: coarsest, transform: place(middle[k] as Tree) }));
		scene.createMesh({
			mesh: geometry.fromArrays({ ...mergeFarGeometry(parts), computeNormals: true }),
			material: wood,
		});
	}

	// The far band: one batch of cards. Each blends the three atlas views nearest the camera and is
	// lit by the sun that the scene has now, so the band follows a moving sun with the meshes.
	const picture = impostorAtlases();
	const atlas = textures.fromData({
		width: picture.color.width,
		height: picture.color.height,
		data: picture.color.data,
		colorSpace: 'srgb',
		wrap: 'clamp',
		mipmaps: false,
	});
	const surface = textures.fromData({
		width: picture.surface.width,
		height: picture.surface.height,
		data: picture.surface.data,
		colorSpace: 'linear',
		wrap: 'clamp',
		mipmaps: false,
	});
	const cards = createImpostors(
		{ scene, materials, geometry },
		{
			color: atlas,
			surface,
			atlas: picture.atlas,
			positions: far.flatMap((tree) => [tree.x, tree.y, tree.z]),
			turn: far.map((tree) => tree.turn),
			alphaMode: 'mask',
		},
	);
	for (const [k, tree] of far.entries())
		cards.batch.scales.set([tree.scale * picture.size[0], tree.scale * picture.size[1], 1], k * 3);
	cards.markDirty(0, far.length);

	// L swaps the far band between the cards and a batch of detail meshes, for comparison.
	const detail = scene.createInstances(pineWithLevels(geometry), far.length, { material: wood });
	fillTrees(detail, far);
	// The hand-over: the meshes draw the far trees up to the switch, and the cards draw them from
	// just before it, so the fade of each edge hides the swap.
	const SWITCH = CARD_EDGE + 60;
	handOverToCards(detail, cards.batch, SWITCH);
	let cardsOn = true;
	// T sweeps the sun across the sky, so the cards' light follows the meshes' light: the bake holds
	// no sun at all.
	let sweeping = false;
	let hour = 0.35;

	return {
		onUpdate(dt) {
			if (input.wasPressed('KeyT')) sweeping = !sweeping;
			if (sweeping) {
				hour = (hour + dt * 0.03) % 1;
				turnSun(sun, hour);
			}
			if (input.wasPressed('KeyL')) {
				cardsOn = !cardsOn;
				if (cardsOn) {
					cards.batch.setActiveCount(far.length);
					handOverToCards(detail, cards.batch, SWITCH);
				} else {
					// Every far tree draws as its mesh, past the switch too.
					cards.batch.setActiveCount(0);
					detail.setDrawRange(0, 1e9);
				}
			}
			if (!view.userCamera) fly(camera, time.now);
			view.update(dt);
		},
	};
});
