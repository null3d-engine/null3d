#define_import_path null3d::globals
#import null3d::tonemap

// The data every render pipeline shares: per-frame values the core writes once a frame, and the
// material table that fragment shaders read by material id.

/// Per-frame values: the camera, the lights and the output settings. Colors are linear and include
/// the intensity.
struct Frame {
    view_proj: mat4x4f,
    camera_position: vec4f,
    /// The direction the sun's light travels, in world space.
    sun_direction: vec4f,
    sun_color: vec4f,
    ambient: vec4f,
    /// The exposure and the tone mapping, which fragment shaders apply themselves on the 8-bit
    /// path.
    output: null3d::tonemap::Output,
}

/// One material's parameters.
struct Material {
    /// Linear base color and opacity.
    color: vec4f,
}
