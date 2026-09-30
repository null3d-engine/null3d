// The debug drawing API that a sketch reaches as ctx.debug, and what release builds give in its
// place: calls that do nothing. The drawing itself lives in draw.ts, which only development builds
// keep, so a release build holds none of it.

import type { Vec3Like } from '../math/types';
import type { ColorInput } from '../scene/color';
import type { Camera, DirectionalLight, Object3D } from '../scene/scene';

/**
 * Options for `debug.grid`.
 *
 * @category api/debug
 */
export interface DebugGridOptions {
	/** The center of the grid. The default is the origin. */
	center?: Vec3Like;
	/** The color of the grid's lines. The default is `'#888888'`, as in three.js's `GridHelper`. */
	color?: ColorInput;
	/** The color of the two lines through the center. The default is `'#444444'`. */
	centerColor?: ColorInput;
}

/**
 * Options for `debug.light`.
 *
 * @category api/debug
 */
export interface DebugLightOptions {
	/**
	 * Where to draw a light that has no position of its own, such as a directional light. The
	 * default is the origin.
	 */
	position?: Vec3Like;
	/** The size of the drawing in meters. The default is 1. */
	size?: number;
	/** The color of the drawing. The default is the light's own color. */
	color?: ColorInput;
}

/**
 * Debug drawing: lines that show where things are, such as bounds, directions and axes. Each call
 * draws for one frame only, so call it in `onUpdate` in every frame that needs the drawing. Lines
 * are one pixel wide, and objects in front of them hide them. Colors take the same forms as material
 * colors, and positions are in world space.
 *
 * Only development builds draw. In a release build every call does nothing, and the build holds
 * none of the drawing code.
 *
 * @category api/debug
 */
export interface Debug {
	/** Draws a line from one point to another. The default color is yellow. */
	line(from: Vec3Like, to: Vec3Like, color?: ColorInput): void;
	/**
	 * Draws the edges of a box that lines up with the world's axes, from its lowest corner `min` to
	 * its highest corner `max`. The default color is yellow.
	 */
	box(min: Vec3Like, max: Vec3Like, color?: ColorInput): void;
	/**
	 * Draws a sphere as three circles around its center, one in each plane of the world's axes. The
	 * default color is yellow.
	 */
	sphere(center: Vec3Like, radius: number, color?: ColorInput): void;
	/**
	 * Draws an arrow from `origin` in `direction`, `length` meters long, with a head at its tip. The
	 * direction needs no unit length. The default length is 1, and the default color is yellow.
	 */
	arrow(origin: Vec3Like, direction: Vec3Like, length?: number, color?: ColorInput): void;
	/**
	 * Draws x, y and z axes, in red, green and blue, `size` meters long: at a position, or on an
	 * object. An object's axes take its position and rotation in the frame they draw in, so they
	 * never lag behind it. The default size is 1.
	 */
	axes(target: Object3D | Vec3Like, size?: number): void;
	/**
	 * Draws a square grid on the horizontal plane through its center, `size` meters wide, with
	 * `divisions` cells along each side, as three.js's `GridHelper` does. The defaults are 10 and 10.
	 */
	grid(size?: number, divisions?: number, options?: DebugGridOptions): void;
	/**
	 * Draws the space that a camera sees: its near and far planes and the edges between them, in the
	 * canvas's shape. The camera takes its place in the frame it draws in. The default color is
	 * orange, as in three.js's `CameraHelper`.
	 */
	frustum(camera: Camera, color?: ColorInput): void;
	/**
	 * Draws a light. A directional light draws as a square that faces its light, with an arrow in the
	 * direction its light travels.
	 */
	light(light: DirectionalLight, options?: DebugLightOptions): void;
}

const nothing = (): void => {};

/** The debug drawing of release builds: every call does nothing. */
export const RELEASE_DEBUG: Debug = {
	line: nothing,
	box: nothing,
	sphere: nothing,
	arrow: nothing,
	axes: nothing,
	grid: nothing,
	frustum: nothing,
	light: nothing,
};
