enable draw_index;

// The motion of moving objects, which the motion pass draws from the motion view into the motion
// target (decision record D-140). Each vertex takes its place in this frame, as the templates that
// shade place it, and its place in the last frame, from the last frame's matrix, joints and morph
// weights. The fragment writes the surface's own motion beyond what the camera's move explains
// (null3d::motion). The position is invariant, so the motion pass's test of the scene's depth
// finds the surfaces that the scene passes drew.
//
// On WebGPU each vertex also reads its last place at location 4, from vertex buffer slot 2: the
// last frame's copy of the skinning pass's vertices for an object that the pass skins or morphs,
// or the mesh's own vertices for any other, whose rest positions do not change. The SKIN builds
// skin in the vertex shader with this frame's and the last frame's joint textures, and the WebGL2
// MORPH builds morph with both frames' weights.
//
// Masked materials test their alpha as masked casters do (shadow_depth.wgsl): the opacity, times
// the vertex alpha in the VERTEX_COLOR builds and the base color map's alpha where the map has an
// image, against the cutoff in the ALPHA_MASK builds or the alpha hash in the ALPHA_HASH builds.
// Group 1 (group 3 on WebGL2) is the base color map's group, or a blank map's for a material
// without one.
#import null3d::mesh::{InstanceIn, clip_of, find_instance, relative_position}
#import null3d::motion::{last_transform, motion_block, surface_motion}
#import null3d::vertex::{mesh_position, transform_point}
#ifndef WEBGL2
#import null3d::motion::{LastIn}
#endif
#ifdef ALPHA_MASK
#import null3d::mesh::{map_layer, map_ready, material_of}
#import null3d::vertex::{mesh_second_uv, mesh_uv}
#endif
#ifdef ALPHA_HASH
#import null3d::cutout::{alpha_hash_threshold}
#endif
#ifdef SKIN
#import null3d::mesh::{skin_of, skinned_point}
#import null3d::motion::{last_skin_point}
#endif
#ifdef MORPH
#import null3d::mesh::{Morphed, morph_vertex}
#import null3d::motion::{last_morphed_position}
#endif

#ifdef ALPHA_MASK
// The base color map's bind group comes after the frame's group, and on WebGL2 after the groups of
// the draw records and the data textures.
#ifdef WEBGL2
@group(3) @binding(0) var map_layers: texture_2d_array<f32>;
@group(3) @binding(1) var map_sampler: sampler;
#else
@group(1) @binding(0) var map_layers: texture_2d_array<f32>;
@group(1) @binding(1) var map_sampler: sampler;
#endif

/// The bit of a material's flags for a base color map on the second texture coordinates.
const SECOND_UV: u32 = 256u;
#endif

/// The vertex attributes that the template reads.
struct VertexIn {
    @location(0) position: vec3f,
#ifdef ALPHA_MASK
    @location(2) uv0: vec2f,
    /// The second texture coordinates, or the first on a mesh without a second set.
    @location(3) uv1: vec2f,
#endif
#ifndef WEBGL2
    /// The vertex's position in the last frame, before the instance's matrix places it.
    @location(4) last_position: vec3f,
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

struct VertexOut {
    @invariant @builtin(position) clip: vec4f,
    /// Where this frame's point would have shown in the last frame, in its clip space.
    @location(0) still: vec4f,
    /// Where the surface's point showed in the last frame, in its clip space.
    @location(1) last: vec4f,
#ifdef ALPHA_MASK
    @location(2) @interpolate(flat, either) material: u32,
    /// The first texture coordinates, then the second.
    @location(3) uv: vec4f,
#endif
#ifdef VERTEX_COLOR
    @location(4) vertex_alpha: f32,
#endif
#ifdef ALPHA_HASH
    /// The position in the mesh's own space, where the alpha hash finds its pattern.
    @location(5) mesh_place: vec3f,
#endif
}

@vertex
#ifdef WEBGL2
fn vs(v: VertexIn, i: InstanceIn) -> VertexOut {
#else
fn vs(v: VertexIn, i: InstanceIn, l: LastIn) -> VertexOut {
#endif
    let found = find_instance(i);
    let rest = mesh_position(v.position);
#ifdef MORPH
    var source = Morphed(rest, vec3f(0.0), vec3f(0.0), vec4f(1.0));
#ifdef VERTEX_COLOR
    source.color = v.vertex_color;
#endif
    let morphed = morph_vertex(found, v.morph, source);
    let now_rest = morphed.position;
    let last_rest = last_morphed_position(found, v.morph, rest);
#else ifdef WEBGL2
    let now_rest = rest;
    let last_rest = rest;
#else
    let now_rest = rest;
    let last_rest = mesh_position(v.last_position);
#endif
#ifdef SKIN
    let now = skinned_point(skin_of(found, v.joints, v.weights), now_rest);
    let then = last_skin_point(found, v.joints, v.weights, last_rest);
#else
    let now = now_rest;
    let then = last_rest;
#endif
#ifdef WEBGL2
    let last = last_transform(found);
#else
    let last = last_transform(found, l);
#endif
    let relative = relative_position(found, now);
    var out: VertexOut;
    out.clip = clip_of(found, relative);
    out.still = motion_block.last_view_proj * vec4f(relative, 1.0);
    out.last = motion_block.last_view_proj * vec4f(transform_point(last, then), 1.0);
#ifdef ALPHA_MASK
    out.material = found.material;
    out.uv = vec4f(mesh_uv(v.uv0), mesh_second_uv(v.uv1));
#endif
#ifdef VERTEX_COLOR
#ifdef MORPH
    out.vertex_alpha = morphed.color.a;
#else
    out.vertex_alpha = v.vertex_color.a;
#endif
#endif
#ifdef ALPHA_HASH
    out.mesh_place = rest;
#endif
    return out;
}

/// The surface's motion, where its alpha passes the material's test. The map is sampled whether it
/// is ready or not, as sampling needs the same control flow in every invocation, and a map that is
/// not ready counts as opaque.
@fragment
fn fs(in: VertexOut) -> @location(0) vec4f {
#ifdef ALPHA_MASK
    let m = material_of(in.material);
    var alpha = m.color.a;
#ifdef VERTEX_COLOR
    alpha *= in.vertex_alpha;
#endif
    let second = (u32(m.strengths.z) & SECOND_UV) != 0u;
    let raw = vec3f(select(in.uv.xy, in.uv.zw, second), 1.0);
    let uv = vec2f(dot(m.uv_u.xyz, raw), dot(m.uv_v.xyz, raw));
    let texel = textureSample(map_layers, map_sampler, uv, map_layer(m.maps.x));
    alpha *= select(1.0, texel.a, map_ready(m.maps.x));
#ifdef ALPHA_HASH
    if alpha < alpha_hash_threshold(in.mesh_place) {
        discard;
    }
#else
    if alpha < m.emissive.w {
        discard;
    }
#endif
#endif
    return surface_motion(in.still, in.last);
}
