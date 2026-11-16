// A reader of the wind field, for the cost of one more texture read for each vertex: a flag that
// ripples from its pole, or a lake whose surface lifts under the air. ?reader= picks the reader and
// ?read=off draws it with the field's read left out, so the page's two runs differ by that read
// alone. The scene holds still in every other way: a fixed camera, one sun, and no other lit work
// that changes between the runs.
import { defineSketch, type SketchContext } from '@null3d/engine';
import { createWater, type Water } from '@null3d/water';
import { createWind } from '@null3d/wind';

const params = new URL(import.meta.url).searchParams;
/** The reader that the page draws: a flag or a water surface. */
const READER = params.get('reader') === 'water' ? 'water' : 'flag';
/** True to read the field; ?read=off draws the reader without it. */
const READS = params.get('read') !== 'off';

/** The flag's material: a cloth that ripples from its pole and leans downwind. */
const flagShader = /* wgsl */ `
#import null3d::noise::{value3}
var wind: texture_2d_array<f32>;
var airSettings: texture_2d<f32>;

struct Uniforms {
    amount: f32,
    speed: f32,
    windBox: f32,
    windStrength: f32,
    windLayer: f32,
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
    let reach = input.uv.x;
    let t = frame.time * material.speed;
    let ripple = sin(t - reach * 7.0) + 0.35 * sin(t * 1.9 - reach * 13.0 + input.uv.y * 3.0);
    var offset = vec3f(0.0, -0.18 * reach * reach, ripple * material.amount * reach);
    if (material.windStrength > 0.0) {
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
        offset += vec3f(air.x, 0.0, air.z) * (reach * reach * 0.06);
    }
    return offset;
}
`;

export default defineSketch((ctx: SketchContext) => {
	const { scene, geometry, materials, page } = ctx;
	scene.setBackground({ sky: { sunPosition: [0.4, 0.5, -0.6], cloudCoverage: 0.2 } });
	const camera = scene.createPerspectiveCamera({
		fov: 42,
		near: 0.5,
		far: 400,
		position: [6, 4.5, 12],
		target: [0, 2.5, 0],
	});
	scene.setActiveCamera(camera);
	scene.createDirectionalLight({ direction: [-0.5, -1, -0.3], intensity: 3, castShadows: true });
	scene.createAmbientLight({ intensity: 0.45 });
	const wind = createWind(ctx, { camera, box: 64, grid: 64 });

	const ground = scene.createMesh({
		mesh: geometry.plane({ width: 200, height: 200 }),
		material: materials.standard({ color: '#5f6b4a', roughness: 1 }),
		rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
		receiveShadows: true,
	});
	void ground;

	/** What the page switches and steps: the flag's strength, or the water's own update. */
	let setRead = (_on: boolean): void => {};
	let update = (): void => {};

	if (READER === 'flag') {
		const pole = scene.createMesh({
			mesh: geometry.cylinder({ radiusTop: 0.05, radiusBottom: 0.07, height: 7 }),
			material: materials.standard({ color: '#8a8078', roughness: 0.6, metalness: 0.3 }),
			position: [0, 3.5, 0],
			castShadows: true,
		});
		void pole;
		const airSettings = readingTexture(ctx, wind.field.air);
		const material = materials.shader({
			wgsl: flagShader,
			color: '#7d1f1a',
			roughness: 0.9,
			doubleSided: true,
			textures: { wind: wind.field.texture, airSettings },
			uniforms: {
				amount: 0.28,
				speed: 4.2,
				windBox: wind.field.size,
				windStrength: READS ? 1 : 0,
				windLayer: 0,
			},
		});
		const cloth = scene.createMesh({
			mesh: geometry.plane({ width: 2.6, height: 1.6, widthSegments: 24, heightSegments: 10 }),
			material,
			position: [1.3, 5.25, 0],
			castShadows: true,
			receiveShadows: true,
		});
		// The cloth swings out of its mesh's own sphere.
		cloth.setBounds([1.3, 0.8, 0], 2.4);
		setRead = (on) => material.setUniform('windStrength', on ? 1 : 0);
		update = () => {
			wind.update();
			material.setUniform('windLayer', wind.field.texture.layer);
		};
	} else {
		let water: Water | undefined;
		water = createWater(ctx, {
			shapes: {
				kind: 'lake',
				shore: [
					[-30, -20],
					[30, -22],
					[34, 16],
					[-28, 20],
				],
				depth: 4,
			},
			bed: 'shape',
			wind: READS ? wind.field : undefined,
		});
		setRead = () => {};
		update = () => {
			wind.update();
			water?.update();
		};
	}

	page.onMessage((name, data) => {
		if (name !== 'read') return;
		const on = (data as { on?: boolean } | undefined)?.on !== false;
		setRead(on);
		page.post('read', { on });
	});

	return {
		onUpdate() {
			update();
		},
	};
});

/** The texture that holds the field's steady settings, three texels of four numbers each. */
function readingTexture(
	ctx: SketchContext,
	air: {
		readonly base: readonly number[];
		readonly gust: readonly number[];
		readonly swirl: readonly number[];
		readonly sent: readonly number[];
	},
) {
	const data = new Float32Array(16);
	data.set(air.base.slice(0, 4), 0);
	data.set(air.gust.slice(0, 4), 4);
	data.set(air.swirl.slice(0, 4), 8);
	data.set(air.sent.slice(0, 4), 12);
	return ctx.textures.fromData({ width: 4, height: 1, format: 'rgba16float', data });
}
