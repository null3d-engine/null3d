// A comparison sketch's answer to the page's request for a signature of its scene: the camera's
// place, which moves in every update. The ramp's browser tests ask for it at each step, so a scene
// that stops updating, as Battle once did when the animation table filled, shows the same signature
// two steps in a row. The sketches send it, and examples/lib/compare.ts asks for it.

/** The page's message that asks a sketch for its scene signature; its data is the request's token. */
export const SIGNATURE_MESSAGE = 'scene-signature';

/** The sketch's answer to a signature request, matched to it by `token`. */
export interface SceneSignature {
	/** The request's token, which the page gave with the message. */
	token: number;
	/** The camera's X and Z, which move with the scene. */
	camera: [number, number];
}
