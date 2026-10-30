// The wind's grid in its WebGL2 form: the fragment shader that a device without compute shaders
// runs in place of `grid.wgsl`. It steps the same solver, reads the state of the run before as the
// pass's input image, and writes the same numbers, so a reader's sampling is the same on every
// path.
//
// The blocks between the markers are byte for byte those of `grid.wgsl` and `shaders/field.wgsl`,
// which a test compares. The values' positions match the compute block's: `u0` of the one starts at
// the same float as `u0` of the other.
#import null3d::noise::{value3}

struct Uniforms {
    u0: vec4f,
    u1: vec4f,
    u2: vec4f,
    u3: vec4f,
    u4: vec4f,
    u5: vec4f,
    u6: vec4f,
    u7: vec4f,
}

/// The pass's size in texels, which the entry sets before it steps the solver.
var<private> wind_size: vec2f = vec2f(1.0, 1.0);

/// The state of one texel of the run before, in the grid's rows. The pass's input image holds that
/// state, and its places count rows from the top, where the grid's count from the bottom.
fn wind_read(at: vec2i) -> vec4f {
    let uv = (vec2f(f32(at.x) + 0.5, wind_size.y - 0.5 - f32(at.y))) / wind_size;
    return effectColor(uv);
}

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

// <wind-events>
/// How long a push lasts before it has faded away, in seconds.
const WIND_PUSH_LIFE: f32 = 3.0;

/// The air that one push slot turns at a place, in meters a second.
fn wind_push(air: WindAir, pushRadius: f32, slot: vec4f, p: vec3f) -> vec3f {
    if (slot.z == 0.0) { return vec3f(0.0); }
    let age = air.time - slot.w;
    if (age < 0.0 || age > WIND_PUSH_LIFE) { return vec3f(0.0); }
    let dx = p.x - slot.x;
    let dz = p.z - slot.y;
    let reach = pushRadius * pushRadius;
    let turn = exp(-(dx * dx + dz * dz) / reach) * (1.0 - age / WIND_PUSH_LIFE);
    let strength = slot.z * turn * wind_profile(air, p.y);
    return vec3f((dz / pushRadius) * strength, 0.0, -(dx / pushRadius) * strength);
}

/// The air that the gust slot turns at a place, in meters a second: a wave about a center that has
/// travelled along the heading since the gust was sent.
fn wind_gust(air: WindAir, slot: vec4f, p: vec3f) -> vec3f {
    if (slot.z == 0.0) { return vec3f(0.0); }
    let travel = air.gustSpeed * (air.time - slot.w);
    let dx = p.x - slot.x - cos(air.heading) * travel;
    let dz = p.z - slot.y - sin(air.heading) * travel;
    let distance = sqrt(dx * dx + dz * dz) / air.gustRadius;
    let reach = distance * distance;
    if (reach >= 9.0) { return vec3f(0.0); }
    let turn = exp(-reach) * cos(distance * air.gustWave);
    let strength = slot.z * turn * wind_profile(air, p.y);
    return vec3f((dz / air.gustRadius) * strength, 0.0, -(dx / air.gustRadius) * strength);
}

/// The air's velocity at a world place, in meters a second: the steady field, the three pushes and
/// the gust. The solver pulls the air toward this field and starts each cycle from it.
fn wind_analytic(
    air: WindAir, pushRadius: f32, slot0: vec4f, slot1: vec4f, slot2: vec4f, gust: vec4f, p: vec3f,
) -> vec3f {
    var v = wind_steady(air, p);
    let pushes = array<vec4f, 3>(slot0, slot1, slot2);
    for (var i = 0u; i < 3u; i = i + 1u) {
        let turned = wind_push(air, pushRadius, pushes[i], p);
        v.x += turned.x;
        v.z += turned.z;
    }
    let blown = wind_gust(air, gust, p);
    v.x += blown.x;
    v.z += blown.z;
    return v;
}
// </wind-events>

// <wind-solver>
/// The Jacobi iterations that one cycle runs before it projects the air.
const WIND_PRESSURE_STEPS: i32 = 20;
/// The runs that one cycle takes: the forces and the advection, the pressure's iterations, and the
/// projection.
const WIND_CYCLE: i32 = WIND_PRESSURE_STEPS + 2;
/// How fast the air is pulled toward the analytic field each second. The pull is weak enough that
/// what the air carried from the frames before stays a while.
const WIND_PULL: f32 = 0.8;
/// How hard the vorticity confinement keeps the eddies that advection would smooth away.
const WIND_VORTICITY: f32 = 0.35;

/// The state of one texel: the air across the ground, the pressure, and the stage of the cycle.
struct WindState {
    v: vec2f,
    pressure: f32,
    stage: i32,
}

/// The state of a texel, which one outside the grid reads the nearest texel inside.
fn wind_state(at: vec2i, size: vec2u) -> WindState {
    let texel = wind_read(clamp(at, vec2i(0), vec2i(size) - 1));
    return WindState(vec2f(texel.r, texel.g), texel.b, i32(texel.a + 0.5));
}

/// The curl of the air about the up axis, in a second, at a texel.
fn wind_curl(at: vec2i, size: vec2u, cell: f32) -> f32 {
    let right = wind_state(at + vec2i(1, 0), size).v;
    let left = wind_state(at - vec2i(1, 0), size).v;
    let up = wind_state(at + vec2i(0, 1), size).v;
    let down = wind_state(at - vec2i(0, 1), size).v;
    return (right.y - left.y) / (2.0 * cell) - (up.x - down.x) / (2.0 * cell);
}

