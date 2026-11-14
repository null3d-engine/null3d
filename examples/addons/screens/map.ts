// Where a point on a screen's surface lies on the canvas that painted it. The engine gives a hit's
// first texture coordinates, and a canvas texture turns the canvas's rows over, so the coordinate
// (0, 0) is the canvas's bottom-left corner. The canvas's x then runs with the first coordinate
// and its y runs against the second.
import type { Vec2Like } from '@null3d/engine';

/** A point on a canvas, in its own coordinates: across from the left edge, and down from the top. */
export interface ScreenPoint {
	/** The distance across from the canvas's left edge, in texels. */
	readonly x: number;
	/** The distance down from the canvas's top edge, in texels. */
	readonly y: number;
}

/**
 * The point on a canvas that a texture coordinate names. The result runs from the canvas's
 * top-left corner: a coordinate of (0, 0) is its bottom-left corner and (1, 1) its top-right. A
 * coordinate outside the surface clamps to its edge. The numbers are continuous, so drawing at
 * them lands on a texel as the browser's canvas rounds.
 */
export function canvasPointAt(uv: Vec2Like, width: number, height: number): ScreenPoint {
	// A pair that the engine gives always holds both numbers, and a pair from other code may not.
	const u = Math.min(1, Math.max(0, uv[0] ?? 0));
	const v = Math.min(1, Math.max(0, uv[1] ?? 0));
	return { x: u * width, y: (1 - v) * height };
}

/**
 * The texel of a canvas that a texture coordinate names, as whole numbers from 0 to the canvas's
 * width or height less one. A coordinate on an edge takes the texel inside it.
 */
export function canvasTexelAt(uv: Vec2Like, width: number, height: number): ScreenPoint {
	const point = canvasPointAt(uv, width, height);
	return {
		x: Math.min(width - 1, Math.floor(point.x)),
		y: Math.min(height - 1, Math.floor(point.y)),
	};
}
