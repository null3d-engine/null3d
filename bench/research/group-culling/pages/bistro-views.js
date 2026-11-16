// The fixed views of the Bistro street scene, in meters after the file's centimeters are scaled by
// BISTRO_SCALE, and the camera's lens, shared by both engines' pages and the CPU model.

/** The scale from the file's centimeters to meters. */
export const BISTRO_SCALE = 0.01;

/** The camera's vertical field of view in degrees, and its near and far planes in meters. */
export const FOV_DEGREES = 55;
export const NEAR = 0.1;
export const FAR = 2000;

/** Each view: the camera's place and the point it looks at. */
export const BISTRO_VIEWS = {
	// At head height in the main street, looking along it past the café.
	street: { position: [-1.5, 1.7, 8], target: [-29, 1.7, -22] },
	// High over the block, looking down the street and the square from above the rooftops.
	wide: { position: [30, 45, 40], target: [-12, 0, -12] },
};
