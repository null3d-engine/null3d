// Meshes and materials, created through `ctx.geometry` and `ctx.materials`. Each is created once
// and shared by any number of objects and instance batches.

import { DEV } from '../errors/checks';
import { EngineError } from '../errors/engine-error';
import { type ColorInput, linearColor } from './color';
import type { CoreMemory } from './memory';

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
 * Mesh generators with the parameters and defaults of three.js's geometry classes.
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

/**
 * A material: how the surfaces of the objects that use it look.
 *
 * @category api/materials
 */
export class Material {
	constructor(
		/** @internal */ readonly id: number,
		private readonly core: CoreMemory,
		private readonly call: string,
	) {}

	/** Changes the material's values; cheap at any time. */
	set(options: MaterialOptions): void {
		const [r, g, b] = linearColor(options.color ?? '#ffffff', `${this.call}.set`);
		this.core.check(
			this.core.glue.setMaterialColor(this.id, r, g, b, options.opacity ?? 1),
			`${this.call}.set`,
			undefined,
			true,
		);
	}
}

/**
 * Material factories. The standard material shades diffuse light only, as three.js's
 * `MeshLambertMaterial` does. Metalness and roughness are planned for null3d 0.1.
 *
 * @category api/materials
 */
export class Materials {
	constructor(private readonly core: CoreMemory) {}

	private create(unlit: boolean, options: MaterialOptions, call: string): Material {
		const [r, g, b] = linearColor(options.color ?? '#ffffff', call);
		const opacity = options.opacity ?? 1;
		if (DEV && !(opacity >= 0 && opacity <= 1))
			throw new EngineError('E1108', `${call}() got the opacity ${opacity}, outside 0 to 1.`);
		const id = this.core.check(this.core.glue.createMaterial(unlit, r, g, b, opacity), call);
		return new Material(id, this.core, call);
	}

	/** A lit material. */
	standard(options: MaterialOptions = {}): Material {
		return this.create(false, options, 'materials.standard');
	}

	/**
	 * A material that ignores lights and shows its color as it is, like three.js's
	 * `MeshBasicMaterial`.
	 */
	unlit(options: MaterialOptions = {}): Material {
		return this.create(true, options, 'materials.unlit');
	}
}
