enable draw_index;

// The tone mask: the objects whose material keeps its color as the display shows it, drawn from the
// camera's view into the mask's blue channel, where the scene's depth leaves them. The final pass
// reads the mask to skip the tone curve for those pixels. Only the objects of this layout draw, so
// every fragment that reaches the target marks its pixel.
//
// null3d::mesh finds each instance as it does for the templates that shade, and the position is
// invariant, so an object stands exactly where the scene passes drew it. The pass tests depth and
// writes none, so a part that another surface hides marks nothing.
//
// The SKIN builds skin each vertex with the joint texture, where the engine skins in the vertex
// shader rather than in the skinning pass.
#import null3d::mesh::{InstanceIn, clip_of, find_instance, relative_position}
#import null3d::vertex::{mesh_position}
#ifdef SKIN
#import null3d::mesh::{skin_of, skinned_point}
#endif

/// The vertex attributes that the template reads: every vertex format has both.
struct VertexIn {
    @location(0) position: vec3f,
    @location(1) normal: vec3f,
#ifdef SKIN
    @location(6) joints: vec4u,
    @location(7) weights: vec4f,
#endif
}

@vertex
fn vs(v: VertexIn, i: InstanceIn) -> @invariant @builtin(position) vec4f {
    let found = find_instance(i);
#ifdef SKIN
    let position = skinned_point(skin_of(found, v.joints, v.weights), mesh_position(v.position));
#else
    let position = mesh_position(v.position);
#endif
    return clip_of(found, relative_position(found, position));
}

@fragment
fn fs() -> @location(0) vec4f {
    return vec4f(0.0, 0.0, 1.0, 0.0);
}
