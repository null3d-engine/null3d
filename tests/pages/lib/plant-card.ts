// A square card that faces +Z, in the plant vertex format that a plant material draws. The material's
// wind offset declares the vertex colour, where a plant's branch index and leaf phase live, so a card
// without the attribute draws nothing. A still material reads none of the branch data, so any colour
// serves. Callers scale the unit card to their size.
import type { MeshArrays } from '@null3d/engine';

/** A card one meter across that faces +Z, which a plant material draws. */
export const PLANT_CARD: MeshArrays = {
	positions: new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]),
	normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
	uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
	colors: new Uint8Array([0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]),
	indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
};
