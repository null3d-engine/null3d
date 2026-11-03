// The grass's blades and their bend: a tuft's blades are strips that lean out and curve over, lit
// by the ground's light, and the air of the wind add-on's one field bends them. The field's steady
// settings come from a small data texture, as the leaf material reads them, and the picture that a
// still field draws stands still.

// The wind's swirl reads the engine's value noise, as the leaf material's copy of the block does.
#import null3d::noise::{pcg, value3}

struct Uniforms {
    // The field's box across the ground, in meters, and how strong the air is: 1 for a field, 0
    // for a material that names none.
    windBox: f32,
    windStrength: f32,
    // The layer of the field's texture that holds the newest state, which a page sets each frame.
    windLayer: f32,
    // How far the air's speed bends a blade at its tip, in meters a second.
    sway: f32,
    // The distance from the camera out to which the blades sway, in meters: 0 for every distance.
    swayDistance: f32,
    // 1 draws the far share and widens its blades, as the compute path does; 0 draws every tuft.
    cull: f32,
}

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

// <tuft-density>
/// The share of a tuft that the far ground draws, from all of it near the camera to this share far
/// from it, and the distances where the share falls. A tuft's place keeps one share, and its
/// blades widen by the inverse, so the hill's cover stays the same.
const DENSITY_FAR: f32 = 0.25;
const DENSITY_START: f32 = 10.0;
const DENSITY_END: f32 = 25.59;

/// A value from 0 up to 1 from a tuft's root place, the same on every device.
fn tuft_hash(place: vec3f) -> f32 {
    let x = bitcast<u32>(i32(round(place.x * 8.0)));
    let z = bitcast<u32>(i32(round(place.z * 8.0)));
    return f32(pcg(x ^ pcg(z ^ 0x9e3779b9u))) / 4294967295.0;
}

/// The share of the tufts that draw at a root's place: all of them near the camera, and the far
/// share at the fade's end.
fn tuft_density(place: vec3f, eye: vec3f) -> f32 {
    return mix(1.0, DENSITY_FAR, smoothstep(DENSITY_START, DENSITY_END, length(place - eye)));
}

/// True when a tuft at `place` draws, from its hash against the share at its distance.
fn tuft_kept(place: vec3f, eye: vec3f) -> bool {
    return tuft_hash(place) < tuft_density(place, eye);
}
// </tuft-density>

/// A tuft's reach from its root, in meters: the farthest that a blade of the biggest tuft lies from
/// the root, which a view's edge test keeps wholly.
const TUFT_REACH: f32 = 1.0;

fn vertexOffset(input: VertexInput) -> vec3f {
    let root = object.position;
    // A far tuft draws a share of the time. The tufts that the share leaves out collapse to their
    // root, so WebGL2's batch draws the same hill that the compute list builds.
    var width = 1.0;
    if (material.cull > 0.5) {
        if (!tuft_kept(root, camera.position)) {
            return -input.position;
        }
        // A view draws only the tufts inside its own box: the camera's view its frustum, and a
        // light's view its cascade, whose box reaches toward the light over the casters. The root
        // and a point a tuft's reach away go through the view's matrix, so the margin that the
        // blades need comes from the view's own scale. The instance's row holds the root relative
        // to the camera, which is the space that the matrix takes.
        let relative = object.worldMatrix[3].xyz;
        let clip = engine_frame.view_proj * vec4f(relative, 1.0);
        let above = engine_frame.view_proj * vec4f(relative + vec3f(0.0, TUFT_REACH, 0.0), 1.0);
        let across = engine_frame.view_proj * vec4f(relative + vec3f(TUFT_REACH, 0.0, 0.0), 1.0);
        let reach = max(
            max(abs(above.x - clip.x), abs(above.y - clip.y)),
            max(abs(across.x - clip.x), abs(across.y - clip.y)),
        );
        if (clip.w <= 0.0
            || clip.x < -clip.w - reach || clip.x > clip.w + reach
            || clip.y < -clip.w - reach || clip.y > clip.w + reach) {
            return -input.position;
        }
        width = 1.0 / tuft_density(root, camera.position);
    }
    var offset = vec3f(0.0);
    if (material.windStrength > 0.0) {
        // The air at the blade's root: the field's grid where it covers the root, and its steady
        // field beyond the box.
        let base = textureLoad(airSettings, vec2i(0, 0), 0);
        let gust = textureLoad(airSettings, vec2i(1, 0), 0);
        let swirl = textureLoad(airSettings, vec2i(2, 0), 0);
        let sent = textureLoad(airSettings, vec2i(3, 0), 0);
        let reading = wind_reading(base, gust, swirl, sent, frame.time);
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
        // The air's direction in the tuft's own space, so a turned tuft bends downwind.
        let local = object.normalMatrix * vec3f(across.x, 0.0, across.y);
        let reach = length(local);
        if (speed > 0.0 && reach > 0.00001) {
            let downwind = local / reach;
            // The blade bends most at its tip, and the air's speed sets how far.
            var bend = input.uv.y * input.uv.y * material.sway * speed;
            // The tuft's whole crown fades with its origin's distance from the camera, so a tuft
            // past the sway distance stands still and its shadow keeps the layer that a far
            // cascade cached.
            if (material.swayDistance > 0.0) {
                let away = length(root - camera.position);
                bend *= 1.0 - smoothstep(material.swayDistance * 0.8, material.swayDistance, away);
            }
            if (bend > 0.0) {
                offset = vec3f(downwind.x * bend, -0.4 * bend * bend, downwind.z * bend);
            }
        }
    }
    // Widen the strip about its radial centerline, so the far share covers the ground that the
    // tufts it leaves out would have covered.
    if (width > 1.0) {
        let radial = normalize(input.position.xz);
        let side = input.position.xz - radial * dot(input.position.xz, radial);
        offset.x += side.x * (width - 1.0);
        offset.z += side.y * (width - 1.0);
    }
    return offset;
}

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let tint = tuft_hash(object.position);
    // A share of the tufts dry toward their tips, and each tuft's green differs a little.
    let dry = smoothstep(0.62, 1.0, tint) * input.uv.y;
    s.baseColor *= mix(vec3f(0.8 + 0.4 * tint), vec3f(1.7, 1.3, 0.45), dry);
    // Both faces light as the upper face, since the blades' normals lean up.
    s.normal = select(input.normal, -input.normal, input.normal.y < 0.0);
    return s;
}
