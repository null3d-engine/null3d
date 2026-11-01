// The creek's grass: tufts of curved blades in instance batches, which cast and receive the sun's
// shadows. A vertex offset bends each blade in the wind: gusts that roll across the banks, and a
// flutter of each tuft's own. The surface function tints each tuft. Each row's values carry its
// tuft's traits: its phase in the wind, its tint, and its turn about y, which the vertex offset
// undoes for the wind, so the wind blows one way over every tuft. The shadow passes run the same
// vertex offset, so the shadows sway with the grass. Only the tufts near the water cast shadows and
// show in its reflection. The blades take no contact shadows: the march would take each thin blade
// for a solid wall, darken the grass and make it shimmer as it sways. The ground keeps the blades'
// contact shadows at their roots.
import {
	type InstanceBatch,
	type MeshArrays,
	type QualityPreset,
	quat,
	type SketchContext,
	type Texture,
	type Textures,
} from '@null3d/engine';
import type { WindField } from '@null3d/wind';
import { random } from '../../lib/procedural';
import { fromStream, groundHeight, streamHalf, streamZ, UNREFLECTED_LAYER, WATER } from './land';

/** Tufts of grass at each preset, over the three tuft shapes. */
export const TUFTS: Record<QualityPreset, number> = {
	low: 3000,
	medium: 9000,
	high: 18000,
	ultra: 27000,
};
/** The shapes of tuft, each one batch. */
const SHAPES = 3;
/** Blades in each tuft, and the segments of each blade. */
const BLADES = 13;
const SEGMENTS = 3;

const wgsl = /* wgsl */ `
#import null3d::noise::{value3}

var wind: texture_2d_array<f32>;
var airSettings: texture_2d<f32>;

struct Uniforms {
    sway: f32,
    // The field's box across the ground, in meters, and 0 without a field.
    windBox: f32,
    // 0 for grass that names no field, and 1 for grass that reads one.
    windStrength: f32,
    // The layer of the field's texture that holds the newest state.
    windLayer: f32,
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

// A tuft's row values: x is its phase in the wind, from 0 to 2 pi, y a value from 0 to 1 that picks
// its tint, and z and w the cosine and sine of its turn about y.

fn vertexOffset(input: VertexInput) -> vec3f {
    if (material.windStrength <= 0.0) {
        return vec3f(0.0);
    }
    let traits = object.values;
    // The air at the tuft's root. Every reader of the field reads it the same way, so a gust that
    // crosses the bank bends the grass and the leaves together.
    let root = object.position;
    let reading = wind_reading(
        textureLoad(airSettings, vec2i(0, 0), 0),
        textureLoad(airSettings, vec2i(1, 0), 0),
        textureLoad(airSettings, vec2i(2, 0), 0),
        frame.time,
    );
    let air = wind_sample(
        vec3f(root.x, 0.5, root.z),
        camera.position.xz - vec2f(material.windBox * 0.5),
        material.windBox,
        i32(material.windLayer),
        reading,
    );
    let across = vec2f(air.x, air.z);
    let speed = length(across);
    if (speed <= 1e-5) {
        return vec3f(0.0);
    }
    let dir = across / speed;
    // The wind's direction in the tuft's own space, against its turn.
    let along = vec2f(dir.x * traits.z - dir.y * traits.w, dir.x * traits.w + dir.y * traits.z);
    // The tuft's own flutter rides on the local air, so a lull stills it and a gust lifts it.
    let flutter = sin(frame.time * 2.7 + traits.x + input.position.x * 7.0);
    let reach = clamp(speed / 6.0, 0.0, 1.2);
    let bend = input.uv.y * input.uv.y * material.sway * reach * (0.75 + 0.25 * flutter);
    return vec3f(along.x * bend, -0.4 * bend * bend, along.y * bend);
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
`;

/**
 * One tuft: blades that lean out from its middle and curve over. Each blade is a strip that narrows
 * to a point. Its normals lean up, so a blade lights like the ground under it, and its colors run
 * from a dark root to a lighter tip.
 */
