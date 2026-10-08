// The host of joined custom effects: one triangle over the target of a group of effects, whose
// fragment shader runs the group's effects one after another for each pixel, in one pass. The
// engine makes a group's shader at run time from a build of this file and the effects' pieces (see
// `effect.rs` in the shader crate): it puts the pieces before `effect_chain`, and writes in its
// place a chain that calls each effect's piece in order, passing the color along.
//
// The group reads the color that the pass before it left, as a lone effect does (`effect.wgsl`),
// and its first effect may read that color at any pixel. Every effect after the first reads only
// its own pixel, the color that the effect before it returned, and may read the scene's depth.
//
// Every effect of the group reads its uniforms from its own block of the effects' uniform buffer,
// which the group binds whole: a piece's loader takes the block's place. The sizes and the clock
// are the same in every block, and the helpers read them from the first.
//
// A piece holds the template's helpers that its effect calls, so this file keeps them, and a build
// without a piece drops the ones that nothing calls. The build of a piece adds the effect's WGSL
// and its loader after this file's last line, and builds with EFFECT_PIECE, which makes the chain
// call the piece. EFFECT_DEPTH binds the scene's depth, and the DEPTH_MULTISAMPLED builds read
// sample 0 of a multisampled depth, on WebGPU.
//
// The effects' WGSL shares this file's names, so the names here keep an `effect` prefix, and the
// file imports nothing.

/// What the engine writes for each effect: the sizes, the clock, the camera, and the effect's
/// uniforms as the build packed them. Two spare vectors make a block 256 bytes long, the distance
/// between blocks in the buffer.
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
    spare0: vec4f,
    spare1: vec4f,
}

/// Every effect's block. A named struct holds them, which gives the WebGL2 build's uniform
/// block a name that every build shares.
struct EffectBlocks {
    blocks: array<EffectBlock, 8>,
}

@group(0) @binding(0) var<uniform> effect_blocks: EffectBlocks;
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

/// Vector `part` of the uniforms in the block at `slot`.
fn effect_value_at(slot: u32, part: u32) -> vec4f {
    let block = effect_blocks.blocks[slot];
    switch part {
        case 0u: { return block.u0; }
        case 1u: { return block.u1; }
        case 2u: { return block.u2; }
        case 3u: { return block.u3; }
        case 4u: { return block.u4; }
        case 5u: { return block.u5; }
        case 6u: { return block.u6; }
        default: { return block.u7; }
    }
}

/// The texel of the targets that holds the image's pixel `pixel`, counted from the top left.
fn effect_texel(pixel: vec2i) -> vec2i {
    let last = vec2i(effect_blocks.blocks[0].size.xy) - 1;
    let inside = clamp(pixel, vec2i(0), last);
#ifdef WEBGL2
    return vec2i(inside.x, i32(effect_blocks.blocks[0].size.w) - 1 - inside.y);
#else
    return inside;
#endif
}

/// The color of the image's pixel `pixel`, counted from the top left, as the group's input holds
/// it. A pixel outside the image reads the nearest one inside.
fn effectPixel(pixel: vec2i) -> vec4f {
    return textureLoad(effect_source, effect_texel(pixel), 0);
}

/// The color at `uv` on the image, from 0 at the top left to 1 at the bottom right, read with a
/// linear filter. Places outside the image read its edge.
fn effectColor(uv: vec2f) -> vec4f {
    let render = effect_blocks.blocks[0].size.xy;
    var at = clamp(uv * render, vec2f(0.5), render - 0.5);
#ifdef WEBGL2
    at.y = effect_blocks.blocks[0].size.w - at.y;
#endif
    return textureSampleLevel(effect_source, effect_sampler, at / effect_blocks.blocks[0].size.zw, 0.0);
}

#ifdef EFFECT_DEPTH
/// The scene's depth at `uv`: 1 at the camera's near plane and 0 at its far plane, and 0 where
/// nothing drew.
fn effectDepth(uv: vec2f) -> f32 {
    let pixel = vec2i(floor(uv * effect_blocks.blocks[0].size.xy));
    return textureLoad(effect_depth_texture, effect_texel(pixel), 0).x;
}

/// The view-space position of the surface at `uv`. View-space z is negative in front of the
/// camera, as in three.js.
fn effectViewPosition(uv: vec2f) -> vec3f {
    let clip = vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, effectDepth(uv), 1.0);
    let p = effect_blocks.blocks[0].inverse_projection * clip;
    return p.xyz / p.w;
}

/// The distance in front of the camera, along its view, of the surface at `uv`, in world units.
fn effectDistance(uv: vec2f) -> f32 {
    return -effectViewPosition(uv).z;
}
#endif

/// The group's effects, one after another. The engine writes its own chain in this function's
/// place; a piece's build calls the piece once, from the first block.
fn effect_chain(input: EffectInput) -> vec4f {
#ifdef EFFECT_PIECE
    return effect_piece_run(input, 0u);
#else
    return input.color;
#endif
}

@vertex
fn effect_vs(@builtin(vertex_index) vertex: u32) -> @builtin(position) vec4f {
    // A triangle past the corners of clip space, at a depth that every WebGL2 depth mode keeps.
    let x = f32((vertex << 1u) & 2u) * 2.0 - 1.0;
    let y = f32(vertex & 2u) * 2.0 - 1.0;
    return vec4f(x, y, 0.5, 1.0);
}

@fragment
fn effect_fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
    let first = effect_blocks.blocks[0];
#ifdef WEBGL2
    let from_top = vec2f(position.x, first.size.w - position.y);
#else
    let from_top = position.xy;
#endif
    var input: EffectInput;
    input.color = textureLoad(effect_source, vec2i(position.xy), 0);
    input.size = first.size.xy;
    input.pixel = from_top;
    input.uv = from_top / first.size.xy;
    input.time = first.clock.x;
    return effect_chain(input);
}
