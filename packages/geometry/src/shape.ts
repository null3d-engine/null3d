// The flat shape generator, ported from three.js's ShapeGeometry. It fills each shape's outline,
// less its holes, with triangles in the XY plane. The texture coordinates are the x and y
// positions.

import { indexArray, type Tuple2, type Tuple3 } from './math';
import { Shape } from './path';
import { isClockWise, triangulateShape } from './shape-utils';
import type { GeneratedArrays } from './types';

/**
 * Options for `shape`, with the names and defaults of three.js's `ShapeGeometry`.
 *
 * @category api/geometry
 */
export interface ShapeOptions {
	/**
	 * One shape or a list of shapes. The default is three.js's triangle with corners (0, 0.5),
	 * (-0.5, -0.5) and (0.5, -0.5).
	 */
	shapes?: Shape | readonly Shape[];
	/** The number of points along each curve of a shape. The default is 12. */
	curveSegments?: number;
}

/**
 * The arrays of flat shapes, like three.js's `ShapeGeometry`. The mesh has indices, and all its
 * normals point along +Z. three.js gives each shape of a list a group of its own. Here the shapes
 * form one mesh, so a material per shape needs one `shape` call per shape.
 *
 * @category api/geometry
 */
export function shape(options: ShapeOptions = {}): GeneratedArrays {
	const {
		shapes = new Shape([
			[0, 0.5],
			[-0.5, -0.5],
			[0.5, -0.5],
		]),
		curveSegments = 12,
	} = options;
	const list: readonly Shape[] = Array.isArray(shapes) ? shapes : [shapes as Shape];

	// Each shape's points, outline first, and its triangles.
	const parts: { points: Tuple2[]; faces: Tuple3[] }[] = [];
	let vertexCount = 0;
	let indexCount = 0;
	for (const item of list) {
		const extracted = item.extractPoints(curveSegments);
		let points = extracted.shape;
		const holes = extracted.holes;
		if (isClockWise(points) === false) points = points.reverse();
		for (let i = 0, l = holes.length; i < l; i++) {
			const hole = holes[i] as Tuple2[];
			if (isClockWise(hole) === true) holes[i] = hole.reverse();
		}
		const faces = triangulateShape(points, holes);
		for (const hole of holes) points = points.concat(hole);
		parts.push({ points, faces });
		vertexCount += points.length;
		indexCount += faces.length * 3;
	}

	const positions = new Float32Array(vertexCount * 3);
	const normals = new Float32Array(vertexCount * 3);
	const uvs = new Float32Array(vertexCount * 2);
	let maxIndex = 0;
	let offset = 0;
	for (const part of parts) {
		for (const face of part.faces) {
			maxIndex = Math.max(maxIndex, face[0] + offset, face[1] + offset, face[2] + offset);
		}
		offset += part.points.length;
	}
	const indices = indexArray(indexCount, maxIndex);
	let v = 0;
	let o = 0;
	offset = 0;
	for (const part of parts) {
		for (const point of part.points) {
			positions[v * 3] = point[0];
			positions[v * 3 + 1] = point[1];
			normals[v * 3 + 2] = 1;
			uvs[v * 2] = point[0];
			uvs[v * 2 + 1] = point[1];
			v++;
		}
		for (const face of part.faces) {
			indices[o++] = face[0] + offset;
			indices[o++] = face[1] + offset;
			indices[o++] = face[2] + offset;
		}
		offset += part.points.length;
	}
	return { positions, normals, uvs, indices };
}
