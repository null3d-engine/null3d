// The row of oak crowns that the coverage picture draws: one crown, grown once, drawn at three
// distances from one camera. The near tree shows the leaf cards at full detail, and the two further
// ones show the mip levels that the atlas's own shrink gives them, so the picture shows whether a
// distant crown keeps the density of a near one.
import type { SketchContext } from '@null3d/engine';
import {
	bakePlantAtlases,
	builtInSpecies,
	generatePlant,
	leafCellFor,
	plantMaterial,
} from '@null3d/vegetation';

/** The camera that frames the row: its place, the point that it looks at and its field of view. */
const CAMERA = {
	position: [0, 7, -26],
	target: [0, 6.2, 0],
	fov: 40,
} as const;

/** The three trees: their places along the ground. */
const TREES = [
	{ x: -8, z: -6 },
	{ x: 2, z: 20 },
	{ x: 26, z: 52 },
] as const;

/** The seed and the variant that grow the crown, so the picture and every run agree. */
const SEED = 12;
const VARIANT = 0;

/** The quaternion that lays a plane, which faces +Z, flat on the ground. */
const FLAT = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] as const;

/**
 * Grows the oak and draws it at each of `TREES`, with the atlases' materials.
 *
 * @param ctx The sketch's context.
 * @param ground True to draw the ground under the row.
 */
export function addCrownRow(ctx: SketchContext, ground: boolean): void {
	const { scene } = ctx;
	scene.setBackground('#9fc0dd');
	scene.createDirectionalLight({ direction: [-0.45, -1, -0.3], intensity: 2.8 });
	scene.createAmbientLight({ intensity: 0.45 });

	const species = builtInSpecies('oak');
	if (!species) throw new Error('the package has no oak');
	const asset = generatePlant(species, { seed: SEED, variant: VARIANT, levels: 1 });
	const atlases = bakePlantAtlases(ctx);
	const bark = plantMaterial(ctx, {
		atlases,
		part: 'wood',
		color: species.color.bark as [number, number, number],
	});
	const leaves = plantMaterial(ctx, {
		atlases,
		part: 'leaves',
		cell: leafCellFor(species),
		color: species.color.leaf as [number, number, number],
	});

	if (ground) {
		const groundMaterial = ctx.materials.standard({ color: '#4a5137', roughness: 1, metalness: 0 });
		scene.createMesh({
			mesh: ctx.geometry.plane({ width: 240, height: 240 }),
			material: groundMaterial,
			rotation: FLAT as unknown as [number, number, number, number],
		});
	}

	const parts = asset.levels[0]?.parts ?? [];
	for (const tree of TREES)
		for (const part of parts)
			scene.createMesh({
				mesh: ctx.geometry.fromArrays(part.arrays),
				material: part.name === 'wood' ? bark : leaves,
				position: [tree.x, 0, tree.z],
			});

	const camera = scene.createPerspectiveCamera({
		fov: CAMERA.fov,
		near: 0.1,
		far: 400,
		position: [CAMERA.position[0], CAMERA.position[1], CAMERA.position[2]],
		target: [CAMERA.target[0], CAMERA.target[1], CAMERA.target[2]],
	});
	scene.setActiveCamera(camera);
}
