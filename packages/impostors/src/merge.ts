// Merged far geometry: many copies of a mesh, each moved by its own transform, written into the
// arrays of one mesh. A far grid cell of static trees, rocks or buildings then draws in one draw
// instead of one per copy, which matters most where the copies are small on the screen.
//
// The recipe that uses a level-of-detail group: give each base mesh its lower levels with
// `mesh.setLevels`, hold the arrays that made the far level, and merge a cell's copies of them
// with `mergeFarGeometry` into one mesh for that cell. The cell's mesh draws as a single object,
// and the detailed levels stay for what is near.

import type { Mat4Like, MeshArrays, VertexValues } from '@null3d/engine';

/**
 * One copy of a mesh in a merge: its arrays, and the transform that places it. The transform is a
 * column-major 4 by 4 matrix, as `mat4` writes; without one the copy stays where its arrays are.
 *
 * @category api/impostors
 */
export interface FarPart {
	/** The mesh's arrays, as `geometry.fromArrays` takes them. */
	readonly arrays: MeshArrays;
	/** Where the copy sits. The default is the origin, with no turn and no scale. */
	readonly transform?: Mat4Like;
}

/** The attributes that a merge carries over, besides positions and indices. */
const ATTRIBUTES = ['normals', 'uvs', 'uvs1', 'colors', 'tangents'] as const;

/** The identity transform, column-major, which a copy without one takes. */
const IDENTITY: Mat4Like = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/**
 * The inverse of a column-major matrix's upper left 3 by 3, written column-major into `out`. A
 * normal turns by its transpose, so `mergeFarGeometry` reads it that way. A matrix with no
 * inverse, such as a zero scale, writes its own upper left 3 by 3 instead.
 */
function inverse3(m: Mat4Like, out: number[]): void {
	const a00 = m[0] as number;
	const a01 = m[4] as number;
	const a02 = m[8] as number;
	const a10 = m[1] as number;
	const a11 = m[5] as number;
	const a12 = m[9] as number;
	const a20 = m[2] as number;
	const a21 = m[6] as number;
	const a22 = m[10] as number;
	const b00 = a11 * a22 - a12 * a21;
	const b01 = a02 * a21 - a01 * a22;
	const b02 = a01 * a12 - a02 * a11;
	const b10 = a12 * a20 - a10 * a22;
	const b11 = a00 * a22 - a02 * a20;
	const b12 = a02 * a10 - a00 * a12;
	const b20 = a10 * a21 - a11 * a20;
	const b21 = a01 * a20 - a00 * a21;
	const b22 = a00 * a11 - a01 * a10;
	const det = a00 * b00 + a01 * b10 + a02 * b20;
	if (det === 0) {
		out[0] = a00;
		out[1] = a01;
		out[2] = a02;
		out[3] = a10;
		out[4] = a11;
		out[5] = a12;
		out[6] = a20;
		out[7] = a21;
		out[8] = a22;
		return;
	}
	out[0] = b00 / det;
	out[1] = b01 / det;
	out[2] = b02 / det;
	out[3] = b10 / det;
	out[4] = b11 / det;
	out[5] = b12 / det;
	out[6] = b20 / det;
	out[7] = b21 / det;
	out[8] = b22 / det;
}

/** The numbers of one attribute, which a `VertexArray` wraps. Throws for normalized integers. */
function numbersOf(attr: VertexValues | Uint32Array, name: string): ArrayLike<number> {
	if (typeof attr === 'object' && attr !== null && 'array' in attr) {
		if (attr.normalized)
			throw new RangeError(
				`mergeFarGeometry() got a normalized integer ${name}; it takes floats or plain numbers.`,
			);
		return (attr as { array: ArrayLike<number> }).array;
	}
	return attr as ArrayLike<number>;
}

/** The stride of an attribute: its numbers per vertex, which the caller's arrays give. */
function strideOf(attr: ArrayLike<number>, vertices: number, name: string): number {
	if (attr.length % vertices !== 0)
		throw new RangeError(
			`mergeFarGeometry() got a ${name} array of ${attr.length} numbers, not a whole number per vertex.`,
		);
	return attr.length / vertices;
}

/**
 * Merges copies of a mesh into the arrays of one mesh, moving each copy by its own transform. The
 * result holds every vertex and triangle of every copy, with each copy's indices moved to point at
 * its own vertices. Give it to `geometry.fromArrays`.
 *
 * Every copy must carry the same attributes, and each attribute must hold the same numbers per
 * vertex in every copy. An attribute that any copy lacks is left out of the result. Positions are
 * always carried, and indices are made for a copy that has none. A copy's normals turn by the
 * inverse transpose of its transform's upper left 3 by 3, as normals turn, so a stretched copy
 * keeps its shading. Throws a RangeError for arrays that do not fit together.
 *
 * @category api/impostors
 */
