// The rain of Skyway: two crossed strips for each drop, drawn as one mesh that follows the camera.
// A vertex offset drops every streak through the air from the clock, each at its own pace and with a
// little wind, so the sketch never moves a vertex. The box of air is wider than the view, so the
// streets stay full of rain whichever way the camera turns.
import { math, type PerspectiveCamera, type SketchContext, vec3 } from '@null3d/engine';
import { EFFECT_LAYER } from '../../lib/layers';

/** The streaks in the air around the camera. */
const STREAKS = 4800;
/** The box of air: how far it reaches either side, and how tall it is, in meters. */
const [REACH, HEIGHT] = [62, 58];
/** The length of one streak, in meters. */
const LENGTH = 0.62;
/** How far round the camera the air stays clear of drops, in meters, unless the scene asks for more. */
const CLEAR = 1.5;

const falling = /* wgsl */ `
struct Uniforms { strength: f32, clear: f32 }

fn vertexOffset(input: VertexInput) -> vec3f {
    let span = 58.0; // the box's height, as HEIGHT above
    let base = input.position.y - input.uv.y * 0.62; // the streak's length, as LENGTH above
    let fallen = fract((base - frame.time * (26.0 + input.uv.x * 12.0)) / span) * span;
    // The drops drift with the wind as they fall, so the rain slants.
    let wind = sin(frame.time * 0.6 + input.position.z * 0.07) * 0.9;
    return vec3f(wind * (fallen / span), fallen - base, 0.0);
}

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    s.baseColor = vec3f(0.0);
    s.roughness = 0.2;
    s.metalness = 0.0;
    s.emissive = vec3f(0.34, 0.42, 0.55) * (0.5 + 0.7 * input.uv.x) * material.strength;
    // A drop that falls past the lens would draw as a bright bar across the view, so the rain
    // fades out near the camera.
    let near = smoothstep(material.clear, material.clear * 2.0, length(input.relativePosition));
    s.alpha = min(1.0, sin(input.uv.y * 3.14159) * (0.16 + 0.28 * input.uv.x)) * material.strength * near;
    s.emissive *= near;
    return s;
}
`;

/** The rain of the scene. */
export interface Rain {
	/** Gives the rain its place around the camera. Call once per frame. */
	follow(camera: PerspectiveCamera): void;
	/** Turns the rain on or off. */
	setVisible(on: boolean): void;
	/** Makes the rain denser or fainter, from 1 for the ordinary fall. */
	setStrength(value: number): void;
	/**
	 * Keeps the air clear of drops within `meters` of the camera, fading them in over as far again:
	 * a little behind the car, and the whole cockpit from its seat.
	 */
	setClear(meters: number): void;
}

/** Builds the rain. */
export function createRain(ctx: SketchContext): Rain {
	const { scene, geometry, materials } = ctx;
	const [positions, uvs, indices] = [[], [], []] as number[][];
	math.seed(19);
	for (let k = 0; k < STREAKS; k++) {
		const [x, z] = [math.randFloat(-REACH, REACH), math.randFloat(-REACH, REACH)];
		const [y, pace, w] = [math.randFloat(0, HEIGHT), math.random(), 0.028];
		for (const [dx, dz] of [
			[w, 0],
			[0, w],
		] as const) {
			const first = positions.length / 3;
			positions.push(
				x - dx,
				y,
				z - dz,
				x + dx,
				y,
				z + dz,
				x + dx,
				y + LENGTH,
				z + dz,
				x - dx,
				y + LENGTH,
				z - dz,
			);
			uvs.push(pace, 0, pace, 0, pace, 1, pace, 1);
			indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
		}
	}
	const material = materials.shader({
		wgsl: falling,
		uniforms: { strength: 1, clear: CLEAR },
		doubleSided: true,
		alphaMode: 'blend',
		blending: 'additive',
		depthWrite: false,
		forceSinglePass: true,
		fog: false,
		contactShadows: false,
	});
	const mesh = scene.createMesh({
		mesh: geometry.fromArrays({
			positions: new Float32Array(positions),
			uvs: new Float32Array(uvs),
			indices: new Uint32Array(indices),
			computeNormals: true,
		}),
		material,
		layers: EFFECT_LAYER,
	});
	// The rain fills the air, so it casts no shadows and the camera's clearance guard ignores it.
	mesh.setCastShadows(false);
	const eye = vec3.create();
	let clear = CLEAR;
	return {
		follow(camera) {
			camera.getWorldPosition(eye);
			mesh.setPosition(eye[0] as number, (eye[1] as number) - HEIGHT * 0.35, eye[2] as number);
		},
		setVisible(on) {
			mesh.setVisible(on);
		},
		setStrength(value) {
			material.set({ strength: value });
		},
		setClear(meters) {
			if (meters === clear) return;
			clear = meters;
			material.set({ clear: meters });
		},
	};
}
