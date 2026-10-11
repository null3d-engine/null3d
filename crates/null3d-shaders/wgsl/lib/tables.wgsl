#define_import_path null3d::tables

// The engine's tables that shaders read texel by texel with `textureLoad`, in the frame's group:
// the material table, and three.js's table of the split-sum terms of specular light. The split-sum
// table sits in the first rows of a data texture of the frame's group, in the columns after each
// row's texels, so it takes no texture of its own. On WebGL2 the material table is a data texture,
// one row of texels per material, which holds it. On WebGPU the material table is a storage buffer
// (null3d::mesh), and the texture of the materials' custom values holds it. Binding 3, which it
// took before, holds the reflection probes' maps (null3d::probes).

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
const DFG_COLUMN: u32 = 11u;

/// Entries along each side of the split-sum table.
const DFG_SIZE: u32 = 16u;

/// The split-sum table's entry at column `at.x` and row `at.y`: the scale and the bias.
fn dfg_entry(at: vec2u) -> vec2f {
#ifdef WEBGL2
    return textureLoad(materials, vec2u(DFG_COLUMN, 0u) + at, 0).xy;
#else
    return textureLoad(custom_values, vec2u(DFG_COLUMN, 0u) + at, 0).xy;
#endif
}
