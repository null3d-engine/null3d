// The wind add-on's own page, which the listing check opens and the image tests draw. A field of
// cards stands in for plants: each card reads the air at its own place in every vertex, so a gust
// that crosses the field makes the cards lean and a body that moves through them leaves a wake.
//
// Switches: `?frozen=1` takes the gust and the swirl out, so the air is a steady wind and nothing
// moves between two times. `?still=1` stops the body after a second, so its wake stays where it
// made it. `?camera=still` holds the camera, so the air alone moves the picture. `?box=0` gives the
// reader no grid, which is what a device without float targets gets, so every card works its air
// out from the steady field. `?push=0` stops the body from shoving the air, which gives a picture
// its control. `?capture=<seconds>` makes the sketch ask the page for the frame once it reaches
// that time.
import { defineSketch, type SketchContext } from '@null3d/engine';
import { createWind } from '../src/index.ts';

const params = new URL(import.meta.url).searchParams;
const FROZEN = params.get('frozen') === '1';
const STILL = params.get('still') === '1';
/** A still camera leaves the field as the only thing that can move the picture. */
const STILL_CAMERA = params.get('camera') === 'still';
/** The box's width across the ground, which zero turns off so that the reader works out the air. */
const BOX = Number(params.get('box') ?? 96);
/** True while the body shoves the air, which a control's page turns off. */
const PUSHES = params.get('push') !== '0';
/** The time at which the page captures its frame, or none. */
const CAPTURE = params.get('capture');

/** The cards: how many, and how far they stand from the middle. */
const CARDS = 3_000;
const GROUND = 36;
/** The body that moves through the air, and how often it shoves it. */
const BODY_SPEED = 0.9;
const BODY_PUSH_MS = 250;
/**
 * Where the camera starts: across the wind, so a card's lean shows on screen instead of pointing at
 * the eye.
 */
const START = Math.PI / 2;
/** The place of the one gust, and the place each push is made at, kept so no frame allocates one. */
const GUST_AT: [number, number] = [-20, -14];
const PUSH_AT: [number, number] = [0, 0];

/** The card's material: a plane whose top leans with the air at its foot. */
const card = /* wgsl */ `
#import null3d::noise::{value3}

var wind: texture_2d_array<f32>;

struct Uniforms {
    // The field's box: its near corner across the ground, its width, and how much the cards lean.
    origin: vec2f,
    size: f32,
    sway: f32,
    // How much slower the air is at the ground.
    ground: f32,
    // The steady settings that the sampling function works the air out from beyond the box.
    base: vec4f,
    gust: vec4f,
    swirl: vec4f,
    // The first layer of the state that the grid's last run wrote.
    layer: i32,
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
    let place = object.position + input.position;
    let air = wind_reading(material.base, material.gust, material.swirl, frame.time);
    let air_at_place = wind_sample(place, material.origin, material.size, material.layer, air);
    // The air slows near the ground, and a card's top leans more than its foot.
    let height = 1.0 - material.ground * exp(-max(place.y, 0.0) / WIND_GROUND_HEIGHT);
    return vec3f(air_at_place.r, 0.0, air_at_place.b) * (material.sway * height * input.uv.y);
}
`;

