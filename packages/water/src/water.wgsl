// The water's surface: long waves that the current carries, finer ripples in the normal, a mirror of
// the banks and the sky, caustics on the bed, foam where the water breaks, and a shore that fades
// where the bed rises to meet the surface. The scene's own depth behind each pixel gives the water
// its depth, so a shore ends softly against the bed instead of on the mesh's edge. The same surface
// draws from below, where it shows the world above through a window overhead and turns the light
// back past that window's edge. Where two bodies' meshes overlap, the junction map names the one
// that draws each point, and both meshes mix the river's waves into still water's alike. Rain, when
// a page turns it on, rings the surface where its drops land.
#import null3d::noise::{value2, value3}
#import null3d::reflection::{reflection_uv}

struct Uniforms {
    // How tall the ripples stand, as a factor of their base height.
    ripple: f32,
    // The height of the long waves and of the wind's lift, as a factor of their base height.
    waveAmplitude: f32,
    // The meters of the gap to the bed over which the water fades to nothing at a shore.
    softness: f32,
    // The share of the water's color that reads the whole way the view runs through it, not its depth.
    viewPath: f32,
    // The light that the ripples focus on the bed, a linear color whose brightness is its strength.
    caustics: vec3f,
    // The world point and the size in meters that the foam map covers.
    foamOrigin: vec2f,
    foamSize: vec2f,
    // The world point and the size in meters that the junction map covers, and no size without one.
    junctionOrigin: vec2f,
    junctionSize: vec2f,
    // 1 when the bed comes from the shapes' own depth, in each vertex's color, and 0 when it comes
    // from the copy of the scene's depth behind the pixel.
    bedFromShape: f32,
    // The wind field's box across the ground in meters, and 0 without a field.
    windBox: f32,
    // The wind's strength: 0 for a water surface that names no field, and 1 for one that does.
    windStrength: f32,
    // The layer of the field's texture that holds the newest state.
    windLayer: f32,
    // How hard rain falls on the surface, from 0 for none to 1 for a downpour.
    rain: f32,
}

// The mirrored view of the scene above the water, which the reflection pass draws.
var mirror: texture_2d<f32>;
// How near each point lies to something that breaks the surface, in its red channel.
var foamMap: texture_2d<f32>;
// Where two bodies meet: the body that draws each texel, counted from 1, or 0 where each mesh draws
// its part, in red; the share of the river's waves in green; and 0 in alpha, which a texture still
// on its way to the GPU reads as 1.
var junctionMap: texture_2d<f32>;
// The wind add-on's field, and its steady settings, for a surface that reads the air. A page gives
// a plain texture and its box, so the water takes no dependency on the wind add-on.
var wind: texture_2d_array<f32>;
var airSettings: texture_2d<f32>;

// <wind-steady>
/// The height over which the air slows to the ground, in meters.
const WIND_GROUND_HEIGHT: f32 = 2.0;
/// The distance over which the noise's curl is measured, in noise cells.
const WIND_CURL_STEP: f32 = 0.02;
/// How long a gust that a page sends keeps its strength, in seconds, before the air is steady again.
const WIND_SENT_LIFE: f32 = 8.0;
/// The height that the grid samples at, where the air moves at its full speed. The grid stores the
/// air at this height, and a reader outside the grid's box works it out at the same height, so the
/// two meet at the box's edge.
const WIND_FULL_HEIGHT: f32 = 100.0;

/// The air's settings: its rule of place and time, the preset's gust and the swirl, and the gust
/// that a page sends. The grid's pass takes the first three vectors from its values and solves a
/// sent gust itself; a reader takes all four from its own settings.
struct WindAir {
    /// The time in seconds, the wind's speed and its heading in radians, and how much slower the
    /// air is at the ground.
    time: f32,
    speed: f32,
    heading: f32,
    ground: f32,
    /// The gust's strength, its radius in meters, its wave number and how fast it travels.
    gustStrength: f32,
    gustRadius: f32,
    gustWave: f32,
    gustSpeed: f32,
    /// The swirl's strength, its size, how fast its pattern drifts and its seed.
    swirl: f32,
    swirlScale: f32,
    swirlDrift: f32,
    seed: f32,
    /// The gust a page sent: its ground place in x and z, its strength in meters a second, and the
    /// time it was sent. Its strength is zero until a page sends one, and after it fades.
    sentX: f32,
    sentZ: f32,
    sentStrength: f32,
    sentBorn: f32,
}

