// Levels of detail: a mixed forest of 56,000 trees over rolling hills at golden hour, climbing to
// wooded ridges in the haze, in one static instance batch per kind of tree. Three firs and a
// broadleaf tree are made in code at four levels of detail each (./woods.ts), and each base mesh
// names its three coarser levels with their errors. Every tree then picks its own level in each
// frame, on the GPU or on the job workers: the coarsest whose error covers less than a pixel. Near
// a switch the two levels share the pixels through a dither, so no tree pops, and the shadows draw
// a coarser level still. An understory of bushes hides the ground between the trunks, in a batch of
// its own. On phones, the nearest 8,000 trees draw in full and the rest as cut-out cards. Press L to
// draw every tree at its full detail, and compare the stats.
import { defineSketch, timeOfDay } from '@null3d/engine';
import { createWind } from '@null3d/wind';
import { interact } from '../lib/interact';
import {
	addHero,
	BUSH,
	bushRows,
	cardArrays,
	cardTexture,
	countRows,
	fillRows,
	fitCounts,
	ground,
	KINDS,
	landArrays,
	litterTexture,
	meshOf,
	plantRows,
	woodTexture,
} from './woods';

/** Trees in all, the trees that draw in full on Low, and the radius of the forest in meters. */
const TREES = 56_000;
const NEAR = 8000;
const RADIUS = 650;
/** Bushes of the understory, the bushes that draw on Low, and how far out they cover, in meters. */
const BUSHES = 30_000;
const BUSH_NEAR = 12_000;
const BUSH_RADIUS = 360;
/** How far out the understory draws, in meters, where the trees hide the ground beyond it. */
const UNDERSTORY_EDGE = 300;
/** The distance from the camera out to which the trees sway, in meters. */
const SWAY_DISTANCE = 120;

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

