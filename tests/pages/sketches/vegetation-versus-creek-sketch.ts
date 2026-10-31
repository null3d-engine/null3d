// Creek's painted bark and leaves beside the generated ones, for judging the atlases. On the left,
// the oak that the showcase loads from a file, with the textures that an artist painted. On the
// right, the same species grown by the add-on and drawn from the atlases that the GPU paints at
// first use. The camera frames both, close enough that the bark's plates and the leaf cards' veins
// show.
import { defineSketch } from '@null3d/engine';
import {
	bakePlantAtlases,
	builtInSpecies,
	generatePlant,
	leafCellFor,
	plantMaterial,
} from '@null3d/vegetation';

/** The address of a sample file on the dev server. */
const sampleUrl = (path: string) => `/samples/${path}`;
/** The quaternion that stands a plane, which faces +Z, upright facing the camera. */
const FLAT = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] as const;

export default defineSketch(async (ctx) => {
	const { scene, assets } = ctx;
	scene.setBackground('#9fc0dd');
	// Both trees cast shadows with a short contact reach, so the trunk's base meets the ground on
	// either side of the comparison.
	scene.createDirectionalLight({
		direction: [-0.45, -1, -0.3],
		intensity: 2.8,
		castShadows: true,
		shadow: { distance: 40, contactDistance: 0.3 },
	});
	scene.createAmbientLight({ intensity: 0.45 });
	const ground = ctx.materials.standard({ color: '#4a5137', roughness: 1, metalness: 0 });
	scene.createMesh({
		mesh: ctx.geometry.plane({ width: 120, height: 120 }),
		material: ground,
		rotation: FLAT as unknown as [number, number, number, number],
	});

	// The painted oak: the file that Creek loads, with its own wood and leaf parts.
	const trees = await assets.loadGltf(sampleUrl('sources/showcase/creek/trees.glb'));
	for (const name of ['oak-wood', 'oak-leaves']) {
		const node = trees.find(name);
		if (!node?.mesh || !node.material) throw new Error(`the file has no part named ${name}`);
		// The file's own place, rotation and scale stand the part where Creek draws it, and the row
		// stands the painted tree to the left of the generated one.
		scene.createMesh({
			mesh: node.mesh,
			material: node.material,
			position: [-6 + node.position[0], node.position[1], node.position[2]],
			rotation: node.rotation,
			scale: node.scale,
			castShadows: true,
			receiveShadows: true,
		});
	}

	// The generated oak: the same species from the add-on, drawn from the atlases.
	const species = builtInSpecies('oak');
	if (!species) throw new Error('the package has no oak');
	const asset = generatePlant(species, { seed: 12, variant: 0, levels: 1 });
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
	for (const part of asset.levels[0]?.parts ?? [])
		scene.createMesh({
			mesh: ctx.geometry.fromArrays(part.arrays),
			material: part.name === 'wood' ? bark : leaves,
			position: [6, 0, 0],
			castShadows: true,
			receiveShadows: true,
		});

	const camera = scene.createPerspectiveCamera({
		fov: 40,
		near: 0.05,
		far: 400,
		position: [0, 6, 26],
		target: [0, 5.5, 0],
	});
	scene.setActiveCamera(camera);
	return {};
});
