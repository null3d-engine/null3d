// Camera lenses: their defaults, which match three.js's cameras, the view that an orthographic
// camera's options describe, and the checks that development builds run on lens values. The engine
// core builds each camera's projection from these values every frame, with the canvas's aspect
// ratio, so the TypeScript side keeps only what the sketch set.

import { checkNumber, type Described } from '../errors/checks';
import { EngineError } from '../errors/engine-error';

/**
 * An orthographic view in world units: its height, its width, or 0 for a width that follows the
 * canvas's aspect ratio, and its center relative to the camera's axis.
 */
export interface OrthographicView {
	height: number;
	width: number;
	centerX: number;
	centerY: number;
}

/** What sizes an orthographic view: a height, or four edges as three.js's camera takes them. */
export interface OrthographicSize {
	height?: number;
	left?: number;
	right?: number;
	top?: number;
	bottom?: number;
}

/** A perspective camera's vertical field of view in degrees, unless its options give one. */
export const DEFAULT_FOV = 50;
/** A camera's near and far distances, unless its options give them. */
export const DEFAULT_NEAR = 0.1;
export const DEFAULT_FAR = 2000;
/** The height of three.js's default orthographic view, from bottom -1 to top 1. */
export const DEFAULT_ORTHO_HEIGHT = 2;
/**
 * Half the height of a full-frame sensor, 36 by 24 mm, in millimetres: a lens's focal length and
 * the vertical field of view relate through it, as depth of field's lens does in the core.
 */
export const HALF_SENSOR_MM = 12;

const EDGES = ['left', 'right', 'top', 'bottom'] as const;

/** True when the options give any of the four edges, which then size the view. */
function hasEdges(size: OrthographicSize): boolean {
	return (
		size.left !== undefined ||
		size.right !== undefined ||
		size.top !== undefined ||
		size.bottom !== undefined
	);
}

/**
 * The view that orthographic options describe: four edges when the options give them, or else a
 * height, 2 by default, whose width follows the canvas.
 */
export function orthographicView(size: OrthographicSize): OrthographicView {
	if (!hasEdges(size))
		return { height: size.height ?? DEFAULT_ORTHO_HEIGHT, width: 0, centerX: 0, centerY: 0 };
	const { left = 0, right = 0, top = 0, bottom = 0 } = size;
	return {
		height: top - bottom,
		width: right - left,
		centerX: (left + right) / 2,
		centerY: (top + bottom) / 2,
	};
}

/**
 * Sets a view's height. A width that follows the canvas keeps following it, and a view from four
 * edges scales its width with its height about its center, as three.js's `zoom` scales it.
 */
export function setViewHeight(view: OrthographicView, height: number): void {
	view.width *= height / view.height;
	view.height = height;
}

/**
 * Something an error message can name before its camera exists: the camera's name, or "a new
 * camera".
 */
export function newCamera(name: string | undefined): Described {
	return { describe: () => (name ? `"${name}"` : 'a new camera') };
}

/** Throws E1203 when a lens value is not finite, and E1108 when it is not above 0. */
export function checkSize(call: string, name: string, value: number, target: Described): void {
	checkNumber(call, name, value, target);
	if (!(value > 0))
		throw new EngineError(
			'E1108',
			`${call}() got the ${name} ${value} on ${target.describe()}, which is not above 0.`,
		);
}

/**
 * Throws E1203 for a value that is not finite, and E1108 for near and far planes that hold
 * nothing: a far plane not beyond the near plane, or a perspective near plane not in front of
 * the camera.
 */
export function checkNearFar(
	call: string,
	near: number,
	far: number,
	perspective: boolean,
	target: Described,
): void {
	checkNumber(call, 'near', near, target);
	checkNumber(call, 'far', far, target);
	if (perspective && !(near > 0))
		throw new EngineError(
			'E1108',
			`${call}() got the near distance ${near} on ${target.describe()}. A perspective camera's near plane must be in front of it, above 0.`,
		);
	if (!(far > near))
		throw new EngineError(
			'E1108',
			`${call}() got the near distance ${near} and the far distance ${far} on ${target.describe()}. The far distance must be above the near one.`,
		);
}

/** Throws E1203 when a field of view is not finite, and E1108 when it is outside 0 to 180. */
export function checkFov(call: string, degrees: number, target: Described): void {
	checkNumber(call, 'fov', degrees, target);
	if (!(degrees > 0 && degrees < 180))
		throw new EngineError(
			'E1108',
			`${call}() got the field of view ${degrees} on ${target.describe()}, outside 0 to 180 degrees.`,
		);
}

/**
 * Throws E1108 when orthographic options give a height and edges together, E1203 when they give
 * some edges without the rest, and E1108 when their view has no size.
 */
export function checkOrthographicSize(
	call: string,
	size: OrthographicSize,
	target: Described,
): void {
	if (!hasEdges(size)) {
		if (size.height !== undefined) checkSize(call, 'height', size.height, target);
		return;
	}
	if (size.height !== undefined)
		throw new EngineError(
			'E1108',
			`${call}() got a height and edges on ${target.describe()}. Give the height, or give left, right, top and bottom.`,
		);
	for (const edge of EDGES) checkNumber(call, edge, size[edge] as number, target);
	const { left = 0, right = 0, top = 0, bottom = 0 } = size;
	if (!(right > left))
		throw new EngineError(
			'E1108',
			`${call}() got the left edge ${left} and the right edge ${right} on ${target.describe()}. The right edge must be above the left one.`,
		);
	if (!(top > bottom))
		throw new EngineError(
			'E1108',
			`${call}() got the top edge ${top} and the bottom edge ${bottom} on ${target.describe()}. The top edge must be above the bottom one.`,
		);
}
