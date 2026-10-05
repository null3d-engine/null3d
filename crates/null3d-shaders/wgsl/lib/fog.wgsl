#define_import_path null3d::fog

// The scene's fog. A fog factor runs from 0, no fog, to 1, where the fog color hides the surface.
// Fog measures each point's straight-line distance from the camera, so a point keeps its fog as the
// camera turns. The fog can thin with height, and can glow toward the sun. The engine's shaders mix
// their exposed linear color with the fog before any tone mapping and encoding.
//
// Per pixel, the fog costs a square root, one `exp` and a `pow` for the sun glow. Fog that thins
// with height adds an `exp` and a division. The fog is a branch on the frame's values, not a
// permutation bit, so every scene shares the same shader builds.

/// No fog, as `Fog.curve` names it.
const NONE: u32 = 0u;
/// Linear fog: none up to a near distance, full from a far one, and a smooth step between them.
const LINEAR: u32 = 1u;
/// Exponential squared fog: a factor of 1 - exp(-(density × distance)²).
const EXP2: u32 = 2u;
/// Exponential fog: a factor of 1 - exp(-density × distance), which light through an even haze
/// follows.
const EXPONENTIAL: u32 = 3u;

/// The scene's fog, as the engine writes it into each frame's values for the camera that draws.
struct Fog {
    /// The exposed linear fog color in `xyz`, and the fog's density at its base height in `w`.
    color: vec4f,
    /// Where linear fog starts in `x`, and where it hides everything in `y`. How fast the fog thins
    /// with height in `z`: 0 for fog that is the same at every height. In `w`, the fog's density
    /// at the camera's height, as a share of its density at its base height.
    shape: vec4f,
    /// How much of the sun's light the fog scatters toward the camera: 0 for no glow.
    sun_glow: f32,
    /// The power of the glow's fall away from the sun: higher values make the glow smaller.
    sun_exponent: f32,
    /// Fills the block to a multiple of 16 bytes.
    spare: f32,
    /// The fog's curve: `NONE`, `LINEAR`, `EXP2` or `EXPONENTIAL`.
    curve: u32,
}

/// The factor of linear fog, as three.js's `Fog`: 0 up to `near`, 1 from `far`, and a smooth step
/// between them. `near` must be less than `far`.
fn fog_linear(distance: f32, near: f32, far: f32) -> f32 {
    return smoothstep(near, far, distance);
}

/// The factor of exponential squared fog, as three.js's `FogExp2`, for a `density` such as 0.02.
fn fog_exp2(distance: f32, density: f32) -> f32 {
    return 1.0 - exp(-density * density * distance * distance);
}

/// The factor of exponential fog: the share of light that an even haze of `density` scatters
/// over `distance`.
fn fog_exponential(distance: f32, density: f32) -> f32 {
    return 1.0 - exp(-density * distance);
}

/// The mean density along a ray from the camera, as a share of the density at the camera's height.
/// Its input, the climb, is the falloff times the ray's rise, where the falloff is how fast the
/// density falls with height. The share is (1 - exp(-climb)) / climb. Near 0 the share takes the
/// first terms of its series: 1 - climb/2 + climb²/6. It takes the series below a climb of 0.01,
/// where the exact form loses digits to cancellation, and limits the exponent to 40, so the share
/// stays finite in 32-bit floats.
fn fog_height_ratio(climb: f32) -> f32 {
    // Local constants, which the shader builds write as numbers rather than as names.
    const EXPONENT_LIMIT = 40.0;
    const SERIES_LIMIT = 1e-2;
    let exact = (1.0 - exp(min(-climb, EXPONENT_LIMIT))) / climb;
    return select(exact, 1.0 + climb * (climb / 6.0 - 0.5), abs(climb) < SERIES_LIMIT);
}

/// The factor of the scene's `fog` at a point, by its position relative to the camera: 0 where
/// the scene has no fog. The curve takes the point's distance, scaled by the mean density along
/// the way where the fog thins with height. Fog at its base density hides as much over that path
/// as the fog hides on the way to the point.
fn fog_factor(fog: Fog, relative_position: vec3f) -> f32 {
    if (fog.curve == NONE) {
        return 0.0;
    }
    var path = length(relative_position);
    if (fog.shape.z != 0.0) {
        path *= fog.shape.w * fog_height_ratio(fog.shape.z * relative_position.y);
    }
    let k = fog.color.w * path;
    let exponential = 1.0 - exp(-select(k, k * k, fog.curve == EXP2));
    return select(exponential, smoothstep(fog.shape.x, fog.shape.y, path), fog.curve == LINEAR);
}

/// The color of the scene's `fog` toward a point, by its position relative to the camera. It is
/// the fog's color, plus the sun's light that the fog scatters toward the camera. That light is
/// brightest toward the sun. `sun_direction` is the unit direction that the sun's light travels,
/// and `sun_color` its exposed color.
fn fog_color(fog: Fog, relative_position: vec3f, sun_direction: vec3f, sun_color: vec3f) -> vec3f {
    let toward_sun = max(dot(normalize(relative_position), -sun_direction), 0.0);
    return fog.color.xyz + sun_color * (fog.sun_glow * pow(toward_sun, fog.sun_exponent));
}

/// A color seen through fog: `c` blended toward `fog_color` by the fog factor.
fn apply_fog(c: vec3f, fog_color: vec3f, factor: f32) -> vec3f {
    return mix(c, fog_color, factor);
}
