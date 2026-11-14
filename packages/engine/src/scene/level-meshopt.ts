// meshoptimizer's simplifier, vertex cache order and clusterizer, which the level planner
// (levels/planner.js) and the pieces planner (levels/pieces.js) run on a job worker for a mesh made
// in code. The modules are meshoptimizer's own builds
// (github.com/zeux/meshoptimizer, MIT licence) from the npm package at the version that the engine
// pins, kept as files in packages/engine/vendor/meshopt, the same builds that the asset tool runs
// through the package. This file calls them as the package's scripts do, so the planner gives the
// same levels in the browser as in the tool.

import {
	GROUP_CONE_WEIGHT,
	GROUP_TRIANGLES,
	GROUP_VERTICES,
	meshletGroups,
} from '../../levels/pieces.js';
import type { Meshopt, SimplifierFlag } from '../../levels/planner.js';
import { MemoryViews } from '../shared/memory-views';

/** The exports of meshoptimizer's modules that the engine calls. */
interface MeshoptExports {
	memory: WebAssembly.Memory;
	__wasm_call_ctors(): void;
	/** Moves the heap's end by a number of bytes and returns the old end; 0 asks where it is. */
	sbrk(bytes: number): number;
}

interface SimplifierExports extends MeshoptExports {
	meshopt_simplifyWithAttributes(
		destination: number,
		indices: number,
		indexCount: number,
		positions: number,
		vertexCount: number,
		positionsStride: number,
		attributes: number,
		attributesStride: number,
		weights: number,
		weightCount: number,
		lock: number,
		target: number,
		error: number,
		options: number,
		resultError: number,
	): number;
}

interface EncoderExports extends MeshoptExports {
	meshopt_optimizeVertexCache(
		destination: number,
		indices: number,
		indexCount: number,
		vertexCount: number,
	): void;
}

interface ClusterizerExports extends MeshoptExports {
	meshopt_buildMeshletsBound(indexCount: number, maxVertices: number, maxTriangles: number): number;
	meshopt_buildMeshletsFlex(
		meshlets: number,
		meshletVertices: number,
		meshletTriangles: number,
		indices: number,
		indexCount: number,
		positions: number,
		vertexCount: number,
		positionsStride: number,
		maxVertices: number,
		minTriangles: number,
		maxTriangles: number,
		coneWeight: number,
		splitFactor: number,
	): number;
	meshopt_optimizeMeshlet(
		meshletVertices: number,
		meshletTriangles: number,
		triangleCount: number,
		vertexCount: number,
	): void;
}

/** The bytes of one group's record in the clusterizer's output. */
const MESHLET_BYTES = 16;

/** The simplifier's option bits, by the names that the package's script takes. */
const FLAGS: Readonly<Record<SimplifierFlag, number>> = {
	LockBorder: 1,
	Sparse: 2,
	ErrorAbsolute: 4,
	Prune: 8,
	Regularize: 16,
	Permissive: 32,
};

/** A typed array's bytes. */
const bytes = (view: ArrayBufferView): Uint8Array =>
	new Uint8Array(view.buffer, view.byteOffset, view.byteLength);

/** Starts a module from its compiled code. */
async function start<T extends MeshoptExports>(module: WebAssembly.Module): Promise<T> {
	const instance = await WebAssembly.instantiate(module, {});
	const exports = instance.exports as unknown as T;
	exports.__wasm_call_ctors();
	return exports;
}

/** The planner's calls of meshoptimizer, and the bytes that the modules' heaps hold. */
export interface LevelMeshopt extends Meshopt {
	/**
	 * The triangles of `indices` over `positions` in groups of triangles that lie close together,
	 * and the triangles of each group, as the pieces planner's `Clusterize` takes them.
	 */
	clusterOrder(
		indices: Uint32Array,
		positions: Float32Array,
	): { indices: Uint32Array; counts: Uint32Array };
	/** The bytes of both modules' memories, which grow with the largest mesh and never shrink. */
	heapBytes(): number;
}

/**
 * The planner's calls of meshoptimizer, started from the compiled simplifier, encoder and
 * clusterizer modules. Each call copies its arrays into the module's heap and frees them before it
 * returns.
 */
