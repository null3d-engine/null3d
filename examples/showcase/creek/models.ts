// The creek's organic models: three broadleaf trees, three plants for the banks and the cave mouth.
// A script builds them in Blender (tools/samples/blender/creek.py), and the asset tool optimizes
// them, so they load as a developer ships models: quantized meshes and KTX2 textures. They live in
// the sample-assets repository. Each tree has a wood part and a leaves part, and each plant and the
// cave is one part. Leaves are cards whose texture cuts their outline, with masked materials.
import {
	type Material,
	type MeshGeometry,
	type Prefab,
	type PrefabNode,
	quat,
	type SketchContext,
	vec3,
} from '@null3d/engine';
import { sampleUrl } from '../../lib/samples';

export const TREE_KINDS = ['oak', 'beech', 'birch'] as const;
export type TreeKind = (typeof TREE_KINDS)[number];
export const PLANT_KINDS = ['fern', 'hosta', 'shrub'] as const;
export type PlantKind = (typeof PLANT_KINDS)[number];

/** A part of a model: its mesh, its material, and its place within its file. */
export type Part = PrefabNode & { readonly mesh: MeshGeometry; readonly material: Material };

export interface Models {
	trees: Record<TreeKind, { wood: Part; leaves: Part }>;
	plants: Record<PlantKind, Part>;
	cave: Part;
}

function part(prefab: Prefab, name: string): Part {
	const node = prefab.find(name);
	if (!node?.mesh || !node.material) throw new Error(`${prefab.url} has no part named ${name}`);
	return node as Part;
}

/** Loads the three model files at once. */
export async function loadModels({ assets }: SketchContext): Promise<Models> {
	const [trees, plants, cave] = await Promise.all([
		assets.loadGltf(sampleUrl('sources/showcase/creek/trees.glb')),
		assets.loadGltf(sampleUrl('sources/showcase/creek/plants.glb')),
		assets.loadGltf(sampleUrl('sources/showcase/creek/cave.glb')),
	]);
	return {
		trees: Object.fromEntries(
			TREE_KINDS.map((kind) => [
				kind,
				{ wood: part(trees, `${kind}-wood`), leaves: part(trees, `${kind}-leaves`) },
			]),
		) as Models['trees'],
		plants: Object.fromEntries(
			PLANT_KINDS.map((kind) => [kind, part(plants, kind)]),
		) as Models['plants'],
		cave: part(cave, 'cave'),
	};
}

/** A part's position, rotation and scale. */
export interface Placement {
	position: [number, number, number];
	rotation: [number, number, number, number];
	scale: [number, number, number];
}

/**
 * Where a part lands when its model stands at a point, turned about y by `yaw` and scaled by
 * `size`. The part's own place in its file comes first: the asset tool's quantized meshes keep
 * their offset and scale there.
 */
export function placed(
	node: PrefabNode,
	at: readonly [number, number, number],
	yaw: number,
	size: number,
): Placement {
	const turn = quat.fromEuler(quat.create(), 0, yaw, 0);
	const offset = vec3.transformQuat(vec3.create(), node.position, turn);
	return {
		position: [at[0] + offset[0] * size, at[1] + offset[1] * size, at[2] + offset[2] * size],
		rotation: [...quat.multiply(quat.create(), turn, node.rotation)] as Placement['rotation'],
		scale: [node.scale[0] * size, node.scale[1] * size, node.scale[2] * size],
	};
}