/// The air's velocity of the next cycle at a texel: the analytic field pulls the air that the
/// advection carried, the vorticity confinement turns the eddies, and the pressure starts again.
fn wind_advect(
    air: WindAir, box: vec4f, dt: f32, slots: array<vec4f, 4>,
    at: vec2i, size: vec2u, state: WindState,
) -> WindState {
    let cell = box.z / f32(size.x);
    let world = vec2f(box.x, box.y) + (vec2f(at) + 0.5) * cell;
    let pullTo = wind_analytic(
        air, box.w, slots[0], slots[1], slots[2], slots[3],
        vec3f(world.x, WIND_FULL_HEIGHT, world.y),
    );
    // The advection: the air here comes from where the velocity a step back points.
    let source = (world - state.v * dt - vec2f(box.x, box.y)) / cell - vec2f(0.5);
    let base = vec2i(floor(source));
    let f = fract(source);
    let s00 = wind_state(base, size).v;
    let s10 = wind_state(base + vec2i(1, 0), size).v;
    let s01 = wind_state(base + vec2i(0, 1), size).v;
    let s11 = wind_state(base + vec2i(1, 1), size).v;
    let carried = mix(mix(s00, s10, f.x), mix(s01, s11, f.x), f.y);
    // The first run starts from an empty state, so it takes the analytic air whole.
    let seed = length(state.v) == 0.0;
    let pull = select(1.0 - exp(-WIND_PULL * dt), 1.0, seed);
    var v = mix(carried, pullTo.xz, pull);
    // The vorticity confinement: the curl's gradient, crossed with the curl, pushes the eddies.
    let curl = wind_curl(at, size, cell);
    let right = wind_curl(at + vec2i(1, 0), size, cell);
    let left = wind_curl(at - vec2i(1, 0), size, cell);
    let up = wind_curl(at + vec2i(0, 1), size, cell);
    let down = wind_curl(at - vec2i(0, 1), size, cell);
    let gradient = vec2f(right - left, up - down) / (2.0 * cell);
    let magnitude = max(length(gradient), 1e-6);
    let n = gradient / magnitude;
    v += vec2f(n.y, -n.x) * WIND_VORTICITY * cell * curl * dt;
    // The box's edge takes the analytic air exactly, so the far field and the grid meet there. A
    // cell beside the edge carries advected air, which lags a push, so beside a push the two differ.
    if (at.x == 0 || at.y == 0 || at.x == i32(size.x) - 1 || at.y == i32(size.y) - 1) {
        v = pullTo.xz;
    }
    return WindState(v, 0.0, 1);
}

/// One Jacobi iteration of the pressure, whose right side is the air's divergence.
fn wind_pressure(
    box: vec4f, dt: f32, at: vec2i, size: vec2u, state: WindState,
) -> WindState {
    let cell = box.z / f32(size.x);
    let left = wind_state(at - vec2i(1, 0), size);
    let right = wind_state(at + vec2i(1, 0), size);
    let down = wind_state(at - vec2i(0, 1), size);
    let up = wind_state(at + vec2i(0, 1), size);
    let divergence = ((right.v.x - left.v.x) + (up.v.y - down.v.y)) / (2.0 * cell);
    let pressure = (left.pressure + right.pressure + up.pressure + down.pressure
        - cell * cell * divergence / dt) * 0.25;
    return WindState(state.v, pressure, state.stage + 1);
}

/// The last stage: the air loses the pressure's slope, and the cycle starts again.
fn wind_project(box: vec4f, dt: f32, at: vec2i, size: vec2u, state: WindState) -> WindState {
    let cell = box.z / f32(size.x);
    let left = wind_state(at - vec2i(1, 0), size).pressure;
    let right = wind_state(at + vec2i(1, 0), size).pressure;
    let down = wind_state(at - vec2i(0, 1), size).pressure;
    let up = wind_state(at + vec2i(0, 1), size).pressure;
    let slope = vec2f(right - left, up - down) / (2.0 * cell);
    return WindState(state.v - slope * dt, state.pressure, 0);
}

/// One run of the solver at a texel: the stage that the state names, as the next state.
fn wind_step(
    air: WindAir, box: vec4f, dt: f32, slots: array<vec4f, 4>,
    at: vec2i, size: vec2u, state: WindState,
) -> WindState {
    if (state.stage == 0) { return wind_advect(air, box, dt, slots, at, size, state); }
    if (state.stage <= WIND_PRESSURE_STEPS) {
        return wind_pressure(box, dt, at, size, state);
    }
    return wind_project(box, dt, at, size, state);
}
// </wind-solver>

fn effect(input: EffectInput) -> vec4f {
    wind_size = input.size;
    // The effect's pixels count from the top left, and the grid's rows from the bottom.
    let size = vec2u(input.size);
    let at = vec2i(i32(input.pixel.x), i32(input.size.y) - 1 - i32(input.pixel.y));
    let before = wind_read(at);
    let state = WindState(vec2f(before.r, before.g), before.b, i32(before.a + 0.5));
    var air = wind_air(uniforms.u0, uniforms.u1, uniforms.u2);
    air.time = input.time;
    // The slots arrive in the fourth to seventh vectors; the first three hold the settings.
    let slots = array<vec4f, 4>(uniforms.u3, uniforms.u4, uniforms.u5, uniforms.u6);
    let next = wind_step(air, uniforms.u7, uniforms.u0.x, slots, at, size, state);
    return vec4f(next.v.x, next.v.y, next.pressure, f32(next.stage));
}
