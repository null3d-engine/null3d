#define_import_path null3d::tables

// The engine's tables in the frame's group: the material table, three.js's table of the
// split-sum terms of specular light, the two tables of area lights, and the images of rectangle
// lights. The light tables texture at binding 3 is an array of layers (the light_tables module of
// the render crate): the split-sum table in the corner of layer 0, the area lights' tables in the
// corner of layers 1 and 2, and an image in each later layer, with its mip levels. Shaders read
// the split-sum table texel by texel with `textureLoad`, and the rest through the frame's
// filtering sampler. On WebGPU the material table is a storage buffer (null3d::mesh). On WebGL2
// it is a data texture, one row of texels per material, and the split-sum table sits in the
// columns after each row's texels, so the material and split-sum tables take one texture unit of
// a stage, and the light tables one more.

#ifdef WEBGL2
/// The material table: row `id` holds material `id`, one texel per `vec4f` of its `Material`.
/// The split-sum table follows in the columns from DFG_COLUMN.
@group(0) @binding(1) var materials: texture_2d<f32>;

/// The first column of the split-sum table in the material table's texture: one past a
/// material's texels.
const DFG_COLUMN: u32 = 15u;
#endif

/// The light tables, at binding 3 of the frame's group: see the module notes.
@group(0) @binding(3) var light_tables: texture_2d_array<f32>;

/// The frame group's filtering sampler: linear between texels and between mip levels, clamped at
/// the edges. The environment's map, the copy of the opaque color and the light tables share it.
@group(0) @binding(13) var environment_sampler: sampler;

/// Entries along each side of the split-sum table.
const DFG_SIZE: u32 = 16u;

/// Entries along each side of each area light table.
const AREA_SIZE: u32 = 64u;

/// Mip levels of a rectangle light's image, down to one texel.
const IMAGE_LEVELS: f32 = 8.0;

/// The split-sum table's entry at column `at.x` and row `at.y`: the scale and the bias.
fn dfg_entry(at: vec2u) -> vec2f {
#ifdef WEBGL2
    return textureLoad(materials, vec2u(DFG_COLUMN, 0u) + at, 0).xy;
#else
    return textureLoad(light_tables, at, 0, 0).xy;
#endif
}

/// What the area lights' tables give for one view angle and roughness: the four values of the
/// inverse of the matrix that fits the GGX BRDF by a transformed cosine, and the scale and bias of
/// the BRDF's Fresnel term.
struct AreaTerms {
    /// The inverse matrix's values at (0, 0), (2, 0), (0, 2) and (2, 2), by column and row.
    inverse: vec4f,
    /// The scale of the reflectance at normal incidence, and the weight of the reflectance at
    /// grazing angles.
    fresnel: vec2f,
}

/// The area lights' tables for a view at `n_dot_v` and a perceptual `roughness`, filtered between
/// the nearest four entries by the sampler. The tables run across by roughness and down by
/// sqrt(1 - n_dot_v), as three.js's `LTC_Uv` reads them, in the corner of their layers.
fn area_terms(n_dot_v: f32, roughness: f32) -> AreaTerms {
    let place = vec2f(roughness, sqrt(1.0 - saturate(n_dot_v)));
    let at = clamp(place, vec2f(0.0), vec2f(1.0)) * f32(AREA_SIZE - 1u) + 0.5;
    let uv = at / f32(textureDimensions(light_tables).x);
    return AreaTerms(table(1, uv), table(2, uv).xy);
}

/// The light tables' layer `layer` at `uv` of the whole layer, at the largest mip level.
fn table(layer: i32, uv: vec2f) -> vec4f {
    return textureSampleLevel(light_tables, environment_sampler, uv, layer, 0.0);
}

/// A rectangle light's image in layer `layer`, at `uv` from its corner at +X and -Y, at mip level
/// `level`: 0 is the sharpest.
fn light_image(layer: i32, uv: vec2f, level: f32) -> vec3f {
    let at = clamp(level, 0.0, IMAGE_LEVELS - 1.0);
    return textureSampleLevel(light_tables, environment_sampler, saturate(uv), layer, at).rgb;
}
