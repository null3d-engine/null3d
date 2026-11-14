// The scene that the 3D label test draws in both engines: a camera that looks down its view, a card
// that turns and scales with its object, and a card that faces the camera. The scene's units are the
// elements' CSS pixels, as they are for three.js's CSS3DRenderer, so a card is as wide as its
// element.

export const CAMERA = { fov: 60, near: 0.5, far: 50 } as const;

/** The card that turns with its object: where the object stands, how it turns, and the label's offset. */
export const PLATE = {
	position: [1.2, 0.8, -5] as [number, number, number],
	rotation: [0.3, -0.7, 0.2] as [number, number, number],
	offset: [0, 0.5, 0] as [number, number, number],
	width: 1.2,
	height: 0.8,
};

/** The card that faces the camera, and its turn in its own plane. */
export const FACE = {
	position: [-1.4, -0.7, -4] as [number, number, number],
	rotation: 0.35,
	width: 1.1,
	height: 0.6,
};
