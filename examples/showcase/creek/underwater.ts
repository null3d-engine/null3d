// The view from under the creek's water. Each pixel whose line of sight starts under the waving
// surface reads as seen through flowing water: the current bends the light in a slow wobble that
// runs downstream, caustics play over the bed and the stones under the surface, and the water
// swallows the light with distance, into its own green. The test is per pixel, from the point where
// the pixel's line of sight leaves the camera's near plane, so a camera half under the water splits
// the picture at the waterline, as a real one does. The effect is added only while the camera is
// near or under the water, so it costs nothing elsewhere.
import {
	type Effect,
	type PerspectiveCamera,
	quat,
	type SketchContext,
	vec3,
} from '@null3d/engine';
import { FLOW, surfaceHeight } from './water';

const wgsl = /* wgsl */ `
#import null3d::noise::{value2}

struct Uniforms {
    tint: vec3f,
    density: f32,
    caustics: vec3f,
    level: f32,
    eye: vec3f,
    flow: f32,
    right: vec3f,
    lens: f32,
    up: vec3f,
    near: f32,
    back: vec3f,
}

/// The caustics of the water's surface shader, the same ridges drifting with the current. Each WGSL
/// string compiles on its own, so this one holds its own copy.
fn caustics(p: vec2f, t: f32, flow: f32) -> f32 {
    let q = p * 4.6 + vec2f(flow * t * 4.0, 0.0);
    let a = sin(q.x * 3.1 + t * 1.3 + sin(q.y * 2.3 - t));
    let b = sin(q.y * 3.7 - t * 1.1 + sin(q.x * 1.9 + t * 0.7));
    let c = sin((q.x + q.y) * 2.6 + t * 0.9 + sin(q.x * 1.3 - q.y * 0.7));
    let v = (a + b + c) / 3.0;
    return pow(1.0 - abs(v), 14.0) * (0.35 + 0.65 * value2(p * 0.8 + vec2f(t * 0.1, 0.0)));
}

/// The height of the water's surface at a point and time, from the long waves that move its
/// vertices. The water's surface shader holds the same three waves first in its list.
fn surface_height(p: vec2f, t: f32) -> f32 {
    let list = array<vec4f, 3>(
        vec4f(1.0, 0.15, 2.3, 0.9),
        vec4f(0.8, -0.6, 3.7, 0.7),
        vec4f(0.6, 0.8, 5.9, 0.5),
    );
    var h = uniforms.level;
    for (var k = 0u; k < 3u; k++) {
        let w = list[k];
        let dir = normalize(w.xy);
        let phase = w.z * (dot(dir, p) - uniforms.flow * t * dir.x) - w.w * t;
        h += 0.05 / w.z * sin(phase);
    }
    return h;
}

/// The direction in the world of the line of sight through a place uv, and its share along the view.
fn sight(uv: vec2f, aspect: f32) -> vec4f {
    let ahead = normalize(vec3f((uv.x * 2.0 - 1.0) * uniforms.lens * aspect, (1.0 - uv.y * 2.0) * uniforms.lens, -1.0));
    return vec4f(uniforms.right * ahead.x + uniforms.up * ahead.y + uniforms.back * ahead.z, -ahead.z);
}

fn effect(input: EffectInput) -> vec4f {
    let t = input.time;
    let aspect = input.size.x / input.size.y;
    // Where this pixel's line of sight leaves the near plane: above the waving surface there, the
    // pixel sees the world from the air and keeps its color.
    let own = sight(input.uv, aspect);
    let start = uniforms.eye + own.xyz * (uniforms.near / own.w);
    let gap = surface_height(start.xz, t) - start.y;
    if gap <= 0.0 {
        return input.color;
    }
    // The current bends the light: a slow wobble whose waves run downstream across the picture.
    let wobble = vec2f(
        sin(input.uv.y * 23.0 + t * 1.7) + 0.6 * sin(input.uv.y * 41.0 + input.uv.x * 9.0 - t * 2.3),
        cos(input.uv.x * 19.0 + t * 1.3) + 0.5 * sin(input.uv.x * 37.0 - input.uv.y * 7.0 + t * 2.9),
    ) * 0.0022;
    let uv = input.uv + wobble;
    var color = effectColor(uv);
    // The ray from the eye through the wobbled place, in the world.
    let line = sight(uv, aspect);
    let ray = line.xyz;
    // How far the ray runs to what it shows, which is infinite where it shows the sky.
    let depth = effectDistance(uv);
    let reach = select(1e6, depth / line.w, depth < 1e6);
    if reach < 1e6 {
        // Caustics on what lies under the surface, fading with depth below it.
        let world = uniforms.eye + ray * reach;
        let below = uniforms.level - world.y;
        if below > 0.0 {
            let light = caustics(world.xz, t, uniforms.flow) * exp(-below * 0.8);
            color = vec4f(color.rgb * (vec3f(1.0) + uniforms.caustics * light * 6.0), color.a);
        }
    }
    // The water swallows the light only along the part of the ray under the surface: what lies above
    // it, the trees, the banks and the sky, shows through as clear as the water between allows.
    let surface = select(1e6, (uniforms.level - uniforms.eye.y) / ray.y, ray.y > 1e-4);
    let wet = min(reach, surface);
    let fade = 1.0 - exp(-min(wet, 1e4) * uniforms.density);
    let filtered = color.rgb * vec3f(0.86, 0.97, 0.95);
    // A thin dark line where the waterline crosses the lens.
    let meniscus = 1.0 - 0.45 * (1.0 - smoothstep(0.0, 0.004, gap));
    return vec4f(mix(filtered, uniforms.tint * color.a, fade) * meniscus, color.a);
}
`;

