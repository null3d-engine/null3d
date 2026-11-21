// The waterfall's column: glassy water that rolls over the lip as a smooth tongue, then turns white
// and falls as a column of broken, frothy water, its ropes about a meter apart with shade between
// them. The column's section is an ellipse, so it reads as a solid body from the side as well as
// from the front, and its outline is soft and torn wherever the view grazes it. Over the lower half
// of its drop it gives way to the mist that the particles draw. Every pattern moves with the water:
// a point's noise reads the place across the lip where its water crossed it and the time it
// crossed, so each clump rides down at the water's own speed and stretches as the water speeds up.
// The animation needs the time alone, so the CPU does nothing in a frame. The scene's light lights
// the column, and its depth softens the column near a wall.
#import null3d::noise::{value2}

struct Uniforms {
    // The glassy water's own color at the lip, a linear color.
    glass: vec3f,
    // How far the fall drops below the lip, in meters.
    drop: f32,
    // The meters below the lip over which the water turns from glassy to white.
    clear: f32,
    // The gap to the surface behind the sheet, in meters, over which the sheet fades as it nears it.
    softness: f32,
    // The seconds that the apron's water takes to reach the lip, over which the apron fades in.
    apron: f32,
    // Half the water's width at the lip, in meters.
    halfWidth: f32,
    // The world height below which the fall vanishes, as into a cloud sea that draws before it.
    fadeBelow: f32,
    // The lip's direction across the water, to its right, as a unit vector in the world.
    across: vec3f,
}

/// The meters below `fadeBelow` over which the fall vanishes, and the meters above it where it
/// starts to thin.
const SINK_DEPTH: f32 = 6.0;
const SINK_LEAD: f32 = 0.5;

/// The ropes that the white water parts into, for each meter round the column.
const ROPES_PER_METER: f32 = 0.9;
/// The width of the froth's clumps across the fall, and their length down it, in meters.
const CLUMP: f32 = 0.35;
const CLUMP_LENGTH: f32 = 0.9;
/// The steady speed that falling water nears, and the time that the air takes to slow it, as the
/// path of falling water gives them.
const FALL_SPEED: f32 = 15.0;
const DRAG_TIME: f32 = 1.5290520;

/// One layer of streaks, from 0 to 1: value noise across the lip and along the time that the water
/// crossed it, so a streak rides with the water. `cells` gives the cells per meter across and per
/// second along. Where one pixel covers more than a cell, the layer gives way to its mean, so a far
/// fall does not shimmer.
fn streak_layer(lip: f32, crossed: f32, cells: vec2f, seed: f32) -> f32 {
    let p = vec2f(lip * cells.x + seed * 17.0, crossed * cells.y + seed * 5.3);
    let footprint = max(fwidth(p.x), fwidth(p.y));
    let resolved = 1.0 - smoothstep(0.6, 1.6, footprint);
    return mix(0.5, value2(p), resolved);
}

/// The normal bent by the slopes of a height `h` over the surface, in meters, from the screen's
/// derivatives of the place and the height.
fn bent_normal(n: vec3f, p: vec3f, h: f32) -> vec3f {
    let dpx = dpdx(p);
    let dpy = dpdy(p);
    let r1 = cross(dpy, n);
    let r2 = cross(n, dpx);
    let det = dot(dpx, r1);
    let grad = sign(det) * (dpdx(h) * r1 + dpdy(h) * r2);
    let bent = abs(det) * n - grad;
    return select(n, normalize(bent), dot(bent, bent) > 1e-12);
}

/// The distance in front of the camera of a depth value, as sceneDistance converts the copy's.
fn distance_of(depth: f32) -> f32 {
    let near = engine_frame.camera_range.x;
    let far = engine_frame.camera_range.y;
    if engine_frame.camera_position.w > 0.5 {
        return near * far / (near + depth * (far - near));
    }
    return far - depth * (far - near);
}