export default defineSketch((ctx: SketchContext) => {
	const { scene, geometry, time } = ctx;
	scene.setBackground({ sky: { sunPosition: [0.4, 0.5, -0.6], cloudCoverage: 0.2 } });
	const camera = scene.createPerspectiveCamera({
		fov: 42,
		near: 0.5,
		far: 400,
		position: [0, 6.5, 22],
		target: [0, 1.2, 0],
	});
	scene.setActiveCamera(camera);
	scene.createDirectionalLight({ direction: [-0.5, -1, -0.3], intensity: 3, castShadows: true });
	scene.createAmbientLight({ intensity: 0.45 });

	const wind = createWind(ctx, {
		camera,
		box: BOX,
		grid: 64,
		air: FROZEN ? { gustStrength: 0, swirl: 0 } : { gustSpeed: 16 },
	});

	scene.createMesh({
		mesh: geometry.plane({ width: GROUND * 2, height: GROUND * 2 }),
		material: ctx.materials.standard({ color: '#5f6b4a', roughness: 1 }),
		rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
		receiveShadows: true,
	});

	// The box follows the camera, so the cards' uniforms follow the box. One object and one pair
	// of numbers hold them, and the material copies what `set` gives it. The steady settings do not
	// change in this page, so the material takes them once.
	const cardValues = { origin: [wind.field.origin[0], wind.field.origin[1]] as [number, number] };
	const cardMaterial = ctx.materials.shader({
		wgsl: card,
		color: '#cfd6a8',
		roughness: 0.85,
		textures: { wind: wind.field.texture },
		uniforms: {
			origin: cardValues.origin,
			size: wind.field.size,
			sway: 0.12,
			ground: FROZEN ? 0 : 0.5,
			base: wind.field.air.base,
			gust: wind.field.air.gust,
			swirl: wind.field.air.swirl,
			layer: wind.field.texture.layer,
		},
	});
	const cards = scene.createInstances(
		geometry.plane({ width: 0.3, height: 1.1, heightSegments: 4 }),
		CARDS,
		{
			material: cardMaterial,
			castShadows: true,
		},
	);
	const positions = cards.positions as Float32Array;
	for (let i = 0; i < CARDS; i++) {
		// A ring of cards with a hole in the middle, so the body has room to pass through.
		const angle = i * 2.399_963_2;
		const radius = 3 + Math.sqrt(i / CARDS) * GROUND;
		positions[i * 3] = Math.cos(angle) * radius;
		positions[i * 3 + 1] = 0;
		positions[i * 3 + 2] = Math.sin(angle) * radius;
	}
	cards.markDirty();

	const material = ctx.materials.standard({ color: '#c4562f', roughness: 0.5, metalness: 0.2 });
	const body = scene.createMesh({
		mesh: geometry.sphere({ radius: 0.9 }),
		material,
		dynamic: true,
		castShadows: true,
	});
	let pushed = 0;
	let sent = false;
	let captured = false;
	let elapsed = 0;

	return {
		onUpdate(dt: number) {
			elapsed += dt;
			// The frozen page holds the body and the camera still, so the only thing that could
			// move the cards is the air. The still page lets the body go until a second in, so its
			// wake stays behind it.
			const moving = !FROZEN && (!STILL || elapsed < 1);
			const turn = (FROZEN || STILL ? Math.min(elapsed, 1) : elapsed) * BODY_SPEED;
			const x = Math.cos(turn) * 9;
			const z = Math.sin(turn) * 9;
			body.setPosition(x, 1.4, z);
			// The body shoves the air as it goes, so the wake trails behind it.
			if (PUSHES && moving && time.now - pushed > BODY_PUSH_MS / 1000) {
				PUSH_AT[0] = x;
				PUSH_AT[1] = z;
				wind.push(PUSH_AT, 4);
				pushed = time.now;
			}
			// One gust arrives from upwind, so the cards change as it passes over them.
			if (!FROZEN && !sent && time.now > 0) {
				wind.gust(GUST_AT);
				sent = true;
			}
			wind.update();
			cardValues.origin[0] = wind.field.origin[0];
			cardValues.origin[1] = wind.field.origin[1];
			cardMaterial.set(cardValues);
			// The pass keeps two states, and the newest one moves between them as the cycles run.
			cardMaterial.setUniform('layer', wind.field.texture.layer);
			// The camera circles slowly, so the cost gate measures frames that change.
			const view = START + (FROZEN || STILL_CAMERA ? 0 : 0.12 * elapsed);
			camera.setPosition(Math.cos(view) * 22, 6.5, Math.sin(view) * 22);
			camera.lookAt(0, 1.2, 0);
			if (CAPTURE !== null && !captured && time.now >= Number(CAPTURE)) {
				captured = true;
				ctx.page.post('capture');
			}
		},
	};
});
