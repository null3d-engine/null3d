// The camera of the shadow turn sketch, which its test needs to map each frame onto the first.

/** Where the camera stands, how far it looks down, and its vertical field of view. */
export const TURN = {
	position: [0, 6, 0] as const,
	pitchDegrees: -35,
	fovDegrees: 50,
};
