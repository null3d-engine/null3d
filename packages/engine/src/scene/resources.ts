// Meshes and materials, created through `ctx.geometry` and `ctx.materials`. Each is created once
// and shared by any number of objects and instance batches.

import { DEV } from '../errors/checks';
import { EngineError } from '../errors/engine-error';
import {
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
	 * How opaque the surface is, from 0 to 1. The default is 1. This version stores the value but
	 * draws every material opaque.
	 */
	opacity?: number;
}

/** Throws E1108 for an opacity outside 0 to 1. Call it inside `if (DEV)`. */
function checkOpacity(opacity: number, call: string): void {
	if (!(opacity >= 0 && opacity <= 1))
		throw new EngineError('E1108', `${call}() got the opacity ${opacity}, outside 0 to 1.`);
}

/**
 * A material: how the surfaces of the objects that use it look.
 *
 * @category api/materials
 */
export class Material {
	constructor(
		/** @internal */ readonly id: number,
		private readonly core: CoreMemory,
		/** The name that errors from `set` give the call, such as 'materials.standard.set'. */
		private readonly call: string,
	) {}

	/**
	 * Changes the options that it gets and keeps the values of the others. Every object that uses
	 * the material changes with it. Converting a new color allocates.
	 */
	set(options: MaterialOptions): void {
		const { core, call } = this;
		const { color, opacity } = options;
		// Every value is checked before the first change, so a call that throws changes nothing.
		if (DEV && opacity !== undefined) checkOpacity(opacity, call);
		if (color !== undefined) {
			const [r, g, b] = linearColor(color, call);
			core.check(core.glue.setMaterialColor(this.id, r, g, b), call, undefined, true);
		}
		if (opacity !== undefined)
			core.check(core.glue.setMaterialOpacity(this.id, opacity), call, undefined, true);
	}
}

/**
 * Material factories. The standard material shades diffuse light only, as three.js's
 * `MeshLambertMaterial` does. Metalness and roughness are planned for null3D 0.1.
 *
 * @category api/materials
 */
export class Materials {
	constructor(private readonly core: CoreMemory) {}

	/** @internal Creates a material that shades as the engine core's shading code says. */
	create(shading: number, options: MaterialOptions, call: string): Material {
		const [r, g, b] = linearColor(options.color ?? '#ffffff', call);
		const opacity = options.opacity ?? 1;
		if (DEV) checkOpacity(opacity, call);
		const id = this.core.check(this.core.glue.createMaterial(shading, r, g, b, opacity), call);
		return new Material(id, this.core, `${call}.set`);
	}

	/** @internal Gives a material a map, or none. */
	setMap(material: Material, map: Texture | undefined, call: string): void {
		const status = this.core.glue.setMaterialMap(material.id, map?.handle ?? 0);
		this.core.check(status, call, undefined, true);
	}

	/** A lit material. */
	standard(options: MaterialOptions = {}): Material {
		return this.create(SHADING_LIT, options, 'materials.standard');
	}

	/**
	 * A material that ignores lights and shows its color as it is, like three.js's
	 * `MeshBasicMaterial`.
	 */
	unlit(options: MaterialOptions = {}): Material {
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
