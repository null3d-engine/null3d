#define_import_path null3d::tables

// The engine's tables that shaders read texel by texel with `textureLoad`, in the frame's group:
// the material table, and three.js's table of the split-sum terms of specular light. On WebGL2 the
// material table is a data texture, one row of texels per material, and the split-sum table sits
// in the columns after each row's texels, so both take one texture unit of a stage. On WebGPU the
// material table is a storage buffer (null3d::mesh), and the split-sum table has a texture of its
// own at binding 3.

#ifdef WEBGL2
/// The material table: row `id` holds material `id`, one texel per `vec4f` of its `Material`.
/// The split-sum table follows in the columns from DFG_COLUMN.
@group(0) @binding(1) var materials: texture_2d<f32>;

/// The first column of the split-sum table in the material table's texture: one past a
/// material's texels.
const DFG_COLUMN: u32 = 9u;
#else
/// three.js's table of the split-sum terms of specular light, at binding 3 of the frame's group.
@group(0) @binding(3) var dfg_table: texture_2d<f32>;
#endif

/// Entries along each side of the split-sum table.
const DFG_SIZE: u32 = 16u;

/// The split-sum table's entry at column `at.x` and row `at.y`: the scale and the bias.
fn dfg_entry(at: vec2u) -> vec2f {
#ifdef WEBGL2
    return textureLoad(materials, vec2u(DFG_COLUMN, 0u) + at, 0).xy;
#else
    return textureLoad(dfg_table, at, 0).xy;
#endif
}
