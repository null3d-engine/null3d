#define_import_path null3d::globals
#import null3d::fog::Fog
#import null3d::sky_scattering::Aerial
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
    /// The scene's light probe grid, which null3d::probe_grid reads (D-146).
    probe_grid: ProbeGrid,
    /// The light that the hemisphere lights add along each world axis, each in `xyz`. A surface
    /// with unit normal n gets `ambient` plus n.x times the first, n.y times the second and n.z
    /// times the third (see null3d::lighting::ambient_irradiance). All zero without hemisphere
    /// lights.
    hemisphere_x: vec4f,
    hemisphere_y: vec4f,
    hemisphere_z: vec4f,
    /// This view's camera relative to the main camera, and 0. The shadow maps' matrices take
    /// positions relative to the main camera, so shadow lookups add this to a position relative to
    /// this view's camera. It is 0 in the main camera's view.
    shadow_origin: vec4f,
    /// The view matrix for positions relative to the camera: the camera's rotation alone, as the
    /// camera sits at the origin. `projection * view` is `view_proj`. Zero in the views of lights.
    view: mat4x4f,
    /// The projection matrix, into the clip space of the engine's reversed depth: 1 at the near
    /// plane and 0 at the far plane. Zero in the views of lights.
    projection: mat4x4f,
    /// Takes a position relative to this frame's camera into the clip space of the camera's view in
    /// the frame before, which screen-space reflections read the color of (see null3d::ssr).
    reflection_reprojection: mat4x4f,
    /// Screen-space reflections' strength, 0 when the view draws none, the most roughness that
    /// reflects, the most distance of a ray, and the share of the screen over which they fade
    /// toward its edges.
    reflection: vec4f,
    /// The frame before's drawn corner of the color copy in pixels, the pixels that one world unit
    /// spans at a distance of one unit in its view, along y, and a spare.
    reflection_corner: vec4f,
    /// The sub-pixel jitter of a still view's accumulated sample, in clip space: `xy` is the offset
    /// a scene's vertex shaders add to a position's clip position, scaled by its `w`. A still view
    /// draws each frame with a different offset, and the frames average to a sharper image. Zero
    /// while the view moves, in the views of lights, and in every frame a moving view draws.
    jitter: vec4f,
    /// The physical sky's air between the camera and each surface, all zero without one.
    aerial: Aerial,
    /// The vignette's intensity, size, falloff and roundness, which fragment shaders apply before
    /// the tone mapping on the 8-bit path, in the camera's view. Zero elsewhere, which applies none.
    vignette: vec4f,
}

/// The clip position of `relative_position` through `view_proj`, with the frame's sub-pixel jitter
/// `jitter` added: a still view shifts by a fraction of a pixel, so its accumulated samples spread
/// over the pixel. Use this in place of `view_proj * vec4f(relative_position, 1.0)` in a scene's
/// vertex shaders, which read the jitter from the frame's values.
fn clip_with_jitter(view_proj: mat4x4f, jitter: vec2f, relative_position: vec3f) -> vec4f {
    let clip = view_proj * vec4f(relative_position, 1.0);
    return clip + vec4f(jitter * clip.w, 0.0, 0.0);
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

/// The scene's light probe grid (D-146): a grid of irradiance probes, each holding L1 spherical
/// harmonics of the light that reaches its point. null3d::probe_grid reads it per pixel. Positions
/// are in the world. The grid's texture is bound at binding 10 of the frame's group; while the
/// scene sets none, `origin.w` is 0 and no shader reads it.
struct ProbeGrid {
    /// The grid's corner of least x, y and z, and 1 while the scene sets a grid, else 0.
    origin: vec4f,
    /// One over the spacing between probes along each axis, 0 for an axis one probe deep, and a
    /// spare. A shader scales the grid's coordinates by it, and divides by 1 in place of the 0.
    inverse_spacing: vec4f,
    /// The probes along each axis, and the depth of one sub-volume along z, `nz + 2`.
    counts: vec4f,
    /// The grid's intensity times the frame's exposure, the share of the environment's diffuse
    /// light that the grid takes over, and two spares.
    params: vec4f,
}

/// One material's whole row of the material table, as the core writes it (`materials.rs` in the
/// renderer crate names each float): the values that every shader reads, which `Material` holds,
/// then the values of a material that lets light through, which only the builds that let light
/// through read, then the clear coat and sheen of a layered material, then the values of a
/// material that lets light through a thin surface, then the scatter distances of the subsurface
/// blur, then the thin film's values and the anisotropy's. Colors are linear.
struct MaterialRow {
    color: vec4f,
    emissive: vec4f,
    surface: vec4f,
    strengths: vec4f,
    uv_u: vec4f,
    uv_v: vec4f,
    maps: vec4f,
    more_maps: vec4f,
    specular: vec4f,
    /// The transmission, the thickness of the volume in the mesh's own units, the index of
    /// refraction, and a spare.
    transmission: vec4f,
    /// The color that white light takes after it travels the attenuation distance through the
    /// volume, and that distance, 0 for a volume that absorbs nothing.
    attenuation: vec4f,
    /// The clear coat, its roughness, and the coat normal map's scale along u and v.
    coat: vec4f,
    /// The sheen's linear color and its roughness.
    sheen: vec4f,
    /// The linear color that tints the light that passes through a thin surface, and how much of
    /// the surface's diffuse light passes through it.
    translucency: vec4f,
    /// Each channel's share of the scatter radius under the surface, linear, and the radius in
    /// world units, which only the skin pass's builds read.
    subsurface: vec4f,
    /// How much of the specular reflection a thin film above the surface tints, the film's index
    /// of refraction, and the film's thickness where its map is 0 and where it is 1, in
    /// nanometers.
    iridescence: vec4f,
    /// The anisotropy's strength, its rotation from the tangent in radians, the family of maps that
    /// each group of shared slots holds (two bits each: 0 for the light map's slot, 2 for the
    /// specular intensity map's and 4 for the specular color map's; 0 is the clear coat's and the
    /// sheen's, 1 iridescence's and the anisotropy's, and 2 the transmission and thickness maps'),
    /// and a spare.
    anisotropy: vec4f,
}

/// The values of a material that lets light through: its row's `transmission` and `attenuation`.
struct MaterialTransmission {
    values: vec4f,
    attenuation: vec4f,
}

/// The values of a layered material: its row's `coat` and `sheen`.
struct MaterialCoatSheen {
    coat: vec4f,
    sheen: vec4f,
}

/// The values of one material's row that every shader reads (see `MaterialRow`). Colors are
/// linear.
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
