// The scenes that prove the temporal resolve's study fixes (task M3-A11, D-206). ?case= names one:
//
// - `exposure` fills the view with fine noise, so a change of the exposure moves every pixel to a
//   color that its neighbors do not hold. The page changes the exposure between frames, and the
//   history must follow it.
// - `alpha` draws a blended square over a transparent canvas, where the scene's alpha holds the
//   surface, and `opaque` draws it over an opaque wall, where only the opaque-only copy finds it.
//   The square jumps from one side of the view to the other, so the side it left shows how much
//   history the resolve kept.
// - `phone` draws the `alpha` scene, a blended square that jumps, so the transparency signal lowers
//   the full path's history. The phone path reads no signal, so the same setting must not change its
//   picture.
// - `rain` draws thin rain streaks, which have no anti-aliasing of their own, and `fog` draws a
//   volumetric fog whose grid moves each frame. Both are effects that a temporal resolve would
//   have to clean up.
//
// ?taa=0 starts the resolve off. ?phone=1 picks its cheaper path, and ?reactive= names the
// transparency signals. The page sends `place`, `exposure`, `taa` and `taa-off` to change them.
import { defineSketch, type Texture } from '@null3d/engine';

const params = new URL(import.meta.url).searchParams;
const CASE = params.get('case') ?? 'exposure';
const JITTER = params.get('jitter') !== '0';
const REACTIVE = (params.get('reactive') ?? 'both') as 'both' | 'alpha' | 'opaque' | 'off';
const PHONE = params.get('phone') === '1';
/** False keeps the history's own exposure, for measuring what the ratio does. */
const RATIO = params.get('ratio') !== '0';
/** The view's size in pixels, which is one world unit per pixel of the orthographic camera. */
const SIZE = [320, 180] as const;
/** The blended square's two places across the view, in world units from its center. */
const SIDES = [100, -100] as const;
/**
 * How far the square stands toward the camera from the background, in world units: close enough
 * that it draws in front of the wall, and close enough that the resolve's depth rejection keeps the
 * history of the surface under it. A square well in front of the background leaves no history to
 * reject, so it would test nothing of the transparency mask.
 */
const NEAR = 0.01;
/** The noise texture's side, which fills the view at one texel per pixel. */
const NOISE = [320, 180] as const;
/** The frame at which the exposure case doubles the exposure, from the frame number. */
const EXPOSURE_STEP = Number(params.get('step') ?? '8');

const RAIN = /* wgsl */ `
#import null3d::builtins::{camera, fill_builtins, frame}
#import null3d::mesh::finish
#import null3d::noise::{random}
#import null3d::wrap::wrap_relative

// The box of streaks around the camera, and the pixels one travels each second. The view draws a
// world unit per pixel, so a streak stays a fraction of a pixel wide.
const HALF = vec3f(160.0, 90.0, 60.0);
const SPEED = vec3f(0.3, -30.0, 0.0);
const LENGTH = 6.0;
const WIDTH = 0.35;

struct Varyings {
    @builtin(position) clip: vec4f,
    @location(0) edge: vec2f,
    @location(1) fade: f32,
}

@vertex
fn vs(@builtin(vertex_index) vertex: u32, @builtin(instance_index) instance: u32) -> Varyings {
    fill_builtins(vec3f(0.0));
    let seed = instance * 3u;
    let home = vec3f(random(seed), random(seed + 1u), random(seed + 2u));
    var place = (home - 0.5) * 2.0 * HALF;
    place += SPEED * frame.time * (0.7 + home.y * 0.6);
    let head = wrap_relative(place, HALF);
    // The card holds its width across the camera's right, so a streak stays one texel wide.
    let right = normalize(vec3f(camera.view[0][0], camera.view[1][0], camera.view[2][0]));
    let corner = vec2f(f32(vertex & 1u), f32((vertex >> 1u) & 1u)) * 2.0 - 1.0;
    let along = corner.y * 0.5 + 0.5;
    let tail = head - normalize(SPEED) * LENGTH;
    let p = mix(head, tail, along) + right * corner.x * WIDTH;
    let away = abs(head) / HALF;
    var out: Varyings;
    out.clip = camera.viewProjection * vec4f(p, 1.0);
    out.edge = corner;
    out.fade = (1.0 - smoothstep(0.8, 1.0, max(away.x, max(away.y, away.z))))
        * smoothstep(0.0, 0.15, along);
    return out;
}

@fragment
fn fs(in: Varyings) -> @location(0) vec4f {
    fill_builtins(vec3f(0.0));
    let side = 1.0 - abs(in.edge.x);
    return finish(vec3f(0.7, 0.8, 1.0) * side * in.fade, in.clip.xy);
}
`;

/** A texture of fine random greys, so every 3 x 3 neighborhood holds a wide range of colors. */
function noiseTexture(textures: { fromCanvas(canvas: OffscreenCanvas): Texture }): Texture {
	const canvas = new OffscreenCanvas(NOISE[0], NOISE[1]);
	const context = canvas.getContext('2d');
	if (!context) throw new Error('the noise texture has no 2D context');
	const pixels = context.createImageData(NOISE[0], NOISE[1]);
	let seed = 1;
	for (let at = 0; at < pixels.data.length; at += 4) {
		// Mulberry32: the same noise in every run.
		seed = (seed + 0x6d2b79f5) >>> 0;
		let t = seed;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		const value = 40 + Math.round((((t ^ (t >>> 14)) >>> 0) / 4294967296) * 175);
		pixels.data[at] = value;
		pixels.data[at + 1] = value;
		pixels.data[at + 2] = value;
		pixels.data[at + 3] = 255;
	}
	context.putImageData(pixels, 0, 0);
	return textures.fromCanvas(canvas);
}

