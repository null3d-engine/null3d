// One oak's leaf cards at a camera distance, framed so that the engine's level switch falls where
// the picture shows it. The page holds the camera still and takes the level threshold from the
// address, so the switch distance moves across the camera and nothing else in the frame changes.
// `morph=off` draws the leaves with the plain material, so the cards switch at once: the cards that
// the coarser level drops vanish and the kept ones grow. With the morph on, the cards move to those
// places over the last band before the switch.
import { defineSketch } from '@null3d/engine';
import {
	bakePlantAtlases,
	builtInSpecies,
	generatePlant,
	leafCellFor,
	plantMaterial,
} from '@null3d/vegetation';

const switches = new URL(import.meta.url).searchParams;
const morph = switches.get('morph') !== 'off';
const threshold = Number(switches.get('threshold') ?? 1);
const distance = Number(switches.get('distance') ?? 60);

const oak = builtInSpecies('oak');
if (!oak) throw new Error('the built-in set has no oak');

export default defineSketch((ctx) => {
	const { scene } = ctx;
	// The threshold picks the switch distance: the engine and the material read the same number, so
	// the cards reach their target places exactly where the engine hands the level over.
	ctx.quality.set({ lodThreshold: threshold });
	scene.setBackground('#9fc0dd');
	scene.createDirectionalLight({ direction: [-0.45, -1, -0.3], intensity: 3 });
	scene.createAmbientLight({ intensity: 0.5 });

	const asset = generatePlant(oak, { seed: 3, variant: 0 });
	// The sphere about the tree's origin that holds every leaf vertex, which the engine's culling
	// and the morph's distance both read.
	const crownRadius =
		Math.hypot(asset.crown.center[0], asset.crown.center[1], asset.crown.center[2]) +
		asset.crown.radius;
	const atlases = bakePlantAtlases(ctx);
	const material = plantMaterial(ctx, {
		atlases,
		part: 'leaves',
		cell: leafCellFor(oak),
		color: oak.color.leaf,
		...(morph ? { morph: { crownRadius, threshold } } : {}),
	});

	const leaves = asset.levels
		.map((level) => level.parts.find((part) => part.name === 'leaves'))
		.filter((part) => part !== undefined);
	if (leaves.length < 2) throw new Error('the oak has too few leaf levels for a switch');
	const meshes = leaves.map((part) => ctx.geometry.fromArrays(part.arrays));
	const base = meshes[0] as (typeof meshes)[number];
	// The generator measures each level's error, so the levels switch at once and the morph alone
	// covers the change. A dither would hide the switch that the picture is here to show.
	base.setLevels(
		meshes.slice(1).map((mesh, k) => ({
			mesh,
			error: asset.levels[k + 1]?.error as number,
		})),
		{ fade: false },
	);
	const tree = scene.createMesh({ mesh: base, material, position: [0, 0, 0] });
	tree.setBounds([0, 0, 0], crownRadius);

	const camera = scene.createPerspectiveCamera({
		fov: 50,
		near: 0.1,
		far: 400,
		position: [0, asset.crown.center[1], distance],
		target: [0, asset.crown.center[1], 0],
	});
	scene.setActiveCamera(camera);
	return {};
});
