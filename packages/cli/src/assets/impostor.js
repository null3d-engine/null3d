// null3d assets impostor: bakes a model's impostor atlases ahead of time. It reads a glTF model,
// draws it from every cell of an octahedral grid with the impostors add-on's own CPU bake, and
// writes the colour and surface atlases as PNG images beside a JSON file that describes the bake.
// A sketch loads the three files with `loadImpostorAtlas` and skips the bake at run time.
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { IMPOSTOR_FILE_FORMAT, IMPOSTOR_FILE_VERSION } from '@null3d/impostors/atlas-file';
import { bakeImpostorAtlas, octahedralAtlas } from '@null3d/impostors/bake';
import { readArguments, UsageError } from '../args.js';
import { encodePng } from '../png.js';
import { counted, shownPath } from '../text.js';
import { decodeImage } from './images.js';
import { glTFIO, readModel } from './pipeline.js';
import { shownBytes } from './report.js';

/** @import { Document, Material, Node, Primitive, Texture, TextureInfo } from '@gltf-transform/core' */
/** @import { ImpostorBakeMap, ImpostorBakePart } from '@null3d/impostors/bake' */

/**
 * A normal matrix's nine numbers, column by column, then the sign of the matrix's determinant.
 *
 * @typedef {[number, number, number, number, number, number, number, number, number, number]} NormalMatrix
 */

/** The views when the command names none: a five by five grid, which a far crown needs. */
export const DEFAULT_VIEWS = 25;
/** The texels on each side of a cell when the command names none. */
export const DEFAULT_TEXELS = 64;

/** glTF's triangle list mode, the only mode that the bake draws. */
const TRIANGLES = 4;
/** glTF's clamp-to-edge wrap. */
const CLAMP_TO_EDGE = 33071;

const OPTIONS = /** @type {const} */ ({
	out: { type: 'string' },
	views: { type: 'string', default: String(DEFAULT_VIEWS) },
	texels: { type: 'string', default: String(DEFAULT_TEXELS) },
	help: { type: 'boolean', short: 'h', default: false },
});

export const HELP = `Usage: bunx @null3d/cli assets impostor <model.glb|model.gltf> [options]

Bakes the impostor atlases of a model ahead of time, so a sketch loads them in place of a bake at
run time. The command draws every mesh of the model's scene, with its node transforms, from each
cell of an octahedral grid, with the same CPU bake as the @null3d/impostors add-on. It writes three
files: <name>-impostor.json, which describes the bake, and the colour and surface atlases as
<name>-impostor-color.png and <name>-impostor-surface.png.

The bake reads each material's base color factor and texture, its alpha mode and cutoff, and its
double-sided flag. Base color textures must be PNG or JPEG images: bake the source model, not one
that assets optimize wrote with KTX2 textures.

Options:
  --out <folder>     The folder for the three files (the model's folder)
  --views <count>    The fewest views in the grid: the squarest grid that holds them (${DEFAULT_VIEWS})
  --texels <count>   The texels on each side of a cell (${DEFAULT_TEXELS})`;

/**
 * @typedef {object} ImpostorArgs
 * @property {string} input
 * @property {string} out
 * @property {number} views
 * @property {number} texels
 * @property {boolean} help
 */

/**
 * The arguments that `args` gives the command.
 *
 * @param {readonly string[]} args
 * @returns {ImpostorArgs}
 */
export function parseImpostorArgs(args) {
	const { values, positionals } = readArguments(args, OPTIONS, true);
	if (values.help) return { input: '', out: '', views: 1, texels: 1, help: true };
	if (positionals.length !== 1)
		throw new UsageError(`it takes one model file, not ${counted(positionals.length, 'argument')}`);
	const input = resolve(/** @type {string} */ (positionals[0]));
	const ext = extname(input).toLowerCase();
	if (ext !== '.glb' && ext !== '.gltf')
		throw new UsageError(
			`it reads .glb and .gltf models, not "${basename(input)}". Run bunx @null3d/cli assets convert first`,
		);
	return {
		input,
		out: values.out === undefined ? dirname(input) : resolve(values.out),
		views: wholeNumber('--views', values.views),
		texels: wholeNumber('--texels', values.texels),
		help: false,
	};
}

/**
 * A whole number from 1 that an option gives, or a usage error.
 *
 * @param {string} option
 * @param {string} text
 */
function wholeNumber(option, text) {
	const value = text.trim() === '' ? Number.NaN : Number(text);
	if (!(Number.isInteger(value) && value >= 1))
		throw new UsageError(`${option} takes a whole number from 1, such as 32, not "${text}"`);
	return value;
}

