// The parts of the showcase scenes' Blender models (tools/samples/blender/), as a scene draws them.
// A part is a node of a loaded file with its mesh, its material, its place in the file and the
// textures that its material samples, which the wind material takes in the file's material's place.
// A scene stands each part as one instance batch over its copies.
import {
	type InstanceBatch,
	type Material,
	type MeshGeometry,
	type Prefab,
	type PrefabNode,
	quat,
	type SketchContext,
	type Texture,
	vec3,
} from '@null3d/engine';
import type { ModelFile } from './model-files';
import type { Sway } from './sway';

/** The textures that a material of the scripts samples, by the slot each fills. */
export interface Maps {
	/** The base color, with the cutout's alpha for a card. */
	readonly map?: Texture;
	/** Occlusion, roughness and metalness in red, green and blue. */
	readonly orm?: Texture;
	readonly normal?: Texture;
}

/** A part of a model: its mesh, its material, its place within its file and its textures. */
export type Part = PrefabNode & {
	readonly mesh: MeshGeometry;
	readonly material: Material;
	readonly maps: Maps;
};

/**
 * The textures of each part of a loaded file, by the part's name. The loader makes a file's
 * textures in the order that its materials first sample them: each material's base color, then its
 * metal and roughness texture, then its normal map, and an occlusion texture that is the metal and
 * roughness texture's own image makes none. `file` lists each material's slots and parts in the
 * file's order. A part's material is a variant of the file's own, made for its mesh, so the parts'
 * names, not the materials, find each part's textures.
 */
function mapsOf(prefab: Prefab, file: ModelFile): Map<string, Maps> {
	const out = new Map<string, Maps>();
	let next = 0;
	for (const material of file.materials) {
		const maps: Record<string, Texture | undefined> = {};
		for (const slot of material.slots) maps[slot] = prefab.textures[next++];
		for (const part of material.parts) out.set(part, maps);
	}
	if (next !== prefab.textures.length)
		throw new Error(
			`${prefab.url} has ${prefab.textures.length} textures, and its materials name ${next}`,
		);
	return out;
}

/** The named parts of a loaded file, with the textures that `file` gives their materials. */
export function partsOf(prefab: Prefab, file: ModelFile): (name: string) => Part {
	const maps = mapsOf(prefab, file);
	return (name) => {
		const node = prefab.find(name);
		const textures = maps.get(name);
		if (!node?.mesh || !node.material || !textures)
			throw new Error(`${prefab.url} has no part named ${name}`);
		return { ...node, mesh: node.mesh, material: node.material, maps: textures };
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

/** Where one copy of a model stands: its foot, its turn about y and its size. */
export interface Stand {
	readonly x: number;
	readonly y: number;
	readonly z: number;
	readonly yaw: number;
	readonly size: number;
}

/**
 * One instance batch of a part over the copies that stand it, each copy at its own place, turn and
 * size, so every copy picks its own level of detail.
 */
export function standPart(
	{ scene }: SketchContext,
	part: Part,
	stands: readonly Stand[],
	material: Material,
): InstanceBatch {
	const batch = scene.createInstances(part.mesh, stands.length, {
		material,
		castShadows: true,
		receiveShadows: true,
	});
	stands.forEach((stand, row) => {
		const { position, rotation, scale } = placed(
			part,
			[stand.x, stand.y, stand.z],
			stand.yaw,
			stand.size,
		);
		batch.positions.set(position, row * 3);
		batch.rotations.set(rotation, row * 4);
		batch.scales.set(scale, row * 3);
	});
	batch.markDirty();
	return batch;
}

/** How a part sways: its bend per meter a second of wind, its stiffness and its leaves' flutter. */
export interface SwayLook {
	readonly sway: number;
	readonly stiffness: number;
	readonly rustle: number;
	readonly roughness?: number;
}

/**
 * The wind material of a part, which draws the part's own textures and bends it by the weight in its
 * second texture coordinates. A cutout part draws its texture's alpha as a masked, two-sided card.
 */
export function swayingPart(sway: Sway, part: Part, look: SwayLook, cutout: boolean): Material {
	return sway.material({
		...(part.maps.map && { map: part.maps.map }),
		...(part.maps.normal && { normalMap: part.maps.normal }),
		...(part.maps.orm && { ormMap: part.maps.orm }),
		...(cutout && { cutout: true }),
		weight: 'uv1',
		...look,
	});
}
