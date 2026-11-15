// Quantisation, after design §7.6: each part's floats become 16-bit positions inside the species
// box, 8-bit normals, plain 16-bit UVs and 8-bit colours, 21 bytes a vertex where floats take 44.
// One box per species means one transform per copy for every part of every variant; the plant
// shader reads the box from the records texture's header. A 40 m box gives 0.6 mm steps, so a
// vertex moves by at most half a step on each axis.
import type { MeshArrays, QuantisedArrays } from '../asset';
import type { SpeciesBox } from '../core/box';

/**
 * Steps of a wood UV per metre of bark.
 *
 * @category api/vegetation
 */
export const WOOD_UV_STEPS = 1024;

/**
 * Steps of a leaf or card UV across the texture.
 *
 * @category api/vegetation
 */
export const TEXTURE_UV_STEPS = 65535;

/** The largest 16-bit step. */
const TOP = 65535;

/**
 * Steps of a position's rest below one step of the species box, on each axis, which a part of
 * small shapes keeps in its texture coordinates. A tree's box steps are near a millimetre, a tenth
 * of a fruit's radius, so a fruit drawn on them alone crumples up close; the rest holds each point
 * to a 255th of a step.
 *
 * @category api/vegetation
 */
export const REST_STEPS = 255;

/**
 * The most vertices of one part, so its indices fit 16 bits.
 *
 * @category api/vegetation
 */
export const PART_VERTICES = 65536;

/**
 * A mesh split into pieces of at most `PART_VERTICES` vertices, each with 16-bit indices. A mesh
 * that fits is returned as it is. The meshers write each triangle's corners after those of every
 * triangle before it, by axis and ring, so the smallest corner never falls from one triangle to the
 * next: a piece ends before the first triangle that would take it past the limit, and the next
 * piece starts at that triangle's smallest corner. A ring that two pieces share is copied into both.
 *
 * @param arrays The mesh.
 * @returns The pieces, in order.
 */
export function splitMesh(arrays: MeshArrays): MeshArrays[] {
	const count = arrays.positions.length / 3;
	if (count <= PART_VERTICES && !(arrays.indices instanceof Uint32Array)) return [arrays];
	const indices = arrays.indices;
	const pieces: MeshArrays[] = [];
	let start = 0;
	while (start < indices.length) {
		let low = Number.POSITIVE_INFINITY;
		let high = 0;
		let end = start;
		while (end < indices.length) {
			const a = indices[end] as number;
			const b = indices[end + 1] as number;
			const c = indices[end + 2] as number;
			const least = Math.min(low, a, b, c);
			const most = Math.max(high, a, b, c);
			if (most - least >= PART_VERTICES) break;
			low = least;
			high = most;
			end += 3;
		}
		if (end === start) throw new Error('a triangle spans more vertices than a part holds');
		const piece = new Uint16Array(end - start);
		for (let i = start; i < end; i++) piece[i - start] = (indices[i] as number) - low;
		pieces.push({
			positions: arrays.positions.slice(low * 3, (high + 1) * 3),
			normals: arrays.normals.slice(low * 3, (high + 1) * 3),
			uvs: arrays.uvs.slice(low * 2, (high + 1) * 2),
			uvs1: arrays.uvs1.slice(low * 2, (high + 1) * 2),
			colors: arrays.colors.slice(low * 4, (high + 1) * 4),
			...(arrays.tangents && { tangents: arrays.tangents.slice(low * 4, (high + 1) * 4) }),
			indices: piece,
		});
		start = end;
	}
	return pieces;
}

/**
 * One mesh's quantised parts: pieces of at most `PART_VERTICES` vertices with 16-bit indices, each
 * quantised against the species box.
 *
 * @param arrays The mesh's floats.
 * @param box The species box.
 * @param uvSteps Steps per unit of the mesh's UVs: `WOOD_UV_STEPS` or `TEXTURE_UV_STEPS`.
 * @param rest Whether the texture coordinates hold each position's rest below one box step, as
 *   `quantise` writes it, in place of the mesh's own.
 * @returns The quantised pieces, in order.
 */
export function quantiseParts(
	arrays: MeshArrays,
	box: SpeciesBox,
	uvSteps: number,
	rest = false,
): QuantisedArrays[] {
	return splitMesh(arrays).map((piece) => quantise(piece, box, uvSteps, rest));
}

