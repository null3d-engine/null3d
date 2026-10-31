// The branch poses of a plant variant, for the frame's near trees: a compute pass that turns each
// branch once, instead of once for every vertex in every pass that draws the plant. The pass keeps
// two states, so the branch springs read the turn and the speed of the run before, and the leaf and
// bark offsets read this frame's pose from one state and the frame before's from the other.
//
// The target holds three kinds of row. The header row maps a copy's row in its batch to the pose
// slot that it takes, so a far copy reads no slot and stands still. The second row holds the field's
// steady settings, which a material reads beyond the field's box. Each slot after them holds one
// branch's pose in four texels: its accumulated turn as a quaternion, its move, its spring and
// flutter, and the flutter's settings.
//
// A branch turns about the axis across the air, as the per-vertex sway does, so both methods move a
// branch the same way. The angle follows the steady sway through a spring, so a branch lags a gust
// and springs back after it. The air is one sample at the tree's base, not one for each vertex.
//
// The block between the steady-field markers is byte for byte the same as the one in the wind
// add-on's files, and so is the sampling block. A test compares them.

#import null3d::noise::{value3}

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
@group(0) @binding(1) var poses: texture_storage_2d_array<rgba16float, write>;
@group(0) @binding(2) var before: texture_2d_array<f32>;

// The maps, in the order that the pass gives them: the field, the variant's branch records and the
// near trees' places and matrices.
@group(1) @binding(0) var wind: texture_2d_array<f32>;
@group(1) @binding(1) var records: texture_2d_array<f32>;
@group(1) @binding(2) var trees: texture_2d_array<f32>;
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

/// The first row of the target: the pose slot that each of a batch's rows takes, plus one, or zero
/// for a row that stands past the sway distance.
const HEADER_ROW: i32 = 0;
/// The second row: the field's steady settings, which a material reads beyond the field's box.
const AIR_ROW: i32 = 1;
/// The first row of a pose slot.
const FIRST_POSE_ROW: i32 = 2;
/// The texels that one branch's pose takes.
const POSE_TEXELS: u32 = 3u;
/// The most branch levels that a plant may hold, as the material's offset walks no further.
const MAX_BRANCH_DEPTH: u32 = 8u;

/// How far a branch turns about its pivot for each meter a second of wind, as the material's own
/// sway gives it.
const BRANCH_BEND: f32 = 0.02;
/// The rate at which a trunk's turn follows the wind, in radians a second.
const SPRING_TRUNK: f32 = 5.5;
/// The rate that each branch level adds, so a twig answers faster than a bough.
const SPRING_LEVEL: f32 = 2.5;
/// How strongly a branch resists its own motion: below one it overshoots and springs back.
const SPRING_DAMPING: f32 = 0.35;
/// The longest step that a spring takes at once, in seconds.
const SPRING_STEP: f32 = 1.0 / 60.0;
/// The most runs that one frame's spring takes, so a stalled page skips the air that it missed.
const SPRING_MAX_RUNS: i32 = 8;

/// One texel of a branch's record in the variant's table: a record is four texels.
fn record(branch: u32, texel: u32) -> vec4f {
    return textureLoad(records, vec2i(i32(branch * POSE_TEXELS + texel), 0), 0, 0);
}

/// The quaternion that turns by `angle` radians about the unit `axis`.
fn turn_quaternion(axis: vec3f, angle: f32) -> vec4f {
    let s = sin(angle * 0.5);
    return vec4f(axis * s, cos(angle * 0.5));
}

/// The product of two quaternions: the rotation that `b` applies, then `a`.
fn quat_mul(a: vec4f, b: vec4f) -> vec4f {
    return vec4f(
        a.w * b.xyz + b.w * a.xyz + cross(a.xyz, b.xyz),
        a.w * b.w - dot(a.xyz, b.xyz),
    );
}

/// `point` turned by the unit quaternion `q`.
fn quat_turn(q: vec4f, point: vec3f) -> vec3f {
    let along = cross(q.xyz, point);
    return point + 2.0 * (q.w * along + cross(q.xyz, along));
}

/// One branch's spring for this frame, from the turn and the speed of the run before: the angle
/// that it reaches, and the speed that it reaches it with.
fn spring(angle: f32, speed: f32, wanted: f32, omega: f32, dt: f32) -> vec2f {
    var a = angle;
    var v = speed;
    let runs = clamp(i32(ceil(dt / SPRING_STEP)), 1, SPRING_MAX_RUNS);
    let step = dt / f32(runs);
    for (var i = 0; i < runs; i++) {
        let accel = omega * omega * (wanted - a) - 2.0 * SPRING_DAMPING * omega * v;
        v += accel * step;
        a += v * step;
    }
    return vec2f(a, v);
}

/// True when the target holds no real work, such as a pass that the page has not filled yet.
fn empty(pixels: vec2u) -> bool {
    return pixels.x == 0u || pixels.y == 0u;
}