/// The froth's clumps, from 0 to 1, about a third of a meter wide and a meter long wherever they
/// are on the fall.
/// Each layer rides with the water, so its clumps stretch as the water speeds up; the clumps fade
/// from a layer whose cells grow too long into one with more cells for each second.
fn clumps(lip: f32, crossed: f32, t: f32, seed: f32) -> f32 {
    // How fast the water falls after `t` seconds, near enough for the clumps' length.
    let speed = max(1.2, FALL_SPEED * tanh(t / DRAG_TIME));
    let k = clamp(log(speed / (CLUMP_LENGTH * 3.0)) / log(3.0), 0.0, 2.0);
    let wa = clamp(1.0 - k, 0.0, 1.0);
    let wc = clamp(k - 1.0, 0.0, 1.0);
    let wb = 1.0 - wa - wc;
    let a = streak_layer(lip, crossed, vec2f(1.0 / CLUMP, 3.0), seed);
    let b = streak_layer(lip, crossed, vec2f(1.0 / CLUMP, 9.0), seed + 0.37);
    let c = streak_layer(lip, crossed, vec2f(1.0 / CLUMP, 27.0), seed + 0.71);
    // Two noises blended halve the spread; this gives it back.
    let mixed = a * wa + b * wb + c * wc - 0.5;
    return clamp(0.5 + mixed / sqrt(wa * wa + wb * wb + wc * wc), 0.0, 1.0);
}

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let white_color = s.baseColor;
    // The place round the column's section: 0 at the front's middle, a half at the back's middle,
    // where the pattern's seam lies against the wall. Its cosine is 1 at the front.
    let around = fract(input.uv1.x + 0.5) - 0.5;
    let facing = cos(around * 6.2831853);
    let t = input.uv.y;
    let fallen = max(input.uv1.y, 0.0);
    let share = clamp(fallen / material.drop, 0.0, 1.0);
    let now = frame.time;
    let crossed = now - t;
    // The place round the column in meters, near enough: the oval's girth is about 5.7 times the
    // lip's half width.
    let lip = around * 5.7 * material.halfWidth;

    // Froth: clumps a third of a meter across that ride down with the water, and a finer grain.
    // They break the ropes' outlines and give the white water its rough, broken look. A grain finer
    // still roughens the froth and the outline seen close up, and gives way to its mean further off.
    let tuft = clumps(lip, crossed, t, 1.71);
    let grain = clumps(lip * 2.3, crossed * 2.3, t, 1.83);
    let froth = smoothstep(0.15, 0.85, 0.65 * tuft + 0.35 * grain);
    let fine = clumps(lip * 6.0, crossed * 6.0, t, 2.41);

    // Ropes: two sets of round bundles at different spacings, bent and widened by slow noise, so
    // they wander as the water falls and no two gaps are alike. Each rope is bright at its core
    // with soft shade at its sides, and the froth's clumps break the shade's outline. Where a
    // pixel covers more than half a rope, the ropes give way to their mean.
    let ropes = streak_layer(lip, crossed, vec2f(0.9, 0.2), 1.0);
    let warp = streak_layer(lip, crossed, vec2f(0.3, 0.1), 1.2);
    let bands = lip * ROPES_PER_METER + warp * 1.8;
    let inside = (2.0 * (fract(bands) - 0.5)) / mix(0.45, 0.9, ropes);
    let more = lip * ROPES_PER_METER * 1.7 + warp * 2.6 + 0.31;
    let beside = (2.0 * (fract(more) - 0.5)) / mix(0.4, 0.8, 1.0 - ropes);
    let core = max(clamp(1.0 - inside * inside, 0.0, 1.0), 0.5 * clamp(1.0 - beside * beside, 0.0, 1.0));
    let lumpy = smoothstep(0.05, 0.75, core + (froth - 0.5) * 0.4);
    let banded = 1.0 - smoothstep(0.3, 0.6, fwidth(more));
    // The glassy tongue over the lip is one smooth body; the ropes part out of it as it turns white,
    // some sooner than others, so no line crosses the fall where it turns.
    let soon = streak_layer(lip, crossed, vec2f(1.6, 0.8), 2.9);
    let white = smoothstep(0.0, material.clear, fallen * mix(0.4, 1.8, soon));
    // Seen from the side, the ropes stand one behind another with no gap between them, so the
    // column's sides show white froth rather than the shade between the ropes.
    let frontal = smoothstep(0.1, 0.7, abs(facing));
    let rope = mix(0.65, mix(0.8, mix(0.9, lumpy, frontal), white), banded);

    // Uneven white streak lines ride over the brink into the glassy tongue.
    let streaks = streak_layer(lip + warp * 2.0, crossed, vec2f(3.7, 0.6), 1.9);
    let patches = streak_layer(lip, crossed, vec2f(1.1, 0.3), 2.3);
    let lines = smoothstep(0.5, 0.8, streaks) * smoothstep(0.15, 0.6, patches);
    // On the apron the water breaks into froth as it nears the brink, as white water piles up
    // before an edge.
    let piled = smoothstep(-0.8 * material.apron, 0.0, t) * smoothstep(0.35, 0.6, froth);
    let foam = max(white, max(lines * 0.9, piled * 0.85) * (1.0 - white));
    // Fine bright streaks run down the ropes, and the froth shades them only a little, so the
    // white reads as streaked rather than mottled.
    let streaked = streak_layer(lip * 1.6, crossed, vec2f(5.0, 1.4), 3.3);
    let body = clamp(rope * mix(0.9, 1.1, froth) * mix(0.86, 1.12, streaked) * mix(0.95, 1.04, fine), 0.0, 1.0);
    s.baseColor = mix(material.glass, white_color * mix(0.22, 1.1, body), foam);
    s.roughness = mix(0.06, s.roughness, foam);
    s.diffuseTransmission = s.diffuseTransmission * white;
    s.diffuseTransmissionColor = s.baseColor;

    // The froth gives the surface a fine relief. White water scatters the light that reaches it
    // from all round, so it takes the sky's light as a surface facing up does, and reads white.
    let relief = (0.08 * lumpy + 0.05 * froth + 0.035 * fine) * white;
    s.normal = bent_normal(input.normal, input.relativePosition, relief);
    s.ambientNormal = normalize(mix(s.normal, vec3f(0.0, 1.0, 0.0), 0.7 * white));

    // How much water there is. The glassy tongue and the white column are solid bodies; the ropes
    // show as shade, not as gaps. Lower down the column breaks up: long upright gaps open in the
    // shade between the ropes first, until only the ropes' cores are left, torn into clumps.
    var alpha = mix(0.9, 0.97, white);
    let breakup = smoothstep(0.4, 0.9, share);
    let long = streak_layer(lip, crossed, vec2f(2.5, 1.2), 3.7);
    let solid = core + (long - 0.5) * 0.5 + (froth - 0.5) * 0.25;
    let threshold = mix(-0.4, 0.95, breakup);
    alpha *= smoothstep(threshold - 0.15, threshold + 0.15, solid);
    // The outline: where the view grazes the column, the water thins to nothing, torn by the froth
    // and by lobes that ride with the water, so no edge is clean, whichever way the column is seen.
    let grazing = abs(dot(input.normal, input.viewDirection));
    let lobes = value2(vec2f(around * 9.0 + 11.0, crossed * 2.2));
    alpha *= smoothstep(0.1, 0.5, grazing + (froth - 0.5) * 1.1 + (lobes - 0.5) * 0.5 + (fine - 0.5) * 0.5);
    // Seen from the front, the column's sides break into separate ropes as it falls, with the rock
    // showing between them, so its edges are never two straight lines. A view along the lip, which
    // sees the ends of the oval face on, keeps them whole.
    // The pattern reads the place across the lip alone, so the column's front and back break
    // alike and the rock shows through both.
    let across_place = abs(input.uv.x) / material.halfWidth;
    let frontal_view = 1.0 - smoothstep(0.45, 0.85, abs(dot(input.viewDirection, material.across)));
    let side_lobes = value2(vec2f(sign(input.uv.x) * 7.0 + 2.0, crossed * 1.8));
    let sides = smoothstep(0.32, 0.66, across_place + (side_lobes - 0.5) * 0.35) * frontal_view;
    let breaking = sides * smoothstep(0.1, 1.2, fallen);
    let strand = value2(vec2f(input.uv.x * 2.4 + 3.0, crossed * 0.7));
    alpha *= mix(1.0, smoothstep(0.45, 0.62, strand + (froth - 0.5) * 0.3), breaking);
    // Its outermost water thins away as it falls, so the fall draws in from the rock on both sides.
    // Lower down the water spreads again as it breaks up, so the thinning is for the brink's
    // first meters alone.
    let edge = mix(1.05, 0.6, smoothstep(0.0, 1.8, fallen)) + 0.7 * smoothstep(3.0, 9.0, fallen)
        + (side_lobes - 0.5) * 0.2;
    alpha *= mix(1.0, 1.0 - smoothstep(edge - 0.06, edge + 0.04, across_place), frontal_view);
    // The water gives way to the mist over the lower half of the drop, so it never lands. Each
    // clump ends at its own height, so no line runs across the fall.
    let ending = share + (froth - 0.5) * 0.3 + (core - 0.5) * 0.12;
    alpha *= 1.0 - smoothstep(0.62, 0.98, ending);
    // The apron fades in from its upstream end, over the river's own surface, sooner in some places
    // across than in others, so neither it nor the river's square end draws a line. The column's
    // back lies on its front at the lip, so it shows only once the column has some depth.
    let start = t + (patches - 0.5) * 0.5 * material.apron;
    alpha *= smoothstep(-material.apron, -0.4 * material.apron, start);
    let back = smoothstep(0.3, -0.3, facing);
    alpha *= mix(1.0, smoothstep(0.05, 0.8, fallen), back);
    s.baseColor *= mix(1.0, 0.85, back);

    // Where the column nears a wall or a ledge behind it, it fades rather than cutting a line. The
    // apron and the first meter of the fall lie on the river and its brink by design, so they do
    // not fade there: a fade would draw the lip as a straight line where the water leaves it.
    let place = input.fragCoord.xy / frame.resolution;
    let gap = max(sceneDistance(place) - distance_of(input.fragCoord.z), 0.0);
    let on_brink = 1.0 - smoothstep(0.4, 1.5, fallen);
    alpha *= mix(smoothstep(0.0, material.softness, gap), 1.0, on_brink);
    // A cloud that draws before the fall does not hide it, so the fall vanishes itself where it
    // sinks into the cloud, each clump at its own depth.
    let sink = input.worldPosition.y + (froth - 0.5) * 0.8;
    alpha *= smoothstep(material.fadeBelow - SINK_DEPTH, material.fadeBelow + SINK_LEAD, sink);
    s.alpha = clamp(alpha, 0.0, 1.0);
    return s;
}
