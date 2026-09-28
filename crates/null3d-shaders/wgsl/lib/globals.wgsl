#define_import_path null3d::globals

// The data every render pipeline shares: per-frame values the core writes once a frame, and the
// material table that fragment shaders read by material id.

/// Per-frame values: the camera and the lights. Colors are linear and include the intensity.
struct Frame {
    view_proj: mat4x4f,
    camera_position: vec4f,
    /// The direction the sun's light travels, in world space.
    sun_direction: vec4f,
    sun_color: vec4f,
    ambient: vec4f,
}

/// One material's parameters.
struct Material {
    /// Linear base color and opacity.
    color: vec4f,
}
