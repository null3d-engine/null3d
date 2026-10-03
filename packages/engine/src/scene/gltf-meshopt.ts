// The meshopt decoder, which the glTF worker (workers/gltf-worker.ts) imports with the first file
// that holds meshopt data. A page without such files downloads none of it.
//
// It is meshoptimizer's own decoder (github.com/zeux/meshoptimizer, MIT licence), from the npm
// package at the version that package.json pins. The decoder holds two WebAssembly builds, one with
// SIMD instructions and one without, and starts the SIMD build where the browser validates it.
import { MeshoptDecoder } from 'meshoptimizer/decoder';
import type { MeshoptDecode } from './gltf-parse';

/** The decoder, once its WebAssembly module has started. */
export async function meshoptDecoder(): Promise<MeshoptDecode> {
	await MeshoptDecoder.ready;
	return MeshoptDecoder.decodeGltfBuffer;
}