/**
 * The names of the three files that the command writes for a model.
 *
 * @param {string} input The model's path.
 * @returns {{ json: string, color: string, surface: string }}
 */
export function impostorFileNames(input) {
	const name = basename(input, extname(input));
	return {
		json: `${name}-impostor.json`,
		color: `${name}-impostor-color.png`,
		surface: `${name}-impostor-surface.png`,
	};
}

/**
 * The parts that a bake draws for a model: every triangle list of every mesh in its scene, in the
 * scene's frame, with each material's colour, coverage and sides.
 *
 * @param {Document} doc
 * @returns {{ parts: ImpostorBakePart[], min: [number, number, number], max: [number, number, number] }}
 */
export function impostorParts(doc) {
	const root = doc.getRoot();
	const scene = root.getDefaultScene() ?? root.listScenes()[0];
	if (!scene) throw new Error('it has no scene');
	/** @type {ImpostorBakePart[]} */
	const parts = [];
	/** @type {[number, number, number]} */
	const min = [Infinity, Infinity, Infinity];
	/** @type {[number, number, number]} */
	const max = [-Infinity, -Infinity, -Infinity];
	/** @type {Map<Texture, ImpostorBakeMap>} */
	const images = new Map();
	scene.traverse((/** @type {Node} */ node) => {
		const mesh = node.getMesh();
		if (!mesh) return;
		const matrix = node.getWorldMatrix();
		for (const primitive of mesh.listPrimitives()) {
			if (primitive.getMode() !== TRIANGLES) continue;
			const part = primitivePart(primitive, matrix, images);
			if (!part) continue;
			const p = part.positions;
			for (let i = 0; i < p.length; i += 3)
				for (let axis = 0; axis < 3; axis++) {
					const v = /** @type {number} */ (p[i + axis]);
					if (v < /** @type {number} */ (min[axis])) min[axis] = v;
					if (v > /** @type {number} */ (max[axis])) max[axis] = v;
				}
			parts.push(part);
		}
	});
	if (parts.length === 0) throw new Error('its scene has no mesh of triangles');
	return { parts, min, max };
}

/**
 * One primitive as a bake part, moved into the scene's frame by `matrix`, or null for one with no
 * positions.
 *
 * @param {Primitive} primitive
 * @param {readonly number[]} matrix The node's world matrix, column by column.
 * @param {Map<Texture, ImpostorBakeMap>} images The colour maps already decoded, by texture.
 * @returns {ImpostorBakePart | null}
 */
