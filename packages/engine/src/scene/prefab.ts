// Prefabs: the templates that `assets.loadGltf` makes from glTF files, and the template nodes that
// `scene.instantiate` and `scene.clone` create objects from. A prefab holds plain data and the
// meshes, materials and textures that every copy shares, and the skeleton and clips that every copy
// animates with. The glTF loader, which loads on first use, is the only code that constructs one,
// so the scene imports this module for its types alone, and calls the prefab's methods.

import type { Vec3Like } from '../math/types';
import { type AnimationRig, animateObject, morphObject, skinObject } from './animation';
import type { CoreMemory } from './memory';
import type { Material, MeshGeometry } from './resources';
import type { Mesh, Object3D } from './scene';
import type { Texture } from './textures';

/** @internal A light that a template node creates: its kind and values in the light table. */
export interface LightTemplate {
	/** The core's light kind (`LIGHT_KIND_*`). */
	kind: number;
	/** The linear color. */
	color: readonly [number, number, number];
	/** The light's numbers, by their codes in the light table (`LIGHT_VALUE_*`). */
	values: readonly (readonly [number, number])[];
}

/** @internal One object that `scene.instantiate` or `scene.clone` creates. */
export interface TemplateNode {
	name: string;
	/** The node's parent among the nodes, which comes before it, or -1 for the copy's root. */
	parent: number;
	/** Position (3 numbers), rotation (4) and scale (3) relative to the parent. */
	transform: ArrayLike<number>;
	mesh?: MeshGeometry | undefined;
	material?: Material | undefined;
	/** The object's flags (`FLAG_*`). */
	flags: number;
	layers: number;
	renderOrder: number;
	/** The center and radius of the object's own bounds, which `FLAG_CUSTOM_BOUNDS` turns on. */
	bounds?: ArrayLike<number>;
	light?: LightTemplate;
	/** The object that this node copies, whose wrapper makes the copy's wrapper. */
	source?: Object3D;
	/** True for the group that holds a prefab's copy. */
	root?: boolean;
	/**
	 * True for a mesh that the copy's joints move: its vertices name the skeleton's joints, and it
	 * sits in the copy's group with no transform of its own.
	 */
	skinned?: boolean;
	/**
	 * For a mesh that one joint moves, the joint's place at rest in the copy's space: where an
	 * instance batch of the model draws it, and where it counts for the model's bounds.
	 */
	rest?: ArrayLike<number>;
	/** The weights of the mesh's morph targets, for a mesh that has any. */
	morph?: MorphTemplate;
}

/** @internal The morph weights of a template node's mesh. */
export interface MorphTemplate {
	/** The weight of each target when no clip moves it. */
	weights: readonly number[];
	/** The first joint of the model's skeleton that animates the weights, or -1 for none. */
	joint: number;
}

/** @internal One mesh of a model as a part of its instance batches. */
export interface PartTemplate {
	mesh: MeshGeometry;
	material: Material;
	/** The 3 × 4 matrix, by rows, that places the mesh in the model's space. */
	matrix: Float32Array;
}

/** @internal A node with instancing of its own: the batch that each copy of the model makes. */
export interface InstancingTemplate {
	/** The node's index among the template's nodes. */
	node: number;
	count: number;
	positions: Float32Array;
	rotations: Float32Array;
	scales: Float32Array;
	parts: readonly PartTemplate[];
}

/**
 * The bounds of a whole model, in the space of its copies' root: a box, and the sphere around the
 * box's center that holds it.
 *
 * @category api/assets
 */
export interface PrefabBounds {
	/** The box's lowest corner. */
	readonly min: readonly [number, number, number];
	/** The box's highest corner. */
	readonly max: readonly [number, number, number];
	/** The box's center. */
	readonly center: readonly [number, number, number];
	/** The radius of the sphere around the center that holds the box. */
	readonly radius: number;
}

/**
 * A node of a prefab: its name, its place relative to its parent, and the mesh and material it
 * draws, if any. `prefab.find` gives it. A mesh with several materials comes as one node per
 * material under its node.
 *
 * @category api/assets
 */
