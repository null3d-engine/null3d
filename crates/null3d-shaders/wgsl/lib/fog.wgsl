#define_import_path null3d::fog

// Fog with three.js's formulas. A fog factor runs from 0, no fog, to 1, where the fog color hides
// the surface. Fog depth is the distance from the camera along its view direction, which three.js
// takes from the view-space position. The engine's shaders mix their linear color with the scene's
// fog, before any tone mapping and encoding.

/// No fog, as `Fog.kind` names it.
const NONE: u32 = 0u;
/// Linear fog, as three.js's `Fog`.
const LINEAR: u32 = 1u;
/// Exponential squared fog, as three.js's `FogExp2`.
const EXP2: u32 = 2u;

/// The scene's fog, as the engine writes it into each frame's values for the camera that draws.
/// Each three-component value shares a `vec4f` with a scalar, so the frame's values lay out the same
/// on every GPU path.
struct Fog {
    /// The linear fog color in `xyz`, and the density of exponential squared fog in `w`.
    color: vec4f,
    /// The camera's unit view direction in `xyz`, which fog depth follows, and where linear fog
    /// starts in `w`.
    forward: vec4f,
    /// Where linear fog hides everything.
    far: f32,
    /// The kind of fog: `NONE`, `LINEAR` or `EXP2`.
    kind: u32,
}

/// The fog depth of a point: its distance from the camera along the camera's unit `forward`
/// direction. `relative_position` is the point's position relative to the camera.
fn fog_depth(relative_position: vec3f, forward: vec3f) -> f32 {
    return dot(relative_position, forward);
}

/// The factor of linear fog, as three.js's `Fog`: 0 up to `near`, 1 from `far`, and a smooth step
/// between them. `near` must be less than `far`.
fn fog_linear(depth: f32, near: f32, far: f32) -> f32 {
    return smoothstep(near, far, depth);
}

/// The factor of exponential squared fog, as three.js's `FogExp2`, for a `density` such as 0.02.
fn fog_exp2(depth: f32, density: f32) -> f32 {
    return 1.0 - exp(-density * density * depth * depth);
}

/// A color seen through fog: `c` blended toward `fog_color` by the fog factor.
fn apply_fog(c: vec3f, fog_color: vec3f, factor: f32) -> vec3f {
    return mix(c, fog_color, factor);
}

/// The factor of the scene's `fog` at a point, by its position relative to the camera: 0 where
/// the scene has no fog.
fn fog_factor(fog: Fog, relative_position: vec3f) -> f32 {
    let depth = fog_depth(relative_position, fog.forward.xyz);
    let linear = select(0.0, fog_linear(depth, fog.forward.w, fog.far), fog.kind == LINEAR);
    return select(linear, fog_exp2(depth, fog.color.w), fog.kind == EXP2);
}
