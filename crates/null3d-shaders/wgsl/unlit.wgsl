enable draw_index;

// Meshes drawn by instance in their material's color alone, as three.js's MeshBasicMaterial draws
// them. null3d::mesh finds each instance on both GPU paths.
#import null3d::mesh::{InstanceIn, clip_position, find_instance, finish, material_of}

/// The vertex attributes that the template reads.
struct VertexIn {
    @location(0) position: vec3f,
}

struct VertexOut {
    @builtin(position) clip: vec4f,
    @location(0) @interpolate(flat, either) material: u32,
}

@vertex
fn vs(v: VertexIn, i: InstanceIn) -> VertexOut {
    let found = find_instance(i);
    var out: VertexOut;
    out.clip = clip_position(found, v.position);
    out.material = found.material;
    return out;
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4f {
    return finish(material_of(in.material).color.rgb, in.clip.xy);
}
