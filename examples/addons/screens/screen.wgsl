// An LCD panel in the world: a canvas texture lit as an emissive screen, with the panel's own
// structure as the camera comes close. Each texel shows its red, green and blue bars, a band of
// light drifts up the panel, the gaps between the rows show, and a share of the texels stays dark.
// A boot tears the rows, rolls a dark band up the panel and fades the picture in. The size of the
// pattern in pixels comes from the texture coordinates' derivatives, so the look changes with the
// distance without a camera value, and a panel far away draws as a smooth image.

#import null3d::math::{TAU}
#import null3d::noise::{random2}

var screen: texture_2d<f32>;

struct Uniforms {
    // The canvas's size in texels.
    resolution: vec2f,
    // How brightly the panel glows.
    glow: f32,
    // The panel's power, from 0 for off to 1 for full.
    power: f32,
    // The sub-pixels' strength, from 0 for none to 1.
    subpixels: f32,
    // The scan band's strength, and the darkness between the texel rows.
    scan: f32,
    // The share of the texels that never light, from 0 for none.
    dead: f32,
    // The sketch time when the panel last booted, and how long its boot lasts in seconds.
    bootAt: f32,
    bootSeconds: f32,
}

/// How much of the boot is left at the sketch time: 1 as the panel starts, falling to 0 as it
/// settles.
fn booting(time: f32) -> f32 {
    let since = time - material.bootAt;
    return step(0.0, since) * (1.0 - smoothstep(material.bootSeconds * 0.45, material.bootSeconds, since));
}

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    // The texture coordinate in texels, and how many texels one pixel covers. A derivative belongs
    // to uniform control flow, so both come before any branch or loop.
    let texel = input.uv * material.resolution;
    let footprint = max(fwidth(texel).x, fwidth(texel).y);
    let f = fract(texel);
    let boot = booting(frame.time);

    // The boot: rows tear sideways by their own hash, a dark band rolls up the panel, and the
    // picture glows faintly while the panel settles.
    let row = floor(texel.y);
    let tear = (random2(vec2f(row, floor(frame.time * 20.0))) - 0.5) * 0.03 * boot;
    let roll = fract(input.uv.y - (frame.time - material.bootAt) * 0.7);
    let dark = smoothstep(0.0, 0.06, roll) * (1.0 - smoothstep(0.12, 0.2, roll));
    let uv = clamp(input.uv + vec2f(tear, tear * 0.35), vec2f(0.0), vec2f(1.0));
    var colour = textureSampleLevel(screen, screenSampler, uv, 0.0).rgb;
    colour *= mix(1.0, 0.12 + 0.88 * dark, boot);

    // The raster: a texel holds three vertical bars of red, green and blue. A texel that covers
    // several pixels shows them; further away they blur into the texel's own colour.
    let close = 1.0 - smoothstep(0.3, 0.6, footprint);
    let bar = f.x * 3.0;
    let lit = vec3f(
        1.0 - smoothstep(0.35, 0.5, abs(bar - 0.5)),
        1.0 - smoothstep(0.35, 0.5, abs(bar - 1.5)),
        1.0 - smoothstep(0.35, 0.5, abs(bar - 2.5)),
    );
    colour *= mix(vec3f(1.0), 0.3 + 0.7 * lit, material.subpixels * close);

    // A slow band of light crosses the panel, and the foot of each texel row darkens where the
    // rows are wide enough to see.
    let sweep = pow(0.5 + 0.5 * sin((input.uv.y * 0.8 - frame.time * 0.06) * TAU), 6.0);
    colour *= 1.0 + material.scan * 0.18 * sweep;
    let gap = smoothstep(0.6, 0.95, f.y);
    colour *= 1.0 - material.scan * mix(0.08, 0.5, close) * gap;

    // Dead texels stay dark whatever the picture shows. The hash of a texel's whole numbers keeps
    // the same texels dark on every frame and every GPU.
    let dead = step(random2(floor(texel) + vec2f(0.5)), material.dead);
    colour *= 1.0 - 0.85 * dead * close;

    // The picture fades in while the panel powers up. A boot that has not started, or has finished,
    // leaves the picture at full brightness.
    let since = max(frame.time - material.bootAt, 0.0);
    colour *= material.power * mix(1.0, mix(0.3, 1.0, smoothstep(0.0, material.bootSeconds * 0.6, since)), boot);

    s.baseColor = vec3f(0.0);
    s.metalness = 0.0;
    s.roughness = 0.4;
    s.emissive = colour * material.glow;
    return s;
}
