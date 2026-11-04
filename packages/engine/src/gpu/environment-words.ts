// The words of a stage's command that a backend reads while it records a map's draws: the layer
// over the sky and the volumetric cloud tier's field. They sit apart from the steps themselves
// because every start reads them: a page that draws downloads this file, where the steps load only
// when a sketch first makes a map (rule 8). `crates/null3d-render/src/sky_maps.rs` lays the words
// out.

/**
 * The words of a stage's command that name the layer over the sky: the template of the layer's
 * build of this shader, its four cloud values, the share of the sun that it hides, its opacity,
 * its clock, and the buffer that a light capture lands in.
 */
export const LAYER_WORD = 20;
export const LAYER_VALUES = 21;
export const LIGHT_BUFFER_WORD = 28;

/**
 * The words that name the volumetric cloud tier's step count and its noise field's texture, which
 * a stage's shader draws the march with. They follow the layer's words.
 */
export const CLOUD_STEPS_WORD = 29;
export const CLOUD_FIELD_WORD = 30;