/** The view from under the water, which the scene drives each frame. */
export interface Underwater {
	/**
	 * Turns the effect on while the camera is under the surface, which waves at the sketch time `t`,
	 * and fits it to the frame's light.
	 */
	update(
		t: number,
		air: readonly [number, number, number],
		caustics: readonly [number, number, number],
	): void;
}

/**
 * How near above the surface the camera comes before the effect is added, and how far above it the
 * camera goes before the effect is removed, in meters. An effect takes a few frames to start
 * drawing after it is added, so it is added before the camera reaches the water, and the first pixel
 * that dips under the surface already reads as under the water.
 */
const READY = 0.6;
const RELEASE = 1;
/** How much of the light the water swallows per meter. */
const DENSITY = 0.07;
/** The water's own color, as a share of the air's color at the horizon in each channel. */
const GREEN = [0.22, 0.42, 0.4] as const;

/** Makes the view from under the water whose surface stands at `level`, for `camera`. */
export function createUnderwater(
	{ post }: SketchContext,
	camera: PerspectiveCamera,
	level: number,
): Underwater {
	const eye = vec3.create();
	const turn = quat.create();
	const right = vec3.create();
	const up = vec3.create();
	const back = vec3.create();
	const tint: [number, number, number] = [0, 0, 0];
	const caustics: [number, number, number] = [0, 0, 0];
	let effect: Effect | null = null;
	return {
		update(t, air, light) {
			camera.getPosition(eye);
			const above = (eye[1] as number) - surfaceHeight(eye[0] as number, eye[2] as number, t);
			if (above > (effect ? RELEASE : READY)) {
				if (effect) post.removeEffect(effect);
				effect = null;
				return;
			}
			camera.getRotation(turn);
			vec3.transformQuat(right, [1, 0, 0], turn);
			vec3.transformQuat(up, [0, 1, 0], turn);
			vec3.transformQuat(back, [0, 0, 1], turn);
			for (let c = 0; c < 3; c++) {
				tint[c] = (air[c] as number) * (GREEN[c] as number);
				caustics[c] = light[c] as number;
			}
			// The lens changes with the depth of field's focal length.
			const lens = Math.tan((camera.fov * Math.PI) / 360);
			if (!effect) {
				effect = post.addEffect({
					wgsl,
					uniforms: {
						tint,
						density: DENSITY,
						caustics,
						level,
						eye,
						flow: FLOW,
						right,
						lens,
						up,
						near: camera.near,
						back,
					},
				});
				return;
			}
			post.setEffectUniform(effect, 'tint', tint);
			post.setEffectUniform(effect, 'caustics', caustics);
			post.setEffectUniform(effect, 'eye', eye);
			post.setEffectUniform(effect, 'right', right);
			post.setEffectUniform(effect, 'up', up);
			post.setEffectUniform(effect, 'back', back);
			post.setEffectUniform(effect, 'lens', lens);
		},
	};
}