/// The field's settings read from three value vectors: the air, the gust and the swirl.
fn wind_air(v0: vec4f, v1: vec4f, v2: vec4f) -> WindAir {
    var air: WindAir;
    air.time = v0.x;
    air.speed = v0.y;
    air.heading = v0.z;
    air.ground = v0.w;
    air.gustStrength = v1.x;
    air.gustRadius = v1.y;
    air.gustWave = v1.z;
    air.gustSpeed = v1.w;
    air.swirl = v2.x;
    air.swirlScale = v2.y;
    air.swirlDrift = v2.z;
    air.seed = v2.w;
    // The grid solves a gust that a page sends itself, from the ring of pushes and gusts, so its
    // readers hold no sent gust here.
    air.sentX = 0.0;
    air.sentZ = 0.0;
    air.sentStrength = 0.0;
    air.sentBorn = 0.0;
    return air;
}

/// The height's factor of the wind: one at the top, and one less the ground's share at the ground.
fn wind_profile(air: WindAir, y: f32) -> f32 {
    return 1.0 - air.ground * exp(-max(y, 0.0) / WIND_GROUND_HEIGHT);
}

/// The stream function of the swirl, in noise cells, at a place and a time.
fn wind_stream(air: WindAir, p: vec3f) -> f32 {
    let drift = air.swirlDrift * air.time;
    let q = vec3f(
        p.x * air.swirlScale + drift + air.seed,
        p.y * air.swirlScale,
        p.z * air.swirlScale + drift * 0.5,
    );
    return value3(q);
}

/// The turn that one gust gives the air at a place, in meters a second: a wave of turns that travels
/// along the heading. The turns are rings about the gust's center and depend only on the distance to
/// it, so a ring of air turns without piling up.
fn wind_gust_wave(air: WindAir, center: vec2f, strength: f32, p: vec3f, height: f32) -> vec3f {
    let g = vec2f(p.x - center.x, p.z - center.y);
    let distance = length(g) / air.gustRadius;
    let reach = distance * distance;
    if (reach >= 9.0) {
        return vec3f(0.0);
    }
    let envelope = exp(-reach) * cos(distance * air.gustWave) * strength * height;
    return vec3f((g.y / air.gustRadius) * envelope, 0.0, -(g.x / air.gustRadius) * envelope);
}

/// The wind's steady velocity at a world place, in meters a second: the base wind, the gust that
/// travels through it, the swirl, and the gust that a page sent, which travels from its own place.
/// A page's pushes reach readers only through the grid.
fn wind_steady(air: WindAir, p: vec3f) -> vec3f {
    let height = wind_profile(air, p.y);
    let cosHeading = cos(air.heading);
    let sinHeading = sin(air.heading);
    var v = vec3f(cosHeading * air.speed * height, 0.0, sinHeading * air.speed * height);

    let travel = air.gustSpeed * air.time;
    v += wind_gust_wave(air, vec2f(cosHeading * travel, sinHeading * travel), air.gustStrength, p, height);

    // The gust that a page sent: the same wave, from the place it was sent, carried along the
    // heading and fading over its life so the air comes back to its steady state.
    if (air.sentStrength != 0.0) {
        let age = air.time - air.sentBorn;
        if (age >= 0.0 && age < WIND_SENT_LIFE) {
            let sentTravel = air.gustSpeed * age;
            let wane = 1.0 - age / WIND_SENT_LIFE;
            v += wind_gust_wave(
                air,
                vec2f(air.sentX + cosHeading * sentTravel, air.sentZ + sinHeading * sentTravel),
                air.sentStrength * wane,
                p,
                height,
            );
        }
    }

    // The swirl: the curl of one stream function in the ground plane. The function varies slowly,
    // so a short step measures the slope.
    let step = WIND_CURL_STEP / air.swirlScale;
    let front = wind_stream(air, p + vec3f(0.0, 0.0, step));
    let back = wind_stream(air, p - vec3f(0.0, 0.0, step));
    let right = wind_stream(air, p + vec3f(step, 0.0, 0.0));
    let left = wind_stream(air, p - vec3f(step, 0.0, 0.0));
    let scale = air.swirl * height / (2.0 * step);
    v.x += (front - back) * scale;
    v.z -= (right - left) * scale;
    return v;
}
// </wind-steady>

