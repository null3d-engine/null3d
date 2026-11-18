// Plants that sway in the wind add-on's field: one material that any demo gives its trees, shrubs,
// ferns and grasses, whether made in code or loaded from a file. The bend is read at each copy's
// root, solved in world space and turned back into the mesh's own space, so turned and scaled
// copies all lean downwind. The offset fades out by the sway distance, so a far plant stands still
// and keeps its shadow in the cached far cascade, and the shadow casters run the same offset.
import type { Material, SketchContext, Texture } from '@null3d/engine';
import type { Wind } from '@null3d/wind';

/** The distance from the camera out to which plants sway, in meters, unless a page names another. */
export const SWAY_DISTANCE = 120;

/**
 * The plants' material: a color map lit as the standard material lights it, with each vertex bent
 * in the wind add-on's field. The field's two blocks are copies of the add-on's sampling file, which
 * the wind add-on's own test holds equal.
 */
const swayShader = /* wgsl */ `
#import null3d::noise::{value3}

var colorMap: texture_2d<f32>;
var wind: texture_2d_array<f32>;
var airSettings: texture_2d<f32>;
var normalMap: texture_2d<f32>;
var ormMap: texture_2d<f32>;

struct Uniforms {
    // The field's box across the ground, in meters, and 0 without a field.
    windBox: f32,
    // 0 for a material that names no field, and 1 for one that reads it.
    windStrength: f32,
    // The layer of the field's texture that holds the newest state.
    windLayer: f32,
    // The height in the mesh's own units at which a plant read by its height bends in full.
    height: f32,
    // How far from the camera the plant sways, in meters.
    swayDistance: f32,
    // How far a vertex of full weight moves for each meter a second of wind, in meters.
    sway: f32,
    // The power of the weight: high keeps a trunk stiff and bends its crown, low bends a whole stem.
    stiffness: f32,
    // How far a vertex of full weight flutters for each meter a second of wind, in meters.
    rustle: f32,
    // 0 reads the weight from the vertex's height, 1 from the second texture coordinates, which
    // also carry each branch's phase.
    weightFromUv1: f32,
    // 1 scales the sway and the rustle by the copy's own height scale, for a mesh 1 unit high.
    perSize: f32,
    // 1 cuts the surface where the color map's alpha is under the cutoff.
    cutout: f32,
    // 1 bends the normal by the normal map, in a frame from the screen's derivatives.
    normalMapOn: f32,
    // 1 scales the occlusion, the roughness and the metalness by the occlusion map's channels.
    ormMapOn: f32,
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

/// The strongest wind that bends a plant further, in meters a second.
const SWAY_TOP_SPEED: f32 = 14.0;

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
    // The copy's axes in the world, whose lengths are its scale on each axis.
    let m = object.worldMatrix;
    let ax = m[0].xyz;
    let ay = m[1].xyz;
    let az = m[2].xyz;
    let size = mix(1.0, length(ay), material.perSize);
    // The weight grows from the root to the tips, and its power sets where the plant bends.
    let byHeight = input.position.y / max(material.height, 0.001);
    let weight = clamp(mix(byHeight, input.uv1.x, material.weightFromUv1), 0.0, 1.0);
    let phase = input.uv1.y * 6.2831853 * material.weightFromUv1;
    let bend = pow(max(weight, 1e-4), material.stiffness);
    // Each plant sways a little on its own, and a branch read by its phase out of step with the rest.
    let flutter = 0.8 + 0.2 * sin(frame.time * 1.7 + dot(root.xz, vec2f(0.37, 0.11)) + phase);
    let push = min(speed, SWAY_TOP_SPEED) * size * fade;
    var world = vec3f(dir.x, 0.0, dir.y) * (bend * material.sway * flutter * push);
    // The leaves rustle quickly, each vertex out of step with its neighbors.
    if (material.rustle > 0.0) {
        let own = dot(input.position, vec3f(37.0, 23.0, 29.0)) + phase * 3.0;
        let t = frame.time * 6.0 + own;
        let shake = vec3f(sin(t), 0.5 * sin(t * 1.3 + 1.1), cos(t * 0.9 + 2.3));
        world += shake * (weight * material.rustle * push);
    }
    // The world offset in the mesh's own space: each axis over its squared length undoes the
    // copy's turn and scale.
    return vec3f(dot(ax, world) / dot(ax, ax), dot(ay, world) / dot(ay, ay), dot(az, world) / dot(az, az));
}

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let texel = textureSample(colorMap, colorMapSampler, input.uv);
    s.baseColor = texel.rgb * s.baseColor;
    // A mesh made without tangents takes its frame from how the position and the texture
    // coordinates change across the screen. The samples and the derivatives run outside the
    // branches, in uniform control flow; a material without the maps reads a white texel.
    let bent = textureSample(normalMap, normalMapSampler, input.uv).xyz * 2.0 - 1.0;
    let orm = textureSample(ormMap, ormMapSampler, input.uv).rgb;
    let dp1 = dpdx(input.relativePosition);
    let dp2 = dpdy(input.relativePosition);
    let duv1 = dpdx(input.uv);
    let duv2 = dpdy(input.uv);
    // A cut-out's alpha thins in the smaller mip levels, so far leaves would fade away. The alpha
    // grows with the level the texture reads, which keeps a far crown's cover.
    if (material.cutout > 0.5) {
        let texels = vec2f(textureDimensions(colorMap, 0));
        let stretch = max(dot(duv1 * texels, duv1 * texels), dot(duv2 * texels, duv2 * texels));
        let mip = max(0.0, 0.5 * log2(max(stretch, 1e-8)));
        s.alpha = texel.a * (1.0 + 0.25 * mip);
    }
    if (material.normalMapOn > 0.5) {
        let n = s.normal;
        let across1 = cross(n, dp1);
        let across2 = cross(dp2, n);
        let t = across2 * duv1.x + across1 * duv2.x;
        let b = across2 * duv1.y + across1 * duv2.y;
        let scale = inverseSqrt(max(max(dot(t, t), dot(b, b)), 1e-20));
        let mapped = normalize(t * (bent.x * scale) + b * (bent.y * scale) + n * bent.z);
        s.normal = mapped;
        s.diffuseNormal = mapped;
        s.ambientNormal = mapped;
    }
    if (material.ormMapOn > 0.5) {
        s.occlusion *= orm.r;
        s.roughness *= orm.g;
        s.metalness *= orm.b;
    }
    return s;
}
`;

