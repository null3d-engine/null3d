#define_import_path null3d::globals
#import null3d::tonemap

// The data every render pipeline shares: per-frame values the core writes once a frame, and the
// material table that fragment shaders read by material id.

/// Per-frame values: the camera, the lights and the output settings. Colors are linear and include
/// the intensity. Positions are relative to the camera.
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
    /// The exposure and the tone mapping, which fragment shaders apply themselves on the 8-bit
    /// path.
    output: null3d::tonemap::Output,
}

/// One material's row of the material table, as the core writes it (`materials.rs` in the
/// renderer crate names each float). Colors are linear.
struct Material {
    /// The base color and the opacity.
    color: vec4f,
    /// The emissive color, and the alpha cutoff.
    emissive: vec4f,
    /// The metalness, the roughness, and the normal map's scale along u and v.
    surface: vec4f,
    /// The occlusion map's strength, the light map's intensity, the shading flags, and the
    /// emissive color's intensity.
    strengths: vec4f,
    /// The row of the texture coordinate transform that gives u, and a spare.
    uv_u: vec4f,
    /// The row of the texture coordinate transform that gives v, and a spare.
    uv_v: vec4f,
    /// The texture array layers of the base color, metal-rough, normal and occlusion maps. A layer
    /// below 0 means that the map draws nothing.
    maps: vec4f,
    /// The layers of the emissive and light maps, and two spares.
    more_maps: vec4f,
}
