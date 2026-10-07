// The meshopt decoder, which the glTF worker (workers/gltf-worker.ts) starts with the first file
// that holds meshopt data. The on-demand loader (shared/tasks.ts) compiles its module once per page
// in the thread that runs the sketch, and sends it to the glTF worker, which only instantiates it.
// A page without such files downloads none of it.
//
// The module is the SIMD build of meshoptimizer's own decoder (github.com/zeux/meshoptimizer, MIT
// licence), from the npm package at the version that the engine pins, kept as a file in
// packages/engine/vendor/meshopt. This file calls it as meshoptimizer's decoder script does.
import type { MeshoptDecode } from './gltf-parse';

/** The decoder's exports that the engine calls. */
interface MeshoptExports {
	memory: WebAssembly.Memory;
	__wasm_call_ctors(): void;
	/** Moves the heap's end by a number of bytes and returns the old end; 0 asks where it is. */
	sbrk(bytes: number): number;
	[name: string]: unknown;
}

/** The decoder's function for each mode of the extension. */
const DECODERS: Readonly<Record<string, string>> = {
	ATTRIBUTES: 'meshopt_decodeVertexBuffer',
	TRIANGLES: 'meshopt_decodeIndexBuffer',
	INDICES: 'meshopt_decodeIndexSequence',
};

/** The decoder's function for each filter of the extension. */
const FILTERS: Readonly<Record<string, string>> = {
	OCTAHEDRAL: 'meshopt_decodeFilterOct',
	QUATERNION: 'meshopt_decodeFilterQuat',
	EXPONENTIAL: 'meshopt_decodeFilterExp',
	COLOR: 'meshopt_decodeFilterColor',
};

type DecodeFunction = (
	target: number,
	count: number,
	size: number,
	source: number,
	length: number,
) => number;
type FilterFunction = (target: number, count: number, size: number) => void;

/** The decoder, started from its compiled module. */
export async function meshoptDecoder(module: WebAssembly.Module): Promise<MeshoptDecode> {
	const instance = await WebAssembly.instantiate(module, {});
	const exports = instance.exports as unknown as MeshoptExports;
	exports.__wasm_call_ctors();
	return (target, count, size, source, mode, filter) => {
		const decode = exports[DECODERS[mode] ?? ''] as DecodeFunction | undefined;
		const filterOf = exports[FILTERS[filter] ?? ''] as FilterFunction | undefined;
		if (!decode) throw new Error(`Unknown meshopt mode ${mode}`);
		const { sbrk } = exports;
		// Filters work on whole groups of four elements.
		const count4 = (count + 3) & ~3;
		const out = sbrk(count4 * size);
		const at = sbrk(source.length);
		const heap = new Uint8Array(exports.memory.buffer);
		heap.set(source, at);
		const result = decode(out, count, size, at, source.length);
		if (result === 0 && filterOf) filterOf(out, count4, size);
		target.set(new Uint8Array(exports.memory.buffer).subarray(out, out + count * size));
		sbrk(out - sbrk(0));
		if (result !== 0) throw new Error(`Malformed buffer data: ${result}`);
	};
}
