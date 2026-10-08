// The tube generator, ported from three.js's TubeGeometry. A ring of vertices follows a 3D curve
// on the curve's Frenet frames, at points spaced evenly along its length.

import type { Curve } from './curve';
import { QuadraticBezierCurve3 } from './curves';
import { gridIndices, type Tuple3 } from './math';
import type { GeneratedArrays } from './types';

/**
 * Options for `tube`, with the names and defaults of three.js's `TubeGeometry`.
 *
 * @category api/geometry
 */
export interface TubeOptions {
	/**
	 * The 3D curve that the tube follows. The default is three.js's quadratic Bézier curve from
	 * (-1, -1, 0) through the control point (-1, 1, 0) to (1, 1, 0).
	 */
	path?: Curve<[number, number, number]>;
	/** The number of segments along the curve. The default is 64. */
	tubularSegments?: number;
	/** The radius of the tube. The default is 1. */
	radius?: number;
	/** The number of segments around the tube. The default is 8. */
	radialSegments?: number;
	/** True joins the tube's end to its start, for a closed curve. The default is false. */
	closed?: boolean;
}

/**
 * The arrays of a tube, like three.js's `TubeGeometry`. The mesh has indices.
 *
 * @category api/geometry
 */
export function tube(options: TubeOptions = {}): GeneratedArrays {
	const {
		path = new QuadraticBezierCurve3([-1, -1, 0], [-1, 1, 0], [1, 1, 0]),
		tubularSegments = 64,
		radius = 1,
		radialSegments = 8,
		closed = false,
	} = options;
	const frames = path.computeFrenetFrames(tubularSegments, closed);
	// The loops below run as three.js's do, so the counts follow them for any segment numbers.
	const ringCount = (tubularSegments > 0 ? Math.ceil(tubularSegments) : 0) + 1;
	const ringSize = radialSegments >= 0 ? Math.floor(radialSegments) + 1 : 0;
	const positions = new Float32Array(ringCount * ringSize * 3);
	const normals = new Float32Array(ringCount * ringSize * 3);
	let o3 = 0;
	const p: Tuple3 = [0, 0, 0];
	const segment = (i: number): void => {
		path.getPointAt(i / tubularSegments, p);
		const n = frames.normals[i] as Tuple3;
		const b = frames.binormals[i] as Tuple3;
		for (let j = 0; j <= radialSegments; j++) {
			const v = (j / radialSegments) * Math.PI * 2;
			const sin = Math.sin(v);
			const cos = -Math.cos(v);
			let nx = cos * n[0] + sin * b[0];
			let ny = cos * n[1] + sin * b[1];
			let nz = cos * n[2] + sin * b[2];
			const s = 1 / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1);
			nx *= s;
			ny *= s;
			nz *= s;
			normals[o3] = nx;
			normals[o3 + 1] = ny;
			normals[o3 + 2] = nz;
			positions[o3] = p[0] + radius * nx;
			positions[o3 + 1] = p[1] + radius * ny;
			positions[o3 + 2] = p[2] + radius * nz;
			o3 += 3;
		}
	};
	for (let i = 0; i < tubularSegments; i++) segment(i);
	// An open tube's last ring lies at the curve's end. A closed tube repeats the first ring, with
	// its own texture coordinates.
	segment(closed === false ? tubularSegments : 0);

	const uvRows = tubularSegments >= 0 ? Math.floor(tubularSegments) + 1 : 0;
	const uvs = new Float32Array(uvRows * ringSize * 2);
	let o2 = 0;
	for (let i = 0; i <= tubularSegments; i++) {
		for (let j = 0; j <= radialSegments; j++) {
			uvs[o2++] = i / tubularSegments;
			uvs[o2++] = j / radialSegments;
		}
	}
	return { positions, normals, uvs, indices: gridIndices(tubularSegments, radialSegments) };
}
