// The polyhedron generators, ported from three.js's PolyhedronGeometry and its four subclasses.
// Each face splits into smaller triangles, and every vertex moves out onto a sphere. The texture
// coordinates come from each vertex's angles on the sphere. Detail 0 gives flat normals from the
// faces, and higher detail gives smooth normals that point from the center.

import { faceNormals, normalizeNormals } from './math';
import type { GeneratedArrays } from './types';

/**
 * Options for `polyhedron`, with the names and defaults of three.js's `PolyhedronGeometry`.
 *
 * @category api/geometry
 */
export interface PolyhedronOptions {
	/** The corner positions, three numbers per corner. The default is none. */
	vertices?: readonly number[];
	/** The faces, three corner indices per triangle. The default is none. */
	indices?: readonly number[];
	/** The radius of the sphere that the vertices lie on. The default is 1. */
	radius?: number;
	/**
	 * How many times each face splits. With detail n, each edge splits into n + 1 parts. The
	 * default is 0.
	 */
	detail?: number;
}

/**
 * Options for the named polyhedra, such as `icosahedron`, with three.js's names and defaults.
 *
 * @category api/geometry
 */
export interface PolyhedronShapeOptions {
	/** The radius of the sphere that the vertices lie on. The default is 1. */
	radius?: number;
	/** How many times each face splits. The default is 0. Above 1, an icosahedron is close to a sphere. */
	detail?: number;
}

type Point = [number, number, number];

function lerp(a: Point, b: Point, alpha: number): Point {
	return [a[0] + (b[0] - a[0]) * alpha, a[1] + (b[1] - a[1]) * alpha, a[2] + (b[2] - a[2]) * alpha];
}

// The angle about the Y axis, counterclockwise from above.
function azimuth(x: number, z: number): number {
	return Math.atan2(z, -x);
}

// The angle above the XZ plane.
function inclination(x: number, y: number, z: number): number {
	return Math.atan2(-y, Math.sqrt(x * x + z * z));
}

/**
 * The arrays of a polyhedron, like three.js's `PolyhedronGeometry`. The mesh has no indices: each
 * three vertices in a row make a triangle.
 *
 * @category api/geometry
 */
export function polyhedron(options: PolyhedronOptions = {}): GeneratedArrays {
	const { vertices = [], indices = [], radius = 1, detail = 0 } = options;
	const buffer: number[] = [];
	const corner = (index: number): Point => {
		const stride = index * 3;
		return [
			vertices[stride] as number,
			vertices[stride + 1] as number,
			vertices[stride + 2] as number,
		];
	};
	const push = (v: Point): void => {
		buffer.push(v[0], v[1], v[2]);
	};

	// Splits each face into smaller triangles.
	for (let f = 0; f < indices.length; f += 3) {
		const a = corner(indices[f] as number);
		const b = corner(indices[f + 1] as number);
		const c = corner(indices[f + 2] as number);
		const cols = detail + 1;
		const v: Point[][] = [];
		for (let i = 0; i <= cols; i++) {
			const row: Point[] = [];
			v[i] = row;
			const aj = lerp(a, c, i / cols);
			const bj = lerp(b, c, i / cols);
			const rows = cols - i;
			for (let j = 0; j <= rows; j++) {
				row[j] = j === 0 && i === cols ? aj : lerp(aj, bj, j / rows);
			}
		}
		for (let i = 0; i < cols; i++) {
			const r0 = v[i] as Point[];
			const r1 = v[i + 1] as Point[];
			for (let j = 0; j < 2 * (cols - i) - 1; j++) {
				const k = Math.floor(j / 2);
				if (j % 2 === 0) {
					push(r0[k + 1] as Point);
					push(r1[k] as Point);
					push(r0[k] as Point);
				} else {
					push(r0[k + 1] as Point);
					push(r1[k + 1] as Point);
					push(r1[k] as Point);
				}
			}
		}
	}

	// Moves every vertex onto the sphere.
	for (let i = 0; i < buffer.length; i += 3) {
		const x = buffer[i] as number;
		const y = buffer[i + 1] as number;
		const z = buffer[i + 2] as number;
		const s = 1 / (Math.sqrt(x * x + y * y + z * z) || 1);
		buffer[i] = x * s * radius;
		buffer[i + 1] = y * s * radius;
		buffer[i + 2] = z * s * radius;
	}

	// Texture coordinates from the angles on the sphere.
	const uvBuffer: number[] = new Array((buffer.length / 3) * 2);
	for (let i = 0, j = 0; i < buffer.length; i += 3, j += 2) {
		const x = buffer[i] as number;
		const y = buffer[i + 1] as number;
		const z = buffer[i + 2] as number;
		const u = azimuth(x, z) / 2 / Math.PI + 0.5;
		const v = inclination(x, y, z) / Math.PI + 0.5;
		uvBuffer[j] = u;
		uvBuffer[j + 1] = 1 - v;
	}
	correctUVs(buffer, uvBuffer);
	correctSeam(uvBuffer);

	const positions = new Float32Array(buffer);
	const uvs = new Float32Array(uvBuffer);
	let normals: Float32Array;
	if (detail === 0) {
		normals = faceNormals(positions);
	} else {
		normals = new Float32Array(buffer);
		normalizeNormals(normals);
	}
	return { positions, normals, uvs };
}