export async function levelMeshopt(
	simplifierModule: WebAssembly.Module,
	encoderModule: WebAssembly.Module,
	clusterizerModule: WebAssembly.Module,
): Promise<LevelMeshopt> {
	const [simplifier, encoder, clusterizer] = await Promise.all([
		start<SimplifierExports>(simplifierModule),
		start<EncoderExports>(encoderModule),
		start<ClusterizerExports>(clusterizerModule),
	]);
	// Each call views a module's heap after its last call into the module, which may grow it.
	const simplifierHeap = new MemoryViews(simplifier.memory);
	const encoderHeap = new MemoryViews(encoder.memory);
	const clusterizerHeap = new MemoryViews(clusterizer.memory);
	return {
		heapBytes: () => simplifierHeap.bytes + encoderHeap.bytes + clusterizerHeap.bytes,
		simplifyWithAttributes(
			indices,
			positions,
			positionsStride,
			attributes,
			attributesStride,
			weights,
			lock,
			target,
			error,
			flags,
		) {
			let options = 0;
			for (const flag of flags) options |= FLAGS[flag];
			const { sbrk } = simplifier;
			const vertexCount = positions.length / positionsStride;
			const te = sbrk(4);
			const ti = sbrk(indices.length * 4);
			const sp = sbrk(vertexCount * positionsStride * 4);
			const sa = sbrk(vertexCount * attributesStride * 4);
			const sw = sbrk(weights.length * 4);
			const si = sbrk(indices.length * 4);
			const vl = lock ? sbrk(vertexCount) : 0;
			let heap = simplifierHeap.view(Uint8Array, 0, simplifierHeap.bytes);
			heap.set(bytes(positions), sp);
			heap.set(bytes(attributes), sa);
			heap.set(bytes(new Float32Array(weights)), sw);
			heap.set(bytes(indices), si);
			if (lock) heap.set(lock, vl);
			const count = simplifier.meshopt_simplifyWithAttributes(
				ti,
				si,
				indices.length,
				sp,
				vertexCount,
				positionsStride * 4,
				sa,
				attributesStride * 4,
				sw,
				weights.length,
				vl,
				target,
				error,
				options,
				te,
			);
			// The heap may have grown.
			heap = simplifierHeap.view(Uint8Array, 0, simplifierHeap.bytes);
			const out = new Uint32Array(count);
			bytes(out).set(heap.subarray(ti, ti + count * 4));
			const result = new Float32Array(1);
			bytes(result).set(heap.subarray(te, te + 4));
			sbrk(te - sbrk(0));
			return [out, result[0] as number];
		},
		cacheOrder(indices) {
			let vertices = 0;
			for (let i = 0; i < indices.length; i++)
				vertices = Math.max(vertices, (indices[i] as number) + 1);
			const { sbrk } = encoder;
			const at = sbrk(indices.length * 4);
			encoderHeap.view(Uint8Array, at, indices.length * 4).set(bytes(indices));
			encoder.meshopt_optimizeVertexCache(at, at, indices.length, vertices);
			const heap = encoderHeap.view(Uint8Array, 0, encoderHeap.bytes);
			const out = new Uint32Array(indices.length);
			bytes(out).set(heap.subarray(at, at + indices.length * 4));
			sbrk(at - sbrk(0));
			return out;
		},
		clusterOrder(indices, positions) {
			// The package's `buildMeshlets`: the flexible build with one size of group, then each
			// group's own order of its triangles and vertices.
			const { sbrk } = clusterizer;
			const vertexCount = positions.length / 3;
			const most = clusterizer.meshopt_buildMeshletsBound(
				indices.length,
				GROUP_VERTICES,
				GROUP_TRIANGLES,
			);
			const meshletsAt = sbrk(most * MESHLET_BYTES);
			const verticesAt = sbrk(indices.length * 4);
			const trianglesAt = sbrk(indices.length);
			const indicesAt = sbrk(indices.byteLength);
			const positionsAt = sbrk(positions.byteLength);
			let heap = clusterizerHeap.view(Uint8Array, 0, clusterizerHeap.bytes);
			heap.set(bytes(indices), indicesAt);
			heap.set(bytes(positions), positionsAt);
			const count = clusterizer.meshopt_buildMeshletsFlex(
				meshletsAt,
				verticesAt,
				trianglesAt,
				indicesAt,
				indices.length,
				positionsAt,
				vertexCount,
				12,
				GROUP_VERTICES,
				GROUP_TRIANGLES,
				GROUP_TRIANGLES,
				GROUP_CONE_WEIGHT,
				0,
			);
			heap = clusterizerHeap.view(Uint8Array, 0, clusterizerHeap.bytes);
			const meshlets = new Uint32Array(count * 4);
			bytes(meshlets).set(heap.subarray(meshletsAt, meshletsAt + count * MESHLET_BYTES));
			for (let k = 0; k < count; k++)
				clusterizer.meshopt_optimizeMeshlet(
					verticesAt + (meshlets[k * 4] as number) * 4,
					trianglesAt + (meshlets[k * 4 + 1] as number),
					meshlets[k * 4 + 3] as number,
					meshlets[k * 4 + 2] as number,
				);
			const last = (count - 1) * 4;
			const used = count > 0 ? (meshlets[last] as number) + (meshlets[last + 2] as number) : 0;
			const corners =
				count > 0 ? (meshlets[last + 1] as number) + (meshlets[last + 3] as number) * 3 : 0;
			heap = clusterizerHeap.view(Uint8Array, 0, clusterizerHeap.bytes);
			const vertices = new Uint32Array(used);
			bytes(vertices).set(heap.subarray(verticesAt, verticesAt + used * 4));
			const triangles = heap.slice(trianglesAt, trianglesAt + corners);
			sbrk(meshletsAt - sbrk(0));
			return meshletGroups(meshlets, vertices, triangles, count);
		},
	};
}
