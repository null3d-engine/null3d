// The waterfall's sheet: glassy water that rolls over the lip as a smooth tongue, then turns white
// and falls as four to six round ropes with grey shade between them, its edges torn into lobes and
// wisps. From about halfway down it bursts into a cloud of mist several times its width, which hides
// its end. Every pattern moves with the water: a point's noise reads the place across the lip where
// its water crossed it and the time it crossed, so each streak rides down at the water's own speed
// and stretches as the water speeds up. The animation needs the time alone, so the CPU does nothing
// in a frame. The scene's light lights the sheet, and its depth softens the sheet near a wall.
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
    // Half the water's width at the lip, in meters, and how far each side widens for each meter that
    // the water falls.
    halfWidth: f32,
    spread: f32,
}

/// The ropes that the white water parts into, for each meter across the lip.
const ROPES_PER_METER: f32 = 0.9;

/// The second texture coordinate's room for each veil, as the mesh writes it.
const VEIL_ROOM: f32 = 2.0;

/// How far each veil's mesh reaches past the water's edges, as a factor of its half width, as the
/// mesh writes it.
const EDGE_ROOM: f32 = 1.5;

/// The veil that a point belongs to, counted from 0 at the back.
fn veil_of(uv1: vec2f) -> f32 {
    return floor(uv1.x / VEIL_ROOM);
}

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

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let white_color = s.baseColor;
    let veil = veil_of(input.uv1);
    // The place across the veil's mesh, from -1 to 1, and across the water, where -1 and 1 are its
    // edges and the mesh's room lies past them.
    let mesh_across = (input.uv1.x - VEIL_ROOM * veil) * 2.0 - 1.0;
    let across = mesh_across * EDGE_ROOM;
    let lip = input.uv.x;
    let t = input.uv.y;
    let fallen = max(input.uv1.y, 0.0);
    let share = clamp(fallen / material.drop, 0.0, 1.0);
    let seed = veil * 3.0 + 1.0;
    let now = frame.time;
    let crossed = now - t;

    // Ropes: thick bundles about a meter apart, each round, with a bright core and grey shade at its
    // sides. Slow noise bends them and changes their widths, so they wander as the water falls, and
    // they fan out with the sheet, since they follow the place across the lip. Where a pixel covers
    // more than half a rope, the ropes give way to their mean.
    let ropes = streak_layer(lip, crossed, vec2f(0.9, 0.2), seed);
    let warp = streak_layer(lip, crossed, vec2f(0.3, 0.1), seed + 0.2);
    let bands = lip * ROPES_PER_METER + warp * 1.4 + seed;
    let inside = (2.0 * (fract(bands) - 0.5)) / mix(0.55, 1.0, ropes);
    let core = sqrt(clamp(1.0 - inside * inside, 0.0, 1.0));
    let banded = 1.0 - smoothstep(0.3, 0.6, fwidth(bands));
    // The glassy tongue over the lip is one smooth body; the ropes part out of it as it turns white.
    let white = smoothstep(0.0, material.clear, fallen);
    let rope = mix(0.6, mix(0.75, core, white), banded);
    // Froth: fine upright streaks inside each rope, which ride down with the water, so a rope reads
    // as white water rather than a smooth tube.
    let grain = streak_layer(lip, crossed * 1.2, vec2f(4.0, 2.2), seed + 0.71);
    let fine = streak_layer(lip, crossed * 1.4, vec2f(9.0, 3.6), seed + 0.83);
    // Thin bright threads among the streaks, which a near view resolves and a far one averages away.
    let threads = smoothstep(0.62, 0.82, streak_layer(lip, crossed * 1.6, vec2f(18.0, 5.0), seed + 0.29));
    let froth = clamp(0.4 * grain + 0.45 * fine + 0.35 * threads, 0.0, 1.0);

    // Glassy over the lip, then white. Thin white streak lines ride over the brink into the glassy
    // tongue.
    let lines = smoothstep(0.7, 0.9, streak_layer(lip, crossed, vec2f(5.0, 0.5), seed + 0.9));
    let foam = max(white, lines * 0.7 * (1.0 - white));
    let body = clamp(rope * mix(0.6, 1.2, froth), 0.0, 1.0);
    s.baseColor = mix(material.glass, white_color * mix(0.35, 1.0, body), foam);
    s.roughness = mix(0.06, s.roughness, foam);
    s.diffuseTransmission = s.diffuseTransmission * white;
    s.diffuseTransmissionColor = s.baseColor;

    // The bundle is round, so its sides turn a little from the light; the froth gives a fine grain.
    let width_here = material.halfWidth + material.spread * fallen;
    let side = clamp(abs(across), 0.0, 1.0);
    let bundle = sqrt(max(1.0 - side * side, 0.0)) * width_here * 0.3;
    let relief = bundle + 0.04 * froth * white;
    s.normal = bent_normal(input.normal, input.relativePosition, relief);

    // How much water there is. The glassy tongue is a body. The white water is dense in its ropes,
    // soft at their sides and thin between them, and lower down the gaps open further.
    let dense = smoothstep(0.05, 0.6, rope) * mix(0.55, 1.0, froth);
    var alpha = mix(0.9, mix(0.2, 1.0, dense), white);
    alpha *= mix(1.0, smoothstep(0.25, 0.8, dense), smoothstep(0.25, 0.7, share));
    // Torn edges: each side's edge moves in and out with noise that rides with the water, further
    // as the fall widens, and wisps tear off it.
    let edge_seed = select(11.0, 23.0, across > 0.0) + seed;
    let lobes = value2(vec2f(edge_seed, crossed * 2.2));
    let wisps = value2(vec2f(edge_seed + 5.0, crossed * 6.0));
    let reach = mix(0.12, 0.5, smoothstep(0.0, 0.5, share));
    let rim = abs(across) - (lobes - 0.45) * reach * 1.6 - (wisps - 0.5) * reach * 0.8;
    alpha *= 1.0 - smoothstep(0.82, 1.0, rim);
    // The water gives way to the mist over the lower half of the drop, so it never lands.
    alpha *= 1.0 - smoothstep(0.45, 0.9, share);
    // The apron fades in from its upstream end, over the river's own surface.
    alpha *= smoothstep(-material.apron, -0.4 * material.apron, t);
    // The back veil starts behind the sheet at the lip, and lies in its shade.
    let back = 1.0 - min(veil, 1.0);
    alpha *= mix(1.0, 0.7 * smoothstep(0.0, 1.5, fallen), back);
    s.baseColor *= mix(1.0, 0.6, back);

    // The mist veil: spray along both edges of the upper fall, then from about halfway down a soft
    // cloud several times the fall's width, which billows with the water and hides the fall's end.
    let mist = step(1.5, veil);
    // The mist's noise runs in meters both across and down, so it billows in round clouds rather
    // than streaks, and it sinks slowly.
    let drift = fallen * 0.3 - now * 0.35;
    let puff = 0.65 * value2(vec2f(lip * 0.3 + seed * 7.0, drift))
        + 0.35 * value2(vec2f(lip * 0.75 + seed * 3.0, drift * 2.5 + 11.0));
    let billow = smoothstep(0.25, 0.75, puff);
    let spread_out = 1.0 - smoothstep(0.15, 0.8, abs(mesh_across) + (puff - 0.5) * 0.9);
    let burst = smoothstep(0.25, 0.6, share) * (1.0 - smoothstep(0.8, 1.0, share)) * spread_out;
    let spray = smoothstep(0.3, 0.55, abs(mesh_across)) * (1.0 - smoothstep(0.6, 0.85, abs(mesh_across)))
        * smoothstep(0.02, 0.2, share) * (1.0 - smoothstep(0.4, 0.7, share));
    let cloud = billow * max(0.4 * burst, 0.3 * spray);
    alpha = mix(alpha, cloud, mist);
    s.baseColor = mix(s.baseColor, white_color * mix(0.72, 1.0, billow), mist);
    s.roughness = mix(s.roughness, 1.0, mist);

    // Where the sheet nears a wall or a ledge behind it, it fades rather than cutting a line.
    let place = input.fragCoord.xy / frame.resolution;
    let gap = max(sceneDistance(place) - distance_of(input.fragCoord.z), 0.0);
    alpha *= smoothstep(0.0, material.softness, gap);
    s.alpha = clamp(alpha, 0.0, 1.0);
    return s;
}
