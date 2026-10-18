// GPU picking: each object of the camera's view drawn with the camera's view-projection, writing
// the source key of the object or of the instance's row where the scene's depth leaves it. A pick
// pass runs after the opaque pass and draws into an id target the size of the render size, with
// the scene's depth as its depth target and a test that writes no depth. So a pixel takes the key
// of the object that owns the depth there, and a fragment that a material's mask discarded (which
// wrote no depth) never matches: masked objects pick by their mask, not by their whole geometry.
//
// null3d::mesh finds each instance exactly as the templates that shade do, so the position matches
// the scene's depth to the last bit, which the test needs. The fragment writes the source key as
// four bytes, which an 8-bit target stores as the bytes themselves. The sketch turns the key into
// an object or a batch and a row.
//
// On WebGL2, exact equality across two programs is not certain. In Chrome on the Mac (ANGLE on
// Metal), the depth template's prepass build and the shading programs gave positions a rounding
// step apart, though every program marks its position invariant (decision record D-43). The
// WebGL2 pipeline therefore tests for a nearer depth with a small bias toward the camera, as the
// outline mask's does (decision record D-36), so the surface that wrote the depth passes.
//
// The SKIN builds skin each vertex with the joint texture, as WebGL2 and the other engine templates
// do, so a skinned character picks where it draws. The MORPH builds, which only WebGL2 has, add the
// morph targets' deltas before that, as its shading templates do, so a morphed mesh picks where it
// draws too. A mesh drawn with a material that moves its vertices in its own WGSL has no build
// here: the material's own template has pick builds when it moves vertices only by its vertex
// offset, and otherwise the scene query answers it with a raycast.
#import null3d::mesh::{Instance, InstanceIn, clip_of, find_instance, relative_position}
#import null3d::vertex::{mesh_position}
#ifdef ALPHA_MASK
#import null3d::mesh::{material_of}
#endif
#ifdef MAP
#import null3d::mesh::{map_layer, map_ready}
#import null3d::vertex::{mesh_second_uv, mesh_uv}
#endif
#ifdef SKIN
#import null3d::mesh::{skin_of, skinned_point}
#endif
#ifdef MORPH
#import null3d::mesh::{Morphed, morph_vertex}
#endif

#ifdef MAP
// The map's bind group comes after the frame's group, and on WebGL2 after the groups of the draw
// records and the data textures. A standard material's group holds each map slot beside its
// sampler, as its shading reads them; an unlit map's group holds the base color map alone.
#ifdef MATERIAL_MAPS
#ifdef WEBGL2
@group(3) @binding(0) var base_map: texture_2d_array<f32>;
@group(3) @binding(8) var base_sampler: sampler;
#else
@group(1) @binding(0) var base_map: texture_2d_array<f32>;
@group(1) @binding(8) var base_sampler: sampler;
#endif
#else
#ifdef WEBGL2
@group(3) @binding(0) var base_map: texture_2d_array<f32>;
@group(3) @binding(1) var base_sampler: sampler;
#else
@group(1) @binding(0) var base_map: texture_2d_array<f32>;
@group(1) @binding(1) var base_sampler: sampler;
#endif
#endif

/// The bit of a material's flags for a base color map on the second texture coordinates.
const SECOND_UV: u32 = 256u;
#endif

/// The vertex attributes that the template reads: the position, and, for a masked material, what
/// its mask test needs.
struct VertexIn {
    @location(0) position: vec3f,
#ifdef MAP
    @location(2) uv0: vec2f,
    /// The second texture coordinates, or the first on a mesh without a second set.
    @location(3) uv1: vec2f,
#endif
#ifdef VERTEX_COLOR
    @location(5) vertex_color: vec4f,
#endif
#ifdef SKIN
    @location(6) joints: vec4u,
    @location(7) weights: vec4f,
#endif
#ifdef MORPH
    @location(8) morph: vec2f,
#endif
}

/// The key of an instance's source: its slot for an object of the scene, or its row of the data
/// texture that the object ranges name, marked for a streamed row. The sketch turns the key back
/// into an object and a row.
fn pick_key(found: Instance) -> u32 {
#ifdef WEBGL2
    // The bit above every resident row marks a row of the streamed data texture.
    return found.source | select(0u, 1u << 31u, found.streamed);
#else
    return found.source;
#endif
}

/// The color that the id target holds for a source key: its four bytes, each as the fraction an
/// 8-bit target stores. The four bytes read back as the key itself.
fn pick_color(key: u32) -> vec4f {
    let bytes = vec4u(
        (key >> 24u) & 0xffu,
        (key >> 16u) & 0xffu,
        (key >> 8u) & 0xffu,
        key & 0xffu,
    );
    return vec4f(bytes) / 255.0;
}

/// The vertex's clip position, the source key that the fragment writes, and, for a masked
/// material, the values that its mask test needs.
struct VertexOut {
    @invariant @builtin(position) position: vec4f,
    @location(0) @interpolate(flat, either) key: u32,
#ifdef ALPHA_MASK
    @location(1) @interpolate(flat, either) material: u32,
#endif
#ifdef MAP
    /// The first texture coordinates, then the second.
    @location(2) uv: vec4f,
#endif
#ifdef VERTEX_COLOR
    @location(3) vertex_alpha: f32,
#endif
}

@vertex
fn vs(v: VertexIn, i: InstanceIn) -> VertexOut {
    let found = find_instance(i);
#ifdef MORPH
    // Only the position and the color matter here, so the normal and the tangent enter as zero.
    var source = Morphed(mesh_position(v.position), vec3f(0.0), vec3f(0.0), vec4f(1.0));
#ifdef VERTEX_COLOR
    source.color = v.vertex_color;
#endif
    let rest = morph_vertex(found, v.morph, source);
    let rest_position = rest.position;
#else
    let rest_position = mesh_position(v.position);
#endif
#ifdef SKIN
    let position = skinned_point(skin_of(found, v.joints, v.weights), rest_position);
#else
    let position = rest_position;
#endif
    var out: VertexOut;
    out.position = clip_of(found, relative_position(found, position));
    out.key = pick_key(found);
#ifdef ALPHA_MASK
    out.material = found.material;
#endif
#ifdef MAP
    out.uv = vec4f(mesh_uv(v.uv0), mesh_second_uv(v.uv1));
#endif
#ifdef VERTEX_COLOR
#ifdef MORPH
    out.vertex_alpha = rest.color.a;
#else
    out.vertex_alpha = v.vertex_color.a;
#endif
#endif
    return out;
}

/// Writes the source key, and keeps no fragment that the material's mask cuts: a masked surface
/// picks by its mask, as it draws. The map is sampled whether it is ready or not, as sampling
/// needs the same control flow in every invocation, and a map that is not ready counts as opaque.
@fragment
fn fs(in: VertexOut) -> @location(0) vec4f {
#ifdef ALPHA_MASK
    let m = material_of(in.material);
    var alpha = m.color.a;
#ifdef VERTEX_COLOR
    alpha *= in.vertex_alpha;
#endif
#ifdef MAP
    let second = (u32(m.strengths.z) & SECOND_UV) != 0u;
    let raw = vec3f(select(in.uv.xy, in.uv.zw, second), 1.0);
    let uv = vec2f(dot(m.uv_u.xyz, raw), dot(m.uv_v.xyz, raw));
    let texel = textureSample(base_map, base_sampler, uv, map_layer(m.maps.x));
    alpha *= select(1.0, texel.a, map_ready(m.maps.x));
#endif
    if alpha < m.emissive.w {
        discard;
    }
#endif
    return pick_color(in.key);
}
