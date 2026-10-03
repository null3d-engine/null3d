// The formats that the asset tool writes into model files and the engine reads, from the engine's
// own Rust core built to WebAssembly (the null3d-assets-wasm crate), so the tool and the engine
// share one source for each. `bun run build` builds the module into this package's dist folder.
//
// The module takes a request in its memory, runs an export, and gives a response: the format's
// bytes, or a message when the input is not one it can store.
import { readFileSync } from 'node:fs';

/** Where `bun run build` writes the module. */
export const ASSET_FORMATS_URL = new URL('../../dist/assets.wasm', import.meta.url);

/**
 * @typedef {object} FormatsModule
 * @property {WebAssembly.Memory} memory
 * @property {(length: number) => number} request
 * @property {() => number} mesh_bvh
 * @property {() => number} response
 * @property {() => number} response_length
 */

/** @type {FormatsModule | undefined} */
let formats;

/** The module, loaded on the first call. */
function module() {
	if (!formats) {
		let bytes;
		try {
			bytes = readFileSync(ASSET_FORMATS_URL);
		} catch {
			throw new Error(
				"the asset tool's formats module is missing. In a copy of the engine's source, run bun run build first",
			);
		}
		formats = /** @type {FormatsModule} */ (
			/** @type {unknown} */ (new WebAssembly.Instance(new WebAssembly.Module(bytes)).exports)
		);
	}
	return formats;
}

/**
 * Runs an export on a request, and returns the response's bytes, or throws its message.
 *
 * @param {(m: FormatsModule) => number} call
 * @param {Uint8Array} request
 */
function respond(call, request) {
	const m = module();
	const at = m.request(request.byteLength);
	new Uint8Array(m.memory.buffer, at, request.byteLength).set(request);
	const failed = call(m);
	const out = new Uint8Array(m.memory.buffer, m.response(), m.response_length()).slice();
	if (failed) throw new Error(new TextDecoder().decode(out));
	return out;
}

/**
 * The stored tree of a mesh's triangles, which the engine's raycasts load instead of building one
 * (`MeshBvh::to_bytes` of the engine's core). Its bytes are the same on every machine.
 *
 * @param {Float32Array} positions Three floats per vertex.
 * @param {Uint32Array} indices Three per triangle.
 * @returns {Uint8Array}
 */
export function meshBvh(positions, indices) {
	const request = new Uint8Array(8 + positions.byteLength + indices.byteLength);
	const view = new DataView(request.buffer);
	view.setUint32(0, positions.length / 3, true);
	view.setUint32(4, indices.length, true);
	for (let i = 0; i < positions.length; i++)
		view.setFloat32(8 + i * 4, /** @type {number} */ (positions[i]), true);
	const base = 8 + positions.byteLength;
	for (let i = 0; i < indices.length; i++)
		view.setUint32(base + i * 4, /** @type {number} */ (indices[i]), true);
	return respond((m) => m.mesh_bvh(), request);
}
