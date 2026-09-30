#define_import_path null3d::globals

// The data every render pipeline shares: per-frame values the core writes once a frame, and the
// material table that fragment shaders read by material id.

/// Per-frame values: the camera and the lights. Colors are linear and include the intensity.
/// Positions are relative to the camera.
struct Frame {
    view_proj: mat4x4f,
    /// The camera as a homogeneous point: (0, 0, 0, 1) for a perspective camera, which sits at the
    /// origin. An orthographic camera's view rays are parallel, so w is 0 and xyz is the unit
    /// direction toward the camera. From a position p, the direction toward the camera is
    /// normalize(camera_position.xyz - p * camera_position.w) for both kinds.
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
