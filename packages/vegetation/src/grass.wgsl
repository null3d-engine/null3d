// The grass's blades and their bend: a tuft's blades are strips that lean out and curve over, lit
// by the ground's light, and the air of the wind add-on's one field bends them. The field's steady
// settings come from a small data texture, as the leaf material reads them, and the picture that a
// still field draws stands still.

// The wind's swirl reads the engine's value noise, as the leaf material's copy of the block does.
#import null3d::noise::{value3}

struct Uniforms {
    // The field's box across the ground, in meters, and how strong the air is: 1 for a field, 0
    // for a material that names none.
    windBox: f32,
    windStrength: f32,
    // The layer of the field's texture that holds the newest state, which a page sets each frame.
    windLayer: f32,
    // How far the air's speed bends a blade at its tip, in meters a second.
    sway: f32,
}

var wind: texture_2d_array<f32>;
var airSettings: texture_2d<f32>;

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

fn vertexOffset(input: VertexInput) -> vec3f {
    if (material.windStrength <= 0.0) {
        return vec3f(0.0);
    }
    // The air at the blade's root: the field's grid where it covers the root, and its steady
    // field beyond the box.
    let base = textureLoad(airSettings, vec2i(0, 0), 0);
    let gust = textureLoad(airSettings, vec2i(1, 0), 0);
    let swirl = textureLoad(airSettings, vec2i(2, 0), 0);
    let reading = wind_reading(base, gust, swirl, frame.time);
    let place = (object.worldMatrix * vec4f(input.position, 1.0)).xyz + camera.position;
    let at = wind_sample(
        place,
        camera.position.xz - vec2f(material.windBox * 0.5),
        material.windBox,
        i32(material.windLayer),
        reading,
    );
    let across = vec2f(at.x, at.z);
    let speed = at.a;
    if (speed <= 0.0) {
        return vec3f(0.0);
    }
    // The air's direction in the tuft's own space, so a turned tuft bends downwind.
    let local = object.normalMatrix * vec3f(across.x, 0.0, across.y);
    let reach = length(local);
    if (reach <= 0.00001) {
        return vec3f(0.0);
    }
    let downwind = local / reach;
    // The blade bends most at its tip, and the air's speed sets how far.
    let bend = input.uv.y * input.uv.y * material.sway * speed;
    return vec3f(downwind.x * bend, -0.4 * bend * bend, downwind.z * bend);
}

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let traits = object.values;
    // A share of the tufts dry toward their tips, and each tuft's green differs a little.
    let dry = smoothstep(0.62, 1.0, traits.y) * input.uv.y;
    s.baseColor *= mix(vec3f(0.8 + 0.4 * traits.y), vec3f(1.7, 1.3, 0.45), dry);
    // Both faces light as the upper face, since the blades' normals lean up.
    s.normal = select(input.normal, -input.normal, input.normal.y < 0.0);
    return s;
}
