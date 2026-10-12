// PLY files for assets convert: text and binary PLY, as scanners and photogrammetry programs
// write them. Vertices keep their normals, colors and texture coordinates. Faces become
// triangles, polygons as fans from their first corner. A file without faces is a point cloud,
// which becomes glTF points.
import { Document, Primitive } from '@gltf-transform/core';
import { createPrimitive } from './convert-document.js';
import { srgbToLinear } from './images.js';

/** Each PLY type: its bytes, and how a DataView reads it. */
const TYPES = /** @type {const} */ ({
	char: [1, 'getInt8'],
	int8: [1, 'getInt8'],
	uchar: [1, 'getUint8'],
	uint8: [1, 'getUint8'],
	short: [2, 'getInt16'],
	int16: [2, 'getInt16'],
	ushort: [2, 'getUint16'],
	uint16: [2, 'getUint16'],
	int: [4, 'getInt32'],
	int32: [4, 'getInt32'],
	uint: [4, 'getUint32'],
	uint32: [4, 'getUint32'],
	float: [4, 'getFloat32'],
	float32: [4, 'getFloat32'],
	double: [8, 'getFloat64'],
	float64: [8, 'getFloat64'],
});

/** @typedef {keyof typeof TYPES} PlyType */

/**
 * A property of an element: a value, or a list with its count's type.
 *
 * @typedef {{ name: string, type: PlyType, countType?: PlyType }} Property
 */

/** @typedef {{ name: string, count: number, properties: Property[] }} Element */

/**
 * The header of a PLY file: its format, its elements, and the byte where its data starts.
 *
 * @param {Uint8Array} bytes
 */
export function readPlyHeader(bytes) {
	const end = findHeaderEnd(bytes);
	const lines = new TextDecoder('latin1').decode(bytes.subarray(0, end)).split(/\r?\n/);
	if (lines[0]?.trim() !== 'ply')
		throw new Error('the file is not a PLY file: it does not start with "ply"');
	let format = '';
	/** @type {Element[]} */
	const elements = [];
	for (const line of lines.slice(1)) {
		const words = line.trim().split(/\s+/);
		const type = (/** @type {string | undefined} */ word) => {
			if (word === undefined || !Object.hasOwn(TYPES, word))
				throw new Error(
					`the PLY header has the line "${line.trim()}", with a type it does not know`,
				);
			return /** @type {PlyType} */ (word);
		};
		if (words[0] === 'format') format = words[1] ?? '';
		else if (words[0] === 'element')
			elements.push({ name: words[1] ?? '', count: Number(words[2]), properties: [] });
		else if (words[0] === 'property') {
			const element = elements.at(-1);
			if (!element) throw new Error('the PLY header has a property before any element');
			if (words[1] === 'list')
				element.properties.push({
					name: words[4] ?? '',
					type: type(words[3]),
					countType: type(words[2]),
				});
			else element.properties.push({ name: words[2] ?? '', type: type(words[1]) });
		}
	}
	if (!['ascii', 'binary_little_endian', 'binary_big_endian'].includes(format))
		throw new Error(`the PLY file has the format "${format}", which the tool does not read`);
	for (const element of elements)
		if (!Number.isSafeInteger(element.count) || element.count < 0)
			throw new Error(`the PLY element ${element.name} has no count`);
	return { format, elements, start: end };
}

/**
 * The byte after the header's `end_header` line.
 *
 * @param {Uint8Array} bytes
 */
function findHeaderEnd(bytes) {
	const marker = new TextEncoder().encode('end_header');
	const limit = Math.min(bytes.length, 1 << 16);
	for (let i = 0; i + marker.length <= limit; i++) {
		if (!marker.every((byte, k) => bytes[i + k] === byte)) continue;
		let end = i + marker.length;
		if (bytes[end] === 13) end++;
		if (bytes[end] === 10) end++;
		return end;
	}
	throw new Error('the file is not a PLY file: its header has no end_header line');
}

/**
 * Reads every element's values: for each element, each property's values in vertex order, and
 * for a list property, an array of its values per item.
 *
 * @param {Uint8Array} bytes
 * @returns {Map<string, Map<string, (number | number[])[]>>}
 */