export interface PrefabNode {
	/** The node's name in the file. */
	readonly name: string;
	/** The position relative to the node's parent. */
	readonly position: readonly [number, number, number];
	/** The rotation relative to the node's parent, as a quaternion (x, y, z, w). */
	readonly rotation: readonly [number, number, number, number];
	/** The scale relative to the node's parent. */
	readonly scale: readonly [number, number, number];
	/** The node's mesh, which `scene.createMesh` and `scene.createInstances` take too. */
	readonly mesh: MeshGeometry | undefined;
	/** The node's material. */
	readonly material: Material | undefined;
}

/**
 * A model that `assets.loadGltf` loaded: a template whose meshes, materials and textures exist
 * once, on the GPU. Every copy shares them. `scene.instantiate` creates a copy of its objects.
 * `scene.createInstances` draws many copies with instance batches. A prefab does not change.
 *
 * @category api/assets
 */
export class Prefab {
	/** @internal */
	constructor(
		/** @internal */ readonly core: CoreMemory,
		/** The address the model was loaded from. */
		readonly url: string,
		/** @internal The objects of a copy: the copy's root first, then the file's nodes. */
		readonly template: readonly TemplateNode[],
		/** @internal The model's meshes as parts of instance batches. */
		readonly parts: readonly PartTemplate[],
		/** @internal The nodes with instancing of their own. */
		readonly instancing: readonly InstancingTemplate[],
		/** The bounds of the whole model, around the origin of its copies. */
		readonly bounds: PrefabBounds,
		/** The model's materials, in the file's order. */
		readonly materials: readonly Material[],
		/** The model's textures, in the order the file names their images. */
		readonly textures: readonly Texture[],
		/** @internal The skeleton and clips that every copy animates with, if the model has any. */
		readonly rig?: AnimationRig,
	) {}

	/** The names of the model's clips, which a copy's animator plays. */
	get clips(): readonly string[] {
		return this.rig ? [...this.rig.clips.keys()] : [];
	}

	/**
	 * @internal Gives a copy's group, the first of `objects`, the animator of the model's skeleton,
	 * and links the copy's skinned meshes, and the meshes whose morph weights clips animate, to it.
	 * `objects` holds one object per template node.
	 */
	animate(objects: readonly Object3D[]): void {
		const { rig } = this;
		if (!rig) return;
		const animator = animateObject(objects[0] as Object3D, rig);
		this.template.forEach((node, k) => {
			if (node.skinned) skinObject(objects[k] as Mesh, animator);
			if ((node.morph?.joint ?? -1) >= 0) morphObject(objects[k] as Mesh, animator);
		});
	}

	/** @internal The model's address, as error messages show it. */
	describe(): string {
		return `the model ${this.url}`;
	}

	/**
	 * The first node with `name`, in the file's order, or undefined when no node has it. The
	 * nodes of a copy have the same names, and its `find` gives them.
	 */
	find(name: string): PrefabNode | undefined {
		for (const node of this.template) {
			if (node.name !== name || node.root) continue;
			const t = node.transform;
			return {
				name,
				position: [t[0] as number, t[1] as number, t[2] as number],
				rotation: [t[3] as number, t[4] as number, t[5] as number, t[6] as number],
				scale: [t[7] as number, t[8] as number, t[9] as number],
				mesh: node.mesh,
				material: node.material,
			};
		}
		return undefined;
	}
}

/** @internal Bounds from the lowest and highest corners of a box. */
export function boundsOf(min: Vec3Like, max: Vec3Like): PrefabBounds {
	const lo = [min[0] as number, min[1] as number, min[2] as number] as const;
	const hi = [max[0] as number, max[1] as number, max[2] as number] as const;
	const center = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2] as const;
	const radius = Math.hypot(hi[0] - center[0], hi[1] - center[1], hi[2] - center[2]);
	return { min: lo, max: hi, center, radius };
}
