// The wind's grid: one compute pass fills a texture with the air's velocity over a box of ground
// that follows the camera. Readers sample that texture instead of evaluating the field at each
// vertex, so a plant, a flag and a smoke card all read the same air with one texture read.
//
// The grid holds the air at the height of a tree's crown. A reader scales it by its own height's
// factor, which `wind_profile` gives, and works out the same air beyond the box, which
// `shaders/field.wgsl` holds.
//
// The block between the steady-field markers is byte for byte the same as the one in
// `grid.fallback.wgsl` and in `shaders/field.wgsl`. A test compares them and fails when one is
// edited alone.
#import null3d::noise::{value3}

/// The block that every compute and full-screen pass receives: the render and canvas sizes, the
/// clock, the inverse projection, the pass's own values and its texture's size.
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
@group(0) @binding(1) var field: texture_storage_2d_array<rgba16float, write>;

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
/// the gust.
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

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
    let size = vec2u(block.drawn.xy);
    if (id.x >= size.x || id.y >= size.y) { return; }
    let air = wind_air(block.u0, block.u1, block.u2);
    // The box's near corner across the ground, its size and the push radius, from the eighth vector.
    let box = block.u7;
    let uv = (vec2f(id.xy) + 0.5) / vec2f(size);
    let place = vec3f(box.x + uv.x * box.z, WIND_FULL_HEIGHT, box.y + uv.y * box.z);
    let v = wind_analytic(air, box.w, block.u3, block.u4, block.u5, block.u6, place);
    // The texture holds the wind across the ground and, in its fourth channel, how fast the air
    // moves there, which a leaf reads to flutter harder in a gust.
    textureStore(field, vec2i(id.xy), 0, vec4f(v.x, v.y, v.z, length(v)));
}
