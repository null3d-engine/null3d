// Meshes and materials, created through `ctx.geometry` and `ctx.materials`. Each is created once
// and shared by any number of objects and instance batches.

import { DEV } from '../errors/checks';
import { EngineError } from '../errors/engine-error';
import {
	MAP_SLOT_BASE_COLOR,
	MAP_SLOT_EMISSIVE,
	MAP_SLOT_LIGHT,
	MAP_SLOT_METAL_ROUGH,
	MAP_SLOT_NORMAL,
	MAP_SLOT_OCCLUSION,
	MAP_SLOT_SPECULAR_COLOR,
	MAP_SLOT_SPECULAR_INTENSITY,
	MATERIAL_FEATURE_ADDITIVE,
	MATERIAL_FEATURE_ALPHA_HASH,
	MATERIAL_FEATURE_ALPHA_MASK,
	MATERIAL_FEATURE_ALPHA_TO_COVERAGE,
	MATERIAL_FEATURE_BLEND,
	MATERIAL_FEATURE_DOUBLE_SIDED,
	MATERIAL_FEATURE_FLAT_SHADING,
	MATERIAL_FEATURE_MULTIPLY,
	MATERIAL_FEATURE_NO_DEPTH_TEST,
	MATERIAL_FEATURE_NO_DEPTH_WRITE,
	MATERIAL_FEATURE_NO_FOG,
	MATERIAL_FEATURE_SINGLE_PASS,
	MATERIAL_FEATURE_VERTEX_COLORS,
	MATERIAL_PARAM_ALPHA_CUTOFF,
	MATERIAL_PARAM_COLOR,
	MATERIAL_PARAM_EMISSIVE,
	MATERIAL_PARAM_EMISSIVE_INTENSITY,
	MATERIAL_PARAM_ENV_INTENSITY,
	MATERIAL_PARAM_LIGHT_MAP_INTENSITY,
	MATERIAL_PARAM_METALNESS,
	MATERIAL_PARAM_NORMAL_SCALE,
	MATERIAL_PARAM_OCCLUSION_STRENGTH,
	MATERIAL_PARAM_OPACITY,
	MATERIAL_PARAM_REFLECTANCE,
	MATERIAL_PARAM_ROUGHNESS,
	MATERIAL_PARAM_SPECULAR_COLOR,
	MATERIAL_PARAM_SPECULAR_INTENSITY,
	MATERIAL_PARAM_UV_U,
	MATERIAL_PARAM_UV_V,
	SHADING_CUSTOM_ATTRIBUTE_SHIFT,
	SHADING_CUSTOM_BASE_COLOR,
	SHADING_CUSTOM_TEXTURE_SHIFT,
	SHADING_LIT,
	SHADING_TEXCOORDS,
	SHADING_UNLIT,
	SHADING_UNLIT_MAP,
	SHAPE_BOX,
	SHAPE_CAPSULE,
	SHAPE_CIRCLE,
	SHAPE_CYLINDER,
	SHAPE_PLANE,
	SHAPE_RING,
	SHAPE_SPHERE,
	SHAPE_TORUS,
} from '../generated/core';
import type { ShaderVariants } from '../generated/shaders';
import type { CustomShader } from '../shared/images';
import type { WgslUpdate } from '../shared/wgsl-updates';
import { type ColorInput, linearColor } from './color';
import type { CoreMemory } from './memory';
import { arraysProblem, meshFromArrays, morphTargetCount } from './mesh-arrays';
import { ShaderPreloads } from './shader-preloads';
import { ShaderTemplates } from './shader-templates';
import { Texture } from './textures';
import type { TextureValues, UniformType, UniformValue, UniformValues } from './wgsl-uniforms';

/**
 * @internal What a destroy asks before it frees anything: a description of the first live object
 * or instance batch that uses one of `meshes` or `materials`, or that `rig` animates, or undefined
 * when none does. The scene answers.
 */
export interface ResourceUsers {
	userOf(
		meshes: ReadonlySet<MeshGeometry>,
		materials?: ReadonlySet<Material>,
		rig?: object,
	): string | undefined;
}

/**
 * A mesh the engine can draw: its id in the engine core, its bounding radius, and its morph
 * targets.
 *
 * @category api/geometry
 */
export class MeshGeometry {
	/** The engine core's id, or 0 once the mesh is destroyed. */
	private liveId: number;

	/** @internal */
	constructor(
		id: number,
		/** The distance from the mesh's origin to its farthest vertex, at rest. */
		readonly radius: number,
		/** @internal */ readonly core: CoreMemory,
		/** How many morph targets the mesh has. 0 for a mesh without any. */
		readonly morphTargets = 0,
		/**
		 * The morph targets' names, by target, or none when the mesh's arrays named none. Like
		 * three.js's `morphTargetDictionary`, turned around. `mesh.setMorphWeight` takes a name too.
		 */
		readonly morphTargetNames: readonly string[] = [],
		/** The geometry that made the mesh, whose scene says which objects use it. */
		private readonly maker?: Geometry,
	) {
		this.liveId = id;
	}

	/** @internal The engine core's id. Throws E1101 once the mesh is destroyed. */
	get id(): number {
		if (this.liveId === 0)
			throw new EngineError('E1101', 'a call used a mesh after its destroy().');
		return this.liveId;
	}

	/** @internal True until `destroy` runs. */
	get live(): boolean {
		return this.liveId !== 0;
	}

	/**
	 * Destroys the mesh, like three.js's `geometry.dispose()`. The engine frees its GPU memory and
	 * its other data at once, and later meshes take its room. Destroy the objects and instance
	 * batches that use it first, in the same frame or before. Throws E1111 while one
	 * still uses it, and E1101 for a mesh that is destroyed already. Later calls that pass the mesh
	 * throw E1101.
	 */
	destroy(): void {
		const call = 'mesh.destroy';
		const user = this.maker?.users?.userOf(new Set([this]));
		if (user)
			throw new EngineError(
				'E1111',
				`${call}() was called on a mesh that ${user} still uses. Destroy the objects and instance batches that use it first.`,
			);
		destroyMeshes(this.core, [this], call);
	}

	/** @internal Marks the mesh destroyed, once the engine core freed it. */
	ended(): void {
		this.liveId = 0;
	}
}

/**
 * @internal Frees live meshes in the engine core in one pass, which no object or batch uses any
 * more, and marks them destroyed. The meshes that stay move once for all of them.
 */
export function destroyMeshes(
	core: CoreMemory,
	meshes: readonly MeshGeometry[],
	call: string,
): void {
	if (meshes.length === 0) return;
	const ids = meshes.map((mesh) => mesh.id);
	const at = core.checkGrowth(core.glue.meshArrays(ids.length), call);
	core.u32(at, ids.length).set(ids);
	core.check(core.glue.destroyMeshes(meshes.length), call, 'a mesh', true);
	for (const mesh of meshes) mesh.ended();
}

/**
 * Options for `geometry.box`. The box is centered on its origin. Segment counts are whole numbers
 * of at least 1.
 *
 * @category api/geometry
 */
export interface BoxOptions {
	/** The size along the X axis. The default is 1. */
	width?: number;
	/** The size along the Y axis. The default is 1. */
	height?: number;
	/** The size along the Z axis. The default is 1. */
	depth?: number;
	/** How many faces divide each side along the width. The default is 1. */
	widthSegments?: number;
	/** How many faces divide each side along the height. The default is 1. */
	heightSegments?: number;
	/** How many faces divide each side along the depth. The default is 1. */
	depthSegments?: number;
}

/**
 * Options for `geometry.sphere`. The sphere is centered on its origin, with its poles on the Y
 * axis. Angles are in radians.
 *
 * @category api/geometry
 */
export interface SphereOptions {
	/** The radius. The default is 1. */
	radius?: number;
	/** How many faces go around the Y axis. The default is 32, and the least is 3. */
	widthSegments?: number;
	/** How many faces go from pole to pole. The default is 16, and the least is 2. */
	heightSegments?: number;
	/** Where the sphere starts around the Y axis, from the -X axis. The default is 0. */
	phiStart?: number;
	/** How far the sphere goes around the Y axis. The default is `Math.PI * 2`, all the way. */
	phiLength?: number;
	/** Where the sphere starts, down from the top pole. The default is 0. */
	thetaStart?: number;
	/** How far the sphere goes down from `thetaStart`. The default is `Math.PI`, to the bottom pole. */
	thetaLength?: number;
}