function tuft(seed: number): MeshArrays {
	const next = random(seed);
	const perBlade = SEGMENTS * 2 + 1;
	const positions = new Float32Array(BLADES * perBlade * 3);
	const normals = new Float32Array(BLADES * perBlade * 3);
	const colors = new Float32Array(BLADES * perBlade * 3);
	const uvs = new Float32Array(BLADES * perBlade * 2);
	const indices: number[] = [];
	for (let b = 0; b < BLADES; b++) {
		const angle = next() * Math.PI * 2;
		const [ox, oz] = [Math.cos(angle), Math.sin(angle)];
		const root = 0.015 + 0.11 * next();
		const height = 0.12 + 0.22 * next() ** 1.5;
		const lean = (0.1 + 0.25 * next()) * height;
		const width = 0.016 + 0.012 * next();
		const twist = angle + Math.PI / 2 + (next() - 0.5) * 0.8;
		const [sx, sz] = [Math.cos(twist), Math.sin(twist)];
		// The face's normal, across the strip, leaned up by two thirds.
		const [fx, fz] = [-sz, sx];
		const length = Math.hypot(fx * 0.35, 1, fz * 0.35);
		const first = b * perBlade;
		for (let j = 0; j <= SEGMENTS; j++) {
			const t = j / SEGMENTS;
			const cx = ox * (root + lean * t * t);
			const cz = oz * (root + lean * t * t);
			const cy = height * (t - 0.15 * t * t);
			const half = (width / 2) * (1 - t) ** 0.9;
			const sides = j === SEGMENTS ? [0] : [-1, 1];
			for (const side of sides) {
				const v = first + (j === SEGMENTS ? SEGMENTS * 2 : j * 2 + (side + 1) / 2);
				positions.set([cx + sx * half * side, cy, cz + sz * half * side], v * 3);
				normals.set([(fx * 0.35) / length, 1 / length, (fz * 0.35) / length], v * 3);
				const shade = 0.3 + 0.7 * t;
				colors.set([shade * (0.9 + 0.25 * t), shade, shade * (0.85 - 0.2 * t)], v * 3);
				uvs.set([(side + 1) / 2, t], v * 2);
			}
		}
		for (let j = 0; j < SEGMENTS - 1; j++) {
			const a = first + j * 2;
			indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
		}
		indices.push(first + SEGMENTS * 2 - 2, first + SEGMENTS * 2 - 1, first + SEGMENTS * 2);
	}
	return { positions, normals, colors, uvs, indices };
}

/** A scratch quaternion for each tuft's turn. */
const spin = quat.create();

/** Tufts nearer the water than this many half widths of the stream show in its reflection. */
const EDGE = 1.7;
/** The width of the squares that group nearby rows, in meters. */
const CELL = 4;
const PRESETS: readonly QualityPreset[] = ['low', 'medium', 'high', 'ultra'];

/** A tuft's place and size: x, y, z, then its scales along x, y and z. */
type Tuft = [number, number, number, number, number, number];

/** The grass's batches, which `fit` sizes to a preset. */
export interface Grass {
	batches: InstanceBatch[];
	/** Draws the preset's share of the tufts. */
	fit(preset: QualityPreset): void;
	/** Gives the tufts the field's newest state, which a frame calls before the engine draws. */
	setWindLayer(field: WindField): void;
}

/** The rows of a list of tufts that a preset draws: its share of them, from the first. */
const share = (count: number, preset: QualityPreset) =>
	Math.ceil((count * TUFTS[preset]) / TUFTS.ultra);

/**
 * Orders tufts so that each preset draws an even spread of them, and nearby rows sit together. The
 * tufts come in a random order, so the first rows of any count spread over the banks. Then each
 * preset's added rows are sorted by square, so the GPU path that culls rows in groups skips the
 * groups out of view.
 */
function ordered(tufts: Tuft[]): Tuft[] {
	const key = (t: Tuft) => Math.floor(t[0] / CELL) * 1000 + Math.floor(t[2] / CELL);
	let from = 0;
	return PRESETS.flatMap((preset) => {
		const to = share(tufts.length, preset);
		const band = tufts.slice(from, to).sort((a, b) => key(a) - key(b));
		from = to;
		return band;
	});
}

