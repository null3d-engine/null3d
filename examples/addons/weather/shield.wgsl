// The windshield drops of the weather add-on: a transparent overlay for a car's canopy. Beads of
// water sit in cells across the glass, some of them slide and leave a trail, and a wiper clears a
// band and lets the drops grow back. The drops are only the overlay's own lit surface: the glass
// under them stays the car's material, so the car's paint and reflections show through.
#import null3d::noise::{value2}

struct Uniforms {
    // The sketch time in seconds, the rain's strength from 0 to 1, the wiper's line from 0 at the
    // canopy's base to 1 at its top (0 when no wipe runs), and seconds since the last wipe ended.
    time: f32,
    rain: f32,
    wipe: f32,
    since: f32,
}

/// The drops in one cell: a bead at a place of its own, and a trail where it has slid.
fn shield_drops(uv: vec2f, time: f32) -> vec4f {
    // Nine cells by six across the canopy. Each cell's numbers give its bead's place, size and pace.
    let cells = vec2f(9.0, 6.0);
    let cell = floor(uv * cells);
    let home = vec2f(value2(cell), value2(cell + 23.0));
    let pace = vec2f(value2(cell + 41.0), value2(cell + 53.0));
    // About half the cells hold a bead; the others stay clear.
    let holds = step(0.45, home.x);
    let sliding = step(0.55, pace.y) * holds;
    // The bead's age runs from 0 to 1 again; a bead that slides moves down as it ages.
    let age = fract(time * (0.05 + 0.12 * pace.x) + pace.y);
    let rest = vec2f(0.25 + 0.5 * home.x, 0.3 + 0.4 * home.y);
    let slide = sliding * age * age * 2.6;
    let center = vec2f(rest.x, fract(rest.y - slide));
    let local = fract(uv * cells) - center;
    let radius = (0.06 + 0.11 * home.y) * holds;
    let body = smoothstep(radius, radius * 0.4, length(local));
    // The trail is a thin streak above a bead that has slid.
    let above = local.y;
    let trail =
        sliding *
        smoothstep(0.018, 0.0, abs(local.x)) *
        smoothstep(0.0, 0.04, above) *
        smoothstep(slide + 0.04, slide - 0.18, above);
    return vec4f(body, local.x, local.y, trail);
}

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let drops = shield_drops(input.uv, material.time);
    let body = drops.x;
    let trail = drops.w;
    let drop = clamp(body + trail * 0.5, 0.0, 1.0);
    // The wiper clears the glass below its line, and the drops grow back after it.
    let cleared = step(material.wipe, input.uv.y);
    let regrow = clamp(material.since / 1.4, 0.0, 1.0);
    let wet = drop * cleared * regrow * clamp(material.rain, 0.0, 1.0);
    s.alpha = wet;
    // Water is clear and shiny: a dark base that takes the lights as sharp highlights, and a normal
    // that bends with the bead so the highlight slides across it.
    s.baseColor = vec3f(0.02, 0.025, 0.035);
    s.metalness = 0.0;
    s.roughness = 0.06;
    s.normal = normalize(s.normal + vec3f(-drops.y, 0.0, -drops.z) * body * 2.0);
    return s;
}
