// The city under the lanes: the wet ground, the street lamps, the searchlights and the signs.
//
// The ground is one plane with one material. Its streets and markings come from the city plan in
// world units, and puddles roughen it from noise, so screen-space reflections smear the lamps and
// the lit windows down the road where it is wet. The lamps are a pool of point lights along the
// streets, drawn as glowing heads in one batch; the searchlights are spot lights that sweep the
// haze above the towers; and the signs are canvases drawn in code, refreshed through a scanline and
// a slow flicker.
import { math, type QualityPreset, quat, type SketchContext } from '@null3d/engine';
import { EFFECT_LAYER } from '../../lib/layers';
import { HALF, PITCH, STREET, streetLine } from './layout';

/** How much ground the plane covers, in meters: past the outer streets into the haze. */
const GROUND = 4200;
/** The colours of the street lamps, as linear RGB. */
const LAMP_COLOURS = [
	[1.0, 0.5, 0.16],
	[0.24, 0.72, 1.0],
	[1.0, 0.28, 0.62],
	[0.55, 1.0, 0.7],
] as const;
/** How many lamps stand along each street of the plan, and how far apart, in meters. */
const LAMPS_PER_STREET = 9;
const LAMP_HEIGHT = 9;
const LAMP_RANGE = 64;
/** The strength of one lamp's light, and of a searchlight, when the city's lights burn fully. */
const LAMP_INTENSITY = 2200;
const BEAM_INTENSITY = 90_000;

const groundWgsl = /* wgsl */ `
#import null3d::noise::{fbm2}

struct Uniforms { pitch: f32, street: f32 }

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let p = input.worldPosition.xz;
    // The distance to the nearest street's centre line, along each axis of the plan.
    let q = abs(fract(p / material.pitch) - vec2f(0.5)) * material.pitch;
    let across = select(q.y, q.x, q.x < q.y);
    let along = select(p.x, p.y, q.x < q.y);
    let halfStreet = material.street * 0.5;
    let pave = step(halfStreet, across);
    let kerb = step(halfStreet, across) * step(across, halfStreet + 3.0);

    // Wet asphalt: puddles are smooth, the dry road is only a little rough.
    let wet = smoothstep(0.38, 0.58, fbm2(p * 0.055, 3u) * 0.5 + 0.5);
    let grain = 0.86 + 0.14 * fbm2(p * 1.7, 2u);
    var road = vec3f(0.019, 0.021, 0.026) * grain;
    var rough = mix(0.44, 0.035, wet);
    // Pavement and the ground under the blocks, both dry and dull.
    road = mix(road, vec3f(0.033, 0.034, 0.038), pave);
    rough = mix(rough, 0.62, pave);

    // Lane markings: edge lines and the dashes between the lanes, only on the road.
    let edge = step(abs(across - (halfStreet - 2.5)), 0.16);
    let divider = step(abs(across - (halfStreet - 8.5)), 0.13);
    let dash = step(fract(along / 11.0), 0.52);
    let paint = clamp((edge + divider * dash) * (1.0 - pave), 0.0, 1.0);
    road = mix(road, vec3f(0.36, 0.36, 0.34), paint);
    rough = mix(rough, 0.24, paint);

    s.baseColor = road;
    s.roughness = rough;
    s.metalness = 0.0;
    // The kerb catches a little of the city's light.
    s.emissive = kerb * vec3f(0.012, 0.013, 0.016);
    return s;
}
`;

const signWgsl = /* wgsl */ `
var screen: texture_2d<f32>;

struct Uniforms { power: f32 }

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let colour = textureSampleLevel(screen, screenSampler, input.uv, 0.0).rgb;
    // Below a texel to a pixel the scanline settles to even light, so a far sign never shimmers.
    let texels = fwidth(input.uv * vec2f(512.0, 256.0));
    let near = 1.0 - smoothstep(0.4, 1.2, max(texels.x, texels.y));
    let scan = 0.78 + 0.22 * sin(input.uv.y * 420.0 - frame.time * 9.0);
    let flicker = 0.92 + 0.08 * sin(frame.time * 11.0 + input.uv.x * 5.0);
    s.baseColor = vec3f(0.0);
    s.metalness = 0.0;
    s.roughness = 0.5;
    s.emissive = colour * mix(1.0, scan, near) * flicker * 1.7 * material.power;
    return s;
}
`;

