// One review tree in a fixed view: the whole tree against a plain background, a close-up of its
// crown, or the crown seen from below. The species, the variant and the seed come from the query,
// so a render run draws the same frame on every device.
import { defineSketch } from '@null3d/engine';
import {
	bakePlantAtlases,
	generatePlant,
	leafCellFor,
	plantMaterial,
	type Species,
} from '@null3d/vegetation';
import { REVIEW_TREES, reviewTree } from '../lib/tree-corpus';

const params = new URL(import.meta.url).searchParams;
const SPECIES: Species | undefined =
	reviewTree(params.get('species') ?? '') ?? REVIEW_TREES[Number(params.get('species') ?? 0)];
const VIEW = params.get('view') ?? 'whole';
const SEED = Number(params.get('seed') ?? 11);
const VARIANT = Number(params.get('variant') ?? 0);
/** How far the camera's field of view narrows the whole-tree frame. */
const WHOLE_FOV = 38;
/** How far the camera's field of view narrows a crown frame. */
const CROWN_FOV = 44;

/** The quaternion that lays a plane, which faces +Z, flat on the ground. */
const FLAT = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] as const;

/** A direction of unit length. */
function normalize(x: number, y: number, z: number): [number, number, number] {
	const length = Math.hypot(x, y, z) || 1;
	return [x / length, y / length, z / length];
}

export default defineSketch((ctx) => {
	if (!SPECIES) throw new Error(`the review has no ${params.get('species')} tree`);
	const { scene, geometry, materials } = ctx;
	scene.setBackground('#c8d2d9');
	scene.createDirectionalLight({
		direction: [-0.5, -1, -0.35],
		intensity: 3.1,
		castShadows: true,
		shadow: { distance: 40, contactDistance: 0.4 },
	});
	scene.createAmbientLight({ intensity: 0.5 });
	scene.createHemisphereLight({
		skyColor: '#cfe0ea',
		groundColor: '#7d7462',
		intensity: 1.3,
	});
	// A gentle light from below shows the underside of a crown in the view that looks up into it.
	scene.createDirectionalLight({ direction: [0.35, 1, 0.3], intensity: 0.8 });
	const ground = materials.standard({ color: '#8c8a80', roughness: 1, metalness: 0 });
	scene.createMesh({
		mesh: geometry.plane({ width: 400, height: 400 }),
		material: ground,
		rotation: FLAT as unknown as [number, number, number, number],
		receiveShadows: true,
	});

	const asset = generatePlant(SPECIES, { seed: SEED, variant: VARIANT });
	const atlases = bakePlantAtlases(ctx);
	const leaves = plantMaterial(ctx, {
		atlases,
		part: 'leaves',
		cell: leafCellFor(SPECIES),
		color: SPECIES.color.leaf as [number, number, number],
		transmission: SPECIES.color.transmission,
		alphaCutoff: SPECIES.leaf?.kind === 'needle' ? 0.28 : 0.35,
	});
	const bark = plantMaterial(ctx, {
		atlases,
		part: 'wood',
		color: SPECIES.color.bark as [number, number, number],
	});
	for (const part of asset.levels[0]?.parts ?? [])
		scene.createMesh({
			mesh: geometry.fromArrays(part.arrays),
			material: part.name === 'wood' ? bark : leaves,
			castShadows: true,
			receiveShadows: true,
		});

	const { min, max, center, radius, start } = asset.crown;
	const crownTop = Math.max(max[1], start + 0.1);
	const span = Math.max(max[0] - min[0], max[2] - min[2], 1);
	let position: [number, number, number];
	let target: [number, number, number];
	let fov: number;
	if (VIEW === 'crown') {
		// Stand off the crown's middle and look along its side, so the close-up fills the frame.
		target = [center[0], start + (crownTop - start) * 0.62, center[2]];
		fov = CROWN_FOV;
		const distance = Math.max(1.6, span * 0.46 + radius * 0.42);
		const direction = normalize(0.72, 0.16, 1);
		position = [
			target[0] + direction[0] * distance,
			target[1] + direction[1] * distance,
			target[2] + direction[2] * distance,
		];
	} else if (VIEW === 'below') {
		// Stand under the crown and look up into it, as a walker sees a broadleaf canopy.
		target = [center[0], start + (crownTop - start) * 0.55, center[2]];
		fov = CROWN_FOV;
		const reach = Math.max(1.6, span * 0.5);
		position = [target[0] + reach * 0.55, Math.max(0.7, start * 0.7), target[2] + reach * 0.55];
	} else {
		target = [center[0], min[1] + (max[1] - min[1]) * 0.48, center[2]];
		fov = WHOLE_FOV;
		const vertical = (fov * Math.PI) / 180;
		const distance =
			(Math.max(max[0] - min[0], (max[1] - min[1]) * 1.05) / 2 / Math.tan(vertical / 2)) * 1.18;
		const direction = normalize(0.62, 0.2, 1);
		position = [
			target[0] + direction[0] * distance,
			target[1] + direction[1] * distance,
			target[2] + direction[2] * distance,
		];
	}
	const camera = scene.createPerspectiveCamera({
		fov,
		near: 0.05,
		far: 800,
		position,
		target,
	});
	scene.setActiveCamera(camera);
	return {};
});
