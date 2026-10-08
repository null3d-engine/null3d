// The Draco decoder, which the glTF worker (workers/gltf-worker.ts) starts with the first file that
// holds KHR_draco_mesh_compression data. The on-demand loader (shared/tasks.ts) compiles its module
// once per page in the thread that runs the sketch, and sends it to the glTF worker, which only
// instantiates it. A page without such files downloads none of it.
//
// The decoder is Draco's own glTF build (github.com/google/draco, Apache-2.0 licence), at the
// release that the engine pins, kept unchanged in packages/engine/vendor/draco
// (tools/vendor-draco.ts). Its script makes no code from strings, so a strict
// Content-Security-Policy lets it run.
//
// The decoder hands each attribute back in the type of its accessor, as three.js's DRACOLoader
// asks for it. Float normals and tangents then become normalized bytes, and float texture
// coordinates within 0 to 1 normalized 16-bit integers, as the asset tool writes them, which
// halves most meshes' vertex memory. Positions stay floats, which their bounds describe.
//
// A hostile file can make the decoder's own memory grow, which never shrinks. So an instance that
// failed, or whose memory grew past what a small file may decode to, is spent: the worker starts a
// fresh one from the compiled module for the next file, and the old memory goes.

import type {
	DracoDecoderObject,
	DracoFactory,
	DracoMesh,
	DracoModule,
} from '../../vendor/draco/draco_wasm_wrapper_gltf.js';
import { FILE_LIMITS } from './file-limits';
import type { DracoDecode, DracoDecoded, DracoRequest } from './gltf-parse';

/** A decoder instance, and whether it is spent. */
export interface DracoDecoder {
	decode: DracoDecode;
	/** True once the instance failed or its memory grew too large: it must not decode again. */
	readonly spent: boolean;
}

// Numbers of the glTF 2.0 specification.
const BYTE = 5120;
const UNSIGNED_BYTE = 5121;
const SHORT = 5122;
const UNSIGNED_SHORT = 5123;
const UNSIGNED_INT = 5125;
const FLOAT = 5126;

/** How far outside 0 to 1 a texture coordinate may lie and still round onto 0 or 1: half a step. */
const UV_SLACK = 0.5 / 65535;

/** The bytes that start Draco data: "DRACO". */
const DRACO_MAGIC = [0x44, 0x52, 0x41, 0x43, 0x4f];

/** The script's factory, once a decoder has imported it. A failed import lets the next try again. */
let factory: Promise<DracoFactory> | undefined;

/**
 * Imports Draco's script. A bundle wraps it as CommonJS and gives its factory as the default
 * export. Served as it is, the script runs as a plain module and hands the factory to an AMD
 * `define`, which this function offers for the time of the import.
 */
function importFactory(): Promise<DracoFactory> {
	factory ??= (async () => {
		const scope = globalThis as { define?: unknown };
		const before = Object.getOwnPropertyDescriptor(scope, 'define');
		let defined: DracoFactory | undefined;
		const define = (_needs: unknown, make: () => DracoFactory) => {
			defined = make();
		};
		define.amd = true;
		scope.define = define;
		try {
			const module = await import('../../vendor/draco/draco_wasm_wrapper_gltf.js');
			const found = module.default ?? defined;
			if (typeof found !== 'function') throw new Error('its script gave no decoder');
			return found;
		} finally {
			if (before) Object.defineProperty(scope, 'define', before);
			else delete scope.define;
		}
	})();
	factory.catch(() => {
		factory = undefined;
	});
	return factory;
}

/** A decoder instance, started from the compiled module. */
export async function dracoDecoder(compiled: WebAssembly.Module): Promise<DracoDecoder> {
	const make = await importFactory();
	// The module waits for its instance through a callback alone, so a failure ends the wait here.
	let fail: (error: unknown) => void = () => {};
	const failed = new Promise<never>((_, reject) => {
		fail = reject;
	});
	const draco = await Promise.race([
		make({
			instantiateWasm(imports, receive) {
				WebAssembly.instantiate(compiled, imports).then(
					(instance) => receive(instance, compiled),
					fail,
				);
				return {};
			},
		}),
		failed,
	]);
	const decoder = new draco.Decoder();
	let spent = false;
	return {
		get spent() {
			return spent;
		},
		decode(source, request) {
			if (spent) throw new Error('the decoder failed on an earlier file');
			try {
				return decodeMesh(draco, decoder, source, request);
			} catch (error) {
				spent = true;
				throw error;
			} finally {
				if (draco.HEAPU8.length > FILE_LIMITS.modelFloorBytes) spent = true;
			}
		},
	};
}

/** Decodes one primitive's Draco data into the arrays that the request names. */
function decodeMesh(
	draco: DracoModule,
	decoder: DracoDecoderObject,
	source: Uint8Array,
	request: DracoRequest,
): DracoDecoded {
	if (!DRACO_MAGIC.every((byte, k) => source[k] === byte)) throw new Error('it is not Draco data');
	const bytes = new Int8Array(source.buffer, source.byteOffset, source.byteLength);
	if (decoder.GetEncodedGeometryType(bytes) !== draco.TRIANGULAR_MESH)
		throw new Error('it holds no triangle mesh');
	const mesh = new draco.Mesh();
	try {
		const status = decoder.DecodeArrayToMesh(bytes, bytes.byteLength, mesh);
		const ok = status.ok();
		const message = ok ? '' : status.error_msg();
		draco.destroy(status);
		if (!ok) throw new Error(message.replace(/\.$/, ''));
		const vertices = mesh.num_points();
		if (vertices !== request.vertices)
			throw new Error(`it holds ${vertices} vertices, and the accessors say ${request.vertices}`);
		const corners = mesh.num_faces() * 3;
		if (request.indices !== undefined && corners !== request.indices)
			throw new Error(`it holds ${corners} indices, and the accessor says ${request.indices}`);
		const attributes = request.attributes.map((wanted) =>
			readAttribute(draco, decoder, mesh, wanted, request),
		);
		return { attributes, indices: readIndices(draco, decoder, mesh, corners, request) };
	} finally {
		draco.destroy(mesh);
	}
}

