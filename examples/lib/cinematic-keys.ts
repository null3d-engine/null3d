// The keys of a showcase scene's camera, in a file of their own, so the cinematic camera and the
// page's own controls read the same codes: the launcher's touch controls send exactly the keys the
// keyboard sends, and one table names them.

/** The keys that the Manual camera reads: the mode switch, the four pans, and the rise and fall. */
export const CAMERA_KEYS = {
	mode: 'KeyC',
	forward: 'KeyW',
	back: 'KeyS',
	left: 'KeyA',
	right: 'KeyD',
	rise: 'KeyR',
	fall: 'KeyF',
} as const;
