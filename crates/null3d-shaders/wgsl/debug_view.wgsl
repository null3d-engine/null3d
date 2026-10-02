enable draw_index;

// The debug views of development builds: meshes drawn by instance with one debug shading in place
// of their material's. The debug view bits pick the view:
//
// - none, normals: the world-space normal as a color, each axis from -1 to 1 as 0 to 1;
// - DEBUG_VIEW_LOW, depth: a gray, white at the camera's near plane and black at its far plane.
//   A perspective camera's distance takes a logarithmic scale, so near and far objects both show.
//   An orthographic camera's depth is linear already. The gray comes from the clip position that
//   the vertex shader passes on, the same in every depth mode, since compatibility mode cannot
//   read the depth target with textureLoad;
// - DEBUG_VIEW_HIGH, overdraw: a little warm light for each fragment, which the pipeline adds
//   without a depth test, so the pixels that many surfaces cover glow;
// - both bits, wireframe: lines in the material's base color, from each mesh's edge list.
//
// The engine draws debug views without tone mapping or exposure, so each color reaches the canvas
// as an sRGB color here gives it. null3d::mesh finds each instance on both GPU paths.
#import null3d::color::{srgb_to_linear}
#import null3d::mesh::{InstanceIn, clip_of, find_instance, finish, frame, material_of}
#import null3d::mesh::{relative_position, world_normal}

/// The light that each fragment adds in the overdraw view, as linear color.
const OVERDRAW_STEP: vec3f = vec3f(0.05, 0.025, 0.01);

/// The vertex attributes that the template reads: every vertex format has both.
struct VertexIn {
    @location(0) position: vec3f,
    @location(1) normal: vec3f,
}

struct VertexOut {
    @builtin(position) clip: vec4f,
    @location(0) normal: vec3f,
    /// The clip position's z and w, before any depth mode maps them.
    @location(1) depth: vec2f,
    @location(2) @interpolate(flat, either) material: u32,
}

@vertex
fn vs(v: VertexIn, i: InstanceIn) -> VertexOut {
    let found = find_instance(i);
    var out: VertexOut;
    out.clip = clip_of(found, relative_position(found, v.position));
    out.normal = world_normal(found, v.normal);
    out.depth = out.clip.zw;
    out.material = found.material;
    return out;
}

/// The depth view's gray: 1 at the near plane, 0 at the far plane.
fn depth_gray(depth: vec2f) -> f32 {
    let near = frame.camera_range.x;
    let far = frame.camera_range.y;
    // An orthographic camera's view rays are parallel, and its reversed depth is linear.
    if frame.camera_position.w == 0.0 {
        return clamp(depth.x / depth.y, 0.0, 1.0);
    }
    // A perspective camera's clip w is the distance along its view.
    let distance = max(depth.y, near);
    return clamp(1.0 - log(distance / near) / log(far / near), 0.0, 1.0);
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4f {
#ifdef DEBUG_VIEW_HIGH
#ifdef DEBUG_VIEW_LOW
    let linear = material_of(in.material).color.rgb;
#else
    let linear = OVERDRAW_STEP;
#endif
#else
#ifdef DEBUG_VIEW_LOW
    let linear = srgb_to_linear(vec3f(depth_gray(in.depth)));
#else
    let linear = srgb_to_linear(normalize(in.normal) * 0.5 + 0.5);
#endif
#endif
    return finish(linear, in.clip.xy);
}