/** Each component type's bytes, and the decoder's data type for it. */
function dataType(draco: DracoModule, componentType: number): [bytes: number, type: number] {
	switch (componentType) {
		case BYTE:
			return [1, draco.DT_INT8];
		case UNSIGNED_BYTE:
			return [1, draco.DT_UINT8];
		case SHORT:
			return [2, draco.DT_INT16];
		case UNSIGNED_SHORT:
			return [2, draco.DT_UINT16];
		case UNSIGNED_INT:
			return [4, draco.DT_UINT32];
		default:
			return [4, draco.DT_FLOAT32];
	}
}

/** The typed array of a component type. */
function arrayOf(
	componentType: number,
	buffer: ArrayBuffer,
): DracoDecoded['attributes'][number]['array'] {
	switch (componentType) {
		case BYTE:
			return new Int8Array(buffer);
		case UNSIGNED_BYTE:
			return new Uint8Array(buffer);
		case SHORT:
			return new Int16Array(buffer);
		case UNSIGNED_SHORT:
			return new Uint16Array(buffer);
		case UNSIGNED_INT:
			return new Uint32Array(buffer);
		default:
			return new Float32Array(buffer);
	}
}

/**
 * One attribute's values in its accessor's type, or quantized: float normals and tangents into
 * normalized bytes, and float texture coordinates within 0 to 1 into normalized 16-bit integers.
 */
function readAttribute(
	draco: DracoModule,
	decoder: DracoDecoderObject,
	mesh: DracoMesh,
	wanted: DracoRequest['attributes'][number],
	request: DracoRequest,
): DracoDecoded['attributes'][number] {
	const attribute = decoder.GetAttributeByUniqueId(mesh, wanted.id);
	if (draco.getPointer(attribute) === 0) throw new Error(`it holds no attribute ${wanted.id}`);
	const components = attribute.num_components();
	if (components !== wanted.components)
		throw new Error(
			`its attribute ${wanted.id} has ${components} components, and the accessor of ${wanted.name} ${wanted.components}`,
		);
	const values = request.vertices * components;
	const [size, type] = dataType(draco, wanted.componentType);
	const byteLength = values * size;
	const pointer = draco._malloc(byteLength);
	if (pointer === 0 && byteLength > 0)
		throw new Error(`the decoder has no memory for ${wanted.name}`);
	try {
		if (!decoder.GetAttributeDataArrayForAllPoints(mesh, attribute, type, byteLength, pointer))
			throw new Error(`its attribute ${wanted.id} does not read as ${wanted.name}`);
		const heap = draco.HEAPU8.buffer;
		if (wanted.componentType === FLOAT) {
			const floats = new Float32Array(heap, pointer, values);
			const quantized = quantize(wanted.name, floats, request);
			if (quantized) return quantized;
		}
		request.take(byteLength, wanted.name);
		const array = arrayOf(wanted.componentType, heap.slice(pointer, pointer + byteLength));
		return { array, componentType: wanted.componentType, normalized: wanted.normalized };
	} finally {
		draco._free(pointer);
	}
}

/**
 * Float normals and tangents as normalized bytes, and float texture coordinates within 0 to 1 as
 * normalized 16-bit integers, or undefined for floats that stay floats.
 */
function quantize(
	name: string,
	floats: Float32Array,
	request: DracoRequest,
): DracoDecoded['attributes'][number] | undefined {
	if (name === 'NORMAL' || name === 'TANGENT') {
		request.take(floats.length, name);
		const out = new Int8Array(floats.length);
		for (let i = 0; i < floats.length; i++)
			out[i] = Math.round(Math.min(1, Math.max(-1, floats[i] as number)) * 127);
		return { array: out, componentType: BYTE, normalized: true };
	}
	if (!name.startsWith('TEXCOORD_')) return undefined;
	// Draco's own quantization can land a value a hair outside 0 to 1, which rounds onto the end.
	for (const value of floats) if (!(value >= -UV_SLACK && value <= 1 + UV_SLACK)) return undefined;
	request.take(floats.length * 2, name);
	const out = new Uint16Array(floats.length);
	for (let i = 0; i < floats.length; i++)
		out[i] = Math.round(Math.min(1, Math.max(0, floats[i] as number)) * 65535);
	return { array: out, componentType: UNSIGNED_SHORT, normalized: true };
}

/** The mesh's triangles: 16-bit indices when every vertex has one, else 32-bit. */
function readIndices(
	draco: DracoModule,
	decoder: DracoDecoderObject,
	mesh: DracoMesh,
	corners: number,
	request: DracoRequest,
): Uint16Array | Uint32Array {
	const wide = request.vertices > 0x10000;
	const byteLength = corners * (wide ? 4 : 2);
	request.take(byteLength, 'indices');
	const pointer = draco._malloc(byteLength);
	if (pointer === 0 && byteLength > 0) throw new Error('the decoder has no memory for the indices');
	try {
		const read = wide
			? decoder.GetTrianglesUInt32Array(mesh, byteLength, pointer)
			: decoder.GetTrianglesUInt16Array(mesh, byteLength, pointer);
		if (!read) throw new Error('its triangles do not read');
		const copy = draco.HEAPU8.buffer.slice(pointer, pointer + byteLength);
		return wide ? new Uint32Array(copy) : new Uint16Array(copy);
	} finally {
		draco._free(pointer);
	}
}
