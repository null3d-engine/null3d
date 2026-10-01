enable draw_index;

// The depth of shadow casters, drawn from the light into one cascade's layer of the shadow map.
// The frame's view-projection matrix is the cascade's. null3d::mesh finds each instance, as it
// does for the lit templates, so casters stand exactly where they draw.
//
// A caster between the light and the cascade's box would fall outside the box's depth range and
// be clipped away. The vertex shader flattens it onto the box's face toward the light instead,
// where its depth of 1 hides everything behind it. Its place across the light does not change,
// because the cascade's projection is orthographic.
#import null3d::mesh::{InstanceIn, clip_position, find_instance}

/// The vertex attribute that the template reads.
struct VertexIn {
    @location(0) position: vec3f,
}

@vertex
fn vs(v: VertexIn, i: InstanceIn) -> @builtin(position) vec4f {
    var clip = clip_position(find_instance(i), v.position);
    clip.z = min(clip.z, clip.w);
    return clip;
}

/// Writes no color: the pass keeps the depth alone.
@fragment
fn fs() {
}
