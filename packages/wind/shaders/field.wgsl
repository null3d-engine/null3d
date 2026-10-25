// The one sampling function for a reader of the wind field. A material that already has its own
// WGSL, such as a plant's leaf material, copies the block between the markers into its own file.
// The shader build resolves only the engine's library, so a shader cannot import another shader of
// the add-on; a test compares each copy with this one and fails when one is edited alone.
//
// A reader declares the field's texture, and the engine declares its sampler beside it:
var wind: texture_2d_array<f32>;

// <wind-sample>
/// The air at a world place, as the texture holds it: the wind across the ground in red and blue,
/// the wind's rise in green, and its speed in alpha. The box's near corner and width place the
/// world. A place outside the box reads the box's edge.
fn wind_sample(world: vec3f, origin: vec2f, size: f32) -> vec4f {
    let uv = clamp((vec2f(world.x, world.z) - origin) / size, vec2f(0.0), vec2f(1.0));
    return textureSampleLevel(wind, windSampler, uv, 0, 0.0);
}
// </wind-sample>
