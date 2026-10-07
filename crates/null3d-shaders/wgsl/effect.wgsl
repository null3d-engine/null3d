// The template of custom effects: one triangle over the effect's target, whose fragment shader
// calls the effect's `fn effect(input: EffectInput) -> vec4f` for each pixel of the scene. The
// shader compiler adds an effect's WGSL after this file's last line and builds with the shader def
// CUSTOM_EFFECT. Without it, the template builds with an effect that keeps each pixel as it is,
// which the shader build checks.
//
// An effect reads the color that the pass before it left: the scene color, or the target of the
// effect before it. That color is linear HDR color, after the exposure and before the tone curve,
// multiplied by its coverage, which alpha holds. The effect writes the same kind of color into a
// target of its own, which the next effect or the final pass reads.
//
// The scene drew into the top-left corner of its targets at the render scale. Every effect draws
// into the same corner of its target, so a fragment reads the input texel at its own position.
// WebGL2 counts rows from the bottom, and draws a corner into its targets' top rows, so the
// effect's places count rows from the top on both paths.
//
// When the effect's WGSL declares `struct Uniforms`, the build adds `load_effect_uniforms` after
// it, and CUSTOM_UNIFORMS makes the fragment shader fill `uniforms` from the effect's block. When
// it calls `effectDepth`, `effectViewPosition` or `effectDistance`, the build adds EFFECT_DEPTH,
// which binds the scene's depth. The DEPTH_MULTISAMPLED builds read sample 0 of a multisampled
// depth, on WebGPU.
//
// The effect's WGSL shares this file's names, so the names here keep an `effect` prefix, and the
// file imports nothing.

/// What the engine writes for each effect: the sizes, the clock, the camera, and the effect's
/// uniforms as the build packed them.
struct EffectBlock {
    /// xy: the drawn corner in pixels, the render size. zw: the targets' size in texels.
    size: vec4f,
    /// The sketch time in seconds, the seconds since the frame before, and two spares.
    clock: vec4f,
    /// The inverse of the camera's projection matrix, which places a depth in view space.
    inverse_projection: mat4x4f,
    /// The effect's uniforms, eight vectors of four floats.
    u0: vec4f,
    u1: vec4f,
    u2: vec4f,
    u3: vec4f,
    u4: vec4f,
    u5: vec4f,
    u6: vec4f,
    u7: vec4f,
}

@group(0) @binding(0) var<uniform> effect_block: EffectBlock;
@group(0) @binding(1) var effect_source: texture_2d<f32>;
@group(0) @binding(2) var effect_sampler: sampler;
#ifdef EFFECT_DEPTH
#ifdef DEPTH_MULTISAMPLED
@group(0) @binding(3) var effect_depth_texture: texture_multisampled_2d<f32>;
#else
@group(0) @binding(3) var effect_depth_texture: texture_2d<f32>;
#endif
#endif

/// What an effect reads for each pixel.
struct EffectInput {
    /// The color under the pixel: linear HDR color multiplied by its coverage, which alpha holds.
    color: vec4f,
    /// The pixel's place on the image, from 0 at the top left to 1 at the bottom right.
    uv: vec2f,
    /// The pixel's center in pixels of the image, from its top left.
    pixel: vec2f,
    /// The image's size in pixels: the render size.
    size: vec2f,
    /// The sketch time in seconds.
    time: f32,
}

/// Vector `part` of the effect's uniforms.
fn effect_value(part: u32) -> vec4f {
    switch part {
        case 0u: { return effect_block.u0; }
        case 1u: { return effect_block.u1; }
        case 2u: { return effect_block.u2; }
        case 3u: { return effect_block.u3; }
        case 4u: { return effect_block.u4; }
        case 5u: { return effect_block.u5; }
        case 6u: { return effect_block.u6; }
        default: { return effect_block.u7; }
    }
}

/// The texel of the targets that holds the image's pixel `pixel`, counted from the top left.
fn effect_texel(pixel: vec2i) -> vec2i {
    let last = vec2i(effect_block.size.xy) - 1;
    let inside = clamp(pixel, vec2i(0), last);
#ifdef WEBGL2
    return vec2i(inside.x, i32(effect_block.size.w) - 1 - inside.y);
#else
    return inside;
#endif
}

/// The color of the image's pixel `pixel`, counted from the top left, as the effect's input holds
/// it. A pixel outside the image reads the nearest one inside.
fn effectPixel(pixel: vec2i) -> vec4f {
    return textureLoad(effect_source, effect_texel(pixel), 0);
}

/// The color at `uv` on the image, from 0 at the top left to 1 at the bottom right, read with a
/// linear filter. Places outside the image read its edge.
fn effectColor(uv: vec2f) -> vec4f {
    let render = effect_block.size.xy;
    var at = clamp(uv * render, vec2f(0.5), render - 0.5);
#ifdef WEBGL2
    at.y = effect_block.size.w - at.y;
#endif
    return textureSampleLevel(effect_source, effect_sampler, at / effect_block.size.zw, 0.0);
}

#ifdef EFFECT_DEPTH
/// The scene's depth at `uv`: 1 at the camera's near plane and 0 at its far plane, and 0 where
/// nothing drew.
fn effectDepth(uv: vec2f) -> f32 {
    let pixel = vec2i(floor(uv * effect_block.size.xy));
    return textureLoad(effect_depth_texture, effect_texel(pixel), 0).x;
}

/// The view-space position of the surface at `uv`. View-space z is negative in front of the
/// camera, as in three.js.
fn effectViewPosition(uv: vec2f) -> vec3f {
    let clip = vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, effectDepth(uv), 1.0);
    let p = effect_block.inverse_projection * clip;
    return p.xyz / p.w;
}

/// The distance in front of the camera, along its view, of the surface at `uv`, in world units.
fn effectDistance(uv: vec2f) -> f32 {
    return -effectViewPosition(uv).z;
}
#endif

#ifdef CUSTOM_UNIFORMS
/// The effect's uniforms, which the fragment shader fills once.
var<private> uniforms: Uniforms;
#endif

@vertex
fn effect_vs(@builtin(vertex_index) vertex: u32) -> @builtin(position) vec4f {
    // A triangle past the corners of clip space, at a depth that every WebGL2 depth mode keeps.
    let x = f32((vertex << 1u) & 2u) * 2.0 - 1.0;
    let y = f32(vertex & 2u) * 2.0 - 1.0;
    return vec4f(x, y, 0.5, 1.0);
}

@fragment
fn effect_fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
#ifdef CUSTOM_UNIFORMS
    uniforms = load_effect_uniforms();
#endif
#ifdef WEBGL2
    let from_top = vec2f(position.x, effect_block.size.w - position.y);
#else
    let from_top = position.xy;
#endif
    var input: EffectInput;
    input.color = textureLoad(effect_source, vec2i(position.xy), 0);
    input.size = effect_block.size.xy;
    input.pixel = from_top;
    input.uv = from_top / effect_block.size.xy;
    input.time = effect_block.clock.x;
    return effect(input);
}

#ifndef CUSTOM_EFFECT
fn effect(input: EffectInput) -> vec4f {
    return input.color;
}
#endif
