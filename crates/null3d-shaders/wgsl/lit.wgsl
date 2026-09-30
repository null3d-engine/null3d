enable draw_index;

// Meshes drawn by instance, shaded as three.js's MeshLambertMaterial shades them: Lambert lighting
// from the sun and the ambient light. null3d::mesh finds each instance on both GPU paths.
#import null3d::lighting
#import null3d::mesh::{InstanceIn, clip_position, find_instance, finish, frame}
#import null3d::mesh::{material_of, world_direction}

/// The vertex attributes that the template reads.
struct VertexIn {
    @location(0) position: vec3f,
    @location(1) normal: vec3f,
}

struct VertexOut {
    @builtin(position) clip: vec4f,
    @location(0) normal: vec3f,
    @location(1) @interpolate(flat, either) material: u32,
}

@vertex
fn vs(v: VertexIn, i: InstanceIn) -> VertexOut {
    let found = find_instance(i);
    var out: VertexOut;
    out.clip = clip_position(found, v.position);
    out.normal = world_direction(found, v.normal);
    out.material = found.material;
    return out;
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4f {
    let albedo = material_of(in.material).color.rgb;
    let shaded = null3d::lighting::lambert(
        albedo,
        normalize(in.normal),
        -frame.sun_direction.xyz,
        frame.sun_color.rgb,
        frame.ambient.rgb,
    );
    return finish(shaded, in.clip.xy);
}
