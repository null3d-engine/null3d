enable draw_index;

// Meshes drawn by instance in their material's color times its map, as three.js's
// MeshBasicMaterial draws them with a `map`. The map is a layer of a texture array, read at the
// first or the second texture coordinates through the material's texture coordinate transform,
// as three.js reads a texture with its `channel` and its transform. Materials whose maps share an
// array and a sampler share the maps' bind group, and each material's row in the material table
// gives its layer. A map whose image is not on the GPU yet has no layer, and the material draws as
// without it. The VERTEX_COLOR builds
// multiply the color by the mesh's vertex colors too. The ALPHA_MASK builds draw nothing where the
// alpha of the color, the map and the vertex colors falls below the material's cutoff. A material
// that blends writes premultiplied color.
// null3d::mesh finds each instance on both GPU paths.
#import null3d::mesh::{InstanceIn, clip_of, exposed, find_instance, finish_exposed, fogged}
#import null3d::mesh::{fragment_color}
#import null3d::mesh::{map_layer, map_ready, material_of, relative_position, straight_texel}
#import null3d::vertex::{mesh_position, mesh_second_uv, mesh_uv}
#ifdef SKIN
#import null3d::mesh::{skin_of, skinned_direction, skinned_point}
#endif

// The maps' bind group comes after the frame's group, and on WebGL2 after the groups of the draw
// records and the data textures.
#ifdef WEBGL2
@group(3) @binding(0) var map_layers: texture_2d_array<f32>;
@group(3) @binding(1) var map_sampler: sampler;
#else
@group(1) @binding(0) var map_layers: texture_2d_array<f32>;
@group(1) @binding(1) var map_sampler: sampler;
#endif

/// The bit of a material's flags for a base color map on the second texture coordinates.
const SECOND_UV: u32 = 256u;

/// The vertex attributes that the template reads.
struct VertexIn {
    @location(0) position: vec3f,
    @location(2) uv0: vec2f,
    /// The second texture coordinates, or the first on a mesh without a second set.
    @location(3) uv1: vec2f,
#ifdef VERTEX_COLOR
    @location(5) vertex_color: vec4f,
#endif
#ifdef SKIN
    @location(6) joints: vec4u,
    @location(7) weights: vec4f,
#endif
}

struct VertexOut {
    /// Invariant, so the depth prepass finds the same depth for each vertex as this template.
    @invariant @builtin(position) clip: vec4f,
    /// The first texture coordinates, then the second.
    @location(0) uv: vec4f,
    @location(1) @interpolate(flat, either) material: u32,
#ifdef VERTEX_COLOR
    @location(2) vertex_color: vec4f,
#endif
    /// The position relative to the camera.
    @location(3) relative: vec3f,
}

@vertex
fn vs(v: VertexIn, i: InstanceIn) -> VertexOut {
    let found = find_instance(i);
    var out: VertexOut;
#ifdef SKIN
    let skin = skin_of(found, v.joints, v.weights);
    let position = skinned_point(skin, mesh_position(v.position));
#else
    let position = mesh_position(v.position);
#endif
    out.relative = relative_position(found, position);
    out.clip = clip_of(found, out.relative);
    out.uv = vec4f(mesh_uv(v.uv0), mesh_second_uv(v.uv1));
    out.material = found.material;
#ifdef VERTEX_COLOR
    out.vertex_color = v.vertex_color;
#endif
    return out;
}

/// The base color times the map, which the coordinates that the material's flags pick place through
/// its texture coordinate transform. Sampling decodes an sRGB map to linear values, and reads a
/// linear map as it is. The texture is sampled whether the map is ready or not, as sampling needs
/// the same control flow in every invocation, and a map that is not ready reads as white.
@fragment
fn fs(in: VertexOut) -> @location(0) vec4f {
    let m = material_of(in.material);
    let second = (u32(m.strengths.z) & SECOND_UV) != 0u;
    let raw = vec3f(select(in.uv.xy, in.uv.zw, second), 1.0);
    let uv = vec2f(dot(m.uv_u.xyz, raw), dot(m.uv_v.xyz, raw));
    let texel = textureSample(map_layers, map_sampler, uv, map_layer(m.maps.x));
    let map = select(vec4f(1.0), straight_texel(m, texel), map_ready(m.maps.x));
    var base = m.color.rgb * map.rgb;
    var alpha = m.color.a * map.a;
#ifdef VERTEX_COLOR
    base *= in.vertex_color.rgb;
    alpha *= in.vertex_color.a;
#endif
#ifdef ALPHA_MASK
    if alpha < m.emissive.w {
        discard;
    }
#endif
    let finished = finish_exposed(fogged(exposed(base), in.relative, m), in.clip.xy);
    return fragment_color(m, finished.rgb, alpha);
}
