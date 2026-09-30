enable draw_index;

// Meshes drawn by instance, shaded as three.js's MeshLambertMaterial shades them: Lambert lighting
// from the sun and the ambient light. null3d::mesh finds each instance on both GPU paths. The
// RECEIVE_SHADOWS builds dim the sun's light where the main directional light's shadows fall.
#import null3d::color
#import null3d::lighting
#import null3d::mesh::{InstanceIn, clip_position, find_instance, frame}
#import null3d::mesh::{material_of, world_direction}
#ifdef RECEIVE_SHADOWS
#import null3d::mesh::transform_of
#import null3d::shadows::{sun_shadow}
#import null3d::vertex::transform_point
#endif

/// The vertex attributes that the template reads.
struct VertexIn {
    @location(0) position: vec3f,
    @location(1) normal: vec3f,
}

struct VertexOut {
    @builtin(position) clip: vec4f,
    @location(0) normal: vec3f,
    @location(1) @interpolate(flat, either) material: u32,
#ifdef RECEIVE_SHADOWS
    /// The position relative to the camera.
    @location(2) relative: vec3f,
#endif
}

@vertex
fn vs(v: VertexIn, i: InstanceIn) -> VertexOut {
    let found = find_instance(i);
    var out: VertexOut;
    out.clip = clip_position(found, v.position);
    out.normal = world_direction(found, v.normal);
    out.material = found.material;
#ifdef RECEIVE_SHADOWS
    out.relative = transform_point(transform_of(found), v.position);
#endif
    return out;
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4f {
    let albedo = material_of(in.material).color.rgb;
    let normal = normalize(in.normal);
    var sun = frame.sun_color.rgb;
#ifdef RECEIVE_SHADOWS
    sun *= sun_shadow(in.relative, normal);
#endif
    let shaded = null3d::lighting::lambert(
        albedo,
        normal,
        -frame.sun_direction.xyz,
        sun,
        frame.ambient.rgb,
    );
    return vec4f(null3d::color::linear_to_srgb(shaded), 1.0);
}