/** One plant material's settings. */
export interface SwayMaterialOptions {
	/** A tangent-space normal map in linear color, read at the first texture coordinates. */
	readonly normalMap?: Texture;
	/** An occlusion, roughness and metalness map in linear color, which scales the three in turn. */
	readonly ormMap?: Texture;
	/**
	 * The color map, times the vertex colors and a batch's row colors. The map carries the plant's
	 * own color, so keep the row colors near white: a dark tint on a dark map leaves only the
	 * specular light. Without a map, the vertex and row colors alone color the surface.
	 */
	readonly map?: Texture;
	/** True cuts the surface, and its shadow, where the map's alpha is under one half. */
	readonly cutout?: boolean;
	/**
	 * Where each vertex's weight comes from: its height over `height` in the mesh's own units, or
	 * the second texture coordinates, whose u is the weight from 0 at the root to 1 at the tips and
	 * whose v is the branch's phase as a share of a turn.
	 */
	readonly weight?: 'height' | 'uv1';
	/** The height in the mesh's own units at which a plant read by its height bends in full. */
	readonly height?: number;
	/** How far a vertex of full weight moves for each meter a second of wind, in meters. */
	readonly sway: number;
	/** The power of the weight: 2 keeps a trunk stiff and bends its crown, about 1.3 bends a stem. */
	readonly stiffness?: number;
	/** How far a vertex of full weight flutters for each meter a second of wind, in meters. */
	readonly rustle?: number;
	/** True scales the sway and the rustle by each copy's height scale, for a mesh 1 unit high. */
	readonly perSize?: boolean;
	/** False draws a mesh without vertex colors. */
	readonly vertexColors?: boolean;
	/** The surface's roughness, which an occlusion map's green channel scales. */
	readonly roughness?: number;
}

/** The materials that sway in one wind field, and the frame step that keeps them current. */
export interface Sway {
	/** Makes a material whose vertices bend in the field. */
	material(options: SwayMaterialOptions): Material;
	/** Gives every material the field's newest layer. Call it once a frame, after the wind steps. */
	update(): void;
}

/**
 * Plant materials that read one wind field.
 *
 * @param ctx The sketch.
 * @param options The wind, and the distance from the camera out to which the plants sway.
 * @returns The maker of materials and their frame step.
 */
export function createSway(
	ctx: SketchContext,
	options: { readonly wind: Wind; readonly swayDistance?: number },
): Sway {
	const { materials, textures } = ctx;
	const { wind, swayDistance = SWAY_DISTANCE } = options;
	/** The sent gust's born time that the settings texture holds, so one gust costs one upload. */
	let sentBorn = Number.NaN;
	const airSettings = textures.fromData({
		width: 4,
		height: 1,
		format: 'rgba16float',
		data: airSettingsData(wind.field.air),
	});
	let white: Texture | undefined;
	const make = (settings: SwayMaterialOptions) => {
		white ??= textures.fromData({ width: 1, height: 1, data: new Uint8Array(4).fill(255) });
		return materials.shader({
			wgsl: swayShader,
			roughness: settings.roughness ?? 0.85,
			vertexColors: settings.vertexColors ?? true,
			doubleSided: true,
			...(settings.cutout && { alphaMode: 'mask' as const, alphaCutoff: 0.5 }),
			swayDistance,
			textures: {
				colorMap: settings.map ?? white,
				normalMap: settings.normalMap ?? white,
				ormMap: settings.ormMap ?? white,
				wind: wind.field.texture,
				airSettings,
			},
			uniforms: {
				windBox: wind.field.size,
				windStrength: 1,
				windLayer: 0,
				height: settings.height ?? 1,
				swayDistance,
				sway: settings.sway,
				stiffness: settings.stiffness ?? 2,
				rustle: settings.rustle ?? 0,
				weightFromUv1: settings.weight === 'uv1' ? 1 : 0,
				perSize: settings.perSize ? 1 : 0,
				cutout: settings.cutout ? 1 : 0,
				normalMapOn: settings.normalMap ? 1 : 0,
				ormMapOn: settings.ormMap ? 1 : 0,
			},
		});
	};
	const made: ReturnType<typeof make>[] = [];
	return {
		material(settings) {
			const material = make(settings);
			made.push(material);
			return material;
		},
		update() {
			for (const material of made) material.setUniform('windLayer', wind.field.texture.layer);
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