export default defineSketch(async (ctx) => {
	const { scene, assets, geometry, materials, textures, post, quality, input, time } = ctx;
	// Golden hour: the sky lights the trees, and a thin amber haze lies over the far ridges.
	const day = timeOfDay('goldenHour', { heading: -2.2 });
	const sky = { intensity: day.skyIntensity };
	scene.setBackground({ sky: { ...day.sky, cloudCoverage: 0.25 } }, sky);
	scene.setEnvironment(await assets.skyEnvironment(), { intensity: day.skyIntensity * 0.8 });
	const haze = { color: [0.34, 0.26, 0.23], density: 0.0005, heightFalloff: 0.01 } as const;
	scene.setFog({ ...haze, sunGlow: day.fog.sunGlow * 0.5 });
	post.set({ exposure: day.exposure * 1.2, bloom: { intensity: 0.2, threshold: 1 }, vignette: {} });
	const camera = scene.createPerspectiveCamera({ fov: 50, near: 0.5, far: 6000 });
	scene.setActiveCamera(camera);
	const view = interact(ctx, camera, { target: [0, 10, 0], groundY: 0 });
	scene.createDirectionalLight({ ...day.light, castShadows: true, shadow: { distance: 160 } });
	scene.createAmbientLight(day.ambient);

	// Textures made in code: bark, needles and leaves for the trees, litter for the land, and a
	// cut-out picture of each kind of tree for the far cards.
	const look = { colorSpace: 'srgb', mipmaps: true, anisotropy: 8 } as const;
	const wood = textures.fromData({ ...woodTexture(), ...look, wrap: ['repeat', 'clamp'] });
	const litter = textures.fromData({ ...litterTexture(), ...look, wrap: 'repeat' });
	const pictures = textures.fromData({ ...cardTexture(KINDS), ...look });
	const land = materials.standard({ map: litter, vertexColors: true, roughness: 0.95 });
	scene.createMesh({
		mesh: geometry.fromArrays(landArrays(5500, RADIUS)),
		material: land,
		receiveShadows: true,
	});
	// The forest's one wind field. The trees bend in it, read at each tree's root, and the offset
	// fades out by the sway distance so the far trees and their cached shadow cascades stand still.
	const wind = createWind(ctx, { camera, box: 256 });
	const airSettings = textures.fromData({
		width: 3,
		height: 1,
		format: 'rgba16float',
		data: airSettingsData(wind.field.air),
	});
	const bark = materials.shader({
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
	const card = materials.standard({
		map: pictures,
		roughness: 0.9,
		alphaMode: 'mask',
		alphaCutoff: 0.4,
		doubleSided: true,
	});

	// One batch per kind of tree, whose base mesh names its coarser levels: each row picks its own
	// level in every frame. A second batch per kind holds the far rows as cards, for Low.
	const rows = plantRows(TREES, RADIUS);
	const { before, all } = countRows(rows, NEAR);
	const kinds = KINDS.map((kind, n) => {
		const count = all[n] as number;
		const near = before[n] as number;
		const mesh = meshOf(geometry, kind);
		const trees = scene.createInstances(mesh, count, {
			material: bark,
			castShadows: true,
			receiveShadows: true,
			colors: true,
		});
		fillRows(trees, rows, n);
		const cards = scene.createInstances(
			geometry.fromArrays(cardArrays(kind, n, KINDS.length)),
			count - near,
			{
				material: card,
				colors: true,
			},
		);
		fillRows(cards, rows, n, near);
		return { mesh, trees, cards, count, near };
	});
	// The understory: broad bushes that cover the ground between the trunks, at their own levels.
	const undergrowth = scene.createInstances(meshOf(geometry, BUSH), BUSHES, {
		material: bark,
		castShadows: true,
		receiveShadows: true,
		colors: true,
	});
	fillRows(undergrowth, bushRows(BUSHES, BUSH_RADIUS), 0);
	// The understory's far rows cost nothing past the distance where the trunks hide the ground,
	// and the dither fades the last bushes out instead of popping them away.
	undergrowth.setDrawRange(0, UNDERSTORY_EDGE);
	// One hero fir stands beside the flight: a bias keeps its finer levels where the trees around
	// it turn coarse, and B gives it the threshold of the rest.
	const hero = addHero(scene, kinds[0], bark, ground);
	const fit = () =>
		fitCounts(kinds, undergrowth, quality.preset === 'low', { all: BUSHES, near: BUSH_NEAR });
	fit();
	quality.onChange(fit);
	// L draws every tree's base level, and the preset's threshold again on the next press.
	let threshold = quality.settings.lodThreshold;

	return {
		onUpdate(dt) {
			// The field's box follows the camera, so it steps before the trees read it.
			wind.update();
			bark.setUniform('windLayer', wind.field.texture.layer);
			if (input.wasPressed('KeyB')) hero.setBias();

			if (input.wasPressed('KeyL')) {
				const levels = quality.settings.lodThreshold > 0;
				if (levels) threshold = quality.settings.lodThreshold;
				quality.set({ lodThreshold: levels ? 0 : threshold });
			}
			// A slow flight above the canopy, looking out over the forest toward the ridges.
			if (!view.userCamera) {
				const t = time.now * 0.03;
				const [x, z] = [Math.sin(t) * 120, Math.cos(t) * 120];
				camera.setPosition(x, ground(x, z) + 30, z);
				camera.lookAt(Math.sin(t + 0.6) * 260, 8, Math.cos(t + 0.6) * 260);
			}
			view.update(dt);
		},
	};
});

/** The data of the field's steady settings, three texels of four numbers each. */
function airSettingsData(air: {
	readonly base: readonly number[];
	readonly gust: readonly number[];
	readonly swirl: readonly number[];
}): Float32Array {
	const data = new Float32Array(12);
	data.set(air.base.slice(0, 4), 0);
	data.set(air.gust.slice(0, 4), 4);
	data.set(air.swirl.slice(0, 4), 8);
	return data;
}