export function mergeFarGeometry(parts: readonly FarPart[]): MeshArrays {
	const count = parts.length;
	if (count === 0) throw new RangeError('mergeFarGeometry() got no copies. Give at least one.');
	const positions: ArrayLike<number>[] = [];
	const vertices: number[] = [];
	const indices: (ArrayLike<number> | undefined)[] = [];
	const carried: { [name: string]: ArrayLike<number>[] } = {};
	const strides: { [name: string]: number } = {};
	let totalVertices = 0;
	let totalIndices = 0;
	for (let k = 0; k < count; k++) {
		const { arrays } = parts[k] as FarPart;
		const position = numbersOf(arrays.positions, 'positions');
		if (position.length % 3 !== 0)
			throw new RangeError(
				`mergeFarGeometry() got copy ${k + 1} with ${position.length} positions, not three per vertex.`,
			);
		const n = position.length / 3;
		positions.push(position);
		vertices.push(n);
		totalVertices += n;
		const index = arrays.indices === undefined ? undefined : numbersOf(arrays.indices, 'indices');
		indices.push(index);
		totalIndices += index ? index.length : n;
		for (const name of ATTRIBUTES) {
			const attr = arrays[name];
			if (attr === undefined) {
				carried[name] = [];
				continue;
			}
			let list = carried[name] as ArrayLike<number>[] | undefined;
			if (!list) {
				list = [];
				carried[name] = list;
			}
			if (list.length === 0 && k > 0) continue;
			const values = numbersOf(attr, name);
			const stride = strideOf(values, n, name);
			if (list.length === 0) strides[name] = stride;
			else if (strides[name] !== stride)
				throw new RangeError(
					`mergeFarGeometry() got copy ${k + 1} with ${stride} numbers per vertex in ${name}, and the first copy has ${strides[name]}.`,
				);
			list.push(values);
		}
	}
	for (const name of ATTRIBUTES)
		if ((carried[name] as unknown[]).length !== count) carried[name] = [];
	const positionsOut = new Float32Array(totalVertices * 3);
	const indicesOut = new Uint32Array(totalIndices);
	const out: MeshArrays = { positions: positionsOut, indices: indicesOut };
	const normalsOut = (carried.normals as unknown[]).length
		? new Float32Array(totalVertices * 3)
		: undefined;
	if (normalsOut) out.normals = normalsOut;
	const outputs: { [name: string]: Float32Array | undefined } = {};
	for (const name of ATTRIBUTES) {
		if (name === 'normals' || (carried[name] as unknown[]).length !== count) continue;
		const stride = strides[name] as number;
		const array = new Float32Array(totalVertices * stride);
		outputs[name] = array;
		out[name] = array;
	}
	const inverse: number[] = [];
	let vertexAt = 0;
	let indexAt = 0;
	for (let k = 0; k < count; k++) {
		const { transform } = parts[k] as FarPart;
		const m = transform ?? IDENTITY;
		const position = positions[k] as ArrayLike<number>;
		const n = vertices[k] as number;
		inverse3(m, inverse);
		for (let i = 0; i < n; i++) {
			const x = position[i * 3] as number;
			const y = position[i * 3 + 1] as number;
			const z = position[i * 3 + 2] as number;
			const at = (vertexAt + i) * 3;
			positionsOut[at] =
				(m[0] as number) * x + (m[4] as number) * y + (m[8] as number) * z + (m[12] as number);
			positionsOut[at + 1] =
				(m[1] as number) * x + (m[5] as number) * y + (m[9] as number) * z + (m[13] as number);
			positionsOut[at + 2] =
				(m[2] as number) * x + (m[6] as number) * y + (m[10] as number) * z + (m[14] as number);
			if (normalsOut) {
				const normals = (carried.normals as ArrayLike<number>[])[k] as ArrayLike<number>;
				const nx = normals[i * 3] as number;
				const ny = normals[i * 3 + 1] as number;
				const nz = normals[i * 3 + 2] as number;
				const tx =
					(inverse[0] as number) * nx + (inverse[3] as number) * ny + (inverse[6] as number) * nz;
				const ty =
					(inverse[1] as number) * nx + (inverse[4] as number) * ny + (inverse[7] as number) * nz;
				const tz =
					(inverse[2] as number) * nx + (inverse[5] as number) * ny + (inverse[8] as number) * nz;
				const length = Math.hypot(tx, ty, tz) || 1;
				normalsOut[at] = tx / length;
				normalsOut[at + 1] = ty / length;
				normalsOut[at + 2] = tz / length;
			}
			for (const name of ['uvs', 'uvs1', 'colors', 'tangents'] as const) {
				const array = outputs[name];
				if (!array) continue;
				const stride = strides[name] as number;
				const values = (carried[name] as ArrayLike<number>[])[k] as ArrayLike<number>;
				for (let c = 0; c < stride; c++)
					array[(vertexAt + i) * stride + c] = values[i * stride + c] as number;
			}
		}
		const index = indices[k];
		if (index) {
			for (let i = 0; i < index.length; i++)
				indicesOut[indexAt + i] = (index[i] as number) + vertexAt;
			indexAt += index.length;
		} else {
			for (let i = 0; i < n; i++) indicesOut[indexAt + i] = vertexAt + i;
			indexAt += n;
		}
		vertexAt += n;
	}
	return out;
}

/**
 * Groups copies by the grid cell of their centers: the cell a center falls in is its position
 * divided by `cellSize` and rounded down, along each axis. Merge each group into one mesh, so a
 * large world draws a few meshes instead of one per copy. Centers that share a cell, in the order
 * they were given, come back as one list.
 *
 * @category api/impostors
 */
export function farCellGroups(
	centers: readonly (readonly [number, number, number])[],
	cellSize: number,
): number[][] {
	if (!(cellSize > 0))
		throw new RangeError(`farCellGroups() got a cell size of ${cellSize}, not above 0.`);
	const groups = new Map<string, number[]>();
	const order: number[][] = [];
	for (let k = 0; k < centers.length; k++) {
		const [x, y, z] = centers[k] as readonly [number, number, number];
		const key = `${Math.floor(x / cellSize)},${Math.floor(y / cellSize)},${Math.floor(z / cellSize)}`;
		let group = groups.get(key);
		if (!group) {
			group = [];
			groups.set(key, group);
			order.push(group);
		}
		group.push(k);
	}
	return order;
}
