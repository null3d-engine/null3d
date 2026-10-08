// The torus knot generator, ported from three.js's TorusKnotGeometry. A tube follows a (p, q)
// knot that winds around a torus. Each ring of the tube lies in the plane of the knot's normal and
// binormal.

import { gridIndices } from './math';
import type { GeneratedArrays } from './types';

/**
 * Options for `torusKnot`, with the names and defaults of three.js's `TorusKnotGeometry`.
 *
 * @category api/geometry
 */
export interface TorusKnotOptions {
	/** The radius of the torus that the knot winds around. The default is 1. */
	radius?: number;
	/** The radius of the tube. The default is 0.4. */
	tube?: number;
	/** The number of segments along the knot, rounded down. The default is 64. */
	tubularSegments?: number;
	/** The number of segments around the tube, rounded down. The default is 8. */
	radialSegments?: number;
	/** How many times the knot winds around the torus's axis of symmetry. The default is 2. */
	p?: number;
	/** How many times the knot winds around a circle inside the torus. The default is 3. */
	q?: number;
}

// Writes the knot's point at angle u into out, at the given offset.
function positionOnCurve(u: number, p: number, q: number, radius: number, out: number[]): void {
	const cu = Math.cos(u);
	const su = Math.sin(u);
	const quOverP = (q / p) * u;
	const cs = Math.cos(quOverP);
	out[0] = radius * (2 + cs) * 0.5 * cu;
	out[1] = radius * (2 + cs) * su * 0.5;
	out[2] = radius * Math.sin(quOverP) * 0.5;
}

/**
 * The arrays of a torus knot, like three.js's `TorusKnotGeometry`. The mesh has indices.
 *
 * @category api/geometry
 */
export function torusKnot(options: TorusKnotOptions = {}): GeneratedArrays {
	const { radius = 1, tube = 0.4, p = 2, q = 3 } = options;
	const tubularSegments = Math.floor(options.tubularSegments ?? 64);
	const radialSegments = Math.floor(options.radialSegments ?? 8);
	const vertexCount = (tubularSegments + 1) * (radialSegments + 1);
	const positions = new Float32Array(vertexCount * 3);
	const normals = new Float32Array(vertexCount * 3);
	const uvs = new Float32Array(vertexCount * 2);
	const p1 = [0, 0, 0];
	const p2 = [0, 0, 0];
	let o3 = 0;
	let o2 = 0;
	for (let i = 0; i <= tubularSegments; ++i) {
		const u = (i / tubularSegments) * p * Math.PI * 2;
		positionOnCurve(u, p, q, radius, p1);
		positionOnCurve(u + 0.01, p, q, radius, p2);
		const p1x = p1[0] as number;
		const p1y = p1[1] as number;
		const p1z = p1[2] as number;
		const p2x = p2[0] as number;
		const p2y = p2[1] as number;
		const p2z = p2[2] as number;
		// The tangent T, and N as the sum of the two points.
		const tx = p2x - p1x;
		const ty = p2y - p1y;
		const tz = p2z - p1z;
		let nx = p2x + p1x;
		let ny = p2y + p1y;
		let nz = p2z + p1z;
		// The binormal B = T x N, then N = B x T, both made unit length.
		let bx = ty * nz - tz * ny;
		let by = tz * nx - tx * nz;
		let bz = tx * ny - ty * nx;
		nx = by * tz - bz * ty;
		ny = bz * tx - bx * tz;
		nz = bx * ty - by * tx;
		const bs = 1 / (Math.sqrt(bx * bx + by * by + bz * bz) || 1);
		bx *= bs;
		by *= bs;
		bz *= bs;
		const ns = 1 / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1);
		nx *= ns;
		ny *= ns;
		nz *= ns;
		for (let j = 0; j <= radialSegments; ++j) {
			const v = (j / radialSegments) * Math.PI * 2;
			const cx = -tube * Math.cos(v);
			const cy = tube * Math.sin(v);
			const vx = p1x + (cx * nx + cy * bx);
			const vy = p1y + (cx * ny + cy * by);
			const vz = p1z + (cx * nz + cy * bz);
			positions[o3] = vx;
			positions[o3 + 1] = vy;
			positions[o3 + 2] = vz;
			// The normal points from the knot's center out to the vertex.
			const dx = vx - p1x;
			const dy = vy - p1y;
			const dz = vz - p1z;
			const ds = 1 / (Math.sqrt(dx * dx + dy * dy + dz * dz) || 1);
			normals[o3] = dx * ds;
			normals[o3 + 1] = dy * ds;
			normals[o3 + 2] = dz * ds;
			uvs[o2] = i / tubularSegments;
			uvs[o2 + 1] = j / radialSegments;
			o3 += 3;
			o2 += 2;
		}
	}
	const indices = gridIndices(tubularSegments, radialSegments);
	return { positions, normals, uvs, indices };
}
