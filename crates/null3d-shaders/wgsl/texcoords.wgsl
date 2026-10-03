enable draw_index;

// Meshes drawn by instance and colored by their first texture coordinates, red for u and green for
// v, for the engine's own tests of vertex formats. null3d::mesh finds each instance on both GPU
// paths.
#import null3d::mesh::{InstanceIn, clip_position, find_instance, finish}
#import null3d::vertex::{mesh_position, mesh_uv}

/// The vertex attributes that the template reads.
struct VertexIn {
    @location(0) position: vec3f,
    @location(2) uv0: vec2f,
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
    out.clip = clip_position(found, mesh_position(v.position));
    out.uv0 = mesh_uv(v.uv0);
    return out;
}

/// The coordinates as linear color, red for u and green for v.
@fragment
fn fs(in: VertexOut) -> @location(0) vec4f {
    return finish(vec3f(in.uv0, 0.0), in.clip.xy);
}
