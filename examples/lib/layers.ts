// The layers that the showcase scenes' clearance guard uses: what fills the air is not a wall, and
// what has a viewable inside may be entered. This is a leaf module, so the scene builders that mark
// their batches import it without reaching the guard's own module and its module graph.
import type { Mesh } from '@null3d/engine';

/**
 * The layer of an object whose inside a visitor may see, such as a cave mouth. The scene's camera
 * draws this layer; the clearance guard never tests it, so the camera may enter it.
 */
export const INTERIOR_LAYER = 1 << 30;
/**
 * The layer of what fills the air, such as falling snow, mist and fairy lights. The scene's camera
 * draws this layer; the clearance guard never tests it, since a sprite is not a wall.
 */
export const EFFECT_LAYER = 1 << 29;
/**
 * The layers of a showcase scene's sun. A light's layers pick the objects that cast its shadows, so
 * an object with an inside, such as a cave's rock, casts too and the sun never shines through it.
 * What fills the air casts none.
 */
export const SUN_LAYERS = 1 | INTERIOR_LAYER;
/** The layers that the clearance guard tests: every layer except the interiors' and the effects'. */
export const SOLID_LAYERS = EFFECT_LAYER - 1;
/** The layers a showcase scene's camera draws: the default, the unreflected and both markers. */
export const CAMERA_LAYERS = 1 | (1 << 1) | INTERIOR_LAYER | EFFECT_LAYER;

/** Puts an object on the interior layer alone, so the camera may enter it. */
export function markInterior(mesh: Mesh): void {
	mesh.setLayers(INTERIOR_LAYER);
}

/** Puts an object that fills the air on the effect layer alone, so the guard never treats it as a wall. */
export function markEffect<T extends { setLayers(mask: number): void }>(batch: T): T {
	batch.setLayers(EFFECT_LAYER);
	return batch;
}
