// The waterfall's sheet: glassy water at the lip that turns white as it falls, in ropes and veils of
// fine upright streaks, with ragged, feathered edges, thinning into mist toward its foot. Every
// pattern moves with the water: a point's noise reads the place across the lip where its water
// crossed it and the time it crossed, so each streak rides down at the water's own speed and
// stretches as the water speeds up. The animation needs the time alone, so the CPU does nothing in
// a frame. The scene's light lights the sheet, and its depth softens the sheet where it nears a wall.
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
}

/// The second texture coordinate's room for each veil, as the mesh writes it.
const VEIL_ROOM: f32 = 2.0;

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
    let veil = veil_of(input.uv1);
    let across = (input.uv1.x - VEIL_ROOM * veil) * 2.0 - 1.0;
    let lip = input.uv.x;
    let t = input.uv.y;
    let fallen = max(input.uv1.y, 0.0);
    let share = clamp(fallen / material.drop, 0.0, 1.0);
    let seed = veil * 3.0 + 1.0;
    let now = frame.time;

    // Ropes: bundles about a meter across that keep their places and waver slowly. Streaks: two
    // finer layers that ride down with the water, the finest a little faster than the rest.
    let ropes = streak_layer(lip, now - t, vec2f(0.9, 0.2), seed);
    let coarse = streak_layer(lip, now - t, vec2f(5.0, 1.4), seed + 0.37);
    let fine = streak_layer(lip, now * 1.25 - t, vec2f(13.0, 3.5), seed + 0.71);
    // A rope is a ridge of the noise, where it crosses its middle: a long, narrow bright band.
    let ridge = 1.0 - abs(ropes * 2.0 - 1.0);
    let rope = smoothstep(0.45, 0.9, ridge);
    let streak = smoothstep(0.3, 0.75, 0.5 * coarse + 0.5 * fine);
    // The sheet falls whole for a few meters, then parts into its ropes.
    let parting = smoothstep(0.0, 0.3, share);
    let body = clamp(mix(0.75, 0.65 * rope + 0.55 * streak, parting * 0.6 + 0.4), 0.0, 1.0);

    // Glassy for a short way below the lip, then white. Over the brink, flecks of white already ride
    // on the glassy water.
    let white = smoothstep(0.0, material.clear, fallen);
    let flecks = smoothstep(0.6, 0.85, fine) * 0.7;
    let foam = max(white, flecks * (1.0 - white));
    // Between the strands, the shade of the water behind them shows grey.
    s.baseColor = mix(material.glass, s.baseColor * min(mix(0.5, 1.08, body), 1.0), foam);
    s.roughness = mix(0.06, s.roughness, foam);
    s.diffuseTransmission = s.diffuseTransmission * white;
    s.diffuseTransmissionColor = s.baseColor;

    // The streaks give the surface its relief: sharp glints on the glassy water, soft on the foam.
    // The ropes are rounded bundles, so the light falls across each one; the streaks add a fine grain.
    let relief = mix(0.05 * streak, 0.14 * rope + 0.03 * streak, white);
    s.normal = bent_normal(input.normal, input.relativePosition, relief);

    // How much of the sheet there is. The glassy water is a body; the white water lets the light
    // behind it through between its strands, and lower down it breaks into ropes with gaps.
    var alpha = mix(0.85, mix(0.55, 1.0, body), white);
    let breakup = smoothstep(0.2, 0.8, share);
    alpha *= mix(1.0, smoothstep(0.15, 0.55, 0.75 * rope + 0.45 * streak), breakup);
    // Ragged, feathered edges that grow as the sheet fans out, torn by the streaks that ride them.
    let feather = mix(0.12, 0.4, smoothstep(0.0, 0.5, share));
    let tufts = streak_layer(lip, now - t, vec2f(2.2, 0.7), seed + 0.53);
    let edge = abs(across) + ((tufts - 0.5) * 1.8 + (coarse - 0.5) * 0.9 + (fine - 0.5) * 0.6) * feather;
    alpha *= 1.0 - smoothstep(1.0 - feather, 1.0, edge);
    // The fall never lands: it thins into the mist over the lower half of its drop.
    alpha *= 1.0 - smoothstep(0.45, 1.0, share);
    // The apron fades in from its upstream end, over the river's own surface.
    alpha *= smoothstep(-material.apron, -0.4 * material.apron, t);
    // The back veil starts behind the front one at the lip, and lies in its shade.
    let back = 1.0 - min(veil, 1.0);
    alpha *= mix(1.0, smoothstep(0.0, 1.5, fallen), back);
    s.baseColor *= mix(1.0, 0.8, back);
    // Where the sheet nears a wall or a ledge behind it, it fades rather than cutting a line.
    let place = input.fragCoord.xy / frame.resolution;
    let gap = max(sceneDistance(place) - distance_of(input.fragCoord.z), 0.0);
    alpha *= smoothstep(0.0, material.softness, gap);
    s.alpha = clamp(alpha, 0.0, 1.0);
    return s;
}
