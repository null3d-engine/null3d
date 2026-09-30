// Meshes and materials, created through `ctx.geometry` and `ctx.materials`. Each is created once
// and shared by any number of objects and instance batches.

import { DEV } from '../errors/checks';
import { EngineError } from '../errors/engine-error';
import { SHADING_LIT, SHADING_TEXCOORDS, SHADING_UNLIT } from '../generated/core';
import { type ColorInput, linearColor } from './color';
import type { CoreMemory } from './memory';
import { arraysProblem, meshFromArrays } from './mesh-arrays';

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
 * Options for `geometry.box`. The box is centered on its origin.
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
 * Options for `geometry.sphere`. The sphere is centered on its origin.
 *
 * @category api/geometry
 */
export interface SphereOptions {
	/** The radius. The default is 1. */
	radius?: number;
	/** How many faces go around the equator. The default is 32. */
	widthSegments?: number;
	/** How many faces go from pole to pole. The default is 16. */
	heightSegments?: number;
}

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

	/** A box, like three.js's `BoxGeometry`. */
	box(options: BoxOptions = {}): MeshGeometry {
		const { width = 1, height = 1, depth = 1 } = options;
		const { widthSegments = 1, heightSegments = 1, depthSegments = 1 } = options;
		return this.mesh(
			this.core.glue.createBoxMesh(
				width,
				height,
				depth,
				widthSegments,
				heightSegments,
				depthSegments,
			),
			'geometry.box',
		);
	}

	/** A sphere, like three.js's `SphereGeometry`. */
	sphere(options: SphereOptions = {}): MeshGeometry {
		const { radius = 1, widthSegments = 32, heightSegments = 16 } = options;
		return this.mesh(
			this.core.glue.createSphereMesh(radius, widthSegments, heightSegments),
			'geometry.sphere',
		);
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