// <wind-sample>
/// The air's steady settings as a reader holds them: the base wind in the first vector, the gust in
/// the second, the swirl in the third and the gust that a page sent in the fourth, with the time
/// that the reader's own frame gives.
fn wind_reading(base: vec4f, gust: vec4f, swirl: vec4f, sent: vec4f, time: f32) -> WindAir {
    var air: WindAir;
    air.time = time;
    air.speed = base.x;
    air.heading = base.y;
    air.ground = base.z;
    air.seed = base.w;
    air.gustStrength = gust.x;
    air.gustRadius = gust.y;
    air.gustWave = gust.z;
    air.gustSpeed = gust.w;
    air.swirl = swirl.x;
    air.swirlScale = swirl.y;
    air.swirlDrift = swirl.z;
    air.sentX = sent.x;
    air.sentZ = sent.y;
    air.sentStrength = sent.z;
    air.sentBorn = sent.w;
    return air;
}

/// The air at a world place: the wind across the ground in red and blue, the wind's rise in green,
/// and its speed in alpha, at the height the field's texture holds it. Inside the box the grid's
/// state gives it, with one read. Outside the box, and on a device that keeps no grid, the steady
/// field gives it, so the air carries on past the box instead of holding the box's edge.
fn wind_sample(world: vec3f, origin: vec2f, size: f32, layer: i32, air: WindAir) -> vec4f {
    if (size > 0.0) {
        let uv = (vec2f(world.x, world.z) - origin) / size;
        if (uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0) {
            // The grid keeps the air across the ground in red and green, the pressure in blue and
            // the step of its cycle in alpha.
            let state = textureSampleLevel(wind, windSampler, uv, layer, 0.0);
            return vec4f(state.r, 0.0, state.g, length(state.rg));
        }
    }
    let v = wind_steady(air, vec3f(world.x, WIND_FULL_HEIGHT, world.z));
    return vec4f(v, length(v));
}
// </wind-sample>

/// The seconds over which a pattern rides the current before it fades into a fresh copy.
const CARRY_CYCLE: f32 = 2.0;

/// Two copies of a pattern that the current carries, half a cycle apart: in x and y the seconds that
/// each has ridden the current, and in z and w their weights, each nothing at the moment its copy
/// starts afresh. A pattern that slid by the current times the clock would stretch further every
/// second wherever the current changes from point to point, into even lines across the view. A copy
/// that rides for one cycle at most cannot.
fn carried(t: f32) -> vec4f {
    let first = fract(t / CARRY_CYCLE);
    let second = fract(t / CARRY_CYCLE + 0.5);
    let weight = 1.0 - abs(2.0 * first - 1.0);
    return vec4f(first * CARRY_CYCLE, second * CARRY_CYCLE, weight, 1.0 - weight);
}

/// A number from 0 to 1 that changes each time a copy starts afresh: `which` is 0 for the first copy
/// and 0.5 for the second. A fresh copy starts somewhere new, so the pattern never loops.
fn cycle_seed(t: f32, which: f32) -> f32 {
    return fract(floor(t / CARRY_CYCLE + which) * 0.618034 + which);
}

/// The net of caustic ridges at a place `q` in the pattern's own units. `ridge` sets how thin they
/// are: 14 draws ridges about 7 mm wide, and a lower power broadens them.
fn caustic_net(q: vec2f, t: f32, ridge: f32) -> f32 {
    let a = sin(q.x * 3.1 + t * 1.3 + sin(q.y * 2.3 - t));
    let b = sin(q.y * 3.7 - t * 1.1 + sin(q.x * 1.9 + t * 0.7));
    let c = sin((q.x + q.y) * 2.6 + t * 0.9 + sin(q.x * 1.3 - q.y * 0.7));
    let v = (a + b + c) / 3.0;
    return pow(1.0 - abs(v), ridge);
}

/// Caustics: bright ridges where the ripples focus the light, which drift with the current in two
/// copies that take turns.
fn caustics(p: vec2f, t: f32, current: vec2f, ridge: f32) -> f32 {
    let copies = carried(t);
    let q = p * 4.6;
    let first = caustic_net(q - current * (copies.x * 4.0) + vec2f(cycle_seed(t, 0.0) * 37.0, 0.0), t, ridge);
    let second = caustic_net(q - current * (copies.y * 4.0) + vec2f(0.0, cycle_seed(t, 0.5) * 41.0), t, ridge);
    // Patches of brighter and fainter light keep the net from looking even.
    return (first * copies.z + second * copies.w) * (0.35 + 0.65 * value2(p * 0.8 + vec2f(t * 0.1, 0.0)));
}