/**
 * Options for `geometry.plane`. The plane lies in the XY plane, centered on its origin, and faces
 * +Z. Segment counts are whole numbers of at least 1.
 *
 * @category api/geometry
 */
export interface PlaneOptions {
	/** The size along the X axis. The default is 1. */
	width?: number;
	/** The size along the Y axis. The default is 1. */
	height?: number;
	/** How many faces divide the width. The default is 1. */
	widthSegments?: number;
	/** How many faces divide the height. The default is 1. */
	heightSegments?: number;
}

/**
 * Options for `geometry.cylinder`. The cylinder stands on the Y axis, centered on its origin.
 * Angles are in radians, and segment counts are whole numbers of at least 1.
 *
 * @category api/geometry
 */
export interface CylinderOptions {
	/** The radius of the top. The default is 1. With 0, the top is a point. */
	radiusTop?: number;
	/** The radius of the bottom. The default is 1. With 0, the bottom is a point. */
	radiusBottom?: number;
	/** The height. The default is 1. */
	height?: number;
	/** How many faces go around the cylinder. The default is 32. */
	radialSegments?: number;
	/** How many rows of faces go up the side. The default is 1. */
	heightSegments?: number;
	/** Leaves out the top and the bottom, so the cylinder is a tube. The default is false. */
	openEnded?: boolean;
	/** Where the side starts around the Y axis, from the +Z axis. The default is 0. */
	thetaStart?: number;
	/** How far the side goes around the Y axis. The default is `Math.PI * 2`, all the way. */
	thetaLength?: number;
}

/**
 * Options for `geometry.cone`. The cone stands on the Y axis, centered on its origin, with its
 * point at the top. Angles are in radians, and segment counts are whole numbers of at least 1.
 *
 * @category api/geometry
 */
export interface ConeOptions {
	/** The radius of the bottom. The default is 1. */
	radius?: number;
	/** The height. The default is 1. */
	height?: number;
	/** How many faces go around the cone. The default is 32. */
	radialSegments?: number;
	/** How many rows of faces go up the side. The default is 1. */
	heightSegments?: number;
	/** Leaves out the bottom. The default is false. */
	openEnded?: boolean;
	/** Where the side starts around the Y axis, from the +Z axis. The default is 0. */
	thetaStart?: number;
	/** How far the side goes around the Y axis. The default is `Math.PI * 2`, all the way. */
	thetaLength?: number;
}

/**
 * Options for `geometry.torus`. The torus is centered on its origin, around the Z axis. Angles are
 * in radians, and segment counts are whole numbers of at least 1.
 *
 * @category api/geometry
 */
export interface TorusOptions {
	/** The distance from the center of the torus to the center of its tube. The default is 1. */
	radius?: number;
	/** The radius of the tube. The default is 0.4. */
	tube?: number;
	/** How many faces go around the tube. The default is 12. */
	radialSegments?: number;
	/** How many faces go around the torus. The default is 48. */
	tubularSegments?: number;
	/** How far the torus goes around its center. The default is `Math.PI * 2`, all the way. */
	arc?: number;
	/** Where the tube starts around its own center. The default is 0. */
	thetaStart?: number;
	/** How far the tube goes around its own center. The default is `Math.PI * 2`, all the way. */
	thetaLength?: number;
}

/**
 * Options for `geometry.capsule`: a cylinder with a half sphere on each end. The capsule stands on
 * the Y axis, centered on its origin, and its full height is `height` plus twice the radius.
 * Segment counts are whole numbers.
 *
 * @category api/geometry
 */
export interface CapsuleOptions {
	/** The radius of the capsule and of its half spheres. The default is 1. */
	radius?: number;
	/** The height of the middle part, between the half spheres. The default is 1. */
	height?: number;
	/** How many rows of faces go along each half sphere. The default is 4, and the least is 1. */
	capSegments?: number;
	/** How many faces go around the capsule. The default is 8, and the least is 3. */
	radialSegments?: number;
	/** How many rows of faces go along the middle part. The default is 1, and the least is 1. */
	heightSegments?: number;
}

/**
 * Options for `geometry.circle`: a flat disc of triangles around its center. The circle lies in
 * the XY plane, centered on its origin, and faces +Z. Angles are in radians.
 *
 * @category api/geometry
 */
export interface CircleOptions {
	/** The radius. The default is 1. */
	radius?: number;
	/** How many triangles make the circle: a whole number. The default is 32, and the least is 3. */
	segments?: number;
	/** Where the circle starts, from the +X axis toward +Y. The default is 0. */
	thetaStart?: number;
	/** How far the circle goes. The default is `Math.PI * 2`. Less makes a slice of the circle. */
	thetaLength?: number;
}

/**
 * Options for `geometry.ring`: a flat disc with a hole. The ring lies in the XY plane, centered on
 * its origin, and faces +Z. Angles are in radians, and segment counts are whole numbers.
 *
 * @category api/geometry
 */
export interface RingOptions {
	/** The radius of the hole. The default is 0.5. */
	innerRadius?: number;
	/** The radius of the outer edge. The default is 1. */
	outerRadius?: number;
	/** How many faces go around the ring. The default is 32, and the least is 3. */
	thetaSegments?: number;
	/** How many faces go from the inner edge to the outer edge. The default is 1, and the least is 1. */
	phiSegments?: number;
	/** Where the ring starts, from the +X axis toward +Y. The default is 0. */
	thetaStart?: number;
	/** How far the ring goes. The default is `Math.PI * 2`, all the way. */
	thetaLength?: number;
}

const TAU = Math.PI * 2;

// Each generator's options with their defaults, in the order of the arguments of the three.js
// class's constructor, which is the order the engine core reads them in.
const BOX: Required<BoxOptions> = {
	width: 1,
	height: 1,
	depth: 1,
	widthSegments: 1,
	heightSegments: 1,
	depthSegments: 1,
};
const SPHERE: Required<SphereOptions> = {
	radius: 1,
	widthSegments: 32,
	heightSegments: 16,
	phiStart: 0,
	phiLength: TAU,
	thetaStart: 0,
	thetaLength: Math.PI,
};
const PLANE: Required<PlaneOptions> = { width: 1, height: 1, widthSegments: 1, heightSegments: 1 };
const CYLINDER: Required<CylinderOptions> = {
	radiusTop: 1,
	radiusBottom: 1,
	height: 1,
	radialSegments: 32,
	heightSegments: 1,
	openEnded: false,
	thetaStart: 0,
	thetaLength: TAU,
};
const CONE: Required<ConeOptions> = {
	radius: 1,
	height: 1,
	radialSegments: 32,
	heightSegments: 1,
	openEnded: false,
	thetaStart: 0,
	thetaLength: TAU,
};
const TORUS: Required<TorusOptions> = {
	radius: 1,
	tube: 0.4,
	radialSegments: 12,
	tubularSegments: 48,
	arc: TAU,
	thetaStart: 0,
	thetaLength: TAU,
};
const CAPSULE: Required<CapsuleOptions> = {
	radius: 1,
	height: 1,
	capSegments: 4,
	radialSegments: 8,
	heightSegments: 1,
};
const CIRCLE: Required<CircleOptions> = {
	radius: 1,
	segments: 32,
	thetaStart: 0,
	thetaLength: TAU,
};
const RING: Required<RingOptions> = {
	innerRadius: 0.5,
	outerRadius: 1,
	thetaSegments: 32,
	phiSegments: 1,
	thetaStart: 0,
	thetaLength: TAU,
};

/**
 * The integer typed arrays that vertex attributes take: 8-bit and 16-bit, signed and unsigned.
 *
 * @category api/geometry
 */
export type IntegerArray = Int8Array | Uint8Array | Int16Array | Uint16Array;

/**
 * One attribute's numbers with a note on how its integers read, like three.js's `BufferAttribute`,
 * whose `array` and `normalized` fields it shares. Normalized integers read as fractions: from 0
 * to 1 when unsigned, and from -1 to 1 when signed. Plain integers read as whole numbers.
 *
 * @category api/geometry
 */
export interface VertexArray {
	/** The numbers, as `MeshArrays` takes them. */
	array: Float32Array | IntegerArray | readonly number[];
	/**
	 * True when the integers are normalized. The default is false, as in three.js and glTF. It
	 * applies to positions and texture coordinates. The other attributes read integers one way
	 * only, so they refuse a value that says otherwise.
	 */
	normalized?: boolean;
}

