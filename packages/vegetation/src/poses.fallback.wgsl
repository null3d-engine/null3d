// The branch poses in the WebGL2 form that a device without compute shaders runs in place of
// `poses.wgsl`: every texel of the target is drawn by one fragment, and each pose texel works out
// its branch's turn from the records and the state of the run before, which the pass's input image
// holds. The numbers are the same as the compute form's, so a material reads one layout on every
// path: the header row, the field's settings, then a row for each near tree.
//
// The blocks between the markers are byte for byte those of the wind add-on's files, which a test
// compares.
#import null3d::noise::{value3}

struct Uniforms {
    u0: vec4f,
    u1: vec4f,
    u2: vec4f,
    u3: vec4f,
    u4: vec4f,
}

// The maps, in the order that the pass gives them: the field, the variant's branch records and the
// near trees' places and matrices.
var wind: texture_2d_array<f32>;
var records: texture_2d<f32>;
var trees: texture_2d<f32>;

/// The target's size in texels, which the entry sets before it works out its texel.
var<private> target_size: vec2u = vec2u(1u, 1u);
/// The sketch time that the effect's entry sets, which the steady field reads.
var<private> effect_time: f32 = 0.0;

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
const HEADER_ROW: u32 = 0u;
/// The second row: the field's steady settings, which a material reads beyond the field's box.
const AIR_ROW: u32 = 1u;
/// The first row of a pose slot.
const FIRST_POSE_ROW: u32 = 2u;
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
    return textureLoad(records, vec2i(i32(branch * POSE_TEXELS + texel), 0), 0);
}

/// One texel of a near tree's place and matrices, from the slot table.
fn tree(slot: u32, texel: u32) -> vec4f {
    return textureLoad(trees, vec2i(i32(texel), i32(slot)), 0);
}

