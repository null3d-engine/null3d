// The camera, the canvas and the drags that the camera controls' tests share between their page and
// their sketch. The live test makes the drags with Playwright. The held sketch makes the same moves
// through the controls' own calls, so its frame shows the pose that the live test reaches.

/** The camera's start: its position, the point it orbits, and its vertical field of view. */
export const CONTROLS_VIEW = {
	position: [0, 4, 9],
	target: [0, 0.5, 0],
	fov: 50,
} as const;

/** The canvas in CSS pixels, the size of the image test's frame. */
export const CONTROLS_CANVAS = { width: 320, height: 180 } as const;

/**
 * The drags in CSS pixels, in order: a left drag turns the camera, a right drag pans it, and wheel
 * scroll dollies it in.
 */
export const CONTROLS_MOVES = {
	turn: [50, 10],
	pan: [-30, 16],
	wheel: -150,
} as const;
