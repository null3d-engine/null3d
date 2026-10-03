enable draw_index;

// The outline effect's mask: outlined objects drawn from the camera's view into a target of their
// own, whose depth target is the scene's depth. null3d::mesh finds each instance, as it does for
// the templates that shade, and the position is invariant, so an object stands exactly where the
// scene passes drew it.
//
// Every object draws twice. The first draw tests no depth and writes 1 in red: every part of the
// object, hidden or not. The OUTLINE_VISIBLE build draws again with the depth test and a small
// bias toward the camera, and writes 1 in red and green: the parts that nothing hides, whose depth
// passes against the depth that the scene passes left. three.js's mask holds the same two facts,
// with 0 and 1 swapped.
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
#ifdef OUTLINE_VISIBLE
    return vec4f(1.0, 1.0, 0.0, 0.0);
#else
    return vec4f(1.0, 0.0, 0.0, 0.0);
#endif
}
