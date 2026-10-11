// STL files for assets convert: binary and text STL, as 3D printers and CAD programs write them.
// Each solid becomes a mesh of its triangles, with corners at the same place joined into one
// vertex. The file's facet normals are left out: glTF readers shade a mesh without normals flat,
// which is what the facets say, and the vertices then join across faces.
import { Document } from '@gltf-transform/core';
import { createPrimitive } from './convert-document.js';
import { srgbToLinear } from './images.js';

/**
 * One solid's triangles: three corners each, and a color for each triangle when the file has
 * them, as linear RGB from 0 to 1.
 *
 * @typedef {{ name: string, corners: Float32Array, colors?: Float32Array }} Solid
 */

/** The bytes of a binary STL file's header and triangle count. */
const HEADER = 84;

/** The bytes of one triangle in a binary STL file. */
const TRIANGLE = 50;

/**
 * The solids of an STL file.
 *
 * @param {Uint8Array} bytes
 * @param {string} name The file's name, which a binary file's one solid takes.
 * @returns {Solid[]}
 */
export function readStl(bytes, name) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (bytes.length >= HEADER && HEADER + view.getUint32(80, true) * TRIANGLE === bytes.length)
		return [binarySolid(bytes, view, name)];
	return textSolids(new TextDecoder().decode(bytes));
}

/**
 * The 5-bit channel of a packed color as linear light from 0 to 1.
 *
 * @param {number} value From 0 to 31.
 */
const channel5 = (value) => srgbToLinear(Math.round((value * 255) / 31)) / 65535;

/**
 * The solid of a binary STL file. A header that holds `COLOR=` marks Materialise's colors: each
 * triangle's color in its last two bytes, unless their top bit says to take the header's color.
 *
 * @param {Uint8Array} bytes
 * @param {DataView} view
 * @param {string} name
 * @returns {Solid}
 */
function binarySolid(bytes, view, name) {
	const count = view.getUint32(80, true);
	const header = new TextDecoder('latin1').decode(bytes.subarray(0, 80));
	const colorAt = header.indexOf('COLOR=');
	const colored = colorAt >= 0 && colorAt + 10 <= 80;
	const fallback = colored
		? [0, 1, 2].map((c) => srgbToLinear(/** @type {number} */ (bytes[colorAt + 6 + c])) / 65535)
		: [];
	const corners = new Float32Array(count * 9);
	const colors = colored ? new Float32Array(count * 3) : undefined;
	for (let t = 0; t < count; t++) {
		const at = HEADER + t * TRIANGLE;
		for (let k = 0; k < 9; k++) corners[t * 9 + k] = view.getFloat32(at + 12 + k * 4, true);
		if (colors) {
			const packed = view.getUint16(at + 48, true);
			const rgb =
				(packed & 0x8000) === 0
					? [channel5(packed & 31), channel5((packed >> 5) & 31), channel5((packed >> 10) & 31)]
					: fallback;
			colors.set(rgb, t * 3);
		}
	}
	return { name, corners, ...(colors && { colors }) };
}

/**
 * The solids of a text STL file, each named by its `solid` line.
 *
 * @param {string} text
 * @returns {Solid[]}
 */
function textSolids(text) {
	/** @type {Solid[]} */
	const solids = [];
	/** @type {number[]} */
	let corners = [];
	let name = '';
	let open = false;
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trim();
		if (line.startsWith('solid')) {
			name = line.slice(5).trim();
			corners = [];
			open = true;
		} else if (line.startsWith('vertex')) {
			const values = line.slice(6).trim().split(/\s+/).map(Number);
			if (values.length !== 3 || values.some((v) => !Number.isFinite(v)))
				throw new Error(`the STL file has the line "${line}", which is not a corner`);
			corners.push(...values);
		} else if (line.startsWith('endsolid') && open) {
			solids.push({ name, corners: Float32Array.from(corners) });
			open = false;
		}
	}
	if (open) solids.push({ name, corners: Float32Array.from(corners) });
	for (const solid of solids)
		if (solid.corners.length % 9 !== 0)
			throw new Error(`the solid "${solid.name}" has corners that make no whole triangle`);
	if (solids.length === 0) throw new Error('the file is not an STL file: it has no solid');
	return solids;
}

/**
 * The welded vertices and the triangles of a solid: one vertex for corners at the same place, or,
 * with colors, at the same place in the same color.
 *
 * @param {Solid} solid
 */
export function weldSolid({ corners, colors }) {
	const count = corners.length / 3;
	const bits = new Uint32Array(corners.buffer, corners.byteOffset, corners.length);
	/** @type {Map<string, number>} */
	const seen = new Map();
	const indices = new Uint32Array(count);
	/** @type {number[]} */
	const positions = [];
	/** @type {number[]} */
	const vertexColors = [];
	for (let i = 0; i < count; i++) {
		const triangle = Math.floor(i / 3);
		let key = `${bits[i * 3]} ${bits[i * 3 + 1]} ${bits[i * 3 + 2]}`;
		if (colors)
			key += ` ${colors[triangle * 3]} ${colors[triangle * 3 + 1]} ${colors[triangle * 3 + 2]}`;
		let index = seen.get(key);
		if (index === undefined) {
			index = positions.length / 3;
			seen.set(key, index);
			positions.push(
				/** @type {number} */ (corners[i * 3]),
				/** @type {number} */ (corners[i * 3 + 1]),
				/** @type {number} */ (corners[i * 3 + 2]),
			);
			if (colors) vertexColors.push(...colors.subarray(triangle * 3, triangle * 3 + 3));
		}
		indices[i] = index;
	}
	return {
		positions: Float32Array.from(positions),
		indices,
		...(colors && { colors: Float32Array.from(vertexColors) }),
	};
}

/**
 * The glTF document of an STL file: a node and a mesh for each solid.
 *
 * @param {Uint8Array} bytes
 * @param {string} name
 */
export function stlDocument(bytes, name) {
	const doc = new Document();
	const buffer = doc.createBuffer();
	const scene = doc.createScene();
	doc.getRoot().setDefaultScene(scene);
	const material = doc.createMaterial('STL').setRoughnessFactor(1).setMetallicFactor(0);
	for (const solid of readStl(bytes, name)) {
		const { positions, indices, colors } = weldSolid(solid);
		const mesh = doc.createMesh(solid.name || name).addPrimitive(
			createPrimitive(doc, buffer, {
				positions,
				indices,
				material,
				...(colors && { colors, colorSize: /** @type {const} */ (3) }),
			}),
		);
		scene.addChild(doc.createNode(solid.name || name).setMesh(mesh));
	}
	return doc;
}