/**
 * The numbers of one vertex attribute: a typed array, a plain array of numbers, or a
 * `VertexArray` that also says whether its integers are normalized. Plain arrays hold 32-bit
 * floats, except joints, which hold 16-bit integers.
 *
 * @category api/geometry
 */
export type VertexValues = Float32Array | IntegerArray | readonly number[] | VertexArray;

/**
 * A mesh's morph targets, like three.js's `morphAttributes` with `morphTargetsRelative` set, as
 * glTF stores them. Each list holds one array per target, of three numbers per vertex, or for
 * colors as many as the mesh's `colors` hold. They say how far the target moves the vertex's
 * position, normal, tangent or color at weight 1. Every list has the same number of targets, from
 * 1 to 256. A mesh's targets move its vertices by their weights, which each object sets with
 * `setMorphWeight`, and clips animate.
 *
 * @category api/geometry
 */
export interface MorphTargets {
	/** For each target, how far it moves each position. Like `morphAttributes.position`. */
	positions?: readonly (Float32Array | readonly number[])[];
	/** For each target, how far it turns each normal. Like `morphAttributes.normal`. */
	normals?: readonly (Float32Array | readonly number[])[];
	/**
	 * For each target, how far it turns each tangent's direction: three numbers per vertex, as
	 * glTF gives them. three.js does not morph tangents.
	 */
	tangents?: readonly (Float32Array | readonly number[])[];
	/**
	 * For each target, how far it changes each vertex color: three or four numbers per vertex, as
	 * many as the mesh's `colors` hold, in linear color. Like `morphAttributes.color`. A morphed
	 * color is clamped to the range 0 to 1, as the glTF specification asks. Needs `colors`.
	 */
	colors?: readonly (Float32Array | readonly number[])[];
	/** The targets' names, one per target, which `setMorphWeight` takes in place of numbers. */
	names?: readonly string[];
}

/**
 * The arrays of a mesh for `geometry.fromArrays`. Each array holds its values for vertex 0, then
 * vertex 1, and so on, as three.js's `BufferGeometry` keeps its attributes. The engine copies
 * them.
 *
 * An attribute can come as 32-bit floats, or as the 8-bit and 16-bit integers that glTF's
 * `KHR_mesh_quantization` allows for it. The mesh keeps that type on the GPU. Smaller types take
 * less memory and upload faster. Integer positions keep their own scale, so give the object
 * the scale that turns them into meters, as a glTF node does. Meshes share GPU buffers with the
 * meshes whose attributes have the same types.
 *
 * @category api/geometry
 */
export interface MeshArrays {
	/**
	 * Three numbers per vertex: x, y and z. Like three.js's `position` attribute. Takes floats,
	 * or 8-bit or 16-bit integers, normalized or plain.
	 */
	positions: VertexValues;
	/**
	 * Three numbers per vertex: a direction of length 1 away from the surface. Like three.js's
	 * `normal` attribute. Pass normals, or set `computeNormals` instead. Takes floats, or an
	 * `Int8Array` or `Int16Array`, whose integers read as fractions from -1 to 1.
	 */
	normals?: VertexValues;
	/**
	 * Texture coordinates: two numbers per vertex, u and v. Like three.js's `uv` attribute. Takes
	 * floats, or 8-bit or 16-bit integers, normalized or plain.
	 */
	uvs?: VertexValues;
	/**
	 * A second set of texture coordinates, two numbers per vertex, such as those of a light map.
	 * Like three.js's `uv1` attribute. Takes the same types as `uvs`.
	 */
	uvs1?: VertexValues;
	/**
	 * Linear colors, three numbers per vertex from 0 to 1, or four with alpha. Like three.js's
	 * `color` attribute. Takes floats, or a `Uint8Array` or `Uint16Array`, whose integers read as
	 * fractions from 0 to 1.
	 */
	colors?: VertexValues;
	/**
	 * Four numbers per vertex: the direction in which u grows along the surface, then 1 or -1 for
	 * the direction in which v grows. Like three.js's `tangent` attribute. Takes the same types as
	 * `normals`.
	 */
	tangents?: VertexValues;
	/**
	 * The joints that move each vertex of a skinned mesh: four joint indices per vertex, in a
	 * `Uint8Array`, a `Uint16Array` or a plain array. Like three.js's `skinIndex` attribute. Give
	 * `weights` with them.
	 */
	joints?: VertexValues;
	/**
	 * How much each of a vertex's four joints moves it: four numbers per vertex, which add up to
	 * 1. Like three.js's `skinWeight` attribute. Takes floats, or a `Uint8Array` or `Uint16Array`,
	 * whose integers read as fractions from 0 to 1.
	 */
	weights?: VertexValues;
	/**
	 * Three vertex indices per triangle, counter-clockwise when you look at its front. 16-bit and
	 * 32-bit indices both work. Without indices, each three vertices in a row make a triangle.
	 * Like three.js's `setIndex`.
	 */
	indices?: Uint16Array | Uint32Array | readonly number[];
	/**
	 * Computes the normals from the triangles, as three.js's `computeVertexNormals` does: each
	 * vertex gets the average of its triangles' normals, weighted by their areas.
	 */
	computeNormals?: boolean;
	/**
	 * Computes the tangents from the positions, the normals and `uvs`, as three.js's
	 * `computeTangents` does, on the job workers.
	 */
	computeTangents?: boolean;
	/**
	 * The mesh's morph targets: shapes that each object of the mesh blends in by its own weights.
	 * The engine keeps, for each vertex, only the targets that move it.
	 */
	morphTargets?: MorphTargets;
}

/**
 * Mesh generators with the parameters and defaults of three.js's geometry classes, and meshes
 * from arrays.
 *
 * @category api/geometry
 */
export class Geometry {
	/** @internal The scene, which says which objects use a mesh that a destroy names. */
	users: ResourceUsers | undefined;

	constructor(private readonly core: CoreMemory) {}

	/**
	 * The GPU bytes that every mesh holds: the shared vertex and index buffers, which keep room to
	 * grow, and the texture of morph target deltas. It counts what the frames made so far, so it
	 * grows once a frame draws a new mesh. Destroyed meshes give their room to later ones, so a
	 * scene that loads and destroys the same models keeps the same figure.
	 */
	get memoryBytes(): number {
		return this.core.glue.meshMemoryBytes();
	}

	/**
	 * @internal Frees live meshes that no object or batch uses any more, in one pass, as a model's
	 * destroy does.
	 */
	destroyMeshes(meshes: readonly MeshGeometry[], call: string): void {
		destroyMeshes(this.core, meshes, call);
	}

	private mesh(id: number, call: string): MeshGeometry {
		this.core.checkGrowth(id, call);
		return new MeshGeometry(id, this.core.glue.meshRadius(id), this.core, 0, [], this);
	}