export default defineSketch(
	async ({ scene, geometry, materials, textures, post, quality, page, time }) => {
		quality.set({ minRenderScale: 1, maxRenderScale: 1, governor: false });
		let feedback = params.get('taa') === '0' ? 0 : 0.9;
		let phone = PHONE;
		let reactive = REACTIVE;
		const setResolve = () =>
			post.set({
				taa: feedback > 0 ? { feedback, jitter: JITTER, phone, reactive, exposure: RATIO } : false,
			});
		setResolve();
		const camera = scene.createOrthographicCamera({
			left: -SIZE[0] / 2,
			right: SIZE[0] / 2,
			bottom: -SIZE[1] / 2,
			top: SIZE[1] / 2,
			near: 0.1,
			far: 400,
			position: [0, 0, 2],
			target: [0, 0, 0],
		});
		scene.setActiveCamera(camera);
		const frames = params.has('frames');
		let side = 0;
		/** The phone case's square, which moves every frame, so the mask's effect is steady. */
		let moving: { setPosition(x: number, y: number, z: number): void } | undefined;
		/** The exposure that the exposure case has set, so it posts only on the step. */
		let exposure = 1;

		if (CASE === 'exposure') {
			scene.setBackground('#000000');
			scene.createAmbientLight({ color: '#ffffff', intensity: 1.0 });
			const noise = noiseTexture(textures);
			scene.createMesh({
				mesh: geometry.plane({ width: SIZE[0], height: SIZE[1] }),
				material: materials.standard({ map: noise }),
			});
		} else if (CASE === 'alpha' || CASE === 'opaque' || CASE === 'phone') {
			// The background is fine noise, so a history from the other side of the view is inside the
			// neighborhood's box and only the transparency signals can drop it. On `alpha` and `phone`
			// the canvas has no background and the noise is blended, so the scene's alpha carries the
			// surface; on `opaque` a wall fills the view and only the opaque-only copy finds it.
			const wall = CASE === 'opaque';
			if (wall) scene.setBackground('#202020');
			const noise = noiseTexture(textures);
			scene.createMesh({
				mesh: geometry.plane({ width: SIZE[0], height: SIZE[1] }),
				material: wall
					? materials.unlit({ map: noise })
					: materials.unlit({ map: noise, opacity: 0.5, alphaMode: 'blend' }),
			});
			// The square is fine noise too, so its neighborhood's box holds the background's colors
			// and only a transparency signal can keep them out of its history.
			const square = scene.createMesh({
				mesh: geometry.plane({ width: 40, height: 40 }),
				material: materials.standard({ map: noise, opacity: 0.6, alphaMode: 'blend' }),
				position: [SIDES[0] as number, 0, NEAR],
			});
			if (CASE === 'phone') moving = square;
			page.onMessage((name, data) => {
				if (name !== 'place') return;
				side = Number(data ?? 0);
				square.setPosition(SIDES[side] ?? 0, 0, NEAR);
				// The page captures the frame after this one, so it waits for the answer, which names
				// the last frame the sketch drew before the change.
				page.post('applied', { frame: time.frame });
			});
		} else if (CASE === 'rain') {
			scene.setBackground('#080d14');
			scene.createAmbientLight({ color: '#9db8e0', intensity: 1.2 });
			scene.createVertexDraw({
				shader: RAIN,
				vertices: 6,
				instances: 6_000,
				bounds: { center: [0, 0, 0], radius: 200 },
				blending: 'additive',
				depthWrite: false,
			});
		} else if (CASE === 'fog') {
			scene.setBackground('#0c141f');
			scene.setFog({
				color: '#0c141f',
				density: 0.035,
				heightFalloff: 0.4,
				volumetric: true,
			});
			scene.createDirectionalLight({ direction: [-0.4, -1, -0.3], intensity: 3.0 });
			for (let i = -3; i <= 3; i++)
				scene.createMesh({
					mesh: geometry.box({ width: 12, height: 40, depth: 12 }),
					material: materials.standard({ color: '#3a4450', roughness: 0.8 }),
					position: [i * 26, 0, -40 - Math.abs(i) * 10],
				});
			const floor = scene.createMesh({
				mesh: geometry.plane({ width: 400, height: 400 }),
				material: materials.standard({ color: '#2b3440', roughness: 0.9 }),
			});
			floor.setRotationEuler(-Math.PI / 2, 0, 0);
		} else {
			throw new Error(`?case= must be exposure, alpha, opaque, phone, rain or fog`);
		}

		page.onMessage((name, data) => {
			if (name === 'taa') {
				const value = data as {
					feedback?: number;
					phone?: boolean;
					reactive?: typeof reactive;
				} | null;
				feedback = value?.feedback ?? feedback;
				phone = value?.phone ?? phone;
				reactive = value?.reactive ?? reactive;
				setResolve();
				void scene.warmUp().then(() => page.post('settled', {}));
			} else if (name === 'taa-off') {
				feedback = 0;
				setResolve();
				void scene.warmUp().then(() => page.post('settled', {}));
			}
		});
		return {
			onUpdate() {
				if (frames) page.post('frame', time.frame);
				// The exposure case doubles the exposure at a frame of the sequence, so every run
				// draws the step at the same frame and the history sees the same change.
				if (CASE === 'exposure') {
					const wanted = time.frame >= EXPOSURE_STEP ? 2 : 1;
					if (wanted !== exposure) {
						exposure = wanted;
						post.set({ exposure: wanted });
					}
				}
				// The phone case's square slides across the view from the frame number, so every run
				// draws the same picture in the same frame and the mask's effect is steady.
				if (moving) moving.setPosition(90 * Math.sin(time.frame * 0.12), 0, NEAR);
			},
		};
	},
);
