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
 * @property {() => number} environment
 * @property {() => number} blocker
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
 * Runs an export on a request, and returns its status and the response's bytes.
 *
 * @param {(m: FormatsModule) => number} call
 * @param {Uint8Array} request
 */
function call(call, request) {
	const m = module();
	const at = m.request(request.byteLength);
	new Uint8Array(m.memory.buffer, at, request.byteLength).set(request);
	const status = call(m);
	return {
		status,
		bytes: new Uint8Array(m.memory.buffer, m.response(), m.response_length()).slice(),
	};
}

/**
 * Runs an export on a request, and returns the response's bytes, or throws its message.
 *
 * @param {(m: FormatsModule) => number} run
 * @param {Uint8Array} request
 */
function respond(run, request) {
	const { status, bytes } = call(run, request);
	if (status) throw new Error(new TextDecoder().decode(bytes));
	return bytes;
}

/**
 * A request that starts with whole numbers, then a mesh's positions and indices.
 *
 * @param {number[]} head
 * @param {Float32Array} positions Three floats per vertex.
 * @param {Uint32Array} indices Three per triangle.
 */
function meshRequest(head, positions, indices) {
	const start = head.length * 4;
	const request = new Uint8Array(start + positions.byteLength + indices.byteLength);
	const view = new DataView(request.buffer);
	head.forEach((value, k) => {
		view.setUint32(k * 4, value, true);
	});
	for (let i = 0; i < positions.length; i++)
		view.setFloat32(start + i * 4, /** @type {number} */ (positions[i]), true);
	const base = start + positions.byteLength;
	for (let i = 0; i < indices.length; i++)
		view.setUint32(base + i * 4, /** @type {number} */ (indices[i]), true);
	return request;
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
	return respond(
		(m) => m.mesh_bvh(),
		meshRequest([positions.length / 3, indices.length], positions, indices),
	);
}

/**
 * @typedef {object} BlockerSettings
 * @property {boolean} ground True when the ground hides the model from below its lowest point.
 * @property {number} [resolution] The grid's cells along the longest side of the mesh's box; the
 *   module's default when left out.
 * @property {number} [maxBoxes] The most boxes in a blocker; the module's default when left out.
 */

/**
 * @typedef {object} BlockerMesh
 * @property {Float32Array} positions Three floats per corner, in the mesh's space.
 * @property {Uint32Array} indices Three per triangle, counterclockwise from outside.
 * @property {number} boxes The boxes that it joins.
 * @property {number} fill The share of the mesh's box that it fills.
 */

/**
 * A mesh's blocker for software occlusion culling: a few boxes inside the mesh, joined into one
 * closed surface, which the engine draws in place of the mesh. The module checks that the blocker
 * lies inside the mesh, since one that bulged out would hide objects that show. Its bytes are the
 * same on every machine.
 *
 * @param {Float32Array} positions Three floats per vertex.
 * @param {Uint32Array} indices Three per triangle, counterclockwise from outside.
 * @param {BlockerSettings} settings
 * @returns {BlockerMesh | { dropped: string }} The blocker, or why the mesh gets none.
 */
export function blockerMesh(positions, indices, { ground, resolution = 0, maxBoxes = 0 }) {
	const head = [positions.length / 3, indices.length, ground ? 1 : 0, resolution, maxBoxes];
	const { status, bytes } = call((m) => m.blocker(), meshRequest(head, positions, indices));
	if (status === 1) throw new Error(new TextDecoder().decode(bytes));
	if (status === 2) return { dropped: new TextDecoder().decode(bytes) };
	const view = new DataView(bytes.buffer);
	const corners = view.getUint32(0, true);
	const count = view.getUint32(4, true);
	return {
		positions: new Float32Array(bytes.buffer, 16, corners * 3),
		indices: new Uint32Array(bytes.buffer, 16 + corners * 12, count),
		boxes: view.getUint32(8, true),
		fill: view.getFloat32(12, true),
	};
}

/** The texel formats of environment maps, in the module's numbering. */
export const ENVIRONMENT_FORMATS = /** @type {const} */ (['rgb9e5ufloat', 'rgba16float']);

/** @typedef {(typeof ENVIRONMENT_FORMATS)[number]} EnvironmentFormat */

/**
 * @typedef {object} EnvironmentSettings
 * @property {number} size The width of the largest faces: a power of 2 from 32 to 2048.
 * @property {EnvironmentFormat} format
 * @property {number} [samples] The filter's directions per texel; the module's default when
 *   left out.
 */

/**
 * An environment map's KTX2 file: a cube map of the light, prefiltered for each roughness, and the
 * spherical harmonics coefficients of its diffuse light. Its bytes are the same on every machine.
 *
 * @param {{ file: Uint8Array } | { builtin: string }} source A Radiance or OpenEXR file, or the
 *   name of a built-in environment.
 * @param {EnvironmentSettings} settings
 * @returns {Uint8Array}
 */
export function environmentMap(source, { size, format, samples = 0 }) {
	const body = 'file' in source ? source.file : new TextEncoder().encode(source.builtin);
	const request = new Uint8Array(16 + body.byteLength);
	const view = new DataView(request.buffer);
	view.setUint32(0, 'file' in source ? 0 : 1, true);
	view.setUint32(4, size, true);
	view.setUint32(8, ENVIRONMENT_FORMATS.indexOf(format), true);
	view.setUint32(12, samples, true);
	request.set(body, 16);
	return respond((m) => m.environment(), request);
}
