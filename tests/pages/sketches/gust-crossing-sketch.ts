// The gust that a page sends, as a reader of the steady field sees it: a line of samples across the
// ground, read before the gust, one second after it and two seconds after it. The pass evaluates the
// same steady block that the grass, the leaves and the water carry, so a peak that moves along the
// heading is the sent gust crossing the ground. The page keeps no grid, which is Creek's WebGL2
// path, so every sample is the steady field's own arithmetic.
import { defineFeature, defineSketch, type RenderPass, type SketchContext } from '@null3d/engine';
import { createWind } from '@null3d/wind';

/** The samples across the ground, in texels. */
const LINE = 64;
/** The first sample's place along x, in meters, and the distance between samples. */
const FROM = -20;
const STEP = 1;
/** The strength of the gust that the page sends, and the line's height over the ground. */
const STRENGTH = 10;
const HEIGHT = 1.5;
/** The second that the page sends its gust, and the two seconds that it reads the line. */
const SENT_AT = 0.6;
const FIRST_READ = 1.6;
const SECOND_READ = 2.6;

/** The compute form: one sample of the steady field at each texel of the line. */
const COMPUTE = /* wgsl */ `
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
@group(0) @binding(1) var output: texture_storage_2d<rgba16float, write>;


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
/// The air's steady settings that a reader takes, with the gust that a page sent in the fourth
/// vector. This mirrors the reading function that the readers carry; the pass never samples the
/// grid, so it needs none of the sampling function's texture.
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

@compute @workgroup_size(64, 1)
fn main(@builtin(global_invocation_id) id: vec3u) {
    if (id.x >= u32(block.size.x)) {
        return;
    }
    let air = wind_reading(block.u0, block.u1, block.u2, block.u3, block.clock.x);
    let along = block.u4;
    let x = along.x + (f32(id.x) - along.z) * along.y;
    let p = vec3f(x, along.w, 0.0);
    let withSent = wind_steady(air, p);
    // The same place with no gust sent, so the two differ by the sent gust alone: the base wind and
    // the swirl cancel, and no drift of the swirl hides where the gust stands.
    var plain = air;
    plain.sentStrength = 0.0;
    let without = wind_steady(plain, p);
    textureStore(output, vec2i(id.xy), vec4f(withSent.x - without.x, withSent.z - without.z, 0.0, 0.0));
}
`;

/** The form that WebGL2 runs in place of the compute pass. */
const FALLBACK = /* wgsl */ `
#import null3d::noise::{value3}

struct Uniforms {
    u0: vec4f,
    u1: vec4f,
    u2: vec4f,
    u3: vec4f,
    u4: vec4f,
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
/// The air's steady settings that a reader takes, with the gust that a page sent in the fourth
/// vector. This mirrors the reading function that the readers carry; the pass never samples the
/// grid, so it needs none of the sampling function's texture.
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

fn effect(input: EffectInput) -> vec4f {
    let air = wind_reading(uniforms.u0, uniforms.u1, uniforms.u2, uniforms.u3, input.time);
    let along = uniforms.u4;
    let x = along.x + (input.pixel.x - along.z) * along.y;
    let p = vec3f(x, along.w, 0.0);
    let withSent = wind_steady(air, p);
    // The same place with no gust sent, so the two differ by the sent gust alone.
    var plain = air;
    plain.sentStrength = 0.0;
    let without = wind_steady(plain, p);
    return vec4f(withSent.x - without.x, withSent.z - without.z, 0.0, 0.0);
}
`;

export default defineSketch((ctx: SketchContext) => {
	const { scene, render } = ctx;
	// A fixed camera over the line, so the field's box and its clock stand still.
	const camera = scene.createPerspectiveCamera({
		position: [0, 8, 24],
		target: [0, 0, 0],
		fov: 45,
	});
	scene.setActiveCamera(camera);
	const wind = createWind(ctx, { camera, box: 128, grid: 0 });
	// The pass's values: the four reading vectors, then the line's first place, its step, the sample
	// that stands at the gust's place, and the line's height.
	const values = new Array<number>(20).fill(0);
	const put = (): void => {
		for (let i = 0; i < 4; i++) {
			values[i] = wind.field.air.base[i] as number;
			values[4 + i] = wind.field.air.gust[i] as number;
			values[8 + i] = wind.field.air.swirl[i] as number;
			values[12 + i] = wind.field.air.sent[i] as number;
		}
		values[16] = FROM;
		values[17] = STEP;
		values[18] = -FROM / STEP;
		values[19] = HEIGHT;
	};
	put();
	const pass: RenderPass = render.addPass({
		kind: 'compute',
		description: defineFeature({
			name: 'gust-crossing',
			frame: 'background',
			kind: 'compute',
			outputs: { line: { default: 'black' } },
		}),
		wgsl: COMPUTE,
		fallback: { wgsl: FALLBACK },
		format: 'rgba16float',
		size: [LINE, 1],
		values,
	});

	// The graph drops a pass that nothing reads, so one effect at the end of the frame samples the
	// line and keeps it alive. It adds a share too small to see.
	const consume = /* wgsl */ `
var lineTex: texture_2d_array<f32>;

fn effect(input: EffectInput) -> vec4f {
    let speed = textureSampleLevel(lineTex, lineTexSampler, vec2f(input.uv.x, 0.5), 0, 0.0).a;
    return input.color + vec4f(speed) * 0.0001;
}
`;
	ctx.post.addEffect({ wgsl: consume, textures: { lineTex: ctx.textures.fromPass(pass) } });

	const reads: { at: number; step: string; speeds: number[] }[] = [];
	/** The reads started so far: a read waits a frame or more for its answer, so the count of them is
	 * not the count of the reads that have started. */
	let started = 0;
	let sent = false;
	const read = (now: number, step: string): void => {
		put();
		render.setPassUniforms(pass, values);
		render.readPass(pass, { x: 0, y: 0, width: LINE, height: 1 }).then(
			(result) => {
				const speeds: number[] = [];
				for (let i = 0; i < LINE; i++) speeds.push(result.data[i * 4 + 1] as number);
				reads.push({ at: now, step, speeds });
				if (reads.length === 2)
					ctx.page.post('gust', {
						reads,
						sent: [...wind.field.air.sent],
						base: [...wind.field.air.base],
						gust: [...wind.field.air.gust],
					});
			},
			(error: unknown) => ctx.page.post('gust', { error: String(error) }),
		);
	};
	return {
		onUpdate() {
			const now = ctx.time.now;
			wind.update();
			if (now >= SENT_AT && !sent) {
				sent = true;
				wind.gust([0, 0], STRENGTH);
			}
			if (now >= FIRST_READ && started === 0) {
				read(now, 'one');
				started = 1;
			}
			if (now >= SECOND_READ && started === 1) {
				read(now, 'two');
				started = 2;
			}
		},
	};
});