	/**
	 * A generator's mesh: each option, or its default, in the order of the three.js class's
	 * arguments, after the numbers in `first`. Throws E1203 for an option that is not a finite
	 * number.
	 */
	private shape<T extends object>(
		shape: number,
		call: string,
		options: T,
		defaults: Required<T>,
		...first: number[]
	): MeshGeometry {
		for (const name in defaults) {
			const given = options[name];
			const value = Number(given ?? defaults[name]);
			if (DEV && !Number.isFinite(value))
				throw new EngineError('E1203', `${call}() got ${given} for ${name}.`);
			first.push(value);
		}
		const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0, g = 0, h = 0] = first;
		return this.mesh(this.core.glue.createShapeMesh(shape, a, b, c, d, e, f, g, h), call);
	}

	/** A box, like three.js's `BoxGeometry`. */
	box(options: BoxOptions = {}): MeshGeometry {
		return this.shape(SHAPE_BOX, 'geometry.box', options, BOX);
	}

	/** A sphere, like three.js's `SphereGeometry`. */
	sphere(options: SphereOptions = {}): MeshGeometry {
		return this.shape(SHAPE_SPHERE, 'geometry.sphere', options, SPHERE);
	}

	/** A flat rectangle, like three.js's `PlaneGeometry`. */
	plane(options: PlaneOptions = {}): MeshGeometry {
		return this.shape(SHAPE_PLANE, 'geometry.plane', options, PLANE);
	}

	/** A cylinder, like three.js's `CylinderGeometry`. */
	cylinder(options: CylinderOptions = {}): MeshGeometry {
		return this.shape(SHAPE_CYLINDER, 'geometry.cylinder', options, CYLINDER);
	}

	/** A cone, like three.js's `ConeGeometry`: a cylinder whose top is a point. */
	cone(options: ConeOptions = {}): MeshGeometry {
		return this.shape(SHAPE_CYLINDER, 'geometry.cone', options, CONE, 0);
	}

	/** A torus, like three.js's `TorusGeometry`. */
	torus(options: TorusOptions = {}): MeshGeometry {
		return this.shape(SHAPE_TORUS, 'geometry.torus', options, TORUS);
	}

	/** A capsule, like three.js's `CapsuleGeometry`. */
	capsule(options: CapsuleOptions = {}): MeshGeometry {
		return this.shape(SHAPE_CAPSULE, 'geometry.capsule', options, CAPSULE);
	}

	/** A flat circle, like three.js's `CircleGeometry`. */
	circle(options: CircleOptions = {}): MeshGeometry {
		return this.shape(SHAPE_CIRCLE, 'geometry.circle', options, CIRCLE);
	}

	/** A flat ring, like three.js's `RingGeometry`. */
	ring(options: RingOptions = {}): MeshGeometry {
		return this.shape(SHAPE_RING, 'geometry.ring', options, RING);
	}

	/**
	 * A mesh from arrays of vertex attributes and triangle indices, like three.js's
	 * `BufferGeometry` with `setAttribute` and `setIndex`. The mesh keeps the attributes it gets,
	 * each in the type of number it came in, and meshes whose attributes have the same types share
	 * GPU buffers. A mesh can have any number of vertices. Throws E1206 when an array's length does
	 * not fit the vertex count, when its attribute does not take its type of number, when an index
	 * names no vertex, for a value that is not a finite number, and for morph targets whose arrays
	 * do not fit the vertices or whose lists hold different numbers of targets.
	 */
	fromArrays(arrays: MeshArrays): MeshGeometry {
		const call = 'geometry.fromArrays';
		const problem = arraysProblem(arrays);
		if (problem) throw new EngineError('E1206', `${call}() ${problem}`);
		const id = meshFromArrays(this.core, arrays, call);
		this.core.checkGrowth(id, call);
		const { morphTargets } = arrays;
		return new MeshGeometry(
			id,
			this.core.glue.meshRadius(id),
			this.core,
			morphTargetCount(morphTargets),
			morphTargets?.names?.slice() ?? [],
			this,
		);
	}
}

/**
 * Options every material takes.
 *
 * @category api/materials
 */
export interface MaterialOptions {
	/** The base color: a hex string or a number in sRGB, or three linear components from 0 to 1. */
	color?: ColorInput;
	/**
	 * How opaque the surface is, from 0 to 1. The default is 1. It is part of the alpha, which the
	 * `mask` alpha mode tests and the `blend` alpha mode blends with. The `opaque` alpha mode
	 * ignores it.
	 */
	opacity?: number;
	/**
	 * With the `mask` alpha mode, the alpha below which the surface draws nothing, from 0 to 1.
	 * The default is 0.5, as in glTF.
	 */
	alphaCutoff?: number;
}

/**
 * How a material uses its alpha: its opacity, times its base color map's alpha, and times its
 * mesh's vertex alpha with `vertexColors`. The `opaque` mode ignores the alpha. The `mask` mode
 * draws nothing where the alpha falls below `alphaCutoff`, and draws the rest opaque, as three.js's
 * `alphaTest` does. The `hash` mode draws each point of the surface opaque or not at all, by a
 * pattern that stays on the mesh. The alpha then sets how much of the surface draws, as three.js's
 * `alphaHash` does. The `blend` mode blends the surface over what lies behind it, as three.js's
 * `transparent: true` does. Blended objects draw after the opaque ones, farthest first.
 *
 * @category api/materials
 */
export type AlphaMode = 'opaque' | 'mask' | 'hash' | 'blend';

/**
 * How a blended surface meets what lies behind it. The `normal` blending covers it as far as the
 * alpha says. The `additive` blending adds the surface's light, for glows and fire. The `multiply`
 * blending tints it, for stains and tinted glass.
 *
 * @category api/materials
 */
export type Blending = 'normal' | 'additive' | 'multiply';

/**
 * A depth bias, as three.js's polygon offset gives. It moves a surface's depth, so a decal on a
 * wall wins the depth test and does not fight with the wall. Negative values pull the surface
 * toward the camera, as in three.js.
 *
 * @category api/materials
 */
export interface DepthBias {
	/**
	 * Steps of the depth buffer's smallest difference, as three.js's `polygonOffsetUnits`. A
	 * fraction rounds to the nearest whole number, as WebGPU takes it. The default is 0.
	 */
	constant?: number;
	/**
	 * A factor of how steeply the surface's depth changes across the screen, as three.js's
	 * `polygonOffsetFactor`. The default is 0.
	 */
	slopeScale?: number;
}

/**
 * The values of a standard material, which `set` changes at any time.
 *
 * @category api/materials
 */
export interface StandardValues extends MaterialOptions {
	/** How much the surface acts like a metal, from 0 to 1. The default is 0. */
	metalness?: number;
	/** How rough the surface is, from 0 (a mirror) to 1 (fully matte). The default is 1. */
	roughness?: number;
	/**
	 * The color the surface gives off without any light, in the forms that `color` takes. The
	 * default is black, which gives off nothing.
	 */
	emissive?: ColorInput;
	/** The factor of the emissive color: 0 or more. The default is 1. */
	emissiveIntensity?: number;
	/**
	 * How strongly the normal map bends normals along u and along v. The default is `[1, 1]`, and
	 * negative values flip a direction.
	 */
	normalScale?: readonly [number, number];
	/** How much the occlusion map darkens ambient light, from 0 to 1. The default is 1. */
	aoMapIntensity?: number;
	/** The factor of the light map's light: 0 or more. The default is 1. */
	lightMapIntensity?: number;
	/**
	 * The index of refraction of the surface's non-metallic part, 1 or more, as three.js's
	 * `MeshPhysicalMaterial.ior`. It sets how much light the surface reflects when seen head on:
	 * `((ior - 1) / (ior + 1))^2`. The default is 1.5, which reflects 4%, as glTF's metallic-roughness
	 * model does.
	 */
	ior?: number;
	/**
	 * The strength of the specular reflection of the surface's non-metallic part, from 0 to 1, as
	 * three.js's `specularIntensity`. It scales the reflection at every angle, so 0 leaves only
	 * diffuse light. Metals ignore it. The default is 1.
	 */
	specularIntensity?: number;
	/**
	 * The color that tints the specular reflection of the surface's non-metallic part when seen head
	 * on, as three.js's `specularColor`. At grazing angles the reflection stays white, and metals
	 * ignore it. It takes the forms that `color` takes, and its three linear components may also
	 * exceed 1, as glTF allows, to reflect more than the index of refraction gives, up to all the
	 * light. The default is white.
	 */
	specularColor?: ColorInput;
	/**
	 * The factor of the scene environment's light on the surface, 0 or more, as three.js's
	 * `envMapIntensity`. It multiplies the intensity that `scene.setEnvironment` gives. The
	 * default is 1.
	 */
	envIntensity?: number;
	/** Where the maps sit on the texture coordinates. The default leaves them as they are. */
	uvTransform?: UvTransform;
}

/**
 * Where a material's maps sit on the texture coordinates, as three.js's texture `offset`, `repeat`
 * and `rotation` place a texture, with its `center` at the coordinates' origin. A transform that
 * leaves a value out takes its default.
 *
 * @category api/materials
 */
export interface UvTransform {
	/** The shift along u and v. The default is `[0, 0]`. */
	offset?: readonly [number, number];
	/** How many times the maps repeat along u and v. The default is `[1, 1]`. */
	repeat?: readonly [number, number];
	/** The turn in radians, about the coordinates' origin. The default is 0. */
	rotation?: number;
}

/**
 * The texture maps of a standard material. They are fixed when the material is created, because
 * each set of maps draws with a pipeline of its own. A map reads the texture coordinates that its
 * texture's `uvSet` names, through the material's `uvTransform`. Meshes need texture coordinates to
 * show maps, and the material draws without a map until its texture's image is on the GPU.
 *
 * @category api/materials
 */