@compute @workgroup_size(1, 1, 1)
fn main(@builtin(global_invocation_id) id: vec3u) {
    let pixels = vec2u(block.drawn.xy);
    if (empty(pixels)) { return; }
    let slot = id.x;
    let used = u32(block.u3.w + 0.5);
    let branches = u32(block.u4.x + 0.5);
    let width = pixels.x;

    // The first invocation clears the header and writes the field's settings, which every material
    // reads. It writes the header for each near tree from the slot table's own rows.
    if (slot == 0u) {
        for (var x = 0u; x < width; x += 1u) {
            textureStore(poses, vec2i(i32(x), HEADER_ROW), 0, vec4f(0.0));
        }
        for (var s = 0u; s < used; s += 1u) {
            let instance = u32(textureLoad(trees, vec2i(3, i32(s)), 0, 0).w + 0.5);
            if (instance < width) {
                textureStore(poses, vec2i(i32(instance), HEADER_ROW), 0, vec4f(f32(s) + 1.0, 0.0, 0.0, 0.0));
            }
        }
        textureStore(poses, vec2i(0, AIR_ROW), 0, block.u0);
        textureStore(poses, vec2i(1, AIR_ROW), 0, block.u1);
        textureStore(poses, vec2i(2, AIR_ROW), 0, block.u2);
    }
    if (slot >= used || branches == 0u) { return; }

    // The tree's place and its normal matrix, whose rows turn the air into the plant's own space.
    let place = textureLoad(trees, vec2i(0, i32(slot)), 0, 0);
    let normal_0 = textureLoad(trees, vec2i(1, i32(slot)), 0, 0).xyz;
    let normal_1 = textureLoad(trees, vec2i(2, i32(slot)), 0, 0).xyz;
    let normal_2 = textureLoad(trees, vec2i(3, i32(slot)), 0, 0).xyz;
    let air = wind_reading(block.u0, block.u1, block.u2, block.clock.x);
    let at = wind_sample(place.xyz, vec2f(block.u3.x, block.u3.y), block.u3.z, i32(block.u4.z), air);
    let across = vec3f(at.x, 0.0, at.z);
    let reach = length(across);
    var downwind = vec3f(0.0, 0.0, 1.0);
    var speed = at.a;
    if (reach > 0.00001) {
        let turned = vec3f(dot(normal_0, across), dot(normal_1, across), dot(normal_2, across));
        let length_object = length(turned);
        if (length_object > 0.00001) {
            downwind = turned / length_object;
        } else {
            speed = 0.0;
        }
    } else {
        speed = 0.0;
    }
    let row = i32(FIRST_POSE_ROW) + i32(slot);
    let fresh = place.w > 0.5;
    let dt = clamp(block.u4.w, 0.0, 0.1);
    let time = block.clock.x;

    // One turn for the whole tree: the branch poses accumulate from the trunk down, so a parent is
    // always posed before its children, which the records order that way.
    var rotation = vec4f(0.0, 0.0, 0.0, 1.0);
    var translation = vec3f(0.0);
    for (var branch = 0u; branch < branches; branch += 1u) {
        let first = record(branch, 0u);
        let second = record(branch, 1u);
        let third = record(branch, 2u);
        let fourth = record(branch, 3u);
        let stiffness = second.w;
        let level = third.z;
        let wanted = stiffness * speed * BRANCH_BEND * sin(time * third.y + fourth.x);
        let was = textureLoad(before, vec2i(i32(branch * POSE_TEXELS + 1u), row), 0, 0);
        let rate = textureLoad(before, vec2i(i32(branch * POSE_TEXELS + 2u), row), 0, 0);
        var angle = was.w;
        var spring_speed = rate.x;
        if (fresh) {
            angle = wanted;
            spring_speed = 0.0;
        } else {
            let omega = SPRING_TRUNK + SPRING_LEVEL * level;
            let turned = spring(angle, spring_speed, wanted, omega, dt);
            angle = turned.x;
            spring_speed = turned.y;
        }
        let axis = normalize(vec3f(first.w, second.x, second.y) + vec3f(0.0, 1.0, 0.0) * 0.000001);
        let swing = cross(axis, downwind);
        var turn_value = vec4f(0.0, 0.0, 0.0, 1.0);
        if (length(swing) > 0.001) {
            turn_value = turn_quaternion(normalize(swing), angle);
        }
        let pivot = first.xyz;
        let own = pivot - quat_turn(turn_value, pivot);
        let parent_rotation = rotation;
        rotation = quat_mul(parent_rotation, turn_value);
        translation = quat_turn(parent_rotation, own) + translation;
        let x = i32(branch * POSE_TEXELS);
        textureStore(poses, vec2i(x, row), 0, rotation);
        textureStore(poses, vec2i(x + 1, row), 0, vec4f(translation, angle));
        textureStore(poses, vec2i(x + 2, row), 0, vec4f(spring_speed, third.x, third.y, 0.0));
    }
}
