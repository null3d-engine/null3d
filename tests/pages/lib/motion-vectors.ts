// The figures that the motion vectors sketch and its spec share (decision record D-140), and the
// decoding of the motion debug view's colors back into pixels of motion. Everything here is plain
// data with no engine imports.

/** The sketch time that every case holds at, a whole number of frame steps. */
export const MOTION_HOLD = 0.5;
/** The time from the last frame to the held one: one step of the hold mode's clock. */
export const FRAME_STEP = 1 / 60;
/** The image's size in pixels, which is the image test manifest's default. */
export const SIZE = [320, 180] as const;
/** The exact cases' orthographic view: its height in meters, 20 pixels per meter on the image. */
export const VIEW_HEIGHT = 9;
export const PIXELS_PER_METER = SIZE[1] / VIEW_HEIGHT;
/** The speeds of the exact cases, in meters per second. */
export const FAST = 24;
export const SLOW = 12;
export const SWAY = 6;
/** The motion in pixels at which the view's color reaches its full brightness. */
export const FULL_PIXELS = 16;

/** The cases that ?case= picks in the sketch. */
export const MOTION_CASES = ['slide', 'rows', 'sway', 'masked', 'skin', 'morph'] as const;
export type MotionCase = (typeof MOTION_CASES)[number];

/** How many pixels a speed in meters per second moves in one frame step on the exact cases' view. */
export const pixelsPerFrame = (speed: number) => speed * FRAME_STEP * PIXELS_PER_METER;

/** The pixel of the image where a point of the exact cases' view, in meters, shows. */
export const pixelOf = (x: number, y: number): [number, number] => [
	Math.floor(SIZE[0] / 2 + x * PIXELS_PER_METER),
	Math.floor(SIZE[1] / 2 - y * PIXELS_PER_METER),
];

/**
 * A pixel's motion since the last frame, in pixels to the right and down, from its color in the
 * motion view: the hue gives the direction and the brightest channel the length.
 */
export function decodeMotion(red: number, green: number, blue: number): [number, number] {
	const r = red / 255;
	const g = green / 255;
	const b = blue / 255;
	const value = Math.max(r, g, b);
	const spread = value - Math.min(r, g, b);
	if (value === 0 || spread === 0) return [0, 0];
	let sixths: number;
	if (value === r) sixths = ((g - b) / spread + 6) % 6;
	else if (value === g) sixths = (b - r) / spread + 2;
	else sixths = (r - g) / spread + 4;
	const angle = (sixths / 6) * 2 * Math.PI;
	const length = value * FULL_PIXELS;
	return [length * Math.cos(angle), length * Math.sin(angle)];
}
