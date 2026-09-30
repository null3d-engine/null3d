// Meshes and materials, created through `ctx.geometry` and `ctx.materials`. Each is created once
// and shared by any number of objects and instance batches.

import { DEV } from '../errors/checks';
import { EngineError } from '../errors/engine-error';
import {
	MATERIAL_FEATURE_ALPHA_MASK,
	MATERIAL_FEATURE_DOUBLE_SIDED,
	MATERIAL_FEATURE_FLAT_SHADING,
	MATERIAL_FEATURE_NO_DEPTH_TEST,
	MATERIAL_FEATURE_NO_DEPTH_WRITE,
	MATERIAL_FEATURE_NO_FOG,
	MATERIAL_FEATURE_VERTEX_COLORS,
	MATERIAL_PARAM_ALPHA_CUTOFF,
	MATERIAL_PARAM_COLOR,
	MATERIAL_PARAM_EMISSIVE,
	MATERIAL_PARAM_EMISSIVE_INTENSITY,
	MATERIAL_PARAM_METALNESS,
	MATERIAL_PARAM_OPACITY,
	MATERIAL_PARAM_ROUGHNESS,
	SHADING_LIT,
	SHADING_TEXCOORDS,
	SHADING_UNLIT,
	SHAPE_BOX,
	SHAPE_CAPSULE,
	SHAPE_CIRCLE,
	SHAPE_CYLINDER,
	SHAPE_PLANE,
	SHAPE_RING,
	SHAPE_SPHERE,
	SHAPE_TORUS,
} from '../generated/core';
import { type ColorInput, linearColor } from './color';
import type { CoreMemory } from './memory';
import { arraysProblem, meshFromArrays } from './mesh-arrays';
import type { Texture } from './textures';

/**
 * A mesh the engine can draw: its id in the engine core, and its bounding radius.
 *
 * @category api/geometry
 */
export class MeshGeometry {
	constructor(
		/** @internal */ readonly id: number,
		/** The distance from the mesh's origin to its farthest vertex. */
		readonly radius: number,
		/** @internal */ readonly core: CoreMemory,
	) {}
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
 * The arrays of a mesh for `geometry.fromArrays`. Each array holds its values for vertex 0, then
 * vertex 1, and so on, as three.js's `BufferGeometry` keeps its attributes. Typed arrays and plain
 * arrays of numbers both work, and the engine copies them.
 *
 * @category api/geometry
 */
export interface MeshArrays {
	/** Three numbers per vertex: x, y and z. Like three.js's `position` attribute. */
	positions: Float32Array | readonly number[];
	/**
	 * Three numbers per vertex: a direction of length 1 away from the surface. Like three.js's
	 * `normal` attribute. Pass normals, or set `computeNormals` instead.
	 */
	normals?: Float32Array | readonly number[];
	/** Texture coordinates: two numbers per vertex, u and v. Like three.js's `uv` attribute. */
	uvs?: Float32Array | readonly number[];
	/**
	 * A second set of texture coordinates, two numbers per vertex, such as those of a light map.
	 * Like three.js's `uv1` attribute.
	 */
	uvs1?: Float32Array | readonly number[];
	/**
	 * Linear colors, three numbers per vertex from 0 to 1, or four with alpha. Like three.js's
	 * `color` attribute.
	 */
	colors?: Float32Array | readonly number[];
	/**
	 * Four numbers per vertex: the direction in which u grows along the surface, then 1 or -1 for
	 * the direction in which v grows. Like three.js's `tangent` attribute.
	 */
	tangents?: Float32Array | readonly number[];
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
}

/**
 * Mesh generators with the parameters and defaults of three.js's geometry classes, and meshes
 * from arrays.
 *
 * @category api/geometry
 */
export class Geometry {
	constructor(private readonly core: CoreMemory) {}

