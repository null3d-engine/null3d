// GPU picking's resolve: one triangle over the render size that copies the id target into a
// texture of one sample, which the frame then reads one pixel of. The device resolves a sampled
// multisampled color target into one sample per pixel before this pass reads it, so the pass
// copies the resolved ids whole. A pixel whose samples belong to different objects holds the
// average of their keys, which names no object: a pick exactly on a silhouette answers nothing.

#import null3d::fullscreen::{triangle}

@group(0) @binding(0) var ids: texture_2d<f32>;

@vertex
fn vs(@builtin(vertex_index) vertex: u32) -> @builtin(position) vec4f {
    return triangle(vertex);
}

@fragment
fn fs(@builtin(position) at: vec4f) -> @location(0) vec4f {
    return textureLoad(ids, vec2u(at.xy), 0);
}
