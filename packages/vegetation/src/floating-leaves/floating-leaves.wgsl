// The floating and falling leaves in the offset form: each leaf follows a closed-form path from its
// seed and the frame's time, and the wind field pushes it where it passes. One texture read a frame
// moves each leaf, and no state passes between frames. A leaf that a gust meets is pushed sideways
// at once; it keeps no speed of its own, so it cannot ride a gust along its path.
#import null3d::noise::{random, value3}

var leafMap: texture_2d<f32>;
var wind: texture_2d_array<f32>;
var airSettings: texture_2d<f32>;

struct Uniforms {
    /// The top of the fall and the ground under it, in meters.
    height: f32,
    low: f32,
    /// The seconds that a leaf takes to fall.
    fall: f32,
    /// The leaf's size in meters.
    size: f32,
    /// The scene's seed, which gives each leaf its own phase.
    seed: f32,
    /// How far a meter a second of air carries a leaf across its fall.
    drift: f32,
    /// The turns a second that a leaf makes as it falls.
    spin: f32,
    /// The field's box across the ground, in meters, and 0 for the steady field everywhere.
    windBox: f32,
    /// The layer of the field's texture that holds the newest state.
    windLayer: f32,
    /// The linear colour that multiplies the leaf's own.
    tint: vec3f,
}

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

/// One turn, for the phases that the leaves carry.
const TURN: f32 = 6.283185307179586;

/// The leaf's place and turn at this frame, from its own seed and the time.
fn leaf_state(input: VertexInput) -> vec4f {
    let index = input.instance;
    let phase = random(index + u32(material.seed));
    let age = fract(frame.time / max(material.fall, 0.001) + phase);
    let y = mix(material.height, material.low, age);
    let turn = frame.time * material.spin + phase * TURN;
    return vec4f(y, turn, age, phase);
}

fn vertexOffset(input: VertexInput) -> vec3f {
    let state = leaf_state(input);
    let y = state.x;
    let turn = state.y;
    let age = state.z;
    let phase = state.w;
    // The leaf turns about the vertical as it falls, so its two faces catch the light in turn.
    let c = cos(turn);
    let s = sin(turn);
    let turned = vec3f(
        input.position.x * c - input.position.z * s,
        input.position.y,
        input.position.x * s + input.position.z * c,
    );
    // The air where the leaf falls, and the way it carries the leaf across the fall.
    let base = vec2f(object.position.x, object.position.z);
    let reading = wind_reading(
        textureLoad(airSettings, vec2i(0, 0), 0),
        textureLoad(airSettings, vec2i(1, 0), 0),
        textureLoad(airSettings, vec2i(2, 0), 0),
        textureLoad(airSettings, vec2i(3, 0), 0),
        frame.time,
    );
    let air = wind_sample(
        vec3f(base.x, y, base.y),
        camera.position.xz - vec2f(material.windBox * 0.5),
        material.windBox,
        i32(material.windLayer),
        reading,
    );
    let drift = vec2f(air.x, air.z) * (material.drift * age * material.fall);
    // A leaf sways across its fall under the air that reaches it, on a path of its own.
    let sway = vec2f(sin(turn * 0.7 + phase * 9.0), cos(turn * 0.6 + phase * 5.0)) * 0.25;
    let place = vec3f(base.x + drift.x + sway.x, y, base.y + drift.y + sway.y);
    return (place - object.position) + turned * material.size - input.position;
}

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let leaf = textureSample(leafMap, leafMapSampler, input.uv);
    s.baseColor = leaf.rgb * material.tint;
    s.alpha = leaf.a;
    s.roughness = 0.7;
    s.metalness = 0;
    return s;
}