export interface StandardMaps {
	/** The base color map, in sRGB. Its color multiplies `color`. */
	map?: Texture;
	/**
	 * Roughness in green and metalness in blue, as glTF packs them, in linear color. They multiply
	 * `roughness` and `metalness`.
	 */
	metalnessRoughnessMap?: Texture;
	/** Normals in tangent space, in linear color, which `normalScale` scales. */
	normalMap?: Texture;
	/** Ambient occlusion in red, in linear color, which darkens ambient light. */
	aoMap?: Texture;
	/** The emissive color map, in sRGB. Its color multiplies `emissive`. */
	emissiveMap?: Texture;
	/** Baked light, added to the ambient light. Light maps usually use the second coordinates. */
	lightMap?: Texture;
	/** The specular intensity in alpha, in linear color. Its alpha multiplies `specularIntensity`. */
	specularIntensityMap?: Texture;
	/** The specular color, in sRGB. Its color multiplies `specularColor`. */
	specularColorMap?: Texture;
}

/**
 * The options that choose how a material's shader and pipeline draw it. They are fixed when the
 * material is created, as most of them would need a new pipeline.
 *
 * @category api/materials
 */
export interface MaterialFeatures {
	/** Draws both faces of each triangle. Back faces light as if they faced the camera. The default is false. */
	doubleSided?: boolean;
	/**
	 * Multiplies the base color by the mesh's vertex colors, and the alpha by their alpha, on
	 * meshes that have them. The default is false.
	 */
	vertexColors?: boolean;
	/** Takes the scene's fog. False keeps the material's color at every distance. The default is true. */
	fog?: boolean;
	/** How the material uses its alpha. The default is `opaque`. */
	alphaMode?: AlphaMode;
	/**
	 * With the `mask` alpha mode, smooths the cut edges with MSAA, as three.js's
	 * `alphaToCoverage` does: the alpha fades over about one pixel above `alphaCutoff`, and covers
	 * that share of the pixel. Without MSAA the mask cuts as without it. False gives three.js's hard
	 * cut edges of `alphaTest`. Custom materials do not take it. The default is true.
	 */
	alphaToCoverage?: boolean;
	/**
	 * With the `blend` alpha mode and `doubleSided`, draws both faces in one draw, in the mesh's
	 * order, as three.js's `forceSinglePass` does. By default such a surface draws its back faces
	 * first and then its front faces, so its near side always covers its far side. The default is
	 * false.
	 */
	forceSinglePass?: boolean;
	/** With the `blend` alpha mode, how the surface meets what lies behind it. The default is `normal`. */
	blending?: Blending;
	/** False to write no depth, so the surface hides nothing behind it. The default is true. */
	depthWrite?: boolean;
	/**
	 * False to draw the surface whatever lies in front of it. It then writes no depth either, as
	 * in three.js's WebGL renderer. The default is true.
	 */
	depthTest?: boolean;
	/** Moves the surface's depth, as three.js's polygon offset does. The default is no bias. */
	depthBias?: DepthBias;
}

/**
 * The options of `materials.standard` besides its texture maps. Custom materials take them too.
 *
 * @category api/materials
 */
export interface StandardBaseOptions extends StandardValues, MaterialFeatures {
	/**
	 * Lights each triangle with one normal, the normal of its face, so the mesh looks faceted. It
	 * is fixed when the material is created. The default is false.
	 */
	flatShading?: boolean;
}

/**
 * Options of `materials.standard`.
 *
 * @category api/materials
 */
export interface StandardOptions extends StandardBaseOptions, StandardMaps {}

/**
 * The values of an unlit material, which `set` changes at any time.
 *
 * @category api/materials
 */
export interface UnlitValues extends MaterialOptions {
	/** Where the map sits on the texture coordinates. The default leaves it as it is. */
	uvTransform?: UvTransform;
}

/**
 * Options of `materials.unlit`.
 *
 * @category api/materials
 */
export interface UnlitOptions extends UnlitValues, MaterialFeatures {
	/**
	 * A color map, in sRGB, whose color multiplies `color`. It is fixed when the material is
	 * created, and meshes need texture coordinates to show it.
	 */
	map?: Texture;
}

/**
 * WGSL that the null3D Vite plugin compiled: a template literal that a `wgsl` block comment tags,
 * or a `.wgsl` file that a module imports. TypeScript sees a tagged literal as a string, and the
 * plugin puts the compiled WGSL in its place.
 *
 * @category api/materials
 */
export interface CompiledWgsl {
	/**
	 * `'material'` for the functions of a custom material, `'effect'` for a custom effect,
	 * `'toneCurve'` for a custom tone curve, and `'shader'` for a whole shader.
	 */
	readonly kind: 'material' | 'effect' | 'toneCurve' | 'shader';
}

/**
 * The values of a custom material, which `set` changes at any time: the standard values but the
 * texture coordinate transform of maps, and the uniforms that its WGSL's `struct Uniforms`
 * declares, by name. `Wgsl` is the type of the material's WGSL, which gives the uniforms' names
 * and types, as `WgslUniforms` says.
 *
 * @category api/materials
 */
export type ShaderValues<Wgsl = string | CompiledWgsl> = [Wgsl] extends [unknown]
	? Omit<StandardValues, 'uvTransform'> & UniformValues<Wgsl>
	: never;

/**
 * Options of `materials.shader`: the material's WGSL, the first values of its uniforms, and the
 * textures that its WGSL samples. It also takes every option of `materials.standard` but the
 * texture maps. `defaultSurface` applies the standard values. Custom materials take no standard
 * maps, so the values of maps have no effect on them. `Wgsl` is the type of the material's WGSL. It
 * gives the names and types of the uniforms, and the names of the textures.
 *
 * @category api/materials
 */
export interface ShaderOptions<Wgsl extends string | CompiledWgsl = string | CompiledWgsl>
	extends StandardBaseOptions {
	/**
	 * The material's WGSL, compiled by the null3D Vite plugin. It declares
	 * `fn surface(input: SurfaceInput) -> Surface`, which the engine calls for each pixel, and
	 * which can start from `defaultSurface(input)`. The engine lights the surface that it returns.
	 * It can declare `struct Uniforms`, whose fields the surface function reads from `material`,
	 * and `fn vertexOffset`, which moves the mesh's vertices. A full shader has a `@vertex` entry
	 * point that takes an `InstanceIn`, and a `@fragment` one, instead. Materials made from the
	 * same WGSL share their shader.
	 */
	wgsl: Wgsl;
	/**
	 * The first value of each uniform, by name. A uniform without one starts at 0. When TypeScript
	 * can see the WGSL's uniforms, a name that the WGSL does not declare fails the type check, and
	 * WGSL without uniforms takes none.
	 */
	uniforms?: NoInfer<
		[keyof UniformValues<Wgsl>] extends [never]
			? { readonly [name: string]: never }
			: UniformValues<Wgsl>
	>;
	/**
	 * The texture of each `var name: texture_2d<f32>;` that the WGSL declares, by name. The WGSL
	 * samples it as `textureSample(name, nameSampler, uv)`, with the sampler of the texture's
	 * `wrap` and `filter` options. A texture samples as white until its image is on the GPU, and a
	 * declared texture without one stays white. The textures are fixed when the material is
	 * created. When TypeScript can see the WGSL, a name that it does not declare fails the type
	 * check.
	 */
	textures?: NoInfer<TextureValues<Wgsl>>;
}

/** A uniform of a custom material: its type, and the float of the row of custom values it starts at. */
interface CompiledUniform {
	readonly name: string;
	readonly type: UniformType;
	readonly offset: number;
}

/**
 * A custom material's WGSL as the plugin compiles it: the standard material's variants with it, or
 * a full shader's, with the vertex attributes that its vertex stage reads.
 */
interface CompiledMaterial extends CompiledWgsl {
	readonly kind: 'material';
	readonly variants: ShaderVariants;
	readonly locations: readonly number[];
	/** The optional vertex attributes (`VERTEX_*` bits) that the vertex stage reads. */
	readonly attributes: number;
	/** True when the shader reads the material's base color and opacity, as the template does. */
	readonly baseColor: boolean;
	readonly uniforms: readonly CompiledUniform[];
	/** The textures that the WGSL declares, in the order of their map slots. */
	readonly textures: readonly { readonly name: string }[];
	/** On the dev server, the key of the WGSL's hot updates. */
	readonly hot?: string;
}

