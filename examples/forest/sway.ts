// The trees' sway: the material that draws the forest, whose trunk and crown bend in the wind
// add-on's one field, and the settings that material reads.
import type { Material, SketchContext, Texture } from '@null3d/engine';
import type { Wind } from '@null3d/wind';

/** The distance from the camera out to which the trees sway, in meters. */
export const SWAY_DISTANCE = 120;

/**
 * The trees' material: the wood and leaf map, lit as the standard material lights it, with the
 * trunk bending in the wind add-on's field. One field moves every tree whose material names it, and
 * the offset fades out by the sway distance so a far tree stands still and keeps its shadow in the
 * cached far cascade.
 */
const treeShader = /* wgsl */ `
#import null3d::noise::{value3}

var wood: texture_2d<f32>;
var wind: texture_2d_array<f32>;
var airSettings: texture_2d<f32>;

struct Uniforms {
    // The field's box across the ground, in meters, and 0 without a field.
    windBox: f32,
    // 0 for a material that names no field, and 1 for one that reads it.
    windStrength: f32,
    // The layer of the field's texture that holds the newest state.
    windLayer: f32,
    // The height over which the trunk's bend grows, in meters.
    height: f32,
    // How far from the camera the tree sways, in meters.
    swayDistance: f32,
    // The most that the top of the trunk moves in a brisk wind, as a share of its height.
    sway: f32,
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

fn vertexOffset(input: VertexInput) -> vec3f {
    if (material.windStrength <= 0.0) {
        return vec3f(0.0);
    }
    let root = object.position;
    let away = length(root - camera.position);
    let fade = 1.0 - smoothstep(material.swayDistance * 0.8, material.swayDistance, away);
    if (fade <= 0.0) {
        return vec3f(0.0);
    }
    let reading = wind_reading(
        textureLoad(airSettings, vec2i(0, 0), 0),
        textureLoad(airSettings, vec2i(1, 0), 0),
        textureLoad(airSettings, vec2i(2, 0), 0),
        textureLoad(airSettings, vec2i(3, 0), 0),
        frame.time,
    );
    let air = wind_sample(
        vec3f(root.x, 2.0, root.z),
        camera.position.xz - vec2f(material.windBox * 0.5),
        material.windBox,
        i32(material.windLayer),
        reading,
    );
    let across = air.xz;
    let speed = length(across);
    if (speed <= 1e-5) {
        return vec3f(0.0);
    }
    let dir = across / speed;
    // A trunk bends as a cantilever, most at its top, and each tree flutters a little on its own.
    let rise = clamp(input.position.y / max(material.height, 0.001), 0.0, 1.0);
    let flutter = 0.8 + 0.2 * sin(frame.time * 1.7 + dot(root.xz, vec2f(0.37, 0.11)));
    let bend = rise * rise * material.sway * min(speed, 14.0) * flutter;
    return vec3f(dir.x, 0.0, dir.y) * (bend * fade);
}

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let texel = textureSample(wood, woodSampler, input.uv);
    s.baseColor = texel.rgb * s.baseColor;
    return s;
}
`;

/** The forest's material, and the frame that keeps its wind layer current. */
export function createSway(
	ctx: SketchContext,
	options: { readonly wood: Texture; readonly wind: Wind },
): { readonly material: Material; update(): void } {
	const { materials, textures } = ctx;
	const { wood, wind } = options;
	/** The sent gust's born time that the settings texture holds, so one gust costs one upload. */
	let sentBorn = Number.NaN;
	const airSettings = textures.fromData({
		width: 4,
		height: 1,
		format: 'rgba16float',
		data: airSettingsData(wind.field.air),
	});
	const material = materials.shader({
		wgsl: treeShader,
		roughness: 0.85,
		vertexColors: true,
		doubleSided: true,
		swayDistance: SWAY_DISTANCE,
		textures: { wood, wind: wind.field.texture, airSettings },
		uniforms: {
			windBox: wind.field.size,
			windStrength: 1,
			windLayer: 0,
			height: 18,
			swayDistance: SWAY_DISTANCE,
			sway: 0.06,
		},
	});
	return {
		material,
		update() {
			material.setUniform('windLayer', wind.field.texture.layer);
			// A gust that a page sends travels through the steady field, which the settings carry. The
			// texels go up when a gust is sent, not once a frame.
			if ((wind.field.air.sent[3] as number) !== sentBorn) {
				sentBorn = wind.field.air.sent[3] as number;
				airSettings.update(airSettingsData(wind.field.air));
			}
		},
	};
}

/** The data of the field's settings, four texels of four numbers each. */
function airSettingsData(air: {
	readonly base: readonly number[];
	readonly gust: readonly number[];
	readonly swirl: readonly number[];
	readonly sent: readonly number[];
}): Float32Array {
	const data = new Float32Array(16);
	data.set(air.base.slice(0, 4), 0);
	data.set(air.gust.slice(0, 4), 4);
	data.set(air.swirl.slice(0, 4), 8);
	data.set(air.sent.slice(0, 4), 12);
	return data;
}
