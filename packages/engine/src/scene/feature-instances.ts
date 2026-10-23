// The instance adapter of the public feature description: one add-on draw that expands a capacity
// of instances from its own per-instance data, whose live count the GPU writes. On WebGPU the
// draw reads the add-on's instance buffer, which the add-on's compute pass fills, and the count
// word that the same pass writes; the engine copies the count into the indirect draw each frame.
// WebGL2 has neither compute nor storage buffers, so the page fills the instances and the count on
// the CPU through an instance batch.
//
// The shape that one instance draws is the add-on's vertices, so the adapter makes the mesh and
// the material from the options, as the feature draw adapter does. The description places the
// draw in the frame; this first version draws at the opaque point in the main view alone.

import { EngineError } from '../errors/engine-error';
import * as C from '../generated/core';
import type { FeatureDescription } from './features';
import type { CoreMemory } from './memory';
import type {
	CompiledWgsl,
	Geometry,
	Material,
	Materials,
	MeshArrays,
	MeshGeometry,
	ShaderOptions,
	ShaderValues,
} from './resources';
import type { InstanceBatch, Mesh } from './scene';

/**
 * The vertex data of one shape that an instance draw shows: the arrays that `geometry.fromArrays`
 * takes. One shape draws once for each live instance.
 *
 * @category api/feature-instances
 */
export type FeatureInstanceVertices = MeshArrays;

/**
 * A handle for a buffer that the engine made for an instance draw, which a compute pass binds.
 * `buffer` names the buffer in the frame's draw list.
 *
 * @category api/feature-instances
 */
export interface FeatureInstanceBuffer {
	/** The engine's name for the buffer, which a compute pass binds. */
	readonly buffer: number;
	/** The buffer's size in bytes, which a compute pass binds. */
	readonly bytes: number;
}

/**
 * Options of `scene.addFeatureInstances` besides the feature description. The shader and its
 * uniforms take the options of `materials.shader`, so a draw takes every value and texture that a
 * custom material takes.
 *
 * @category api/feature-instances
 */
export interface FeatureInstanceOptions<Wgsl extends string | CompiledWgsl = string | CompiledWgsl>
	extends Omit<ShaderOptions<Wgsl>, 'wgsl'> {
	/** The draw's WGSL, compiled by the null3D Vite plugin. */
	readonly shader: Wgsl;
	/** The vertex data of one shape, which every live instance draws. */
	readonly vertices: FeatureInstanceVertices;
	/** The most instances that the draw may hold, which sizes its buffers. */
	readonly capacity: number;
	/** The count at the first frame. The default is 0. */
	readonly count?: number;
	/** The layers the draw is on, as a 32-bit mask. The default, 1, is layer 0. */
	readonly layers?: number;
}

/** What the adapter asks the scene for: the makers, the scene's core, its GPU path, and errors. */
export interface FeatureInstancesHost {
	/** True on the WebGL2 path, which has no compute and no storage buffer. */
	readonly webgl2: boolean;
	readonly core: CoreMemory;
	readonly geometry: Geometry;
	readonly materials: Materials;
	createMesh(
		mesh: MeshGeometry,
		material: Material,
		place: {
			readonly name: string;
			readonly layers?: number;
		},
	): Mesh;
	/** One batch of `count` rows of `mesh` and `material`, for the CPU path. */
	createBatch(mesh: MeshGeometry, material: Material, count: number): InstanceBatch;
	/** The error that a description the adapter cannot place throws. */
	fail(detail: string): Error;
}

/** The floats of one instance: three world-matrix rows, then the ids. */
const INSTANCE_FLOATS = C.FEATURE_INSTANCE_INSTANCE_FLOATS;

/**
 * One add-on draw whose live count the GPU writes. Draw its instances from the add-on's own buffer
 * with `setInstances`, or from a compute pass that writes the count word, and free it with
 * `destroy`.
 *
 * @category api/feature-instances
 */
export class FeatureInstances<Wgsl extends string | CompiledWgsl = string | CompiledWgsl> {
	/** @internal */
	constructor(
		private readonly core: CoreMemory,
		/** @internal The draw's id in the engine's table, or 0 on the CPU path. */
		private readonly id: number,
		/** The scene object that places the draw, or the instance batch on the CPU path. */
		readonly object: Mesh | InstanceBatch,
		/** The draw's custom material, whose WGSL reads its instances. */
		readonly material: Material<ShaderValues<Wgsl>>,
		/** @internal The mesh that holds the draw's one shape. */
		private readonly mesh: MeshGeometry,
		/** @internal The count word, which a compute pass writes. */
		readonly counts: FeatureInstanceBuffer,
		/** @internal The per-instance buffer, which a compute pass fills. */
		readonly instances: FeatureInstanceBuffer,
		private readonly call: string,
		/** The most instances that the draw holds. */
		private readonly capacityValue: number,
		private countValue: number,
		private live = true,
	) {}