/** What the thread that draws builds a custom material's pipelines from. */
function customShader(compiled: CompiledMaterial): CustomShader {
	return {
		variants: compiled.variants,
		locations: compiled.locations,
		textures: compiled.textures.length,
	};
}

/** Every value of either material, which `set` writes. */
type AnyValues = StandardValues & UnlitValues;

/** The options of the values that are numbers, with the range each takes. */
type Ranged =
	| 'opacity'
	| 'alphaCutoff'
	| 'metalness'
	| 'roughness'
	| 'emissiveIntensity'
	| 'aoMapIntensity'
	| 'lightMapIntensity'
	| 'specularIntensity'
	| 'envIntensity';

/** The core's code for each value that is a number, and the most it takes, or none above 0. */
const RANGED: readonly (readonly [Ranged, number, number, string])[] = [
	['opacity', MATERIAL_PARAM_OPACITY, 1, 'opacity'],
	['alphaCutoff', MATERIAL_PARAM_ALPHA_CUTOFF, 1, 'alpha cutoff'],
	['metalness', MATERIAL_PARAM_METALNESS, 1, 'metalness'],
	['roughness', MATERIAL_PARAM_ROUGHNESS, 1, 'roughness'],
	[
		'emissiveIntensity',
		MATERIAL_PARAM_EMISSIVE_INTENSITY,
		Number.POSITIVE_INFINITY,
		'emissive intensity',
	],
	['aoMapIntensity', MATERIAL_PARAM_OCCLUSION_STRENGTH, 1, 'aoMapIntensity'],
	[
		'lightMapIntensity',
		MATERIAL_PARAM_LIGHT_MAP_INTENSITY,
		Number.POSITIVE_INFINITY,
		'lightMapIntensity',
	],
	['specularIntensity', MATERIAL_PARAM_SPECULAR_INTENSITY, 1, 'specularIntensity'],
	['envIntensity', MATERIAL_PARAM_ENV_INTENSITY, Number.POSITIVE_INFINITY, 'envIntensity'],
];

/** The core's slot of each map option. */
const MAP_OPTIONS: readonly (readonly [keyof StandardMaps, number])[] = [
	['map', MAP_SLOT_BASE_COLOR],
	['metalnessRoughnessMap', MAP_SLOT_METAL_ROUGH],
	['normalMap', MAP_SLOT_NORMAL],
	['aoMap', MAP_SLOT_OCCLUSION],
	['emissiveMap', MAP_SLOT_EMISSIVE],
	['lightMap', MAP_SLOT_LIGHT],
	['specularIntensityMap', MAP_SLOT_SPECULAR_INTENSITY],
	['specularColorMap', MAP_SLOT_SPECULAR_COLOR],
];

/** Throws E1108 for a pair or a transform with a number that is not finite. */
function checkNumbers(values: AnyValues, call: string): void {
	const { normalScale, uvTransform } = values;
	const numbers = [
		...(normalScale ?? []),
		...(uvTransform?.offset ?? []),
		...(uvTransform?.repeat ?? []),
		uvTransform?.rotation ?? 0,
	];
	if (!numbers.every(Number.isFinite))
		throw new EngineError(
			'E1108',
			`${call}() got a normalScale or uvTransform that is not finite.`,
		);
}

/** Throws E1108 for each number of `values` outside its range. Call it inside `if (DEV)`. */
function checkValues(values: AnyValues, call: string): void {
	checkNumbers(values, call);
	const { ior } = values;
	if (ior !== undefined && !(ior >= 1 && ior < Number.POSITIVE_INFINITY))
		throw new EngineError('E1108', `${call}() got the ior ${ior}; it takes a finite 1 or more.`);
	for (const [key, , most, name] of RANGED) {
		const value = values[key];
		if (value === undefined) continue;
		if (!(value >= 0 && value <= most))
			throw new EngineError(
				'E1108',
				most === 1
					? `${call}() got the ${name} ${value}, outside 0 to 1.`
					: `${call}() got the ${name} ${value}; it takes 0 or more.`,
			);
	}
}

/**
 * Writes the numbers of `values` that are set, and the linear colors that are given, into the
 * core's row of material `id`. Every value was checked and every color converted before, so a
 * call that throws changes nothing.
 */
function writeValues(
	core: CoreMemory,
	id: number,
	call: string,
	values: AnyValues,
	color: readonly number[] | undefined,
	emissive: readonly number[] | undefined,
	specular: readonly number[] | undefined,
): void {
	const write = (param: number, x: number, y: number, z: number) =>
		core.check(core.glue.setMaterialValue(id, param, x, y, z), call, undefined, true);
	if (color)
		write(MATERIAL_PARAM_COLOR, color[0] as number, color[1] as number, color[2] as number);
	if (emissive)
		write(
			MATERIAL_PARAM_EMISSIVE,
			emissive[0] as number,
			emissive[1] as number,
			emissive[2] as number,
		);
	if (specular)
		write(
			MATERIAL_PARAM_SPECULAR_COLOR,
			specular[0] as number,
			specular[1] as number,
			specular[2] as number,
		);
	for (const [key, param] of RANGED) {
		const value = values[key];
		if (value !== undefined) write(param, value, 0, 0);
	}
	const { normalScale, uvTransform, ior } = values;
	if (ior !== undefined) write(MATERIAL_PARAM_REFLECTANCE, reflectance(ior), 0, 0);
	if (normalScale) write(MATERIAL_PARAM_NORMAL_SCALE, normalScale[0], normalScale[1], 0);
	if (uvTransform) {
		// three.js's texture matrix with its center at the origin, by rows.
		const [x, y] = uvTransform.offset ?? [0, 0];
		const [u, v] = uvTransform.repeat ?? [1, 1];
		const angle = uvTransform.rotation ?? 0;
		const [c, s] = [Math.cos(angle), Math.sin(angle)];
		write(MATERIAL_PARAM_UV_U, u * c, u * s, x);
		write(MATERIAL_PARAM_UV_V, -v * s, v * c, y);
	}
}

/** The linear value of a color option, or none when it is not set. */
function linearOrNone(color: ColorInput | undefined, call: string): readonly number[] | undefined {
	return color === undefined ? undefined : linearColor(color, call);
}

/**
 * The linear value of a specular color option, or none when it is not set. Its three linear
 * components may exceed 1, as glTF's specular color factor may.
 */
function specularOrNone(
	color: ColorInput | undefined,
	call: string,
): readonly number[] | undefined {
	if (Array.isArray(color) && color.length === 3 && color.every((c) => c >= 0 && c < Infinity))
		return color;
	return linearOrNone(color, call);
}

/**
 * The dielectric reflectance at normal incidence of a surface with index of refraction `ior`, by
 * the Fresnel equations, as three.js's physical material computes it.
 */
function reflectance(ior: number): number {
	return ((ior - 1) / (ior + 1)) ** 2;
}

/** The alpha modes, each with the core's feature bit that draws it. */
const ALPHA_MODES: Readonly<Record<AlphaMode, number>> = {
	opaque: 0,
	mask: MATERIAL_FEATURE_ALPHA_MASK,
	hash: MATERIAL_FEATURE_ALPHA_MASK | MATERIAL_FEATURE_ALPHA_HASH,
	blend: MATERIAL_FEATURE_BLEND,
};

/** The blendings, each with the core's feature bit that draws it. */
const BLENDINGS: Readonly<Record<Blending, number>> = {
	normal: 0,
	additive: MATERIAL_FEATURE_ADDITIVE,
	multiply: MATERIAL_FEATURE_MULTIPLY,
};

/**
 * Throws E1217 for an option that fixes the material's pipeline but takes no such value, and
 * E1203 for a depth bias that is not a finite number. Call it inside `if (DEV)`.
 */
function checkFeatures(options: StandardOptions, call: string): void {
	const { alphaMode, blending, depthBias } = options;
	if (alphaMode !== undefined && !Object.hasOwn(ALPHA_MODES, alphaMode))
		throw new EngineError(
			'E1217',
			`${call}() got the alpha mode ${JSON.stringify(alphaMode)}; it takes 'opaque', 'mask', 'hash' or 'blend'.`,
		);
	if (blending !== undefined && !Object.hasOwn(BLENDINGS, blending))
		throw new EngineError(
			'E1217',
			`${call}() got the blending ${JSON.stringify(blending)}; it takes 'normal', 'additive' or 'multiply'.`,
		);
	for (const key of ['constant', 'slopeScale'] as const) {
		const value = depthBias?.[key] ?? 0;
		if (!Number.isFinite(value))
			throw new EngineError('E1203', `${call}() got ${value} for depthBias.${key}.`);
	}
}

