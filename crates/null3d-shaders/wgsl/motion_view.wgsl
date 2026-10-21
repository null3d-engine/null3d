// The motion debug view (decision record D-140): one triangle over the scene color, which shows
// each pixel's whole motion since the last frame. The camera's part comes from the depth: the
// pixel's point, placed by its depth, moved into the last frame's clip space by the reprojection
// matrix. The surface's own part comes from the motion target. Their sum, in pixels of the render
// size, shows as a color: its direction as the hue, from red to the right through yellow downward
// and blue to the left, and its length as the brightness, full at FULL_PIXELS. A still pixel is
// black.
//
// The step draws into the corner of the scene color that the frame draws at the render scale, and
// reads the same corner of the motion target and the depth, at the texel under the fragment on
// both GPU paths. WebGL2 counts rows from the bottom, so its builds turn the rows around for the
// place on the image, which counts from the top. The DEPTH_MULTISAMPLED builds read sample 0 of a
// multisampled depth, on WebGPU. On the 8-bit path (the TONE_MAP builds) the scene color holds
// display color, so the step writes the color as it is; elsewhere it writes the linear color that
// the final pass, which draws debug views without a tone curve, encodes back.

#import null3d::color::{srgb_to_linear}

/// The step's values: the render size in pixels, then the targets' size in texels, and the matrix
/// from this frame's clip space to the last frame's.
struct ViewBlock {
    size: vec4f,
    reproject: mat4x4f,
}

@group(0) @binding(0) var<uniform> view: ViewBlock;
@group(0) @binding(1) var motion_texture: texture_2d<f32>;
@group(0) @binding(2) var view_sampler: sampler;
#ifdef DEPTH_MULTISAMPLED
@group(0) @binding(3) var depth_texture: texture_multisampled_2d<f32>;
#else
@group(0) @binding(3) var depth_texture: texture_2d<f32>;
#endif

/// The motion in pixels at which the color reaches its full brightness.
const FULL_PIXELS: f32 = 16.0;
const TAU: f32 = 6.2831853;

@vertex
fn vs(@builtin(vertex_index) vertex: u32) -> @builtin(position) vec4f {
    // A triangle past the corners of clip space, at a depth that every WebGL2 depth mode keeps.
    let x = f32((vertex << 1u) & 2u) * 2.0 - 1.0;
    let y = f32(vertex & 2u) * 2.0 - 1.0;
    return vec4f(x, y, 0.5, 1.0);
}

/// A color of full saturation from its hue, from 0 to 1 around the wheel, and its brightness.
fn hue_color(hue: f32, value: f32) -> vec3f {
    let k = fract(vec3f(hue) + vec3f(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0;
    return value * clamp(abs(k) - 1.0, vec3f(0.0), vec3f(1.0));
}

@fragment
fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
    let render = view.size.xy;
#ifdef WEBGL2
    let from_top = vec2f(position.x, view.size.w - position.y);
#else
    let from_top = position.xy;
#endif
    let texel = vec2i(position.xy);
    let uv = from_top / render;
    let depth = textureLoad(depth_texture, texel, 0).x;
    let last = view.reproject * vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, depth, 1.0);
    var motion = textureLoad(motion_texture, texel, 0).xy;
    if last.w > 1e-6 {
        let then = last.xy / last.w;
        motion += uv - vec2f(then.x * 0.5 + 0.5, 0.5 - then.y * 0.5);
    }
    let pixels = motion * render;
    let length_pixels = length(pixels);
    var hue = 0.0;
    if length_pixels > 0.0 {
        hue = fract(atan2(pixels.y, pixels.x) / TAU + 1.0);
    }
    let color = hue_color(hue, min(length_pixels / FULL_PIXELS, 1.0));
#ifdef TONE_MAP
    return vec4f(color, 1.0);
#else
    return vec4f(srgb_to_linear(color), 1.0);
#endif
}
