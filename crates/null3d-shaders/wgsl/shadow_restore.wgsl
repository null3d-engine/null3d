// The copy of a far shadow cascade's cache layer into its layer of the shadow map: one triangle
// over the layer that writes each texel's depth from the same texel of the cache. The cache holds
// the cascade's still casters, drawn in its last turn, and the cascade's moving casters then draw
// over the copy. The draw's first vertex names the cache layer: each vertex's index is the layer
// times three, plus its corner. The cache binds as unfilterable floats, which every GPU path reads
// with textureLoad, compatibility mode too. A fragment and the texel it covers have the same place
// in the layer and in the cache on both GPU paths, so the copy turns no rows.

@group(0) @binding(0) var cache: texture_2d_array<f32>;

struct VertexOut {
    @builtin(position) clip: vec4f,
    @location(0) @interpolate(flat, either) layer: u32,
}

@vertex
fn vs(@builtin(vertex_index) vertex: u32) -> VertexOut {
    // Corners at (-1, -1), (3, -1) and (-1, 3) in clip space, at a depth that every WebGL2 depth
    // mapping keeps inside the clip volume. The fragment writes its own depth.
    let index = vertex % 3u;
    let corner = vec2f(f32((index << 1u) & 2u), f32(index & 2u));
    var out: VertexOut;
    out.clip = vec4f(corner * 2.0 - 1.0, 0.5, 1.0);
    out.layer = vertex / 3u;
    return out;
}

@fragment
fn fs(in: VertexOut) -> @builtin(frag_depth) f32 {
    return textureLoad(cache, vec2i(in.clip.xy), in.layer, 0).x;
}
