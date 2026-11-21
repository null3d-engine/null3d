// The parts of the showcase scenes' Blender models (tools/samples/blender/), as a scene draws them.
// A part is a node of a loaded file with its mesh, its material, its place in the file and the
// textures that its material samples, which the wind material draws in the file's material's place.
// A scene stands each part as one instance batch over its copies.
import {
	type InstanceBatch,
	type Material,
	type MeshGeometry,
	type Prefab,
	type PrefabNode,
	type QuatLike,
	quat,
	type SketchContext,
	vec3,
} from '@null3d/engine';
import type { Sway } from './sway';

/** A part of a model: its mesh, its material, its place within its file and its textures. */
export type Part = PrefabNode & { readonly mesh: MeshGeometry; readonly material: Material };

/** The named parts of a loaded file. */
export function partsOf(prefab: Prefab): (name: string) => Part {
	return (name) => {
		const node = prefab.find(name);
		if (!node?.mesh || !node.material) throw new Error(`${prefab.url} has no part named ${name}`);
		return { ...node, mesh: node.mesh, material: node.material };
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
	return placedTurned(node, at, quat.fromEuler(quat.create(), 0, yaw, 0), size);
}

/**
 * Where a part lands when its model stands at a point, turned by the quaternion `turn` and scaled by
 * `size`, as `placed` does for a turn about y alone.
 */
export function placedTurned(
	node: PrefabNode,
	at: readonly [number, number, number],
	turn: QuatLike,
	size: number,
): Placement {
	const offset = vec3.transformQuat(vec3.create(), node.position, turn);
	return {
		position: [at[0] + offset[0] * size, at[1] + offset[1] * size, at[2] + offset[2] * size],
		rotation: [...quat.multiply(quat.create(), turn, node.rotation)] as Placement['rotation'],
		scale: [node.scale[0] * size, node.scale[1] * size, node.scale[2] * size],
	};
}

/**
 * A copy of a part's material that draws its colour and normal maps under a tint and a roughness of
 * its own, such as one that mutes a model's moss.
 */
export function tintedPart(
	materials: SketchContext['materials'],
	part: Part,
	tint: string,
	roughness: number,
): Material {
	return materials.standard({
		...(part.maps.map && { map: part.maps.map }),
		...(part.maps.normalMap && { normalMap: part.maps.normalMap }),
		color: tint,
		roughness,
	});
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
		...(part.maps.normalMap && { normalMap: part.maps.normalMap }),
		// The scripts pack the occlusion with the metalness and roughness, in one texture.
		...(part.maps.metalnessRoughnessMap && { ormMap: part.maps.metalnessRoughnessMap }),
		...(cutout && { cutout: true }),
		weight: 'uv1',
		...look,
	});
}