	/** The count that the GPU or the CPU set. */
	get count(): number {
		return this.countValue;
	}

	/**
	 * Sets the count that a shadow view draws and that a page without compute sets. On WebGL2 it
	 * is the count that the draw renders. It is a whole number from 0 to the capacity.
	 */
	setCount(count: number): this {
		this.checkCount(count);
		if (this.id !== 0) this.core.glue.setFeatureInstanceCount(this.id, count);
		else (this.object as InstanceBatch).setActiveCount(count);
		this.countValue = count;
		return this;
	}

	/**
	 * Writes `count` instances from `values`, laid out as the engine's instance rows: three
	 * world-matrix rows, then the ids, sixteen floats for each. WebGPU uploads them into the
	 * add-on's buffer; WebGL2 places each row in the instance batch. It also sets the count.
	 */
	setInstances(values: Float32Array, count: number): this {
		this.checkCount(count);
		if (values.length < count * INSTANCE_FLOATS)
			throw new EngineError(
				'E1108',
				`${this.call}.setInstances() got ${values.length} floats for ${count} instances. Give ${INSTANCE_FLOATS} floats for each instance.`,
			);
		if (this.id !== 0) {
			if (this.core.glue.setFeatureInstanceRows(this.id, 0, count, values) !== 0)
				throw new EngineError(
					'E1108',
					`${this.call}.setInstances() got values that the draw does not take.`,
				);
			this.core.glue.setFeatureInstanceCount(this.id, count);
		} else {
			const batch = this.object as InstanceBatch;
			writeRows(batch, values, count);
			batch.markDirty(0, count);
			batch.setActiveCount(count);
		}
		this.countValue = count;
		return this;
	}

	/** Draws the draw, or hides it, from the next frame on. */
	setVisible(visible: boolean): void {
		if (this.id !== 0) (this.object as Mesh).setVisible(visible);
		else (this.object as InstanceBatch).setActiveCount(visible ? this.countValue : 0);
	}

	/** Frees the draw's object, material and vertices. Later calls on it throw E1101. */
	destroy(): void {
		if (!this.live) return;
		this.live = false;
		if (this.id !== 0) {
			this.core.glue.destroyFeatureInstances(this.id);
			(this.object as Mesh).destroy();
		} else {
			(this.object as InstanceBatch).destroy();
		}
		this.material.destroy();
		this.mesh.destroy();
	}

	private checkCount(count: number): void {
		const capacity = this.capacityValue;
		if (!Number.isInteger(count) || count < 0 || count > capacity)
			throw new EngineError(
				'E1108',
				`${this.call}() got the count ${count}. A draw holds from 0 to ${capacity} instances.`,
			);
	}
}

/**
 * Makes the draw that `description` declares: checks the description and the capacity, builds the
 * mesh and the material, and creates the object that draws them or, on WebGL2, the instance batch
 * that the CPU fills.
 */
export function createFeatureInstances<const Wgsl extends string | CompiledWgsl>(
	description: FeatureDescription,
	options: FeatureInstanceOptions<Wgsl>,
	host: FeatureInstancesHost,
	call = 'addFeatureInstances',
): FeatureInstances<Wgsl> {
	const invalid = (detail: string) => host.fail(`${call}() ${detail}`);
	if (description.kind !== 'draw')
		throw invalid(
			`got the feature '${description.name}' with the kind ${JSON.stringify(description.kind)}; an instance draw takes a description with the kind 'draw'.`,
		);
	if (description.frame !== 'opaque')
		throw invalid(
			`got the feature '${description.name}' with the frame ${JSON.stringify(description.frame)}; an instance draw records at 'opaque'.`,
		);
	const views = description.views ?? ['main'];
	if (views.length !== 1 || views[0] !== 'main')
		throw invalid(
			`got the feature '${description.name}' with the views ${JSON.stringify(views)}; an instance draw records in the main view alone.`,
		);
	const { capacity, count = 0 } = options;
	if (!Number.isInteger(capacity) || capacity < 1 || capacity > C.FEATURE_INSTANCE_MAX_CAPACITY)
		throw invalid(
			`got the capacity ${capacity}. An instance draw holds from 1 to ${C.FEATURE_INSTANCE_MAX_CAPACITY} instances.`,
		);
	if (!Number.isInteger(count) || count < 0 || count > capacity)
		throw invalid(
			`got the count ${count}. An instance draw holds from 0 to its capacity of ${capacity}.`,
		);
	const { geometry, materials } = host;
	const {
		shader,
		vertices,
		layers,
		count: _count,
		capacity: _capacity,
		...materialOptions
	} = options;
	const material = materials.shader({
		...materialOptions,
		wgsl: shader,
		alphaMode: 'opaque',
	} as ShaderOptions<Wgsl>);
	const mesh = geometry.fromArrays(vertices);
	if (host.webgl2) {
		let batch: InstanceBatch;
		try {
			batch = host.createBatch(mesh, material as unknown as Material, capacity);
		} catch (error) {
			material.destroy();
			mesh.destroy();
			throw error;
		}
		// The add-on's own cull decides what draws, so the engine culls nothing.
		batch.setFrustumCulled(false);
		if (layers !== undefined) batch.setLayers(layers);
		batch.setActiveCount(count);
		const none = { buffer: 0, bytes: 0 };
		return new FeatureInstances(
			host.core,
			0,
			batch,
			material,
			mesh,
			none,
			none,
			call,
			capacity,
			count,
		);
	}
	const object = host.createMesh(mesh, material as unknown as Material, {
		name: description.name,
		layers,
	});
	// The draw is unculled: the add-on's compute is its cull.
	object.setFrustumCulled(false);
	let id: number;
	try {
		id = host.core.checkGrowth(host.core.glue.createFeatureInstances(object.slot, capacity), call);
	} catch (error) {
		object.destroy();
		material.destroy();
		mesh.destroy();
		throw error;
	}
	if (count > 0) host.core.glue.setFeatureInstanceCount(id, count);
	const counts = {
		buffer: host.core.glue.featureInstanceCountBuffer(id),
		bytes: C.FEATURE_INSTANCE_COUNT_BYTES,
	};
	const instances = {
		buffer: host.core.glue.featureInstanceBuffer(id),
		bytes: capacity * C.FEATURE_INSTANCE_INSTANCE_BYTES,
	};
	return new FeatureInstances(
		host.core,
		id,
		object,
		material,
		mesh,
		counts,
		instances,
		call,
		capacity,
		count,
	);
}

