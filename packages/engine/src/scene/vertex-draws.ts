// Draws that make their vertices from a vertex count: a material of the sketch's, a number of
// vertices for one shape and a number of copies, and no mesh data. The shader reads
// `@builtin(vertex_index)` and `@builtin(instance_index)` and makes every vertex, so rain, streaks,
// card effects and procedural shapes cost one call and upload nothing per frame. The object's
// culling sphere comes from the sketch, and the shapes move with the material's values, wrapped
// around the camera where the sketch wants that (see `null3d::wrap` in the shader library).

import { EngineError } from '../errors/engine-error';
import * as C from '../generated/core';
import type { Vec3Like } from '../math/types';
import type { CoreMemory } from './memory';
import type { CompiledWgsl, Material, ShaderOptions, ShaderValues } from './resources';
import type { Mesh, Quat, Vec3 } from './scene';

/**
 * The sphere that culls a draw. The engine draws the whole draw or none of it, so the sphere holds
 * every shape that the shader makes. A shape that moves outside it stops drawing.
 *
 * @category api/vertex-draws
 */
export interface VertexDrawBounds {
	/** The middle of the sphere in the object's space. The default is (0, 0, 0). */
	readonly center?: Vec3;
	/** The reach of the sphere from its center, in world units. */
	readonly radius: number;
}

/**
 * Options of `scene.createVertexDraw`: the shader, its two counts, its bounds, and every option
 * of `materials.shader`, such as the uniforms, the blending and `doubleSided`. A draw blends, so
 * its material draws in the transparent pass, where its sphere culls it and one shape covers the
 * ones behind it.
 *
 * @category api/vertex-draws
 */
export interface VertexDrawOptions<Wgsl extends string | CompiledWgsl = string | CompiledWgsl>
	extends Omit<ShaderOptions<Wgsl>, 'wgsl'> {
	/**
	 * The draw's WGSL, compiled by the null3D Vite plugin: one `@vertex` entry point that takes the
	 * vertex and instance indices and no mesh attribute, and one `@fragment` entry point.
	 */
	readonly shader: Wgsl;
	/** The vertices of one shape, such as 2 for a line or 6 for a card. */
	readonly vertices: number;
	/** The copies of the shape in the draw, such as one for each streak. */
	readonly instances: number;
	/** The sphere that culls the draw. */
	readonly bounds: VertexDrawBounds;
	/** The position of the draw in the world. The default is (0, 0, 0). */
	readonly position?: Vec3;
	/** The rotation of the draw, as a quaternion (x, y, z, w). The default is none. */
	readonly rotation?: Quat;
	/** The scale of the draw on each axis. The default is (1, 1, 1). */
	readonly scale?: Vec3;
	/** The layers the draw is on, as a 32-bit mask. The default, 1, is layer 0. */
	readonly layers?: number;
}

/**
 * A draw that has a material and a vertex count but no mesh data. Its shader makes every vertex of
 * every copy from the indices, so the draw uploads nothing per frame. Change its counts, its
 * sphere and its material's uniforms with the calls here, and free it with `destroy`.
 *
 * @category api/vertex-draws
 */
export class VertexDraw<Wgsl extends string | CompiledWgsl = string | CompiledWgsl> {
	/** @internal */
	constructor(
		private readonly core: CoreMemory,
		/** The draw's id in the engine's table. */
		private readonly id: number,
		/** The scene object that gives the draw its place, its layers and its culling sphere. */
		readonly object: Mesh,
		/** The draw's custom material, whose uniforms the WGSL reads. */
		readonly material: Material<ShaderValues<Wgsl>>,
		private readonly call: string,
		private vertexTotal: number,
		private instanceTotal: number,
		private live = true,
	) {}

	/** The vertices of one shape. */
	get vertices(): number {
		return this.vertexTotal;
	}

	/** The copies of the shape. */
	get instances(): number {
		return this.instanceTotal;
	}

	/**
	 * Sets the vertices of one shape and the copies of the shape, from the next frame on. Each is a
	 * whole number from 1 to the most that the draw holds.
	 */
	setCounts(vertices: number, instances: number): this {
		if (!whole(vertices) || !whole(instances))
			throw new EngineError(
				'E1108',
				`${this.call}.setCounts() got ${vertices} vertices and ${instances} copies. Give whole numbers of 1 or more.`,
			);
		this.core.glue.setVertexDrawCounts(this.id, vertices, instances);
		this.vertexTotal = Math.min(vertices, C.VERTEX_DRAW_MAX_VERTICES);
		this.instanceTotal = Math.min(instances, C.VERTEX_DRAW_MAX_INSTANCES);
		return this;
	}

	/**
	 * Sets the sphere that culls the draw, as `object.setBounds` does. The sphere holds every shape
	 * that the shader makes.
	 */
	setBounds(center: Vec3Like, radius: number): this {
		this.object.setBounds(center, radius);
		return this;
	}

	/** Frees the draw and its object. A second call does nothing. */
	destroy(): void {
		if (!this.live) return;
		this.live = false;
		this.core.glue.destroyVertexDraw(this.id);
		this.object.scene.vertexDraws--;
		this.object.destroy();
	}
}

/** True for a whole number of 1 or more. */
function whole(value: number): boolean {
	return Number.isInteger(value) && value >= 1;
}