/// The width of one cell of the rain's rings in meters, the rings that one cell shows a second, and
/// how far a ring tilts the surface. The weather add-on's wet surface takes the same values.
const RING_CELL: f32 = 0.9;
const RING_RATE: f32 = 0.8;
const RING_TILT: f32 = 0.32;

/// The slopes of the rings that raindrops make where they land, as the weather add-on's wet surface
/// draws them: one drop at a time in each cell, its place and its moment from the cell's hash and
/// its cycle, and a ring that grows and fades over the cycle. Two grids, half a cell apart, keep the
/// rings from lining up. A lighter rain leaves more of the cells dry. The rings drift with the
/// current, and give way where a pixel covers more than a ring's line, so far water does not shimmer.
fn rain_rings(p: vec2f, t: f32, flow: vec2f, rain: f32, footprint: f32) -> vec2f {
    var tilt = vec2f(0.0);
    let carried = (p - flow * t) / RING_CELL;
    for (var k = 0u; k < 2u; k++) {
        let grid = carried + vec2f(0.5, 0.5) * f32(k);
        let cell = floor(grid) + vec2f(97.0, 0.0) * f32(k);
        let clock = t * RING_RATE + value2(cell + 3.0) + 0.5 * f32(k);
        let phase = fract(clock);
        let drop = cell + vec2f(13.0, 7.0) * floor(clock);
        let falls = step(value2(drop + 41.0), rain);
        let jitter = (vec2f(value2(drop), value2(drop + 17.0)) - 0.5) * 0.35;
        let at = fract(grid) - 0.5 - jitter;
        let d = (length(at) - phase * 0.42) / 0.07;
        let ring = exp(-d * d) * (1.0 - phase) * falls;
        tilt += normalize(at + vec2f(1e-4, 1e-4)) * ring;
    }
    let resolved = 1.0 - smoothstep(0.05, 0.16, footprint);
    return tilt * RING_TILT * resolved;
}

/// The mean brightness of the caustics over a wide area, at any ridge once it is evened: the ridges'
/// mean, 0.114 at a power of 14, times the mean of the patches that brighten and dim them.
const CAUSTIC_MEAN: f32 = 0.077;

/// The foam's clumps for each meter, the same along the current and across it.
const FOAM_CELLS: f32 = 6.0;

/// Two octaves of the foam's clumps at a point, from 0 to 1, drawn out into streaks along `along`,
/// the current's direction (or nothing in still water). `footprint` is the meters that one pixel
/// covers there. Where a pixel covers more than a clump, an octave gives way to its mean, so the
/// foam never breaks into a grid of dots far off.
fn foam_clumps(q: vec2f, along: vec2f, footprint: f32) -> f32 {
    // Each octave turns its grid a different way, and the coarse one bends the fine one, so no clump
    // lines up with the world's axes.
    let turn = mat2x2f(0.866, 0.5, -0.5, 0.866);
    let a = turn * q * FOAM_CELLS;
    let bend = vec2f(value2(a * 0.5 + vec2f(3.3, 1.7)), value2(a * 0.5 + vec2f(9.1, 5.2))) - vec2f(0.5);
    let b = mat2x2f(0.766, -0.643, 0.643, 0.766) * q * FOAM_CELLS * 2.3 + bend * 1.5 + vec2f(7.0, 3.1);
    // The coarse clumps are smeared a third of a meter downstream, so foam lies in streaks behind
    // what breaks the water rather than in round blotches of one size.
    let step = turn * along * (FOAM_CELLS * 0.17);
    let streak = (value2(a) + value2(a - step) + value2(a - step * 2.0)) / 3.0;
    let coarse = 0.5 + (streak - 0.5) * 1.45;
    let near = 1.0 - smoothstep(0.5, 1.1, footprint * FOAM_CELLS);
    let fine = 1.0 - smoothstep(0.5, 1.1, footprint * FOAM_CELLS * 2.3);
    return 0.65 * mix(0.5, coarse, near) + 0.35 * mix(0.5, value2(b), fine);
}

