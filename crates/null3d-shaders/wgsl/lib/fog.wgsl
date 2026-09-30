#define_import_path null3d::fog

// Fog with three.js's formulas. A fog factor runs from 0, no fog, to 1, where the fog color hides
// the surface. Fog depth is the distance from the camera along its view direction, which three.js
// takes from the view-space position.

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