/** The core's feature bits of `options`. */
function featureBits(options: StandardOptions): number {
	return (
		(options.doubleSided ? MATERIAL_FEATURE_DOUBLE_SIDED : 0) |
		(options.vertexColors ? MATERIAL_FEATURE_VERTEX_COLORS : 0) |
		(options.flatShading ? MATERIAL_FEATURE_FLAT_SHADING : 0) |
		ALPHA_MODES[options.alphaMode ?? 'opaque'] |
		BLENDINGS[options.blending ?? 'normal'] |
		(options.depthWrite === false ? MATERIAL_FEATURE_NO_DEPTH_WRITE : 0) |
		(options.depthTest === false ? MATERIAL_FEATURE_NO_DEPTH_TEST : 0) |
		(options.fog === false ? MATERIAL_FEATURE_NO_FOG : 0) |
		(options.alphaMode === 'mask' && options.alphaToCoverage !== false
			? MATERIAL_FEATURE_ALPHA_TO_COVERAGE
			: 0) |
		(options.forceSinglePass ? MATERIAL_FEATURE_SINGLE_PASS : 0)
	);
}

/** The numbers each type of uniform takes. */
const UNIFORM_FLOATS: Readonly<Record<CompiledUniform['type'], number>> = {
	f32: 1,
	i32: 1,
	u32: 1,
	vec2f: 2,
	vec3f: 3,
	vec4f: 4,
};

/** The values that `set` changes on every standard material, which no uniform may be named. */
const STANDARD_VALUES: ReadonlySet<string> = new Set([
	'color',
	'emissive',
	'specularColor',
	'ior',
	...RANGED.map(([key]) => key),
]);

/**
 * The numbers of a uniform's value, or throws E1216 for a value of another kind. A `vec3f` takes
 * an sRGB color too, converted to linear.
 */
function uniformNumbers(uniform: CompiledUniform, value: UniformValue, call: string): number[] {
	const count = UNIFORM_FLOATS[uniform.type];
	const numbers =
		uniform.type === 'vec3f' && !Array.isArray(value)
			? [...linearColor(value as ColorInput, call)]
			: Array.isArray(value)
				? [...value]
				: [value];
	const fits =
		numbers.length === count &&
		numbers.every((n) => typeof n === 'number' && Number.isFinite(n)) &&
		(uniform.type === 'f32' || uniform.type.startsWith('vec') || Number.isInteger(numbers[0]));
	if (!fits) {
		const takes =
			count === 1
				? uniform.type === 'f32'
					? 'a number'
					: 'a whole number'
				: `an array of ${count} numbers${count === 3 ? ', or a color' : ''}`;
		throw new EngineError(
			'E1216',
			`${call}() got ${JSON.stringify(value)} for the ${uniform.type} uniform ${uniform.name}; it takes ${takes}.`,
		);
	}
	return numbers;
}

/** A uniform and the numbers of its new value. */
type UniformWrite = readonly [CompiledUniform, readonly number[]];

/**
 * The uniforms of `values` with their numbers, each checked, so a caller can check every value
 * before it writes any. `set` calls skip the standard values, which `set` writes itself. Throws
 * E1216 for a name that is not a uniform.
 */
function uniformWrites(
	uniforms: ReadonlyMap<string, CompiledUniform>,
	values: Readonly<Record<string, UniformValue | undefined>>,
	call: string,
): UniformWrite[] {
	const writes: UniformWrite[] = [];
	for (const name in values) {
		const value = values[name];
		if (value === undefined || (STANDARD_VALUES.has(name) && call.endsWith('.set'))) continue;
		const uniform = uniforms.get(name);
		if (!uniform) {
			const names = [...uniforms.keys()].join(', ') || 'none';
			throw new EngineError(
				'E1216',
				`${call}() got ${name}, which is not a uniform of the material's WGSL. Its uniforms: ${names}.`,
			);
		}
		writes.push([uniform, uniformNumbers(uniform, value, call)]);
	}
	return writes;
}

/**
 * The texture of each slot that a custom material's WGSL declares, from its `textures` option, with
 * none where the option gives none. Throws E1216 for a name that the WGSL does not declare, and for
 * a value that is not a texture of one layer.
 */
function textureSlots(
	declared: readonly { readonly name: string }[],
	given: Readonly<Record<string, unknown>>,
	call: string,
): (Texture | undefined)[] {
	const slots: (Texture | undefined)[] = declared.map(() => undefined);
	for (const name in given) {
		const value = given[name];
		if (value === undefined) continue;
		const slot = declared.findIndex((texture) => texture.name === name);
		if (slot < 0) {
			const names = declared.map((texture) => texture.name).join(', ') || 'none';
			throw new EngineError(
				'E1216',
				`${call}() got the texture ${name}, which the material's WGSL does not declare. Its textures: ${names}.`,
			);
		}
		if (!(value instanceof Texture) || value.depth !== 1)
			throw new EngineError(
				'E1216',
				`${call}() got ${value instanceof Texture ? `a texture of ${value.depth} layers` : String(value)} for the texture ${name}; it takes a texture of one layer, from textures or assets.`,
			);
		slots[slot] = value;
	}
	return slots;
}

/**
 * A material: how the surfaces of the objects that use it look. `Values` are the options that
 * `set` changes.
 *
 * @category api/materials
 */
export class Material<Values extends MaterialOptions = MaterialOptions> {
	/** The engine core's id, or 0 once the material is destroyed. */
	private liveId: number;

	/** @internal */
	constructor(
		id: number,
		/** @internal */ readonly core: CoreMemory,
		/** The name that errors from `set` give the call, such as 'materials.standard.set'. */
		protected readonly call: string,
	) {
		this.liveId = id;
	}

	/** @internal True until `destroy` runs. */
	get live(): boolean {
		return this.liveId !== 0;
	}

	/** @internal The engine core's id. Throws E1101 once the material is destroyed. */
	get id(): number {
		if (this.liveId === 0)
			throw new EngineError(
				'E1101',
				`a call used a material of ${this.call.replace(/\.set$/, '')}() after its destroy().`,
			);
		return this.liveId;
	}

	/**
	 * Changes the values that it gets and keeps the others. Every object that uses the material
	 * changes with it. Converting a new color allocates. Throws E1101 once the material is
	 * destroyed.
	 */
	set(options: Values): void {
		const { core, call } = this;
		const values = options as AnyValues;
		const id = this.id;
		if (DEV) checkValues(values, call);
		const color = linearOrNone(values.color, call);
		const emissive = linearOrNone(values.emissive, call);
		const specular = specularOrNone(values.specularColor, call);
		writeValues(core, id, call, values, color, emissive, specular);
	}

	/**
	 * Destroys the material, like three.js's `material.dispose()`. Objects and instance batches that
	 * still use it draw nothing until `setMaterial` gives them another material. Once no object uses
	 * it, its place in the engine's table of materials goes to the next material. When the last
	 * material of a custom material's WGSL goes, the engine frees that WGSL's pipelines. The
	 * material's textures stay, so destroy them apart. Later calls on the material, and calls that
	 * pass it, throw E1101.
	 */
	destroy(): void {
		const { core } = this;
		const call = `${this.call.replace(/\.set$/, '')}.destroy`;
		core.check(core.glue.destroyMaterial(this.id), call, undefined, true);
		this.liveId = 0;
	}
}

/** A custom material, whose `set` changes its uniforms too. */
class ShaderMaterial extends Material<ShaderValues> {
	constructor(
		id: number,
		core: CoreMemory,
		call: string,
		/** The uniforms that the material's WGSL declares, by name. */
		private readonly uniforms: ReadonlyMap<string, CompiledUniform>,
	) {
		super(id, core, call);
	}

	/**
	 * Changes the standard values and the uniforms that it gets, and keeps the others. It checks
	 * every value before it changes any. Converting a color or an array allocates.
	 */
	override set(options: ShaderValues): void {
		const writes = uniformWrites(this.uniforms, options, this.call);
		super.set(options);
		this.write(writes);
	}

