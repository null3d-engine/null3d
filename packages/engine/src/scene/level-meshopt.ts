// meshoptimizer's simplifier and vertex cache order, which the level planner (levels/planner.js)
// runs on a job worker for a mesh made in code. The modules are meshoptimizer's own builds
// (github.com/zeux/meshoptimizer, MIT licence) from the npm package at the version that the engine
// pins, kept as files in packages/engine/vendor/meshopt, the same builds that the asset tool runs
// through the package. This file calls them as the package's scripts do, so the planner gives the
// same levels in the browser as in the tool.

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
	/** The bytes of both modules' memories, which grow with the largest mesh and never shrink. */
	heapBytes(): number;
}

/**
 * The planner's calls of meshoptimizer, started from the compiled simplifier and encoder modules.
 * Each call copies its arrays into the module's heap and frees them before it returns.
 */
export async function levelMeshopt(
	simplifierModule: WebAssembly.Module,
	encoderModule: WebAssembly.Module,
): Promise<LevelMeshopt> {
	const [simplifier, encoder] = await Promise.all([
		start<SimplifierExports>(simplifierModule),
		start<EncoderExports>(encoderModule),
	]);
	// Each call views a module's heap after its last call into the module, which may grow it.
	const simplifierHeap = new MemoryViews(simplifier.memory);
	const encoderHeap = new MemoryViews(encoder.memory);
	return {
		heapBytes: () => simplifierHeap.bytes + encoderHeap.bytes,
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
	};
}