function primitivePart(primitive, matrix, images) {
	const positionAccessor = primitive.getAttribute('POSITION');
	if (!positionAccessor) return null;
	const count = positionAccessor.getCount();
	const m = matrix;
	/** @type {number[]} */
	const element = [];
	const positions = new Float32Array(count * 3);
	for (let i = 0; i < count; i++) {
		positionAccessor.getElement(i, element);
		const [x, y, z] = /** @type {[number, number, number]} */ (element);
		for (let r = 0; r < 3; r++)
			positions[i * 3 + r] =
				/** @type {number} */ (m[r]) * x +
				/** @type {number} */ (m[4 + r]) * y +
				/** @type {number} */ (m[8 + r]) * z +
				/** @type {number} */ (m[12 + r]);
	}
	// Normals turn by the inverse transpose of the matrix's upper three by three.
	const normal = normalMatrix(m);
	const normalAccessor = primitive.getAttribute('NORMAL');
	let normals;
	if (normalAccessor) {
		normals = new Float32Array(count * 3);
		for (let i = 0; i < count; i++) {
			normalAccessor.getElement(i, element);
			const [x, y, z] = /** @type {[number, number, number]} */ (element);
			let nx = normal[0] * x + normal[3] * y + normal[6] * z;
			let ny = normal[1] * x + normal[4] * y + normal[7] * z;
			let nz = normal[2] * x + normal[5] * y + normal[8] * z;
			const length = Math.hypot(nx, ny, nz) || 1;
			nx /= length;
			ny /= length;
			nz /= length;
			normals[i * 3] = nx;
			normals[i * 3 + 1] = ny;
			normals[i * 3 + 2] = nz;
		}
	}
	const indexAccessor = primitive.getIndices();
	const indices = indexAccessor
		? Uint32Array.from(indexAccessor.getArray() ?? [])
		: Uint32Array.from({ length: count }, (_, i) => i);
	// A mirroring transform turns the triangles inside out, so their corners swap to keep them
	// facing out.
	if (normal[9] < 0)
		for (let i = 0; i + 2 < indices.length; i += 3) {
			const b = /** @type {number} */ (indices[i + 1]);
			indices[i + 1] = /** @type {number} */ (indices[i + 2]);
			indices[i + 2] = b;
		}
	const material = primitive.getMaterial();
	const factor = material?.getBaseColorFactor() ?? [1, 1, 1, 1];
	const alphaMode = material?.getAlphaMode() ?? 'OPAQUE';
	const covered = alphaMode !== 'OPAQUE';
	const texture = material?.getBaseColorTexture() ?? null;
	const info = material?.getBaseColorTextureInfo() ?? null;
	/** @type {ImpostorBakePart} */
	const base = {
		positions,
		...(normals ? { normals } : {}),
		indices,
		tint: [
			/** @type {number} */ (factor[0]),
			/** @type {number} */ (factor[1]),
			/** @type {number} */ (factor[2]),
		],
		alphaCutoff: alphaMode === 'MASK' ? (material?.getAlphaCutoff() ?? 0.5) : 0.5,
		doubleSided: material?.getDoubleSided() ?? false,
	};
	if (texture && info) {
		const uvAccessor = primitive.getAttribute(`TEXCOORD_${info.getTexCoord()}`);
		if (uvAccessor) {
			const uvs = new Float32Array(count * 2);
			for (let i = 0; i < count; i++) {
				uvAccessor.getElement(i, element);
				uvs[i * 2] = /** @type {number} */ (element[0]);
				uvs[i * 2 + 1] = /** @type {number} */ (element[1]);
			}
			const color = colorMap(texture, info, images);
			return {
				...base,
				uvs,
				color,
				...(covered ? { coverage: coverageMap(color, /** @type {number} */ (factor[3])) } : {}),
			};
		}
	}
	const colorAccessor = primitive.getAttribute('COLOR_0');
	const colors = new Float32Array(count * 4);
	for (let i = 0; i < count; i++) {
		if (colorAccessor) colorAccessor.getElement(i, element);
		const at = i * 4;
		colors[at] = colorAccessor ? /** @type {number} */ (element[0]) : 1;
		colors[at + 1] = colorAccessor ? /** @type {number} */ (element[1]) : 1;
		colors[at + 2] = colorAccessor ? /** @type {number} */ (element[2]) : 1;
		const alpha = colorAccessor && element.length > 3 ? /** @type {number} */ (element[3]) : 1;
		colors[at + 3] = covered ? alpha * /** @type {number} */ (factor[3]) : 1;
	}
	return { ...base, colors };
}

/**
 * The inverse transpose of a matrix's upper three by three, column by column, with the
 * determinant's sign at index 9.
 *
 * @param {readonly number[]} m A four by four matrix, column by column.
 * @returns {NormalMatrix}
 */
function normalMatrix(m) {
	const [a, b, c, , d, e, f, , g, h, i] = /** @type {number[]} */ (m);
	const A = /** @type {number} */ (a);
	const B = /** @type {number} */ (b);
	const C = /** @type {number} */ (c);
	const D = /** @type {number} */ (d);
	const E = /** @type {number} */ (e);
	const F = /** @type {number} */ (f);
	const G = /** @type {number} */ (g);
	const H = /** @type {number} */ (h);
	const I = /** @type {number} */ (i);
	const det = A * (E * I - F * H) - D * (B * I - C * H) + G * (B * F - C * E);
	const s = det === 0 ? 1 : 1 / det;
	// The cofactor matrix over the determinant is the inverse's transpose.
	return [
		(E * I - F * H) * s,
		(F * G - D * I) * s,
		(D * H - E * G) * s,
		(C * H - B * I) * s,
		(A * I - C * G) * s,
		(B * G - A * H) * s,
		(B * F - C * E) * s,
		(C * D - A * F) * s,
		(A * E - B * D) * s,
		Math.sign(det) || 1,
	];
}

/**
 * A base color texture as a bake's colour map, decoded once per texture.
 *
 * @param {Texture} texture
 * @param {TextureInfo} info
 * @param {Map<Texture, ImpostorBakeMap>} images
 * @returns {ImpostorBakeMap}
 */
