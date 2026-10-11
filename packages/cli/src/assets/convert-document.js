// The glTF parts that assets convert builds from other formats: primitives from plain arrays of
// vertices and indices, and textures from image files, which glTF holds as PNG or JPEG.
import { Primitive } from '@gltf-transform/core';
import { encodePng } from '../png.js';
import { imageType, readPixels } from './image-files.js';

/** @import { Buffer, Document, Material } from '@gltf-transform/core' */

/**
 * The arrays of one primitive. Every vertex array holds the same count of vertices.
 *
 * @typedef {object} PrimitiveArrays
 * @property {Float32Array} positions Three values a vertex.
 * @property {Float32Array} [normals]
 * @property {Float32Array[]} [uvs] Two values a vertex in each set, glTF's top row at V = 0.
 * @property {Float32Array} [colors] Linear RGB or RGBA from 0 to 1.
 * @property {3 | 4} [colorSize] The values a color holds. 4 unless said.
 * @property {Uint8Array | Uint16Array} [joints] Four a vertex.
 * @property {Float32Array} [weights] Four a vertex, summing to one.
 * @property {{ name: string, positions: Float32Array, normals?: Float32Array }[]} [targets] Morph
 *   targets: each one's name, which glTF keeps in the mesh's `targetNames`, and its offsets of
 *   each vertex.
 * @property {Uint32Array} [indices] Three a triangle. Without them, the vertices run in order.
 * @property {number} [mode] glTF's primitive mode: triangles unless said, or points.
 * @property {Material | null} [material]
 */

/**
 * An accessor of the document's buffer.
 *
 * @param {Document} doc
 * @param {Buffer} buffer
 * @param {ArrayBufferView} array A typed array.
 * @param {'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4' | 'MAT4'} type
 * @param {boolean} [normalized]
 */
export function accessor(doc, buffer, array, type, normalized = false) {
	return doc
		.createAccessor()
		.setBuffer(buffer)
		.setArray(/** @type {import('@gltf-transform/core').TypedArray} */ (array))
		.setType(type)
		.setNormalized(normalized);
}

/**
 * Indices in the smallest unsigned type that holds every one of them.
 *
 * @param {Uint32Array} indices
 * @param {number} vertices
 */
export const compactIndices = (indices, vertices) =>
	vertices <= 65536 ? Uint16Array.from(indices) : indices;

/**
 * A primitive of the arrays, its accessors in the document's buffer.
 *
 * @param {Document} doc
 * @param {Buffer} buffer
 * @param {PrimitiveArrays} arrays
 */
export function createPrimitive(doc, buffer, arrays) {
	const prim = doc
		.createPrimitive()
		.setMode(/** @type {any} */ (arrays.mode ?? Primitive.Mode.TRIANGLES));
	const vertices = arrays.positions.length / 3;
	prim.setAttribute('POSITION', accessor(doc, buffer, arrays.positions, 'VEC3'));
	if (arrays.normals) prim.setAttribute('NORMAL', accessor(doc, buffer, arrays.normals, 'VEC3'));
	for (const [set, uv] of (arrays.uvs ?? []).entries())
		prim.setAttribute(`TEXCOORD_${set}`, accessor(doc, buffer, uv, 'VEC2'));
	if (arrays.colors)
		prim.setAttribute(
			'COLOR_0',
			accessor(doc, buffer, arrays.colors, arrays.colorSize === 3 ? 'VEC3' : 'VEC4'),
		);
	if (arrays.joints && arrays.weights) {
		prim.setAttribute('JOINTS_0', accessor(doc, buffer, arrays.joints, 'VEC4'));
		prim.setAttribute('WEIGHTS_0', accessor(doc, buffer, arrays.weights, 'VEC4'));
	}
	for (const target of arrays.targets ?? []) {
		const morph = doc.createPrimitiveTarget(target.name);
		morph.setAttribute('POSITION', accessor(doc, buffer, target.positions, 'VEC3'));
		if (target.normals) morph.setAttribute('NORMAL', accessor(doc, buffer, target.normals, 'VEC3'));
		prim.addTarget(morph);
	}
	if (arrays.indices)
		prim.setIndices(accessor(doc, buffer, compactIndices(arrays.indices, vertices), 'SCALAR'));
	if (arrays.material) prim.setMaterial(arrays.material);
	return prim;
}

/**
 * An image as glTF holds it: a PNG or JPEG file as it is, and a TGA file as a PNG file. Undefined
 * for any other kind, which `notes` then names.
 *
 * @param {Uint8Array} bytes
 * @param {string} name The file's name, for its type and for notes.
 * @param {string[]} notes
 * @returns {{ bytes: Uint8Array, mimeType: string } | undefined}
 */
export function gltfImage(bytes, name, notes) {
	const type = imageType(bytes, name);
	if (type === 'image/png' || type === 'image/jpeg') return { bytes, mimeType: type };
	if (type === 'image/x-tga')
		try {
			return { bytes: encodePng(readPixels(bytes, name)), mimeType: 'image/png' };
		} catch (error) {
			notes.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
			return undefined;
		}
	notes.push(`${name} is not a PNG, JPEG or TGA image, so its texture is left out`);
	return undefined;
}
