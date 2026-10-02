#define_import_path null3d::shadows

// The shadows of the main directional light, which lit templates read where a surface receives
// shadows. Each frame the core fits up to four cascades to the camera's view, near ones small and
// far ones large, and draws the depth of the light's shadow casters into one layer of a depth
// texture array per cascade. A receiver picks the cascade that holds its distance along the
// camera's view, and compares its depth from the light with the depth that the cascade stored.
//
// Depth is reversed, as everywhere in the engine: 1 on the light's side of a cascade and 0 on the
// far side. A point is lit where its depth is at least the stored depth, which the comparison
// sampler tests with its hardware filter over the four nearest texels.
//
// Point and spot lights cast shadows into the tiles of the shadow atlas, a second depth texture
// array with one tile per layer. A spot light's tile is a perspective view from the light that
// holds its cone. A point light has six tiles in a row, one per face of a cube around it. Each
// light's record in the light list holds its first tile plus one, or 0 without one, and the
// tiles' uniform block holds each tile's matrix with the light's biases.

/// The cascades of the main directional light's shadows, as the core writes them each frame.
struct ShadowCascades {
    /// Each cascade's matrix from positions relative to the camera into its clip space.
    view_proj: array<mat4x4f, 4>,
    /// Where each cascade ends along the camera's view. Past the last, nothing is shadowed.
    ends: vec4f,
    /// The vector whose dot product with a position relative to the camera gives its distance
    /// along the camera's view, then the cascade count.
    forward: vec4f,
    /// How far each cascade's receivers move along their normals, in meters.
    normal_offsets: vec4f,
    /// How far each cascade's receivers move their depth toward the light.
    depth_biases: vec4f,
}

/// The tiles of the shadow atlas, as the core writes them each frame.
struct ShadowTiles {
    /// Each tile's matrix from positions relative to the camera into its clip space.
    view_proj: array<mat4x4f, 24>,
    /// Each tile's texel size per meter of distance from its light, the light's bias and normal
    /// bias in texels, and the light's tiles: 1 for a spot light, 6 for a point light.
    params: array<vec4f, 24>,
}

@group(0) @binding(4) var shadow_map: texture_depth_2d_array;
@group(0) @binding(5) var shadow_sampler: sampler_comparison;
@group(0) @binding(6) var<uniform> cascades: ShadowCascades;
@group(0) @binding(9) var shadow_atlas: texture_depth_2d_array;
@group(0) @binding(10) var<uniform> tiles: ShadowTiles;

/// The share of the shadow distance over which shadows fade out.
const FADE_SHARE: f32 = 0.1;

/// How much of the main directional light reaches a point: 1 in full light, 0 in full shadow.
/// `relative` is the point's position relative to the camera, and `normal` its unit normal, which
/// moves the point off its own surface before the lookup.
fn sun_shadow(relative: vec3f, normal: vec3f) -> f32 {
    let along = dot(relative, cascades.forward.xyz);
    let count = u32(cascades.forward.w);
    var cascade = 0u;
    while cascade < count && along >= cascades.ends[cascade] {
        cascade += 1u;
    }
    if cascade >= count {
        return 1.0;
    }
    let moved = relative + normal * cascades.normal_offsets[cascade];
    let clip = cascades.view_proj[cascade] * vec4f(moved, 1.0);
    var uv = clip.xy * vec2f(0.5, -0.5) + 0.5;
#ifdef WEBGL2
    // WebGL2 keeps the rows of a drawn texture bottom first.
    uv.y = 1.0 - uv.y;
#endif
    let depth = clip.z + cascades.depth_biases[cascade];
    let lit = textureSampleCompareLevel(shadow_map, shadow_sampler, uv, cascade, depth);
    let end = cascades.ends[count - 1u];
    return mix(lit, 1.0, smoothstep(end * (1.0 - FADE_SHARE), end, along));
}

/// The face of a point light's cube that a direction from the light points through, in the order
/// of its tiles: +x, -x, +y, -y, +z, -z.
fn cube_face(direction: vec3f) -> u32 {
    let size = abs(direction);
    if size.x >= size.y && size.x >= size.z {
        return select(1u, 0u, direction.x > 0.0);
    }
    if size.y >= size.z {
        return select(3u, 2u, direction.y > 0.0);
    }
    return select(5u, 4u, direction.z > 0.0);
}

/// How much of a point or spot light reaches a point: 1 in full light, 0 in full shadow. `first`
/// is the light's first tile. `relative` is the point's position relative to the camera, `normal`
/// its unit normal, `to_light` the unit direction toward the light, and `gap` the distance to it.
/// The biases count texels of the tile at the point's distance from the light. A point outside its
/// tile's view is lit.
fn light_shadow(first: u32, relative: vec3f, normal: vec3f, to_light: vec3f, gap: f32) -> f32 {
    let params = tiles.params[first];
    let texel = params.x * gap;
    let moved = relative + normal * (params.z * texel) + to_light * (params.y * texel);
    var tile = first;
    if params.w > 1.5 {
        tile += cube_face(moved - (relative + to_light * gap));
    }
    let clip = tiles.view_proj[tile] * vec4f(moved, 1.0);
    if clip.w <= 0.0 {
        return 1.0;
    }
    let ndc = clip.xyz / clip.w;
    if abs(ndc.x) > 1.0 || abs(ndc.y) > 1.0 {
        return 1.0;
    }
    var uv = ndc.xy * vec2f(0.5, -0.5) + 0.5;
#ifdef WEBGL2
    // WebGL2 keeps the rows of a drawn texture bottom first.
    uv.y = 1.0 - uv.y;
#endif
    return textureSampleCompareLevel(shadow_atlas, shadow_sampler, uv, tile, ndc.z);
}