/// The state of the run before at texel `x` of row `row`, which the pass's input image holds. The
/// image counts its rows from the top, where the target counts them from the bottom.
fn before_at(x: u32, row: u32) -> vec4f {
    let place = vec2f(f32(x) + 0.5, f32(target_size.y) - 0.5 - f32(row)) / vec2f(f32(target_size.x), f32(target_size.y));
    return effectColor(place);
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

/// The air at the tree's base, in the plant's own space: the direction across the wind, and the
/// speed that turns its branches.
struct TreeAir {
    /// The air's direction across the ground, in the plant's own space, made unit.
    downwind: vec3f,
    /// The air's speed there, in meters a second.
    speed: f32,
}

fn tree_air(slot: u32) -> TreeAir {
    let place = tree(slot, 0u);
    let normal_0 = tree(slot, 1u).xyz;
    let normal_1 = tree(slot, 2u).xyz;
    let normal_2 = tree(slot, 3u).xyz;
    // The sketch time comes from the effect's input, so the steady field reads it here.
    var air = wind_reading(uniforms.u0, uniforms.u1, uniforms.u2, effect_time);
    let at = wind_sample(
        place.xyz,
        vec2f(uniforms.u3.x, uniforms.u3.y),
        uniforms.u3.z,
        i32(uniforms.u4.z),
        air,
    );
    let across = vec3f(at.x, 0.0, at.z);
    var result: TreeAir;
    result.speed = at.a;
    result.downwind = vec3f(0.0, 0.0, 1.0);
    if (length(across) > 0.00001) {
        let turned = vec3f(dot(normal_0, across), dot(normal_1, across), dot(normal_2, across));
        let length_object = length(turned);
        if (length_object > 0.00001) {
            result.downwind = turned / length_object;
        } else {
            result.speed = 0.0;
        }
    } else {
        result.speed = 0.0;
    }
    return result;
}

fn effect(input: EffectInput) -> vec4f {
    target_size = vec2u(input.size);
    effect_time = input.time;
    let texel = vec2u(clamp(input.pixel, vec2f(0.5), input.size - 0.5));
    let x = texel.x;
    let row = target_size.y - 1u - texel.y;
    let used = u32(uniforms.u3.w + 0.5);
    let branches = u32(uniforms.u4.x + 0.5);

    if (row == HEADER_ROW) {
        // The header names the slot of each copy that stands near enough to move. Every header
        // texel looks for its own copy among the slot table's rows.
        for (var s = 0u; s < used; s += 1u) {
            if (u32(tree(s, 3u).w + 0.5) == x) {
                return vec4f(f32(s) + 1.0, 0.0, 0.0, 0.0);
            }
        }
        return vec4f(0.0);
    }
    if (row == AIR_ROW) {
        if (x == 0u) { return uniforms.u0; }
        if (x == 1u) { return uniforms.u1; }
        if (x == 2u) { return uniforms.u2; }
        return vec4f(0.0);
    }
    let slot = row - FIRST_POSE_ROW;
    if (slot >= used || branches == 0u) { return vec4f(0.0); }
    let branch = x / POSE_TEXELS;
    if (branch >= branches) { return vec4f(0.0); }
    let part = x % POSE_TEXELS;

    let first = record(branch, 0u);
    let second = record(branch, 1u);
    let third = record(branch, 2u);
    let air = tree_air(slot);
    let fresh = tree(slot, 0u).w > 0.5;
    let dt = clamp(uniforms.u4.w, 0.0, 0.1);
    let time = effect_time;

    // The branch's own spring, then those of its ancestors, which the pose of this branch carries.
    var chain: array<u32, MAX_BRANCH_DEPTH>;
    var angles: array<f32, MAX_BRANCH_DEPTH>;
    var speeds: array<f32, MAX_BRANCH_DEPTH>;
    var depth = 0u;
    var at = branch;
    loop {
        if (at >= branches || depth >= MAX_BRANCH_DEPTH) { break; }
        chain[depth] = at;
        let held = record(at, 1u);
        let third = record(at, 2u);
        let fourth = record(at, 3u);
        let wanted = held.w * air.speed * BRANCH_BEND * sin(time * third.y + fourth.x);
        let was = before_at(at * POSE_TEXELS + 1u, row);
        let rate = before_at(at * POSE_TEXELS + 2u, row);
        if (fresh) {
            angles[depth] = wanted;
            speeds[depth] = 0.0;
        } else {
            let omega = SPRING_TRUNK + SPRING_LEVEL * third.z;
            let turned = spring(was.w, rate.x, wanted, omega, dt);
            angles[depth] = turned.x;
            speeds[depth] = turned.y;
        }
        depth += 1u;
        // Only the turn needs the ancestors, so the spring and flutter texel stops here.
        if (part == 2u) { break; }
        let parent = i32(held.z + 0.5);
        if (parent < 0) { break; }
        at = u32(parent);
    }
    if (part == 2u) {
        return vec4f(speeds[0], third.x, third.y, 0.0);
    }
    // The turn accumulates from the trunk down, so the root's turn applies last.
    var rotation = vec4f(0.0, 0.0, 0.0, 1.0);
    var translation = vec3f(0.0);
    for (var k = depth; k > 0u; k -= 1u) {
        let i = k - 1u;
        let entry = chain[i];
        let own_record = record(entry, 0u);
        let held = record(entry, 1u);
        let axis = normalize(vec3f(own_record.w, held.x, held.y) + vec3f(0.0, 1.0, 0.0) * 0.000001);
        let swing = cross(axis, air.downwind);
        var turn_value = vec4f(0.0, 0.0, 0.0, 1.0);
        if (length(swing) > 0.001) {
            turn_value = turn_quaternion(normalize(swing), angles[i]);
        }
        let pivot = own_record.xyz;
        let own = pivot - quat_turn(turn_value, pivot);
        let parent_rotation = rotation;
        rotation = quat_mul(parent_rotation, turn_value);
        translation = quat_turn(parent_rotation, own) + translation;
    }
    if (part == 0u) { return rotation; }
    return vec4f(translation, angles[0]);
}
