// Impostors and merged far geometry: a pine forest on rolling hills at golden hour, drawn three
// ways by distance. The nearest trees are level-of-detail meshes in one instance batch. The middle
// band is the same pine at its coarsest level, merged into one mesh per grid cell, so a whole cell
// draws in one call. The far band is one sprite batch of impostor cards, each showing the stored
// view nearest the camera from an octahedral atlas drawn in code. Press L to draw the far band as
// detail meshes instead, and compare the stats.
import { defineSketch, timeOfDay } from '@null3d/engine';
import { createImpostors, farCellGroups, mergeFarGeometry } from '@null3d/impostors';
import { interact } from '../lib/interact';
import {
	bands,
	CARD_EDGE,
	CELL,
	ground,
	hills,
	impostorAtlas,
	pineArrays,
	pineWithLevels,
	place,
	SIDE,
	type Tree,
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
	scene.createDirectionalLight({
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
	near.forEach((tree, k) => {
		pines.positions.set([tree.x, tree.y, tree.z], k * 3);
		pines.rotations.set([0, Math.sin(tree.turn / 2), 0, Math.cos(tree.turn / 2)], k * 4);
		pines.scales.fill(tree.scale, k * 3, k * 3 + 3);
	});
	pines.markDirty(0, near.length);

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

	// The far band: one sprite batch of cards, each showing the atlas cell nearest the camera.
	const picture = impostorAtlas(SUN);
	const atlas = textures.fromData({
		width: picture.width,
		height: picture.height,
		data: picture.data,
		colorSpace: 'srgb',
		wrap: 'clamp',
		mipmaps: false,
	});
	const cards = await createImpostors(scene, {
		texture: atlas,
		atlas: picture.atlas,
		positions: far.flatMap((tree) => [tree.x, tree.y, tree.z]),
		center: [0.5, 0],
		alphaMode: 'mask',
	});
	far.forEach((tree, k) => {
		cards.sprites.sizes.set([tree.scale * 0.9, tree.scale], k * 2);
	});
	cards.markDirty(0, far.length);
	const eye: [number, number, number] = [0, 0, 0];

	// L swaps the far band between the cards and a batch of detail meshes, for comparison.
	const detail = scene.createInstances(pineWithLevels(geometry), far.length, { material: wood });
	far.forEach((tree, k) => {
		detail.positions.set([tree.x, tree.y, tree.z], k * 3);
		detail.rotations.set([0, Math.sin(tree.turn / 2), 0, Math.cos(tree.turn / 2)], k * 4);
		detail.scales.fill(tree.scale, k * 3, k * 3 + 3);
	});
	detail.markDirty(0, far.length);
	detail.setActiveCount(0);
	let cardsOn = true;

	return {
		onUpdate(dt) {
			if (input.wasPressed('KeyL')) {
				cardsOn = !cardsOn;
				cards.sprites.setActiveCount(cardsOn ? far.length : 0);
				detail.setActiveCount(cardsOn ? 0 : far.length);
			}
			// A slow flight around the middle, looking out over the three bands.
			if (!view.userCamera) {
				const t = time.now * 0.05;
				const [x, z] = [Math.sin(t) * 60, Math.cos(t) * 60];
				camera.setPosition(x, ground(x, z) + 32, z);
				camera.lookAt(Math.sin(t + 0.7) * CARD_EDGE * 1.6, 6, Math.cos(t + 0.7) * CARD_EDGE * 1.6);
			}
			view.update(dt);
			// The camera has no parent, so its own position is its world position, and it is right
			// on the first frame. The world position would still hold the world's origin there,
			// because the engine reports the frame that last ran.
			camera.getPosition(eye);
			cards.update(eye);
		},
	};
});
