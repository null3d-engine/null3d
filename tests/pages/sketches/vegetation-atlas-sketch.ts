// The four maps that the GPU paints for the bark and the leaf atlases, and the materials that draw
// from them: the colour and surface maps of each atlas in the upper row, and in the lower row a
// trunk and a leaf card that sample them. Each map shows its level 0 block at the lower left and
// the levels below it down the right-hand column.
import { defineSketch } from '@null3d/engine';
import { bakePlantAtlases, plantMaterial } from '@null3d/vegetation';
import { PLANT_CARD } from '../lib/plant-card';

export default defineSketch((ctx) => {
	const { scene } = ctx;
	scene.setBackground('#26282c');
	scene.createDirectionalLight({ direction: [-0.4, -1, -0.35], intensity: 3 });
	scene.createAmbientLight({ intensity: 0.5 });

	const atlases = bakePlantAtlases(ctx);
	// Each map fills a plane of its own size, so the level 0 block keeps its shape.
	const maps = [
		{ atlas: atlases.bark, map: atlases.bark.color },
		{ atlas: atlases.bark, map: atlases.bark.surface },
		{ atlas: atlases.leaf, map: atlases.leaf.color },
		{ atlas: atlases.leaf, map: atlases.leaf.surface },
	] as const;

	for (const [index, entry] of maps.entries()) {
		const { width, height } = entry.map;
		const scale = 5 / width;
		const material = ctx.materials.unlit({
			map: entry.map.texture,
			// The leaf's own alpha is its coverage, so the plane cuts the leaf shapes out of it.
			alphaMode: entry.map === atlases.leaf.color ? 'mask' : 'opaque',
			alphaCutoff: 0.35,
		});
		scene.createMesh({
			mesh: ctx.geometry.plane({ width, height }),
			material,
			position: [(index - 1.5) * 5.0, 3.4, 0],
			scale: [scale, scale, 1],
		});
	}

	// Below them, the two materials that a plant draws with: a trunk's bark and a crown's leaves.
	const bark = plantMaterial(ctx, { atlases, part: 'wood', color: [0.2, 0.15, 0.1] });
	const leaves = plantMaterial(ctx, {
		atlases,
		part: 'leaves',
		cell: 'cluster-a',
		color: [0.13, 0.28, 0.07],
	});
	const card = ctx.geometry.fromArrays(PLANT_CARD);
	const scale = [4, 4, 1] as [number, number, number];
	scene.createMesh({ mesh: card, material: bark, position: [-2.4, -2.4, 0.6], scale });
	scene.createMesh({ mesh: card, material: leaves, position: [2.4, -2.4, 0.6], scale });

	const camera = scene.createPerspectiveCamera({
		fov: 40,
		near: 0.1,
		far: 200,
		position: [0, 0.6, 20],
		target: [0, 0.6, 0],
	});
	scene.setActiveCamera(camera);
	return {};
});