/** Places the rows that a page wrote in an instance batch, which the CPU path draws. */
function writeRows(batch: InstanceBatch, values: Float32Array, count: number): void {
	const positions = batch.positions;
	const rotations = batch.rotations;
	const scales = batch.scales;
	for (let row = 0; row < count; row++) {
		const at = row * INSTANCE_FLOATS;
		const r0: [number, number, number] = [
			values[at] ?? 0,
			values[at + 1] ?? 0,
			values[at + 2] ?? 0,
		];
		const r1: [number, number, number] = [
			values[at + 4] ?? 0,
			values[at + 5] ?? 0,
			values[at + 6] ?? 0,
		];
		const r2: [number, number, number] = [
			values[at + 8] ?? 0,
			values[at + 9] ?? 0,
			values[at + 10] ?? 0,
		];
		positions[row * 3] = values[at + 3] ?? 0;
		positions[row * 3 + 1] = values[at + 7] ?? 0;
		positions[row * 3 + 2] = values[at + 11] ?? 0;
		// The rows hold the rotation scaled along each of its columns, so a column's length is
		// that axis's scale and its direction is the rotation's basis vector.
		const sx = Math.hypot(r0[0], r1[0], r2[0]) || 1;
		const sy = Math.hypot(r0[1], r1[1], r2[1]) || 1;
		const sz = Math.hypot(r0[2], r1[2], r2[2]) || 1;
		scales[row * 3] = sx;
		scales[row * 3 + 1] = sy;
		scales[row * 3 + 2] = sz;
		const q = quaternionOf(
			r0[0] / sx,
			r1[0] / sx,
			r2[0] / sx,
			r0[1] / sy,
			r1[1] / sy,
			r2[1] / sy,
			r0[2] / sz,
			r1[2] / sz,
			r2[2] / sz,
		);
		rotations[row * 4] = q[0];
		rotations[row * 4 + 1] = q[1];
		rotations[row * 4 + 2] = q[2];
		rotations[row * 4 + 3] = q[3];
	}
}

/**
 * The quaternion of a rotation matrix, given its columns. The matrix is orthonormal, so the
 * largest diagonal term picks the stable branch.
 */
function quaternionOf(
	m00: number,
	m10: number,
	m20: number,
	m01: number,
	m11: number,
	m21: number,
	m02: number,
	m12: number,
	m22: number,
): [number, number, number, number] {
	const trace = m00 + m11 + m22;
	let x: number;
	let y: number;
	let z: number;
	let w: number;
	if (trace > 0) {
		const s = Math.sqrt(trace + 1) * 2;
		w = s / 4;
		x = (m21 - m12) / s;
		y = (m02 - m20) / s;
		z = (m10 - m01) / s;
	} else if (m00 > m11 && m00 > m22) {
		const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
		w = (m21 - m12) / s;
		x = s / 4;
		y = (m01 + m10) / s;
		z = (m02 + m20) / s;
	} else if (m11 > m22) {
		const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
		w = (m02 - m20) / s;
		x = (m01 + m10) / s;
		y = s / 4;
		z = (m12 + m21) / s;
	} else {
		const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
		w = (m10 - m01) / s;
		x = (m02 + m20) / s;
		y = (m12 + m21) / s;
		z = s / 4;
	}
	return [x, y, z, w];
}