export function readPlyData(bytes) {
	const { format, elements, start } = readPlyHeader(bytes);
	/** @type {Map<string, Map<string, (number | number[])[]>>} */
	const out = new Map();
	for (const element of elements)
		out.set(element.name, new Map(element.properties.map((property) => [property.name, []])));
	if (format === 'ascii') {
		const words = new TextDecoder('latin1')
			.decode(bytes.subarray(start))
			.split(/\s+/)
			.filter(Boolean);
		let at = 0;
		const next = () => {
			if (at >= words.length) throw new Error('the PLY file ends before its last element');
			return Number(words[at++]);
		};
		for (const element of elements) {
			const columns = /** @type {Map<string, (number | number[])[]>} */ (out.get(element.name));
			for (let i = 0; i < element.count; i++)
				for (const property of element.properties) {
					const column = /** @type {(number | number[])[]} */ (columns.get(property.name));
					if (property.countType) {
						const n = next();
						column.push(Array.from({ length: n }, next));
					} else column.push(next());
				}
		}
		return out;
	}
	const little = format === 'binary_little_endian';
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let at = start;
	const read = (/** @type {PlyType} */ type) => {
		const [size, method] = TYPES[type];
		if (at + size > bytes.length) throw new Error('the PLY file ends before its last element');
		const value = /** @type {(at: number, little: boolean) => number} */ (view[method].bind(view))(
			at,
			little,
		);
		at += size;
		return value;
	};
	for (const element of elements) {
		const columns = /** @type {Map<string, (number | number[])[]>} */ (out.get(element.name));
		const list = element.properties.map(
			(property) => /** @type {(number | number[])[]} */ (columns.get(property.name)),
		);
		for (let i = 0; i < element.count; i++)
			element.properties.forEach((property, p) => {
				const column = /** @type {(number | number[])[]} */ (list[p]);
				if (property.countType) {
					const n = read(property.countType);
					column.push(Array.from({ length: n }, () => read(property.type)));
				} else column.push(read(property.type));
			});
	}
	return out;
}

/** The names that PLY files give each vertex value, in the order that glTF stores them. */
const NAMES = {
	positions: ['x', 'y', 'z'],
	normals: ['nx', 'ny', 'nz'],
	colors: ['red', 'green', 'blue', 'alpha'],
	uvs: [
		['s', 't'],
		['u', 'v'],
		['texture_u', 'texture_v'],
		['texture_s', 'texture_t'],
	],
};

/**
 * The glTF document of a PLY file: one node and mesh, of triangles, or of points when the file has
 * no faces. Colors in bytes are sRGB, which glTF stores as linear values.
 *
 * @param {Uint8Array} bytes
 * @param {string} name
 */
export function plyDocument(bytes, name) {
	const { elements } = readPlyHeader(bytes);
	const data = readPlyData(bytes);
	const vertex = data.get('vertex');
	if (!vertex) throw new Error('the PLY file has no vertex element');
	const count = /** @type {(number | number[])[]} */ (vertex.get('x') ?? []).length;
	const types = new Map(
		(elements.find((element) => element.name === 'vertex')?.properties ?? []).map((p) => [
			p.name,
			p.type,
		]),
	);
	/** Interleaved values of the named properties, or undefined when one is missing. */
	const values = (
		/** @type {readonly string[]} */ names,
		/** @type {(v: number, name: string) => number} */ map = (v) => v,
	) => {
		if (!names.every((n) => vertex.has(n))) return undefined;
		const out = new Float32Array(count * names.length);
		names.forEach((n, c) => {
			const column = /** @type {number[]} */ (vertex.get(n));
			for (let i = 0; i < count; i++)
				out[i * names.length + c] = map(/** @type {number} */ (column[i]), n);
		});
		return out;
	};
	const positions = values(NAMES.positions);
	if (!positions) throw new Error('the PLY file has no x, y and z for its vertices');
	const normals = values(NAMES.normals);
	const integer = (/** @type {string} */ n) =>
		!String(types.get(n)).startsWith('float') && types.get(n) !== 'double';
	const colorNames = vertex.has('alpha') ? NAMES.colors : NAMES.colors.slice(0, 3);
	const colors = values(colorNames, (v, n) =>
		integer(n)
			? n === 'alpha'
				? v / 255
				: srgbToLinear(Math.max(0, Math.min(255, v))) / 65535
			: v,
	);
	const uvNames = NAMES.uvs.find((pair) => pair.every((n) => vertex.has(n)));
	// PLY puts the texture's bottom row at V = 0, and glTF its top row.
	const uv = uvNames && values(uvNames, (v, n) => (n === uvNames[1] ? 1 - v : v));
	const faces = data.get('face');
	const list = faces?.get('vertex_indices') ?? faces?.get('vertex_index');
	/** @type {number[]} */
	const triangles = [];
	for (const corners of /** @type {number[][]} */ (list ?? []))
		for (let k = 1; k + 1 < corners.length; k++)
			triangles.push(
				/** @type {number} */ (corners[0]),
				/** @type {number} */ (corners[k]),
				/** @type {number} */ (corners[k + 1]),
			);
	for (const index of triangles)
		if (!(index >= 0 && index < count))
			throw new Error(
				`the PLY file has a face with the corner ${index}, past its ${count} vertices`,
			);
	const doc = new Document();
	const buffer = doc.createBuffer();
	const scene = doc.createScene();
	doc.getRoot().setDefaultScene(scene);
	const points = triangles.length === 0;
	const material = doc.createMaterial('PLY').setRoughnessFactor(1).setMetallicFactor(0);
	const prim = createPrimitive(doc, buffer, {
		positions,
		...(normals && { normals }),
		...(uv && { uvs: [uv] }),
		...(colors && { colors, colorSize: /** @type {3 | 4} */ (colorNames.length) }),
		...(!points && { indices: Uint32Array.from(triangles) }),
		mode: points ? Primitive.Mode.POINTS : Primitive.Mode.TRIANGLES,
		material,
	});
	scene.addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim)));
	return doc;
}
