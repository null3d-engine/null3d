#define_import_path null3d::tables

// The engine's tables in the frame's group: the material table, three.js's table of the split-sum
// terms of specular light, the two tables of area lights, the images of lights, and the
// reflection probes' maps. Binding 3 is one texture array of half floats (the light_tables module
// of the render crate): layer 0 is spare, layers 1 and 2 hold the area lights' tables in their
// corner, the reflection probes' maps take the layers after them, and an image follows in each
// later layer, with its mip levels. The split-sum table takes no texture of its own: on WebGL2 it
// sits in the columns of the material table's texture, and on WebGPU in the materials' custom
// values. Shaders read the split-sum table texel by texel with `textureLoad`, and the rest of the
// array through the frame's filtering sampler. The array is one unit of a WebGL2 stage.

#ifdef WEBGL2
/// The material table: row `id` holds material `id`, one texel per `vec4f` of its `Material`.
/// The split-sum table follows in the columns from DFG_COLUMN.
@group(0) @binding(1) var materials: texture_2d<f32>;
#else
/// The materials' custom values: row `id` holds material `id`'s, one texel per `vec4f`. Vertex
/// shaders read them too, and read no storage buffers, so they have a data texture of their own.
/// The split-sum table follows in the columns from DFG_COLUMN.
@group(0) @binding(2) var custom_values: texture_2d<f32>;
#endif

/// The first column of the split-sum table in its data texture: one past a material's texels.
const DFG_COLUMN: u32 = 37u;

/// The light tables and the probes' maps, at binding 3 of the frame's group: see the module notes.
@group(0) @binding(3) var light_tables: texture_2d_array<f32>;

/// The frame group's filtering sampler: linear between texels and between mip levels, clamped at
/// the edges. The environment's map, the copy of the opaque color, the light tables and the
/// probes' maps share it.
@group(0) @binding(13) var environment_sampler: sampler;

/// Entries along each side of the split-sum table.
const DFG_SIZE: u32 = 16u;

/// Entries along each side of each area light table.
const AREA_SIZE: u32 = 64u;

/// Texels along each side of a light's image at the smallest size that a picture takes.
const IMAGE_SIZE: f32 = 128.0;

/// Mip levels of an image at `IMAGE_SIZE`, down to one texel.
const IMAGE_BASE_LEVELS: f32 = 8.0;

/// Bits of a light's record that hold its image's layer, above the bits that hold the number of
/// its size. The record holds the layer plus one, so 0 names an image that the light lacks.
const IMAGE_LAYER_BITS: u32 = 6u;

/// The image that `record` names, which is the value in a light's image place: its layer in the
/// light tables plus one at `x`, 0 for a light without one, the texels across its largest level at
/// `y`, and the level that holds one texel at `z`.
fn image_of(record: f32) -> vec3f {
    let index = u32(record) >> IMAGE_LAYER_BITS;
    return vec3f(
        f32(u32(record) & ((1u << IMAGE_LAYER_BITS) - 1u)),
        IMAGE_SIZE * f32(1u << index),
        IMAGE_BASE_LEVELS - 1.0 + f32(index),
    );
}

/// The split-sum table's entry at column `at.x` and row `at.y`: the scale and the bias.
fn dfg_entry(at: vec2u) -> vec2f {
#ifdef WEBGL2
    return textureLoad(materials, vec2u(DFG_COLUMN, 0u) + at, 0).xy;
#else
    return textureLoad(custom_values, vec2u(DFG_COLUMN, 0u) + at, 0).xy;
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

/// A light's image from `record`, in its layer, at `uv` from its corner at +X and -Y, at mip
/// level `level`: 0 is the sharpest. The image fills the corner of its layer, which the probes'
/// maps may make larger than the image.
fn light_image(record: f32, uv: vec2f, level: f32) -> vec3f {
    let image = image_of(record);
    let scale = image.y / f32(textureDimensions(light_tables).x);
    let at = clamp(level, 0.0, image.z);
    return textureSampleLevel(light_tables, environment_sampler, saturate(uv) * scale, i32(image.x) - 1, at).rgb;
}