/// The flecks that break the foam around the stones, which the current carries downstream in two
/// copies that take turns, so the pattern moves with the water without ever stretching where the
/// current changes.
fn foam_flecks(p: vec2f, flow: vec2f, t: f32, footprint: f32) -> f32 {
    let copies = carried(t);
    let along = select(vec2f(0.0), normalize(flow), length(flow) > 1e-4);
    let a = foam_clumps(p - flow * copies.x + vec2f(cycle_seed(t, 0.0) * 37.0, 0.0), along, footprint);
    let b = foam_clumps(p - flow * copies.y + vec2f(0.0, cycle_seed(t, 0.5) * 41.0 + 11.0), along, footprint);
    let wa = copies.z;
    let wb = copies.w;
    // Two noises blended halve the spread; this gives it back.
    return clamp(0.5 + (a * wa + b * wb - 0.5) / sqrt(wa * wa + wb * wb), 0.0, 1.0);
}

/// The cosine of the angle from straight up, under the water, inside which the world above shows:
/// past it the surface turns every ray back down, as total internal reflection does.
const WINDOW: f32 = 0.66;

/// The current at a point: its direction in the first texture coordinate's second vector, and its
/// speed in the first coordinate's x. The mesh carries both.
fn current_of(uv: vec2f, uv1: vec2f) -> vec3f {
    return vec3f(uv1 * 2.0 - vec2f(1.0), uv.x);
}

/// The body that a vertex belongs to, counted from 1, in the whole part of the first texture
/// coordinate's y, and how flat the surface lies there in its fraction, at half scale.
fn body_of(uv: vec2f) -> f32 {
    return floor(uv.y);
}

/// What the junction map holds at a point for the body that `body` names, counted from 1: in x, 1
/// where that body draws the point, and in y the share of the river's waves. Outside the map every
/// body draws with its own waves.
fn junction(p: vec2f, body: f32) -> vec2f {
    let open = vec2f(1.0);
    if material.junctionSize.x <= 0.0 {
        return open;
    }
    let at = (p - material.junctionOrigin) / material.junctionSize;
    if any(at < vec2f(0.0)) || any(at >= vec2f(1.0)) {
        return open;
    }
    let cell = textureLoad(junctionMap, vec2i(at * vec2f(textureDimensions(junctionMap))), 0);
    if cell.a > 0.5 {
        return open;
    }
    let owner = round(cell.r * 255.0);
    let draws = select(0.0, 1.0, owner == 0.0 || owner == body);
    return vec2f(draws, textureSampleLevel(junctionMap, junctionMapSampler, at, 0.0).g);
}

/// The water's height at a point, and its slopes along x and z: long waves, and with `fine` set,
/// shorter ripples beside them. A current carries the whole set downstream: each wave's direction
/// turns into the current's frame, so the crests keep every angle between them and all of them
/// travel with the water, in two copies that take turns, as `carried` gives them. Still water keeps
/// the authored directions and each wave's own speed. A wave's slope fades as the wave grows finer
/// than `footprint`, the meters that one pixel covers, so a slope that a pixel cannot resolve never
/// turns into noise that changes each frame.
fn waves(p: vec2f, t: f32, current: vec3f, fine: bool, footprint: f32) -> vec3f {
    // Each wave: its direction, its wave number, and the speed it runs at in still water.
    let list = array<vec4f, 6>(
        vec4f(1.0, 0.15, 2.3, 0.9),
        vec4f(0.8, -0.6, 3.7, 0.7),
        vec4f(0.6, 0.8, 5.9, 0.5),
        vec4f(1.0, -0.25, 11.0, 1.2),
        vec4f(-0.3, 1.0, 17.0, 0.6),
        vec4f(0.9, 0.45, 29.0, 1.6),
    );
    var h = 0.0;
    var slope = vec2f(0.0);
    let moving = current.z > 1e-5;
    let copies = carried(t);
    let count = select(3u, 6u, fine);
    for (var k = 0u; k < count; k++) {
        let w = list[k];
        let own = normalize(w.xy);
        // The authored direction turned into the current's frame. A plane wave travels along its
        // own direction, so a turned set whose phases the current carries drifts all downstream.
        let dir = select(own, vec2f(current.x * own.x - current.y * own.y, current.y * own.x + current.x * own.y), moving);
        // The long waves take the surface's height factor, and the fine ripples keep their own.
        let height = select(material.waveAmplitude, 1.0, k >= 3u);
        let amplitude = material.ripple * height * 0.05 / w.z;
        let resolved = 1.0 - smoothstep(0.75, 2.0, w.z * footprint);
        if moving {
            // Carried: the current moves the whole pattern, in two copies that take turns.
            let run = w.z * current.z * dot(current.xy, dir);
            let base = w.z * dot(dir, p);
            let turn = 6.2831853 * f32(k + 1u);
            let first = base - run * copies.x + cycle_seed(t, 0.0) * turn;
            let second = base - run * copies.y + cycle_seed(t, 0.5) * turn;
            h += amplitude * (copies.z * sin(first) + copies.w * sin(second));
            slope += dir * (amplitude * w.z * (copies.z * cos(first) + copies.w * cos(second)) * resolved);
        } else {
            // Still: each wave runs at its own speed.
            let still = w.z * dot(own, p) - w.w * t;
            h += amplitude * sin(still);
            slope += dir * (amplitude * w.z * cos(still) * resolved);
        }
    }
    return vec3f(h, slope);
}