	private mesh(id: number, call: string): MeshGeometry {
		this.core.check(id, call);
		this.core.refresh();
		return new MeshGeometry(id, this.core.glue.meshRadius(id), this.core);
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
	 * and meshes with the same attributes share GPU buffers. A mesh can have any number of
	 * vertices. Throws E1206 when an array's length does not fit the vertex count or an index names
	 * no vertex, and for a value that is not a finite number.
	 */
	fromArrays(arrays: MeshArrays): MeshGeometry {
		const call = 'geometry.fromArrays';
		const problem = arraysProblem(arrays);
		if (problem) throw new EngineError('E1206', `${call}() ${problem}`);
		return this.mesh(meshFromArrays(this.core, arrays, call), call);
	}
}

/**
 * Options every material takes.
 *
 * @category api/materials
 */
export interface MaterialOptions {
	/** The base color: a hex string, a number, or three sRGB components from 0 to 1. */
	color?: ColorInput;
	/**
	 * How opaque the surface is, from 0 to 1. The default is 1. With the `mask` alpha mode, it is
	 * part of the alpha that the cutoff tests. This version draws no blended materials, so it has
	 * no other effect yet.
	 */
	opacity?: number;
	/**
	 * With the `mask` alpha mode, the alpha below which the surface draws nothing, from 0 to 1.
	 * The default is 0.5, as in glTF.
	 */
	alphaCutoff?: number;
}

/**
 * How a material uses its alpha: its opacity, times its mesh's vertex alpha with `vertexColors`.
 * The `opaque` mode ignores the alpha. The `mask` mode draws nothing where the alpha falls below
 * `alphaCutoff`, and draws the rest opaque. It works as glTF's alpha mode `MASK` and three.js's
 * `alphaTest` do.
 *
 * @category api/materials
 */
export type AlphaMode = 'opaque' | 'mask';

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
	 * The color the surface gives off without any light, in sRGB as `color` takes it. The default
	 * is black, which gives off nothing.
	 */
	emissive?: ColorInput;
	/** The factor of the emissive color: 0 or more. The default is 1. */
	emissiveIntensity?: number;
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
 * Options of `materials.standard`.
 *
 * @category api/materials
 */
export interface StandardOptions extends StandardValues, MaterialFeatures {
	/**
	 * Lights each triangle with one normal, the normal of its face, so the mesh looks faceted. It
	 * is fixed when the material is created. The default is false.
	 */
	flatShading?: boolean;
}

/**
 * Options of `materials.unlit`.
 *
 * @category api/materials
 */
export interface UnlitOptions extends MaterialOptions, MaterialFeatures {}

/** The options of the standard values that are numbers, with the range each takes. */
type Ranged = 'opacity' | 'alphaCutoff' | 'metalness' | 'roughness' | 'emissiveIntensity';

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
];

/** Throws E1108 for each number of `values` outside its range. Call it inside `if (DEV)`. */
function checkValues(values: StandardValues, call: string): void {
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
	values: StandardValues,
	color: readonly number[] | undefined,
	emissive: readonly number[] | undefined,
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
	for (const [key, param] of RANGED) {
		const value = values[key];
		if (value !== undefined) write(param, value, 0, 0);
	}
}

/** The linear value of a color option, or none when it is not set. */
function linearOrNone(color: ColorInput | undefined, call: string): readonly number[] | undefined {
	return color === undefined ? undefined : linearColor(color, call);
}

/** The alpha modes, each with the core's feature bit that draws it. */
const ALPHA_MODES: Readonly<Record<AlphaMode, number>> = {
	opaque: 0,
	mask: MATERIAL_FEATURE_ALPHA_MASK,
};

/**
 * Throws E1217 for an option that fixes the material's pipeline but takes no such value, and
 * E1203 for a depth bias that is not a finite number. Call it inside `if (DEV)`.
 */
function checkFeatures(options: StandardOptions, call: string): void {
	const { alphaMode, depthBias } = options;
	if (alphaMode !== undefined && !Object.hasOwn(ALPHA_MODES, alphaMode))
		throw new EngineError(
			'E1217',
			`${call}() got the alpha mode ${JSON.stringify(alphaMode)}; it takes 'opaque' or 'mask'.`,
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
		(options.depthWrite === false ? MATERIAL_FEATURE_NO_DEPTH_WRITE : 0) |
		(options.depthTest === false ? MATERIAL_FEATURE_NO_DEPTH_TEST : 0) |
		(options.fog === false ? MATERIAL_FEATURE_NO_FOG : 0)
	);
}

/**
 * A material: how the surfaces of the objects that use it look. `Values` are the options that
 * `set` changes.
 *
 * @category api/materials
 */
export class Material<Values extends MaterialOptions = MaterialOptions> {
	constructor(
		/** @internal */ readonly id: number,
		/** @internal */ readonly core: CoreMemory,
		/** The name that errors from `set` give the call, such as 'materials.standard.set'. */
		private readonly call: string,
	) {}

	/**
	 * Changes the values that it gets and keeps the others. Every object that uses the material
	 * changes with it. Converting a new color allocates.
	 */
	set(options: Values): void {
		const { core, call } = this;
		const values = options as StandardValues;
		if (DEV) checkValues(values, call);
		const color = linearOrNone(values.color, call);
		const emissive = linearOrNone(values.emissive, call);
		writeValues(core, this.id, call, values, color, emissive);
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
	constructor(private readonly core: CoreMemory) {}

	/**
	 * @internal Creates a material that shades as the engine core's shading code says, with the
	 * features and values of `options`.
	 */
	create<Values extends MaterialOptions>(
		shading: number,
		options: StandardOptions,
		call: string,
	): Material<Values> {
		const [r, g, b] = linearColor(options.color ?? '#ffffff', call);
		const emissive = linearOrNone(options.emissive, call);
		if (DEV) {
			checkValues(options, call);
			checkFeatures(options, call);
		}
		const opacity = options.opacity ?? 1;
		const features = featureBits(options);
		const { constant = 0, slopeScale = 0 } = options.depthBias ?? {};
		const { core } = this;
		const id = core.check(
			core.glue.createMaterial(shading, features, r, g, b, opacity, constant, slopeScale),
			call,
		);
		const { alphaCutoff, metalness, roughness, emissiveIntensity } = options;
		const values = { alphaCutoff, metalness, roughness, emissiveIntensity };
		writeValues(core, id, call, values, undefined, emissive);
		return new Material<Values>(id, core, `${call}.set`);
	}

	/** @internal Gives a material a map, or none. */
	setMap(material: Material, map: Texture | undefined, call: string): void {
		const status = this.core.glue.setMaterialMap(material.id, map?.handle ?? 0);
		this.core.check(status, call, undefined, true);
	}

	/**
	 * A lit material with glTF's metallic-roughness model, like three.js's
	 * `MeshStandardMaterial`.
	 */
	standard(options: StandardOptions = {}): Material<StandardValues> {
		return this.create<StandardValues>(SHADING_LIT, options, 'materials.standard');
	}

	/**
	 * A material that ignores lights and shows its color as it is, like three.js's
	 * `MeshBasicMaterial`.
	 */
	unlit(options: UnlitOptions = {}): Material {
		return this.create(SHADING_UNLIT, options, 'materials.unlit');
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
