// The lathe generator, ported from three.js's LatheGeometry. It turns a 2D profile about the Y
// axis, as a lathe turns wood. Each profile point's x is its distance from the axis.

import { clamp, indexArray } from './math';
import type { GeneratedArrays, Vec2Like } from './types';

/**
 * Options for `lathe`, with the names and defaults of three.js's `LatheGeometry`.
 *
 * @category api/geometry
 */
export interface LatheOptions {
	/**
	 * The profile: points (x, y), where x is the distance from the Y axis and must be 0 or more.
	 * The default is three.js's diamond: (0, -0.5), (0.5, 0) and (0, 0.5).
	 */
	points?: readonly Vec2Like[];
	/** The number of segments around the axis, rounded down. The default is 12. */
	segments?: number;
	/** The start angle in radians. The default is 0. */
	phiStart?: number;
	/** The angle the lathe turns through, in radians, clamped to 0 to 2π. The default is 2π. */
	phiLength?: number;
}

/**
 * The arrays of a lathe, like three.js's `LatheGeometry`. The mesh has indices.
 *
 * @category api/geometry
 */
export function lathe(options: LatheOptions = {}): GeneratedArrays {
	const {
		points = [
			[0, -0.5],
			[0.5, 0],
			[0, 0.5],
		],
		phiStart = 0,
	} = options;
	const segments = Math.floor(options.segments ?? 12);
	const phiLength = clamp(options.phiLength ?? Math.PI * 2, 0, Math.PI * 2);
	const count = points.length;
	const last = count - 1;
	const inverseSegments = 1.0 / segments;

	// The normals of the first meridian. Each inner point averages its two edges' normals.
	const initNormals = new Float64Array(count * 3);
	let prevX = 0;
	let prevY = 0;
	let prevZ = 0;
	for (let j = 0; j <= last; j++) {
		if (j === 0 || j !== last) {
			const a = points[j] as Vec2Like;
			const b = points[j + 1] as Vec2Like;
			const dx = (b[0] as number) - (a[0] as number);
			const dy = (b[1] as number) - (a[1] as number);
			let nx = dy * 1.0;
			let ny = -dx;
			let nz = dy * 0.0;
			const curX = nx;
			const curY = ny;
			const curZ = nz;
			if (j !== 0) {
				nx += prevX;
				ny += prevY;
				nz += prevZ;
			}
			const s = 1 / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1);
			initNormals[j * 3] = nx * s;
			initNormals[j * 3 + 1] = ny * s;
			initNormals[j * 3 + 2] = nz * s;
			prevX = curX;
			prevY = curY;
			prevZ = curZ;
		} else {
			// The last point takes the last edge's normal as it is, not made unit length.
			initNormals[j * 3] = prevX;
			initNormals[j * 3 + 1] = prevY;
			initNormals[j * 3 + 2] = prevZ;
		}
	}

	const vertexCount = (segments + 1) * count;
	const positions = new Float32Array(vertexCount * 3);
	const normals = new Float32Array(vertexCount * 3);
	const uvs = new Float32Array(vertexCount * 2);
	let o3 = 0;
	let o2 = 0;
	for (let i = 0; i <= segments; i++) {
		const phi = phiStart + i * inverseSegments * phiLength;
		const sin = Math.sin(phi);
		const cos = Math.cos(phi);
		for (let j = 0; j <= last; j++) {
			const point = points[j] as Vec2Like;
			const px = point[0] as number;
			positions[o3] = px * sin;
			positions[o3 + 1] = point[1] as number;
			positions[o3 + 2] = px * cos;
			uvs[o2] = i / segments;
			uvs[o2 + 1] = j / last;
			const nx = initNormals[3 * j] as number;
			normals[o3] = nx * sin;
			normals[o3 + 1] = initNormals[3 * j + 1] as number;
			normals[o3 + 2] = nx * cos;
			o3 += 3;
			o2 += 2;
		}
	}

	const indexCount = Math.max(0, segments) * Math.max(0, last) * 6;
	const indices = indexArray(indexCount, indexCount > 0 ? vertexCount - 1 : 0);
	let o = 0;
	for (let i = 0; i < segments; i++) {
		for (let j = 0; j < last; j++) {
			const base = j + i * count;
			const a = base;
			const b = base + count;
			const c = base + count + 1;
			const d = base + 1;
			indices[o++] = a;
			indices[o++] = b;
			indices[o++] = d;
			indices[o++] = c;
			indices[o++] = d;
			indices[o++] = b;
		}
	}
	return { positions, normals, uvs, indices };
}