/// The waves at a point with a share of the river's waves over still water's. Two meshes that meet
/// carry one current there and read one share, so they give the same surface.
fn shared_waves(p: vec2f, t: f32, current: vec3f, share: f32, fine: bool, footprint: f32) -> vec3f {
    let moving = waves(p, t, current, fine, footprint);
    if share >= 1.0 {
        return moving;
    }
    return mix(waves(p, t, vec3f(0.0), fine, footprint), moving, share);
}

fn vertexOffset(input: VertexInput) -> vec3f {
    let current = current_of(input.uv, input.uv1);
    // Where the bodies meet, the surface lies flat, so both meshes lie in one plane there. The river's
    // waves give way to still water's only inside that flat band, so the vertices need no mix.
    let flatness = fract(input.uv.y) * 2.0;
    // The vertex stage has no screen-space derivative to fade by, and a displaced vertex is
    // geometry rather than a pixel, so the fine ripples keep their full detail here.
    var lift = waves(input.position.xz, frame.time, current, false, 0.0).x * (1.0 - flatness);
    if (material.windStrength > 0.0) {
        // The air over the surface: its speed lifts a short wave, and its direction sets where the
        // crest stands. The field's box follows the camera, as it does for every reader of the field.
        let place = (object.worldMatrix * vec4f(input.position, 1.0)).xyz + camera.position;
        let reading = wind_reading(
            textureLoad(airSettings, vec2i(0, 0), 0),
            textureLoad(airSettings, vec2i(1, 0), 0),
            textureLoad(airSettings, vec2i(2, 0), 0),
            textureLoad(airSettings, vec2i(3, 0), 0),
            frame.time,
        );
        let air = wind_sample(
            place,
            camera.position.xz - vec2f(material.windBox * 0.5),
            material.windBox,
            i32(material.windLayer),
            reading,
        );
        let along = dot(air.xz, vec2f(0.919, 0.394));
        lift += material.waveAmplitude * 0.035 * air.a * sin(dot(input.position.xz, vec2f(0.7, 0.3)) * 0.5 + frame.time * 2.0 + along);
    }
    return vec3f(0.0, lift, 0.0);
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
    let p = input.worldPosition.xz;
    let footprint = max(length(dpdx(p)), length(dpdy(p)));
    let j = junction(p, body_of(input.uv));
    // Where two meshes overlap, only the body that the junction map names draws the point. The
    // other discards it, since the water writes depth and would hide the drawing body behind it.
    if j.x < 0.5 {
        discard;
    }
    let share = j.y;
    let current = current_of(input.uv, input.uv1);
    let w = shared_waves(p, frame.time, current, share, true, footprint);
    // Rain's rings tilt the surface beside its waves. The branch reads a uniform, so dry water
    // skips the rings' work.
    var slope = w.yz;
    if material.rain > 0.0 {
        slope += rain_rings(p, frame.time, current.xy * current.z, material.rain, footprint);
    }
    s.normal = normalize(vec3f(-slope.x, 1.0, -slope.y));
    let clip = camera.viewProjection * vec4f(input.relativePosition, 1.0);
    let mirrorUv = reflection_uv(clip, slope * 0.08);
    s.reflection = vec4f(textureSampleLevel(mirror, mirrorSampler, mirrorUv, 0.0).rgb, 1.0);
    // The water's depth: the gap between the sheet and the geometry behind the pixel along the view
    // ray, from the copy of the opaque scene's depth. The depth below the surface is that gap
    // measured against the view's slope.
    let place = input.fragCoord.xy / frame.resolution;
    let gap = max(sceneDistance(place) - distance_of(input.fragCoord.z), 0.0);
    // A bed that the shape describes rides in each vertex's color, and the water reads it in place
    // of the depth behind the pixel. Its alpha is 1 on a surface that takes no vertex colors.
    let depth = mix(
        gap * abs(input.viewDirection.y),
        max(input.vertexColor.a, 0.0),
        material.bedFromShape,
    );
    // A low view runs a long way through the water, which hides the bed's colors. From above the
    // depth alone gives the bed's own shading.
    let grazing = 1.0 - smoothstep(0.08, 0.4, abs(input.viewDirection.y));
    s.thickness = max(mix(depth, gap, material.viewPath * grazing), 0.02);
    // Shallow water at the edges carries a little foam.
    let edgeFoam = (1.0 - smoothstep(0.0, 0.05, depth)) * smoothstep(0.0, 0.03, w.x + 0.012);
    // Foam around the stones: the map holds how near each point lies to a stone, stretched
    // downstream, and moving noise breaks it into flecks that the current carries away. Clear water
    // is the rule: foam needs both a stone close by and a strong fleck, so it gathers in streaks
    // behind the stones and thins to scattered flecks further off.
    let foamUv = (p - material.foamOrigin) / material.foamSize;
    let near = textureSampleLevel(foamMap, foamMapSampler, foamUv, 0.0).r;
    var flecks = foam_flecks(p, current.xy * current.z, frame.time, footprint);
    if share < 1.0 {
        flecks = mix(foam_flecks(p, vec2f(0.0), frame.time, footprint), flecks, share);
    }
    let stoneFoam = smoothstep(0.57, 0.85, near * (0.205 + 0.95 * flecks));
    let foam = max(edgeFoam, stoneFoam);
    // Foam is broken white water: nearly white, and too full of air to show the bed through it.
    s.baseColor = mix(s.baseColor, vec3f(1.0), foam);
    s.roughness = mix(s.roughness, 0.6, foam);
    if !input.frontFacing {
        // Seen from under the water: the world above shows through, bent by the ripples, clearest in
        // a window overhead and dimmer past its edge, where the surface turns some of the light back
        // down as a faint mirror of the water. The planar reflection holds the world above the
        // water, so it takes no part here.
        s.normal = -s.normal;
        let overhead = max(input.viewDirection.y * -1.0, 0.0);
        let window = smoothstep(WINDOW - 0.05, WINDOW + 0.05, overhead);
        s.reflection = vec4f(0.0);
        s.thickness = 0.05;
        s.transmission = mix(0.8, 1.0, window) * (1.0 - 0.9 * foam);
        s.baseColor = mix(vec3f(0.08, 0.16, 0.15), s.baseColor, window);
        s.alpha = 1.0;
        return s;
    }
    // The caustics show on the bed, under clear water that is not too deep, and not under foam.
    let bed = p + w.yz * depth * 0.6;
    let reach = smoothstep(0.02, 0.15, depth) * exp(-depth * 1.4) * (1.0 - foam);
    // The ridges are about 7 mm wide close up. Where a pixel covers more than a ridge, as a low view
    // along the water does a little way off, they would alias into even lines across the view.
    // So they broaden with the pixel, at nearly the same mean brightness, each ridge kept a few
    // pixels wide, and where a pixel covers a good share of the pattern they give way to that mean.
    let ridge = clamp(0.04 / max(footprint, 1e-4), 2.0, 14.0);
    let even = (ridge + 1.0) / 15.0;
    var light = caustics(bed, frame.time, current.xy * current.z, ridge) * even;
    if share < 1.0 {
        light = mix(caustics(bed, frame.time, vec2f(0.0), ridge) * even, light, share);
    }
    light = mix(CAUSTIC_MEAN, light, 1.0 - smoothstep(0.025, 0.07, footprint));
    s.emissive += material.caustics * light * reach;
    s.transmission = 1.0 - 0.9 * foam;
    // The soft shore: the water fades to nothing as its gap to the bed closes, so its edge lies in a
    // band against the bed rather than on the mesh's own edge.
    s.alpha = smoothstep(0.0, material.softness, gap);
    return s;
}
