// The lenses of the lens shift test: a wide camera, and a narrow one whose lens shift frames one
// rectangle of the wide camera's image. The page and its sketch both read them.

/** The wide perspective camera's vertical field of view, in degrees. */
export const LENS_SHIFT_FOV = 50;
/** The wide orthographic camera's view height, in world units. */
export const LENS_SHIFT_HEIGHT = 16;
/**
 * The rectangle of the wide camera's image that the narrow camera frames: x, y, width and height as
 * shares of the canvas from its top-left corner. It is the top-right quarter, so the narrow lens
 * shifts by half its view both across and up.
 */
export const LENS_SHIFT_RECT = [0.5, 0, 0.5, 0.5] as const;

/**
 * The narrow lens that frames `rect` of the wide camera's image, on a canvas of the rectangle's
 * shape: its view's height as a share of the wide view's, and its lens shift, as shares of its own
 * view's width and height.
 */
export function narrowLens(rect: readonly [number, number, number, number]): {
	scale: number;
	shift: readonly [number, number];
} {
	const [x, y, width, height] = rect;
	return {
		scale: height,
		shift: [(x + width / 2 - 0.5) / width, (0.5 - (y + height / 2)) / height],
	};
}
