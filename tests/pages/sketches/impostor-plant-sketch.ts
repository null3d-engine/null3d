// A grown birch beside the card that `bakeFarTree` makes from it: the near mesh is the plant's
// level 0 with the bark and leaf materials, and the card is the same level baked into the two
// impostor atlases with the same bark and leaf atlases and the same colours. The two must show the
// same crown in the same colour, which proves the far-tree bake and the leaf coverage it reads.
import { defineSketch } from '@null3d/engine';
import { createImpostors } from '@null3d/impostors';
import {
	bakeFarTree,
	bakePlantAtlases,
	builtInSpecies,
	generatePlant,
	leafCellFor,
	plantMaterial,
} from '@null3d/vegetation';

/** The species that the picture grows. */
const SPECIES = builtInSpecies('birch');
if (!SPECIES) throw new Error('the birch species is missing');

export default defineSketch((ctx) => {
	const { scene, materials, geometry } = ctx;
	scene.setBackground('#20262f');
	scene.createDirectionalLight({ direction: [-0.6, -0.7, -0.45], intensity: 3.2 });
	scene.createAmbientLight({ intensity: 0.5 });
	const camera = scene.createPerspectiveCamera({
		fov: 42,
		position: [0, 9, 34],
		target: [0, 6.5, 0],
	});
	scene.setActiveCamera(camera);
	scene.createMesh({
		mesh: geometry.plane({ width: 60, height: 40 }),
		material: materials.standard({ color: '#3d4450', roughness: 0.95 }),
		rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
	});

	const atlases = bakePlantAtlases(ctx);
	const asset = generatePlant(SPECIES, { seed: 7, levels: 1 });
	const bark = plantMaterial(ctx, { atlases, part: 'wood', color: SPECIES.color.bark });
	const leaves = plantMaterial(ctx, {
		atlases,
		part: 'leaves',
		cell: leafCellFor(SPECIES),
		color: SPECIES.color.leaf,
	});
	const level = asset.levels[0];
	if (!level) throw new Error('the birch has no level 0');
	for (const part of level.parts)
		scene.createMesh({
			mesh: geometry.fromArrays(part.arrays),
			material: part.name === 'wood' ? bark : leaves,
			position: [-6, 0, 0],
		});

	// The bake draws the same level, with the same atlases and the same colours that the mesh's
	// materials multiply them by.
	const far = bakeFarTree(ctx, { asset, atlases, views: 16, texels: 64 });
	createImpostors(
		{ scene, materials, geometry },
		{
			color: far.color,
			surface: far.surface,
			atlas: far.atlas,
			positions: [6, far.base, 0],
			size: far.size,
			alphaMode: 'mask',
			roughness: 1,
			metalness: 0,
		},
	);
	return {};
});
