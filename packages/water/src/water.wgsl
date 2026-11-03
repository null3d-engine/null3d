// The water's surface: long waves that the current carries, finer ripples in the normal, a mirror of
// the banks and the sky, caustics on the bed, foam where the water breaks, and a shore that fades
// where the bed rises to meet the surface. The scene's own depth behind each pixel gives the water
// its depth, so a shore ends softly against the bed instead of on the mesh's edge. The same surface
// draws from below, where it shows the world above through a window overhead and turns the light
// back past that window's edge. Where two bodies' meshes overlap, the junction map names the one
// that draws each point, and both meshes mix the river's waves into still water's alike.
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

/// Caustics: bright, thin ridges where the ripples focus the light, which drift with the current.
fn caustics(p: vec2f, t: f32, current: vec2f) -> f32 {
    let q = p * 4.6 - current * (t * 4.0);
    let a = sin(q.x * 3.1 + t * 1.3 + sin(q.y * 2.3 - t));
    let b = sin(q.y * 3.7 - t * 1.1 + sin(q.x * 1.9 + t * 0.7));
    let c = sin((q.x + q.y) * 2.6 + t * 0.9 + sin(q.x * 1.3 - q.y * 0.7));
    let v = (a + b + c) / 3.0;
    // Patches of brighter and fainter light keep the net from looking even.
    return pow(1.0 - abs(v), 14.0) * (0.35 + 0.65 * value2(p * 0.8 + vec2f(t * 0.1, 0.0)));
}

/// The flecks that break the foam around the stones, which the current carries downstream.
fn foam_flecks(p: vec2f, flow: vec2f, t: f32) -> f32 {
    let drift = p * vec2f(5.0, 9.0) - flow * (t * 6.0);
    return 0.6 * value2(drift) + 0.4 * value2(drift * 2.3 + 7.0);
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
/// travel with the water. Still water keeps the authored directions and each wave's own speed. A
/// wave's slope fades as the wave grows finer than `footprint`, the meters that one pixel covers, so
/// a slope that a pixel cannot resolve never turns into noise that changes each frame.
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
        // Carried: the current moves the whole pattern. Still: each wave runs at its own speed.
        let still = w.z * dot(own, p) - w.w * t;
        let carried = w.z * (dot(dir, p) - current.z * t * dot(current.xy, dir));
        let phase = select(still, carried, moving);
        h += amplitude * sin(phase);
        let resolved = 1.0 - smoothstep(0.75, 2.0, w.z * footprint);
        slope += dir * (amplitude * w.z * cos(phase) * resolved);
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
    s.normal = normalize(vec3f(-w.y, 1.0, -w.z));
    let clip = camera.viewProjection * vec4f(input.relativePosition, 1.0);
    let mirrorUv = reflection_uv(clip, w.yz * 0.08);
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
    // downstream, and moving noise breaks it into flecks that the current carries away.
    let foamUv = (p - material.foamOrigin) / material.foamSize;
    let near = textureSampleLevel(foamMap, foamMapSampler, foamUv, 0.0).r;
    var flecks = foam_flecks(p, current.xy * current.z, frame.time);
    if share < 1.0 {
        flecks = mix(foam_flecks(p, vec2f(0.0), frame.time), flecks, share);
    }
    let stoneFoam = 0.85 * smoothstep(0.45, 0.95, near * (0.3 + 1.0 * flecks));
    let foam = max(edgeFoam, stoneFoam);
    s.baseColor = mix(s.baseColor, vec3f(0.8), foam);
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
        s.transmission = mix(0.8, 1.0, window) * (1.0 - 0.7 * foam);
        s.baseColor = mix(vec3f(0.08, 0.16, 0.15), s.baseColor, window);
        s.alpha = 1.0;
        return s;
    }
    // The caustics show on the bed, under clear water that is not too deep, and not under foam.
    let bed = p + w.yz * depth * 0.6;
    let reach = smoothstep(0.02, 0.15, depth) * exp(-depth * 1.4) * (1.0 - foam);
    var light = caustics(bed, frame.time, current.xy * current.z);
    if share < 1.0 {
        light = mix(caustics(bed, frame.time, vec2f(0.0)), light, share);
    }
    s.emissive += material.caustics * light * reach;
    s.transmission = 1.0 - 0.7 * foam;
    // The soft shore: the water fades to nothing as its gap to the bed closes, so its edge lies in a
    // band against the bed rather than on the mesh's own edge.
    s.alpha = smoothstep(0.0, material.softness, gap);
    return s;
}