/** The city around the lanes. */
export interface City {
	/** Draws the lights and signs of a preset. */
	fit(preset: QualityPreset): void;
	/** Sets the share of the street lights and signs that burn, from 0 by day to 1 at night. */
	power(share: number): void;
	/** Sweeps the searchlights. Call once per frame with the sketch time. */
	update(t: number): void;
}

/** The colours and the words of the signs, in the order the signs take them. */
const SIGNS = [
	{ top: '#ff2d78', bottom: '#25063a', words: ['SKYWAY', 'TRANSIT'] },
	{ top: '#12e0ff', bottom: '#041a3a', words: ['NOODLE', 'BAR 24H'] },
	{ top: '#ffd23f', bottom: '#3a1a04', words: ['ZERO-G', 'COLA'] },
	{ top: '#8a5cff', bottom: '#0a0424', words: ['KAIJU', 'NIGHTS'] },
] as const;

/** Draws one sign on a canvas of its own: a wash, a band of light and two lines of text. */
function paintSign(
	index: number,
	width = 512,
	height = 256,
): { canvas: OffscreenCanvas; context: OffscreenCanvasRenderingContext2D } {
	const sign = SIGNS[index % SIGNS.length] as (typeof SIGNS)[number];
	const canvas = new OffscreenCanvas(width, height);
	const context = canvas.getContext('2d');
	if (!context) throw new Error('the canvas has no 2D context');
	const wash = context.createLinearGradient(0, 0, width, height);
	wash.addColorStop(0, sign.top);
	wash.addColorStop(1, sign.bottom);
	context.fillStyle = wash;
	context.fillRect(0, 0, width, height);
	// A frame, a bright bar and the words, in a heavy sans face.
	context.strokeStyle = 'rgba(255,255,255,0.55)';
	context.lineWidth = 6;
	context.strokeRect(12, 12, width - 24, height - 24);
	context.fillStyle = 'rgba(255,255,255,0.22)';
	context.fillRect(30, 150, width - 60, 10);
	context.fillStyle = '#ffffff';
	context.textAlign = 'center';
	context.textBaseline = 'middle';
	context.font = 'bold 76px sans-serif';
	context.fillText(sign.words[0], width / 2, 92);
	context.font = 'bold 40px sans-serif';
	context.fillText(sign.words[1], width / 2, 190);
	return { canvas, context };
}