// Fixes the u of a vertex on the seam or at a pole, from the azimuth of its face's center.
function correctUVs(buffer: readonly number[], uvBuffer: number[]): void {
	for (let i = 0, j = 0; i < buffer.length; i += 9, j += 6) {
		const cx =
			((buffer[i] as number) + (buffer[i + 3] as number) + (buffer[i + 6] as number)) * (1 / 3);
		const cz =
			((buffer[i + 2] as number) + (buffer[i + 5] as number) + (buffer[i + 8] as number)) * (1 / 3);
		const azi = azimuth(cx, cz);
		for (let k = 0; k < 3; k++) {
			const stride = j + k * 2;
			if (azi < 0 && uvBuffer[stride] === 1) {
				uvBuffer[stride] = (uvBuffer[stride] as number) - 1;
			}
			if (buffer[i + k * 3] === 0 && buffer[i + k * 3 + 2] === 0) {
				uvBuffer[stride] = azi / 2 / Math.PI + 0.5;
			}
		}
	}
}

// Moves the u of a face that straddles the seam onto one side of it.
function correctSeam(uvBuffer: number[]): void {
	for (let i = 0; i < uvBuffer.length; i += 6) {
		const x0 = uvBuffer[i] as number;
		const x1 = uvBuffer[i + 2] as number;
		const x2 = uvBuffer[i + 4] as number;
		const max = Math.max(x0, x1, x2);
		const min = Math.min(x0, x1, x2);
		if (max > 0.9 && min < 0.1) {
			if (x0 < 0.2) uvBuffer[i] = x0 + 1;
			if (x1 < 0.2) uvBuffer[i + 2] = x1 + 1;
			if (x2 < 0.2) uvBuffer[i + 4] = x2 + 1;
		}
	}
}

/**
 * The arrays of a tetrahedron, like three.js's `TetrahedronGeometry`. The mesh has no indices.
 *
 * @category api/geometry
 */
export function tetrahedron(options: PolyhedronShapeOptions = {}): GeneratedArrays {
	return polyhedron({
		vertices: [1, 1, 1, -1, -1, 1, -1, 1, -1, 1, -1, -1],
		indices: [2, 1, 0, 0, 3, 2, 1, 3, 0, 2, 3, 1],
		...shapeOptions(options),
	});
}

/**
 * The arrays of an octahedron, like three.js's `OctahedronGeometry`. The mesh has no indices.
 *
 * @category api/geometry
 */
export function octahedron(options: PolyhedronShapeOptions = {}): GeneratedArrays {
	return polyhedron({
		vertices: [1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1],
		indices: [0, 2, 4, 0, 4, 3, 0, 3, 5, 0, 5, 2, 1, 2, 5, 1, 5, 3, 1, 3, 4, 1, 4, 2],
		...shapeOptions(options),
	});
}

/**
 * The arrays of an icosahedron, like three.js's `IcosahedronGeometry`. The mesh has no indices.
 *
 * @category api/geometry
 */
export function icosahedron(options: PolyhedronShapeOptions = {}): GeneratedArrays {
	const t = (1 + Math.sqrt(5)) / 2;
	return polyhedron({
		vertices: [
			-1,
			t,
			0,
			1,
			t,
			0,
			-1,
			-t,
			0,
			1,
			-t,
			0,
			0,
			-1,
			t,
			0,
			1,
			t,
			0,
			-1,
			-t,
			0,
			1,
			-t,
			t,
			0,
			-1,
			t,
			0,
			1,
			-t,
			0,
			-1,
			-t,
			0,
			1,
		],
		indices: [
			0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1,
			8, 3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1,
		],
		...shapeOptions(options),
	});
}

/**
 * The arrays of a dodecahedron, like three.js's `DodecahedronGeometry`. The mesh has no indices.
 *
 * @category api/geometry
 */
export function dodecahedron(options: PolyhedronShapeOptions = {}): GeneratedArrays {
	const t = (1 + Math.sqrt(5)) / 2;
	const r = 1 / t;
	return polyhedron({
		vertices: [
			-1,
			-1,
			-1,
			-1,
			-1,
			1,
			-1,
			1,
			-1,
			-1,
			1,
			1,
			1,
			-1,
			-1,
			1,
			-1,
			1,
			1,
			1,
			-1,
			1,
			1,
			1,
			0,
			-r,
			-t,
			0,
			-r,
			t,
			0,
			r,
			-t,
			0,
			r,
			t,
			-r,
			-t,
			0,
			-r,
			t,
			0,
			r,
			-t,
			0,
			r,
			t,
			0,
			-t,
			0,
			-r,
			t,
			0,
			-r,
			-t,
			0,
			r,
			t,
			0,
			r,
		],
		indices: [
			3, 11, 7, 3, 7, 15, 3, 15, 13, 7, 19, 17, 7, 17, 6, 7, 6, 15, 17, 4, 8, 17, 8, 10, 17, 10, 6,
			8, 0, 16, 8, 16, 2, 8, 2, 10, 0, 12, 1, 0, 1, 18, 0, 18, 16, 6, 10, 2, 6, 2, 13, 6, 13, 15, 2,
			16, 18, 2, 18, 3, 2, 3, 13, 18, 1, 9, 18, 9, 11, 18, 11, 3, 4, 14, 12, 4, 12, 0, 4, 0, 8, 11,
			9, 5, 11, 5, 19, 11, 19, 7, 19, 5, 14, 19, 14, 4, 19, 4, 17, 1, 12, 14, 1, 14, 5, 1, 5, 9,
		],
		...shapeOptions(options),
	});
}

// The radius and detail of a named polyhedron, without keys that are present but undefined.
function shapeOptions(options: PolyhedronShapeOptions): PolyhedronShapeOptions {
	return { radius: options.radius ?? 1, detail: options.detail ?? 0 };
}