/**
 * Makes the tufts. They grow on the banks, densest near the water, in patches, and not on steep
 * ground or where `clear` keeps a place bare. The tufts near the water show in its reflection and
 * cast shadows. The others only receive shadows, which costs the shadow and reflection passes far
 * fewer triangles.
 */
export function createGrass(
	{ scene, geometry, materials, textures }: SketchContext,
	clear: (x: number, z: number) => boolean,
	wind: WindField,
): Grass {
	const material = materials.shader({
		wgsl,
		color: '#5f9a2a',
		vertexColors: true,
		roughness: 0.75,
		specularIntensity: 0.4,
		doubleSided: true,
		contactShadows: false,
		textures: { wind: wind.texture, airSettings: readingTexture(textures, wind.air) },
		uniforms: {
			sway: 0.12,
			windBox: wind.size,
			windStrength: 1,
			windLayer: 0,
		},
	});
	const next = random(23);
	const batches: InstanceBatch[] = [];
	for (let shape = 0; shape < SHAPES; shape++) {
		const edge: Tuft[] = [];
		const inland: Tuft[] = [];
		while (edge.length + inland.length < TUFTS.ultra / SHAPES) {
			const x = (next() * 2 - 1) * 22;
			const side = next() < 0.5 ? -1 : 1;
			const z = streamZ(x) + side * (streamHalf(x) * 0.97 + 11 * next() ** 1.5);
			const y = groundHeight(x, z);
			const slope = Math.abs(groundHeight(x + 0.2, z) - y) + Math.abs(groundHeight(x, z + 0.2) - y);
			const patch = Math.sin(x * 0.7 + Math.sin(z * 0.9) * 2) + Math.sin(z * 0.5 - x * 0.3);
			if (y < WATER + 0.03 || slope > 0.16 || clear(x, z)) continue;
			if (patch < -0.9 && fromStream(x, z) > 1.6 && next() < 0.8) continue;
			const size = 0.75 + 0.6 * next();
			const place: Tuft = [
				x,
				y - 0.02,
				z,
				size * (0.85 + 0.3 * next()),
				size,
				size * (0.85 + 0.3 * next()),
			];
			(fromStream(x, z) < EDGE ? edge : inland).push(place);
		}
		const mesh = geometry.fromArrays(tuft(101 + shape));
		for (const [tufts, near] of [
			[edge, true],
			[inland, false],
		] as const) {
			const batch = scene.createInstances(mesh, tufts.length, {
				material,
				castShadows: near,
				receiveShadows: true,
				layers: near ? 1 : UNREFLECTED_LAYER,
				values: true,
			});
			// A batch made with values has its array.
			const values = batch.values as Float32Array;
			ordered(tufts).forEach((t, row) => {
				const turn = next() * Math.PI * 2;
				batch.positions.set([t[0], t[1], t[2]], row * 3);
				batch.rotations.set(quat.fromEuler(spin, 0, turn, 0), row * 4);
				batch.scales.set([t[3], t[4], t[5]], row * 3);
				values.set([next() * Math.PI * 2, next(), Math.cos(turn), Math.sin(turn)], row * 4);
			});
			batch.markDirty();
			batches.push(batch);
		}
	}
	return {
		batches,
		fit(preset) {
			for (const batch of batches) batch.setActiveCount(share(batch.count, preset));
		},
		setWindLayer(field) {
			material.setUniform('windLayer', field.texture.layer);
		},
	};
}

/** The texture that holds the field's steady settings, three texels of four numbers each. */
function readingTexture(textures: Textures, air: WindField['air']): Texture {
	const data = new Float32Array(12);
	data.set(air.base.slice(0, 4), 0);
	data.set(air.gust.slice(0, 4), 4);
	data.set(air.swirl.slice(0, 4), 8);
	return textures.fromData({ width: 3, height: 1, format: 'rgba16float', data });
}
