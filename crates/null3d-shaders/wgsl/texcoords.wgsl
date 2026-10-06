enable draw_index;

// Meshes drawn by instance and colored by their first texture coordinates, red for u and green for
// v, for the engine's own tests of vertex formats. null3d::mesh finds each instance on both GPU
// paths.
#import null3d::mesh::{InstanceIn, clip_position, find_instance, finish}
#import null3d::vertex::{mesh_position, mesh_uv}
#ifdef SKIN
#import null3d::mesh::{skin_of, skinned_point}
#endif
#ifdef MORPH
#import null3d::mesh::{Morphed, morph_vertex}
#endif

/// The vertex attributes that the template reads.
struct VertexIn {
    @location(0) position: vec3f,
    @location(2) uv0: vec2f,
#ifdef SKIN
    @location(6) joints: vec4u,
    @location(7) weights: vec4f,
#endif
#ifdef MORPH
    @location(8) morph: vec2f,
#endif
}

struct VertexOut {
    /// Invariant, so the depth prepass finds the same depth for each vertex as this template.
    @invariant @builtin(position) clip: vec4f,
    @location(0) uv0: vec2f,
}

@vertex
fn vs(v: VertexIn, i: InstanceIn) -> VertexOut {
    let found = find_instance(i);
    var out: VertexOut;
#ifdef MORPH
    let rest = morph_vertex(found, v.morph, Morphed(mesh_position(v.position), vec3f(0.0), vec3f(0.0), vec4f(1.0)));
    let rest_position = rest.position;
#else
    let rest_position = mesh_position(v.position);
#endif
#ifdef SKIN
    let skin = skin_of(found, v.joints, v.weights);
    out.clip = clip_position(found, skinned_point(skin, rest_position));
#else
    out.clip = clip_position(found, rest_position);
#endif
    out.uv0 = mesh_uv(v.uv0);
    return out;
}

/// The coordinates as linear color, red for u and green for v.
@fragment
fn fs(in: VertexOut) -> @location(0) vec4f {
    return finish(vec3f(in.uv0, 0.0), in.clip.xy);
}
