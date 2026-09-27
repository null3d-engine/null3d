// Meshes drawn by instance: each instance brings three rows of its world matrix and its material
// id as instance-rate vertex attributes, never through a storage buffer, so the same vertex stage
// runs in WebGPU's compatibility mode. The lit pipeline shades like three.js's
// MeshLambertMaterial, and the unlit pipeline like its MeshBasicMaterial.
#import sokko3d::color
#import sokko3d::globals::{Frame, Material}
#import sokko3d::lighting

@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<storage, read> materials: array<Material>;

struct VertexIn {
    @location(0) position: vec3f,
    @location(1) normal: vec3f,
    @location(2) row0: vec4f,
    @location(3) row1: vec4f,
    @location(4) row2: vec4f,
    @location(5) ids: vec4u,
}

struct VertexOut {
    @builtin(position) clip: vec4f,
    @location(0) normal: vec3f,
    @location(1) @interpolate(flat, either) material: u32,
}

@vertex
fn vs(v: VertexIn) -> VertexOut {
    let p = vec4f(v.position, 1.0);
    let n = vec4f(v.normal, 0.0);
    var out: VertexOut;
    out.clip = frame.view_proj * vec4f(dot(v.row0, p), dot(v.row1, p), dot(v.row2, p), 1.0);
    out.normal = vec3f(dot(v.row0, n), dot(v.row1, n), dot(v.row2, n));
    out.material = v.ids.x;
    return out;
}

@fragment
fn fs_lit(in: VertexOut) -> @location(0) vec4f {
    let albedo = materials[in.material].color.rgb;
    let shaded = sokko3d::lighting::lambert(
        albedo,
        normalize(in.normal),
        -frame.sun_direction.xyz,
        frame.sun_color.rgb,
        frame.ambient.rgb,
    );
    return vec4f(sokko3d::color::linear_to_srgb(shaded), 1.0);
}

@fragment
fn fs_unlit(in: VertexOut) -> @location(0) vec4f {
    return vec4f(sokko3d::color::linear_to_srgb(materials[in.material].color.rgb), 1.0);
}