function colorMap(texture, info, images) {
	const known = images.get(texture);
	if (known) return known;
	const mimeType = texture.getMimeType();
	const bytes = texture.getImage();
	if (!bytes) throw new Error(`its texture "${texture.getName()}" holds no image`);
	if (mimeType !== 'image/png' && mimeType !== 'image/jpeg')
		throw new Error(
			`its texture "${texture.getName() || texture.getURI()}" is ${mimeType || 'of an unknown type'}, and the bake reads PNG and JPEG images. Bake the source model, before assets optimize`,
		);
	const pixels = decodeImage(bytes, mimeType);
	const clamp = info.getWrapS() === CLAMP_TO_EDGE && info.getWrapT() === CLAMP_TO_EDGE;
	// glTF's first image row is at v = 0, as the bake's maps read it. A map that repeats takes
	// `tiles`, so a coordinate past the map wraps rather than clamps.
	/** @type {ImpostorBakeMap} */
	const map = clamp
		? { width: pixels.width, height: pixels.height, data: pixels.data, wrap: 'clamp' }
		: { width: pixels.width, height: pixels.height, data: pixels.data, wrap: 'repeat', tiles: 1 };
	images.set(texture, map);
	return map;
}

/**
 * The coverage map of a colour map's alpha times the material's alpha factor, in blue, as the bake
 * reads coverage.
 *
 * @param {ImpostorBakeMap} color
 * @param {number} alpha
 * @returns {ImpostorBakeMap}
 */
function coverageMap(color, alpha) {
	const data = new Uint8Array(color.data.length);
	for (let i = 0; i < data.length; i += 4) {
		const value = Math.round(/** @type {number} */ (color.data[i + 3]) * alpha);
		data[i] = value;
		data[i + 1] = value;
		data[i + 2] = value;
		data[i + 3] = 255;
	}
	return { ...color, data };
}

/**
 * An atlas's texels with its rows in the other order, so the image's top row is the atlas's top
 * row: the bake's data starts at v = 0, the atlas's bottom.
 *
 * @param {{ width: number, height: number, data: Uint8Array }} image
 */
export function uprightImage({ width, height, data }) {
	const out = new Uint8Array(data.length);
	const row = width * 4;
	for (let y = 0; y < height; y++)
		out.set(data.subarray(y * row, (y + 1) * row), (height - 1 - y) * row);
	return { width, height, data: out };
}

/**
 * Bakes a model's atlases and writes the three files.
 *
 * @param {string} input The model's path.
 * @param {string} out The folder for the files.
 * @param {number} views The fewest views in the grid.
 * @param {number} texels The texels on each side of a cell.
 * @returns {Promise<{ json: string, color: string, surface: string, bytes: number, atlas: { columns: number, rows: number } }>}
 */
export async function bakeModelImpostor(input, out, views, texels) {
	const doc = await readModel(await glTFIO(), input);
	const { parts, min, max } = impostorParts(doc);
	const atlas = octahedralAtlas(views);
	const bake = bakeImpostorAtlas({ atlas, texels, parts, min, max });
	const names = impostorFileNames(input);
	const color = encodePng(uprightImage(bake.color));
	const surface = encodePng(uprightImage(bake.surface));
	const json = {
		format: IMPOSTOR_FILE_FORMAT,
		version: IMPOSTOR_FILE_VERSION,
		atlas,
		texels,
		color: names.color,
		surface: names.surface,
		size: bake.size,
		room: bake.room,
		depth: bake.depth,
		min,
		max,
	};
	mkdirSync(out, { recursive: true });
	const paths = {
		json: join(out, names.json),
		color: join(out, names.color),
		surface: join(out, names.surface),
	};
	writeFileSync(paths.color, color);
	writeFileSync(paths.surface, surface);
	writeFileSync(paths.json, `${JSON.stringify(json, null, '\t')}\n`);
	return { ...paths, bytes: color.byteLength + surface.byteLength, atlas };
}

/**
 * Runs the command, and returns its exit code.
 *
 * @param {readonly string[]} args
 * @returns {Promise<number>}
 */
export async function run(args) {
	const { input, out, views, texels, help } = parseImpostorArgs(args);
	if (help) {
		console.log(HELP);
		return 0;
	}
	const start = performance.now();
	let written;
	try {
		written = await bakeModelImpostor(input, out, views, texels);
	} catch (error) {
		console.error(`${shownPath(input)}: ${error instanceof Error ? error.message : String(error)}`);
		return 1;
	}
	const { columns, rows } = written.atlas;
	console.log(
		`${shownPath(input)} to ${shownPath(written.json)}: ${columns} x ${rows} views of ${texels} texels, ${columns * texels} x ${rows * texels} atlases, ${shownBytes(written.bytes)}, in ${((performance.now() - start) / 1000).toFixed(1)} s`,
	);
	return 0;
}