/** Builds the ground, the lamps, the searchlights and the signs. */
export function createCity(ctx: SketchContext): City {
	const { scene, geometry, materials, textures } = ctx;
	math.seed(5);

	scene.createMesh({
		mesh: geometry.plane({ width: GROUND, height: GROUND }),
		material: materials.shader({
			wgsl: groundWgsl,
			uniforms: { pitch: PITCH, street: STREET },
			color: '#ffffff',
			roughness: 0.4,
		}),
		rotation: turnAbout('x', -Math.PI / 2),
		receiveShadows: false,
	});

	// The lamps: a point light at each head, and one batch of glowing heads for them all.
	const heads: { x: number; y: number; z: number; colour: readonly number[] }[] = [];
	for (const axis of ['x', 'z'] as const) {
		for (let street = 1; street < 10; street++) {
			for (let lamp = 0; lamp < LAMPS_PER_STREET; lamp++) {
				const line = streetLine(street);
				const at = -HALF + ((lamp + 0.5) / LAMPS_PER_STREET) * HALF * 2;
				const colour = LAMP_COLOURS[(street + lamp) % LAMP_COLOURS.length] as readonly number[];
				heads.push({
					x: axis === 'x' ? at : line,
					y: LAMP_HEIGHT,
					z: axis === 'x' ? line : at,
					colour,
				});
			}
		}
	}
	const streetLights: ReturnType<typeof scene.createPointLight>[] = [];
	for (const head of heads) {
		streetLights.push(
			scene.createPointLight({
				position: [head.x, head.y, head.z],
				color: [head.colour[0] as number, head.colour[1] as number, head.colour[2] as number],
				intensity: LAMP_INTENSITY,
				range: LAMP_RANGE,
			}),
		);
	}
	const headGlow = materials.shader({
		wgsl: /* wgsl */ `
struct Uniforms { power: f32 }

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    s.baseColor = vec3f(0.0);
    s.emissive = vec3f(1.0, 0.82, 0.55) * 6.0 * material.power;
    return s;
}`,
		uniforms: { power: 1 },
		contactShadows: false,
	});
	const glowBatch = scene.createInstances(geometry.box(), heads.length, {
		material: headGlow,
		layers: EFFECT_LAYER,
	});
	for (let k = 0; k < heads.length; k++) {
		const head = heads[k] as (typeof heads)[number];
		glowBatch.positions.set([head.x, head.y, head.z], k * 3);
		glowBatch.scales.set([0.9, 0.22, 0.9], k * 3);
	}
	glowBatch.markDirty(0, heads.length);

	// Three searchlights over the city, sweeping the rain.
	const beams = [
		{ at: [-HALF * 0.5, 200, -HALF * 0.5], turn: 0.6, speed: 0.16 },
		{ at: [HALF * 0.6, 240, -HALF * 0.35], turn: 2.4, speed: 0.11 },
		{ at: [HALF * 0.1, 190, HALF * 0.6], turn: 4.2, speed: 0.14 },
	] as const;
	const spots = beams.map((beam) =>
		scene.createSpotLight({
			position: [beam.at[0], beam.at[1], beam.at[2]],
			direction: [0, -1, 0],
			color: '#bcd6ff',
			intensity: BEAM_INTENSITY,
			range: 700,
			angle: 0.085,
			penumbra: 0.55,
		}),
	);

	// The signs, on the faces that look down the route's streets.
	const signs = [
		{ at: [-525, 33, 470], yaw: 0 },
		{ at: [-525, 40, 120], yaw: Math.PI },
		{ at: [-525, 30, -300], yaw: 0 },
		{ at: [525, 36, -260], yaw: Math.PI },
		{ at: [-262, 34, -75], yaw: Math.PI / 2 },
		{ at: [82, 42, -75], yaw: -Math.PI / 2 },
		{ at: [330, 30, 75], yaw: Math.PI / 2 },
		{ at: [-75, 38, 225], yaw: -Math.PI / 2 },
	] as const;
	const signMaterials: ReturnType<typeof materials.shader>[] = [];
	for (let k = 0; k < signs.length; k++) {
		const sign = signs[k] as (typeof signs)[number];
		const { canvas } = paintSign(k);
		const map = textures.fromCanvas(canvas);
		const material = materials.shader({
			wgsl: signWgsl,
			uniforms: { power: 1 },
			textures: { screen: map },
			alphaMode: 'opaque',
			fog: true,
		});
		signMaterials.push(material);
		scene.createMesh({
			mesh: geometry.plane({ width: 13, height: 6.5 }),
			material,
			position: [sign.at[0], sign.at[1], sign.at[2]],
			rotation: turnAbout('y', sign.yaw),
			layers: EFFECT_LAYER,
			castShadows: false,
		});
	}

	return {
		fit(_preset) {},
		power(share) {
			headGlow.setUniform('power', share);
			// A lit sign reads by day too, so it keeps nearly half its light while the city sleeps.
			for (const sign of signMaterials) sign.setUniform('power', 0.45 + 0.55 * share);
			for (const light of streetLights) light.setIntensity(LAMP_INTENSITY * share);
			for (const spot of spots) spot.setIntensity(BEAM_INTENSITY * share);
		},
		update(t) {
			for (let k = 0; k < spots.length; k++) {
				const beam = beams[k] as (typeof beams)[number];
				const turn = beam.turn + t * beam.speed;
				const tilt = 0.32 + 0.16 * Math.sin(t * 0.23 + k * 2.1);
				(spots[k] as (typeof spots)[number]).setDirection(
					Math.cos(turn) * tilt,
					1,
					Math.sin(turn) * tilt,
				);
			}
		},
	};
}

/** A turn about one axis, as the quaternion that a mesh's rotation takes. */
function turnAbout(axis: 'x' | 'y', angle: number): [number, number, number, number] {
	const out = quat.create();
	quat.setAxisAngle(out, axis === 'x' ? [1, 0, 0] : [0, 1, 0], angle);
	return [out[0] as number, out[1] as number, out[2] as number, out[3] as number];
}
