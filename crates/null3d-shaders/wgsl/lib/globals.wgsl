#define_import_path null3d::globals
#import null3d::fog::Fog
#import null3d::tonemap

// The data every render pipeline shares: per-frame values the core writes once a frame, and the
// material table that fragment shaders read by material id.

/// Per-frame values: the camera, the lights, the output settings and the fog. Colors are linear and
/// include the intensity. Positions are relative to the camera.
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
    /// The scene's fog, seen from this camera.
    fog: Fog,
    /// The row that gives a position's slice depth in the light grid of clustered lighting (see
    /// null3d::lights).
    cluster_depth: vec4f,
    /// The light grid's tiles across, tiles up, slices, and slices per doubling of the slice
    /// depth. The slices are 0 when no point or spot light reaches the view.
    cluster_grid: vec4f,
    /// The sketch time in seconds, the seconds since the frame before, the frame's number as the
    /// bits of a `u32`, and a spare.
    clock: vec4f,
    /// The camera's position in the world, absolute rather than relative to it, and a spare. Far
    /// from the world's origin, it holds fewer digits than positions relative to the camera.
    camera_world: vec4f,
    /// The size of the render target in pixels, and one over each.
    target_size: vec4f,
    /// The distances of the camera's near and far planes, then the change in normalized device
    /// coordinates across one CSS pixel of the canvas, along x and along y.
    camera_range: vec4f,
    /// Ambient occlusion's strength, 0 when the view draws none, the scene target's height in
    /// pixels, and the texels of its texture per pixel of the scene, across and down (see
    /// null3d::gtao).
    occlusion: vec4f,
    /// The scene's environment, which null3d::ibl reads.
    environment: EnvironmentLight,
}

/// The scene's environment, as the engine writes it into each frame's values: light from every
/// direction around the scene, in a prefiltered cube map and nine spherical harmonics
/// coefficients. Its vectors are named fields rather than arrays: shaders copy the struct out of
/// the frame's uniform block, and Adreno 830's WebGL2 driver copies no array member of a struct
/// that way (see "Browser faults" in the maintainer notes). The bytes are the same as arrays'.
struct EnvironmentLight {
    /// The coefficients of the diffuse light in three.js's order, from `a`, each in `xyz`.
    sh_a: vec4f,
    sh_b: vec4f,
    sh_c: vec4f,
    sh_d: vec4f,
    sh_e: vec4f,
    sh_f: vec4f,
    sh_g: vec4f,
    sh_h: vec4f,
    sh_i: vec4f,
    /// The rows of the matrix that turns a direction in the world into the map's direction, which
    /// give its x, y and z, each in `xyz`.
    rotation_x: vec4f,
    rotation_y: vec4f,
    rotation_z: vec4f,
    /// The map's last mip level, the environment's intensity, 1 while the map draws and 0 while
    /// the scene has none, and a spare.
    params: vec4f,
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
    /// The row of the texture coordinate transform that gives u, and the factor of the scene
    /// environment's light.
    uv_u: vec4f,
    /// The row of the texture coordinate transform that gives v, and the dielectric reflectance at
    /// normal incidence that the index of refraction gives.
    uv_v: vec4f,
    /// The texture array layers of the base color, metal-rough, normal and occlusion maps. A layer
    /// below 0 means that the map draws nothing.
    maps: vec4f,
    /// The layers of the emissive, light, specular intensity and specular color maps.
    more_maps: vec4f,
    /// The specular color, which tints the dielectric reflectance, and the specular intensity.
    specular: vec4f,
}
