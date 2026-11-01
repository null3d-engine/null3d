// The leaves' state, stepped by the wind: one texel for each leaf's place across the ground and its
// speed. Each run reads the state of the run before and moves the leaf toward the air that it meets,
// so a gust carries a leaf along its path and a wake lasts after the gust has gone. The leaf's fall
// is closed form, from the sketch time and the leaf's own phase, so the state holds only the two
// places and the two speeds.
#import null3d::noise::{random, value3}

struct ComputeBlock {
    size: vec4f,
    clock: vec4f,
    inverseProjection: mat4x4f,
    u0: vec4f,
    u1: vec4f,
    u2: vec4f,
    u3: vec4f,
    u4: vec4f,
    u5: vec4f,
    u6: vec4f,
    u7: vec4f,
    drawn: vec4f,
    bloom: vec4f,
}

@group(0) @binding(0) var<uniform> block: ComputeBlock;
@group(0) @binding(1) var state: texture_storage_2d_array<rgba16float, write>;
@group(0) @binding(2) var history: texture_2d_array<f32>;
// Group 1 holds the pass's eight texture slots first, then their samplers. The field is the first
// texture, so its sampler sits after all eight slots.
@group(1) @binding(0) var wind: texture_2d_array<f32>;
@group(1) @binding(8) var windSampler: sampler;

// <wind-steady>
/// The height over which the air slows to the ground, in meters.
const WIND_GROUND_HEIGHT: f32 = 2.0;
/// The distance over which the noise's curl is measured, in noise cells.
const WIND_CURL_STEP: f32 = 0.02;
/// The height that the grid samples at, where the air moves at its full speed. The grid stores the
/// air at this height, and a reader outside the grid's box works it out at the same height, so the
/// two meet at the box's edge.
const WIND_FULL_HEIGHT: f32 = 100.0;

/// The air's steady settings: its rule of place and time, without the pushes and gusts that a page
/// sends. The grid takes them from a pass's first three value vectors, and a reader from its own
/// uniforms.
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

/// The wind's steady velocity at a world place, in meters a second: the base wind, the gust that
/// travels through it and the swirl, without the pushes and gusts that a page sends.
fn wind_steady(air: WindAir, p: vec3f) -> vec3f {
    let height = wind_profile(air, p.y);
    let cosHeading = cos(air.heading);
    let sinHeading = sin(air.heading);
    var v = vec3f(cosHeading * air.speed * height, 0.0, sinHeading * air.speed * height);

    // The gust: a wave of turns that travels along the heading. The turns are rings about the
    // gust's center and depend only on the distance to it, so a ring of air turns without piling up.
    let travel = air.gustSpeed * air.time;
    let g = vec2f(p.x - cosHeading * travel, p.z - sinHeading * travel);
    let distance = length(g) / air.gustRadius;
    let reach = distance * distance;
    if (reach < 9.0) {
        let envelope = exp(-reach) * cos(distance * air.gustWave) * air.gustStrength * height;
        v.x += (g.y / air.gustRadius) * envelope;
        v.z -= (g.x / air.gustRadius) * envelope;
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
/// the second and the swirl in the third, with the time that the reader's own frame gives.
fn wind_reading(base: vec4f, gust: vec4f, swirl: vec4f, time: f32) -> WindAir {
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

/// The state of one leaf: its place across the ground and its speed, in meters and meters a second.
fn leaf_step(at: vec2i, index: u32) -> vec4f {
    let before = textureLoad(history, at, 0, 0);
    let base = block.u0;
    let gust = block.u1;
    let swirl = block.u2;
    let box = block.u3;
    let area = block.u4;
    let home = block.u6;
    let seed = u32(block.u5.x);
    let air = wind_reading(base, gust, swirl, block.clock.x);
    let phase = random(index + seed);
    // The page gives the step from its own frame, so the WebGL2 form steps by the same time.
    let dt = clamp(block.u5.y, 0.0, 0.1);
    let fall = max(area.z, 0.001);
    let age = fract(block.clock.x / fall + phase);
    var place = vec2f(before.x, before.y);
    var speed = vec2f(before.z, before.w);
    // A leaf starts again at the top of its fall: a fresh place from its own seed and the lap, and
    // the air's speed there. The first run sees a zero state, which also starts every leaf.
    let first = before.x == 0.0 && before.y == 0.0;
    if (first || age < dt / fall) {
        let lap = u32(max(floor(block.clock.x / fall + phase), 0.0));
        let a = random(index * 3u + seed + lap * 7u);
        let b = random(index * 5u + seed + lap * 11u);
        place = home.xy + vec2f(a, b) * max(home.z, 0.001);
        speed = vec2f(0.0);
    }
    let reading = wind_sample(
        vec3f(place.x, WIND_FULL_HEIGHT, place.y),
        box.xy,
        box.z,
        i32(box.w),
        air,
    );
    let aim = vec2f(reading.x, reading.z);
    speed += (aim - speed) * min(area.w * dt, 1.0);
    place += speed * dt;
    // The box follows the camera. A leaf that reaches an edge comes back at the other, so the air
    // keeps the same number of leaves in view wherever the camera goes.
    if (home.z > 0.0) {
        let local = (place - home.xy) / home.z;
        let wrapped = local - floor(local);
        place = home.xy + wrapped * home.z;
    }
    return vec4f(place.x, place.y, speed.x, speed.y);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
    let size = vec2u(block.drawn.xy);
    if (id.x >= size.x || id.y >= size.y) {
        return;
    }
    let index = id.y * size.x + id.x;
    textureStore(state, vec2i(id.xy), id.z, leaf_step(vec2i(id.xy), index));
}
