// Helpers for 2D outlines, ported from three.js's ShapeUtils: the signed area, the winding order,
// and triangulation with holes through earcut.

import { earcut } from './earcut';
import type { Vec2Like } from './types';

/**
 * The signed area of a closed outline. It is negative when the points run clockwise.
 */
export function area(contour: readonly Vec2Like[]): number {
	const n = contour.length;
	let a = 0.0;
	for (let p = n - 1, q = 0; q < n; p = q++) {
		const pp = contour[p] as Vec2Like;
		const qq = contour[q] as Vec2Like;
		a += (pp[0] as number) * (qq[1] as number) - (qq[0] as number) * (pp[1] as number);
	}
	return a * 0.5;
}

/** True when the points of a closed outline run clockwise. */
export function isClockWise(pts: readonly Vec2Like[]): boolean {
	return area(pts) < 0;
}

// Removes the last point when it repeats the first, as three.js does before triangulation.
function removeDupEndPts(points: Vec2Like[]): void {
	const l = points.length;
	if (l > 2) {
		const last = points[l - 1] as Vec2Like;
		const first = points[0] as Vec2Like;
		if (last[0] === first[0] && last[1] === first[1]) points.pop();
	}
}

/**
 * Cuts an outline with holes into triangles. It returns three point indices per triangle. The
 * outline's points come first, then each hole's in turn. When the last point of a list repeats
 * its first, it removes that last point, as three.js does. So the lists it takes can shrink.
 */
export function triangulateShape(
	contour: Vec2Like[],
	holes: Vec2Like[][],
): [number, number, number][] {
	const vertices: number[] = [];
	const holeIndices: number[] = [];
	removeDupEndPts(contour);
	addContour(vertices, contour);
	let holeIndex = contour.length;
	for (const hole of holes) removeDupEndPts(hole);
	for (const hole of holes) {
		holeIndices.push(holeIndex);
		holeIndex += hole.length;
		addContour(vertices, hole);
	}
	const triangles = earcut(vertices, holeIndices);
	const faces: [number, number, number][] = [];
	for (let i = 0; i < triangles.length; i += 3) {
		faces.push([triangles[i] as number, triangles[i + 1] as number, triangles[i + 2] as number]);
	}
	return faces;
}

function addContour(vertices: number[], contour: readonly Vec2Like[]): void {
	for (const point of contour) {
		vertices.push(point[0] as number, point[1] as number);
	}
}