/**
 * One part's arrays, quantised against the species box. Positions span the box in 65,535 steps on
 * each axis; normals take 127 steps a side; `uvs` take `uvSteps` steps a unit and `uvs1` 65,535,
 * each held within 16 bits; colours and indices are copied.
 *
 * A part that draws no texture may keep each position's rest instead of its texture coordinates:
 * the rest below one step on each axis, from half a step under to half a step over, in
 * `REST_STEPS` steps, with x in the first number's high byte, y in its low byte and z in the second
 * number's high byte.
 *
 * @param arrays The part's floats.
 * @param box The species box.
 * @param uvSteps Steps per unit of the part's UVs: `WOOD_UV_STEPS` or `TEXTURE_UV_STEPS`.
 * @param rest Whether the texture coordinates hold each position's rest.
 * @returns The quantised arrays.
 */
export function quantise(
	arrays: MeshArrays,
	box: SpeciesBox,
	uvSteps: number,
	rest = false,
): QuantisedArrays {
	const count = arrays.positions.length / 3;
	const positions = new Uint16Array(count * 3);
	const normals = new Int8Array(count * 3);
	const uvs = new Uint16Array(count * 2);
	const uvs1 = new Uint16Array(count * 2);
	const low0 = box.min[0];
	const low1 = box.min[1];
	const low2 = box.min[2];
	const scale0 = TOP / (box.max[0] - low0);
	const scale1 = TOP / (box.max[1] - low1);
	const scale2 = TOP / (box.max[2] - low2);
	const source = arrays.positions;
	const normal = arrays.normals;
	for (let i = 0; i < count; i++) {
		const at = i * 3;
		const x = ((source[at] as number) - low0) * scale0;
		const y = ((source[at + 1] as number) - low1) * scale1;
		const z = ((source[at + 2] as number) - low2) * scale2;
		positions[at] = clampStep(x, TOP);
		positions[at + 1] = clampStep(y, TOP);
		positions[at + 2] = clampStep(z, TOP);
		normals[at] = clampSigned((normal[at] as number) * 127);
		normals[at + 1] = clampSigned((normal[at + 1] as number) * 127);
		normals[at + 2] = clampSigned((normal[at + 2] as number) * 127);
		if (rest) {
			uvs[i * 2] =
				restStep(x, positions[at] as number) * 256 + restStep(y, positions[at + 1] as number);
			uvs[i * 2 + 1] = restStep(z, positions[at + 2] as number) * 256;
		}
	}
	const uv = arrays.uvs;
	const uv1 = arrays.uvs1;
	for (let i = 0; i < count * 2; i++) {
		if (!rest) uvs[i] = clampStep((uv[i] as number) * uvSteps, TOP);
		uvs1[i] = clampStep((uv1[i] as number) * TEXTURE_UV_STEPS, TOP);
	}
	return {
		positions,
		normals,
		uvs,
		uvs1,
		colors: arrays.colors.slice(),
		...(arrays.tangents && { tangents: arrays.tangents.slice() }),
		indices: arrays.indices.slice(),
	};
}

/** A value rounded to a whole step from 0 to `top`. */
function clampStep(value: number, top: number): number {
	const step = Math.round(value);
	return step < 0 ? 0 : step > top ? top : step;
}

/** The rest of a position in steps past the step it was rounded to, in `REST_STEPS` steps. */
function restStep(exact: number, step: number): number {
	return clampStep((exact - step + 0.5) * REST_STEPS, REST_STEPS);
}

/** A value rounded to a whole step from −127 to 127. */
function clampSigned(value: number): number {
	const step = Math.round(value);
	return step < -127 ? -127 : step > 127 ? 127 : step;
}

/**
 * A quantised position back in plant-space metres, as the plant shader reads it.
 *
 * @param positions The quantised positions.
 * @param index The vertex.
 * @param box The species box.
 * @param out The point to write.
 * @param uvs The part's texture coordinates, when they hold each position's rest.
 * @returns `out`.
 */
export function dequantisePosition(
	positions: Uint16Array,
	index: number,
	box: SpeciesBox,
	out: [number, number, number],
	uvs?: Uint16Array,
): [number, number, number] {
	const first = uvs ? (uvs[index * 2] as number) : 0;
	const second = uvs ? (uvs[index * 2 + 1] as number) : 0;
	const rests = [first >> 8, first & 255, second >> 8];
	for (let k = 0; k < 3; k++) {
		const low = box.min[k] as number;
		const rest = uvs ? (rests[k] as number) / REST_STEPS - 0.5 : 0;
		out[k] =
			low + (((positions[index * 3 + k] as number) + rest) / TOP) * ((box.max[k] as number) - low);
	}
	return out;
}