	/** Writes checked uniforms into the material's row of custom values. */
	write(writes: readonly UniformWrite[]): void {
		const { core } = this;
		for (const [uniform, [x = 0, y = 0, z = 0, w = 0]] of writes) {
			const count = UNIFORM_FLOATS[uniform.type];
			const status = core.glue.setMaterialValues(this.id, uniform.offset, count, x, y, z, w);
			core.check(status, this.call, undefined, true);
		}
	}
}

/**
 * Material factories. The standard material follows glTF's metallic-roughness model and shades
 * with the formulas of three.js's `MeshStandardMaterial`. The unlit material shows its color as
 * three.js's `MeshBasicMaterial` does.
 *
 * @category api/materials
 */
export class Materials {
	/** @internal */
	constructor(
		private readonly core: CoreMemory,
		/** The templates of compiled WGSL, which send each custom material's shader once. */
		private readonly templates = new ShaderTemplates(),
		/** @internal Asks the thread that draws for the shader files of features early. */
		readonly shaders: ShaderPreloads = new ShaderPreloads(),
	) {}

	/**
	 * @internal Creates a material that shades as the engine core's shading code says, with the
	 * features and values of `options`.
	 */
	create<Values extends MaterialOptions>(
		shading: number,
		options: StandardOptions & UnlitOptions,
		call: string,
	): Material<Values> {
		return new Material<Values>(this.createId(shading, options, call), this.core, `${call}.set`);
	}

	/** Creates a material in the engine core, with its standard options, and returns its id. */
	private createId(shading: number, options: StandardOptions, call: string): number {
		const [r, g, b] = linearColor(options.color ?? '#ffffff', call);
		const emissive = linearOrNone(options.emissive, call);
		const specular = specularOrNone(options.specularColor, call);
		if (DEV) {
			checkValues(options, call);
			checkFeatures(options, call);
		}
		const opacity = options.opacity ?? 1;
		const features = featureBits(options);
		const { constant = 0, slopeScale = 0 } = options.depthBias ?? {};
		const { core } = this;
		const id = core.checkGrowth(
			core.glue.createMaterial(shading, features, r, g, b, opacity, constant, slopeScale),
			call,
		);
		const values = { ...options, color: undefined, opacity: undefined };
		writeValues(core, id, call, values, undefined, emissive, specular);
		for (const [key, slot] of MAP_OPTIONS) {
			const map = options[key];
			if (!map) continue;
			const second = map.uvSet === 1 ? 1 : 0;
			core.checkGrowth(
				core.glue.setMaterialMap(id, slot, map.handle, second),
				call,
				undefined,
				true,
			);
		}
		return id;
	}

	/**
	 * A lit material with glTF's metallic-roughness model, like three.js's
	 * `MeshStandardMaterial`.
	 */
	standard(options: StandardOptions = {}): Material<StandardValues> {
		return this.create<StandardValues>(SHADING_LIT, options, 'materials.standard');
	}

	/**
	 * A material that ignores lights and shows its color unlit, like three.js's
	 * `MeshBasicMaterial`. The exposure and the tone mapping still apply to it, as three.js applies
	 * them to that material.
	 */
	unlit(options: UnlitOptions = {}): Material<UnlitValues> {
		const shading = options.map ? SHADING_UNLIT_MAP : SHADING_UNLIT;
		return this.create<UnlitValues>(shading, options, 'materials.unlit');
	}

	/**
	 * A custom material: the standard material with a surface function in WGSL, which changes how
	 * each pixel of the surface looks before the engine lights it, or a full shader of your own. It
	 * takes every option of `materials.standard` but the texture maps, the first values of the
	 * uniforms that its WGSL declares, and the textures that its WGSL samples. `set` changes the
	 * standard values and the uniforms. Meshes need texture coordinates to draw with a surface
	 * function, and the attributes that a full shader reads. Throws E1215 for WGSL that the null3D
	 * Vite plugin did not compile, and for a whole shader whose `@vertex` entry point takes no
	 * `InstanceIn`. Throws E1216 for a uniform or a texture that the WGSL does not declare, for a
	 * value of the wrong kind, and for a uniform named as a standard value, such as `color`. Throws
	 * E1217 for the `hash` alpha mode and for `alphaToCoverage`, which custom materials do not take.
	 * When
	 * TypeScript can see the WGSL, a wrong name or a value of the wrong kind also fails the type
	 * check.
	 */
	shader<const Wgsl extends string | CompiledWgsl>(
		options: ShaderOptions<Wgsl>,
	): Material<ShaderValues<Wgsl>> {
		const call = 'materials.shader';
		if (DEV && (options.alphaMode === 'hash' || options.alphaToCoverage === true))
			throw new EngineError(
				'E1217',
				`${call}() got ${options.alphaMode === 'hash' ? "the alpha mode 'hash'" : 'alphaToCoverage'}; a custom material takes 'opaque', 'mask' or 'blend', and tests its alpha against alphaCutoff.`,
			);
		const compiled = this.compiledMaterial(options.wgsl, call);
		const uniforms = new Map(compiled.uniforms.map((u) => [u.name, u]));
		for (const name of uniforms.keys())
			if (STANDARD_VALUES.has(name))
				throw new EngineError(
					'E1216',
					`${call}() got WGSL whose uniform ${name} has the name of a standard value. Rename the field of struct Uniforms.`,
				);
		const writes = uniformWrites(uniforms, options.uniforms ?? {}, call);
		const declared = compiled.textures;
		const textures = textureSlots(declared, options.textures ?? {}, call);
		const shading =
			this.templateOf(compiled) |
			(compiled.attributes << SHADING_CUSTOM_ATTRIBUTE_SHIFT) |
			(compiled.baseColor ? SHADING_CUSTOM_BASE_COLOR : 0) |
			(declared.length << SHADING_CUSTOM_TEXTURE_SHIFT);
		const id = this.createId(shading, { ...options, alphaToCoverage: false }, call);
		const material = new ShaderMaterial(id, this.core, `${call}.set`, uniforms);
		material.write(writes);
		const { core } = this;
		textures.forEach((texture, slot) => {
			if (!texture) return;
			core.checkGrowth(
				core.glue.setMaterialMap(id, slot, texture.handle, 0),
				call,
				undefined,
				true,
			);
		});
		return material;
	}

	/**
	 * A custom material's compiled WGSL, or throws E1215 for WGSL that the plugin did not compile
	 * and for a whole shader.
	 */
	private compiledMaterial(wgsl: string | CompiledWgsl, call: string): CompiledMaterial {
		if (typeof wgsl !== 'object' || wgsl?.kind !== 'material') {
			throw new EngineError(
				'E1215',
				typeof wgsl === 'object' && wgsl?.kind === 'shader'
					? `${call}() got a whole shader whose @vertex entry point takes no InstanceIn. A full shader of a custom material finds each instance with InstanceIn and find_instance from null3d::mesh.`
					: `${call}() got WGSL as ${typeof wgsl === 'string' ? 'text' : String(wgsl)}, which the null3D Vite plugin did not compile.`,
			);
		}
		return wgsl as CompiledMaterial;
	}

	/**
	 * The template of a custom material's WGSL, which goes to the thread that draws once. On the
	 * dev server, WGSL under one hot update key shares one template, which takes the newest WGSL.
	 */
	private templateOf(compiled: CompiledMaterial): number {
		return this.templates.of(compiled, () => [customShader(compiled)], compiled.hot);
	}

	/**
	 * @internal Swaps the shader of every custom material made from WGSL under the keys of hot
	 * updates. The plugin sends an update only when the new WGSL keeps the material's uniforms,
	 * textures and vertex inputs, so the materials keep their values.
	 */
	updateShaders(updates: readonly WgslUpdate[]): void {
		if (!DEV) return;
		for (const { key, shader } of updates) {
			if (shader.kind !== 'material') continue;
			this.templates.update(key, [customShader(shader as CompiledMaterial)]);
		}
	}
}

/**
 * A material that shows a mesh's first texture coordinates as colors: u in red and v in green,
 * with no color encoding. Only meshes with texture coordinates draw with it. The engine's own
 * tests use it to check vertex formats.
 */
export function texCoordsMaterial(materials: Materials): Material {
	return materials.create(SHADING_TEXCOORDS, {}, 'texCoordsMaterial');
}
