// The weather add-on's cost, for its cost page: a lit ground fills the view, so every pixel runs the
// wet surface block. On the page's 'off' and 'on' messages the ground takes one of two materials:
// by default a plain ground and the wet ground, and with ?mirror=1 the wet ground without and with
// the planar reflection. The sketch posts 'settled' once the material is built. ?scale= draws at
// that render scale, and ?fixed holds it with the governor off.
//
// ?show=1 adds the add-on's other parts for a held picture: a canopy in front with the windshield
// drops, and the splashes and steam from the particles add-on. The ground starts with the add-on's
// water, so a page that sends no message shows it.
//
// The module uses no type annotations: an address whose last value holds a dot, such as scale=0.5,
// makes the dev server read the module as JavaScript.
import { defineSketch } from '@null3d/engine';
import {
	createSplashes,
	createSteam,
	createWetSurface,
	createWindshield,
} from '../../../examples/addons/weather/index';

const params = new URL(import.meta.url).searchParams;
const SCALE = params.get('scale');
const FIXED = params.has('fixed');
const MIRROR = params.get('mirror') === '1';
const SHOW = params.has('show');

/** The wet ground of the cost page: the block copied from the add-on, over a plain surface. */
const wetGround = /* wgsl */ `
#import null3d::noise::{value2}
#import null3d::reflection::{reflection_uv}

struct Uniforms {
    wet0: vec4f,
    wet1: vec4f,
    wet2: vec4f,
}

var wetMirror: texture_2d<f32>;

// <wet-surface>
/// The water depth at a place from two octaves of value noise, for a scene with no puddle map. The
/// scale is the width of the largest puddles in meters, and the result runs from 0 for dry ground
/// to 1 for deep water.
fn wet_noise_depth(p: vec2f, scale: f32) -> f32 {
    let large = value2(p / max(scale, 1e-3));
    let small = value2(p / max(scale * 0.37, 1e-3) + 13.0);
    return large * 0.68 + small * 0.32;
}

/// Adds water to a surface. The state is the scene's surface, which this returns wetted; the depth
/// is the scene's own water depth, from a map or from wet_noise_depth, where 0 is dry ground. The
/// vectors carry the look:
/// wet0 = (puddle coverage, edge softness, ripple cell in meters, ripples a second),
/// wet1 = (darken, planar mirror share, wet roughness, ripple strength),
/// wet2 = (time, rain, grain scale, dry asphalt's share of the planar mirror).
/// The surface faces up, as a road or a floor does.
fn wet_surface(
    state: Surface,
    input: SurfaceInput,
    depth: f32,
    wet0: vec4f,
    wet1: vec4f,
    wet2: vec4f,
) -> Surface {
    var s = state;
    let p = input.worldPosition.xz;
    let rain = clamp(wet2.y, 0.0, 1.0);
    let edge = 1.0 - wet0.x;
    let water = smoothstep(edge, edge + max(wet0.y, 1e-4), depth) * rain;
    // The asphalt between the puddles keeps its grain, but rain has darkened and smoothed it, and
    // it shows a share of the planar mirror that its grain breaks into streaks.
    let road = (1.0 - water) * clamp(wet2.w, 0.0, 1.0) * rain;
    if (water <= 0.0 && road <= 0.0) {
        return s;
    }

    // Rain rings: one drop at a time in each cell, its place and its moment from the cell's hash.
    // The cell is wet0.z meters across, and its ring grows and fades over a second or so.
    let cell = floor(p / max(wet0.z, 1e-3));
    let jitter = (vec2f(value2(cell), value2(cell + 17.0)) - 0.5) * 0.35;
    let at = fract(p / max(wet0.z, 1e-3)) - 0.5 - jitter;
    let phase = fract(wet2.x * wet0.w + value2(cell + 3.0));
    let radius = phase * 0.42;
    let d = (length(at) - radius) / 0.07;
    let ring = exp(-d * d) * (1.0 - phase) * water;
    let tilt = normalize(at + vec2f(1e-4, 1e-4)) * ring * wet1.w;

    // The planar mirror, where the scene gave one. The branch is on a uniform, so the sample is
    // uniform; the texture coordinates are not, which textureSampleLevel allows.
    var mirrored = vec3f(0.0);
    if (wet1.y > 0.0) {
        // The asphalt's grain moves each pixel's sample across the mirror, so each reflected light
        // leaves a short broken streak on the wet road, while a puddle stays a clean mirror.
        let grain = vec2f(value2(p * wet2.z), value2(p * wet2.z + 29.0)) - 0.5;
        let smear = grain * vec2f(0.004, 0.3) * (1.0 - water);
        let clip = camera.viewProjection * vec4f(input.relativePosition, 1.0);
        mirrored = textureSampleLevel(
            wetMirror,
            wetMirrorSampler,
            reflection_uv(clip, tilt * 0.08 + smear),
            0.0,
        ).rgb;
    }

    // Water darkens the surface and smooths it, and the rings bend its normal. Light from the
    // mirror direction takes the place of the environment's reflection where the water shows.
    s.baseColor = s.baseColor * mix(1.0, wet1.x, water);
    s.roughness = mix(s.roughness, wet1.z, water);
    s.normal = normalize(mix(s.normal, vec3f(tilt.x, 1.0, tilt.y), water));
    s.reflection = vec4f(mirrored, clamp(wet1.y, 0.0, 1.0) * (water + road));
    return s;
}
// </wet-surface>

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let depth = wet_noise_depth(input.worldPosition.xz, 9.0);
    return wet_surface(s, input, depth, material.wet0, material.wet1, material.wet2);
}
`;

export default defineSketch(async (ctx) => {
	const { scene, materials, geometry, time, quality, page } = ctx;
	if (SCALE !== null) {
		const scale = Number(SCALE);
		quality.set({
			minRenderScale: FIXED ? scale : Math.min(scale, 0.5),
			maxRenderScale: scale,
			governor: !FIXED,
		});
	}
	scene.setBackground('#070a10');
	scene.setActiveCamera(
		scene.createPerspectiveCamera({
			fov: 50,
			near: 0.1,
			far: 120,
			position: [0, 3.2, 7.5],
			target: [0, 0.4, -1],
		}),
	);
	scene.createDirectionalLight({
		direction: [-0.4, -0.8, -0.5],
		color: '#a8c0ff',
		intensity: 2.4,
	});
	scene.createAmbientLight({ color: '#28324a', intensity: 0.6 });

	// A row of glowing posts over the ground, so the mirror has something to show.
	const glow = materials.unlit({ color: '#ffcf9a' });
	for (let k = 0; k < 5; k++)
		scene.createMesh({
			mesh: geometry.box({ width: 0.25, height: 1.6, depth: 0.25 }),
			material: glow,
			position: [-6 + k * 3, 0.8, -3 - (k % 2) * 2],
		});

	// The dry ground, and the add-on's water over the same ground. The mirror pass exists only in
	// the mirror comparison, so it never draws over the plain comparison's frames.
	const plain = materials.standard({ color: '#1b1d21', roughness: 0.55 });
	const wetOff = createWetSurface(ctx, {
		coverage: 0.55,
		softness: 0.055,
		rippleSize: 0.9,
		rippleRate: 0.8,
		darken: 0.5,
		mirrorShare: 0,
		wetRoughness: 0.03,
		rippleStrength: 0.32,
		rain: 1,
		grainScale: 1.6,
		roadMirror: 0,
	});
	const wetOn = createWetSurface(ctx, {
		coverage: 0.55,
		softness: 0.055,
		rippleSize: 0.9,
		rippleRate: 0.8,
		darken: 0.5,
		mirrorShare: 1,
		wetRoughness: 0.03,
		rippleStrength: 0.32,
		rain: 1,
		grainScale: 1.6,
		roadMirror: 0.5,
		...(MIRROR ? { reflection: { scale: 0.5 as const } } : { reflection: false as const }),
	});
	const plainWet = materials.shader({
		wgsl: wetGround,
		color: '#1b1d21',
		roughness: 0.55,
		uniforms: { ...wetOff.uniforms },
		textures: { wetMirror: wetOff.textures.wetMirror },
	});
	const mirroredWet = materials.shader({
		wgsl: wetGround,
		color: '#1b1d21',
		roughness: 0.55,
		uniforms: { ...wetOn.uniforms },
		textures: { wetMirror: wetOn.textures.wetMirror },
	});
	const ground = scene.createMesh({
		mesh: geometry.plane({ width: 60, height: 60 }),
		// A page that sends no message shows the add-on's water, as the held picture needs.
		material: MIRROR ? mirroredWet : plainWet,
		rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
	});
	// True while the mirror material draws, or always where the comparison has no mirror pass.
	let onSide = true;
	page.onMessage((message) => {
		if (message === 'off') {
			ground.setMaterial(MIRROR ? plainWet : plain);
			onSide = false;
			if (MIRROR) wetOn.pause();
			return;
		}
		if (message !== 'on') return;
		onSide = true;
		ground.setMaterial(MIRROR ? mirroredWet : plainWet);
		void scene.warmUp().then(() => page.post('settled', {}));
	});

	// The add-on's other parts, for the held picture: drops on a canopy in front, and the splashes
	// and steam from the particles add-on on the ground. A function keeps the types inferred, since
	// this module carries no annotations.
	const buildShow = async () => {
		scene.createPointLight({ position: [1.6, 2.4, 5], color: '#ffd7b0', intensity: 30, range: 20 });
		const shield = createWindshield(ctx, {
			mesh: geometry.plane({ width: 2.4, height: 1.35 }),
			position: [0, 1.55, 3.4],
			wiper: { every: 7, duration: 0.9 },
		});
		const spray = await createSplashes(ctx, {
			position: [0, 0.03, 0.5],
			size: [9, 0.02, 9],
			rate: 45,
		});
		const vapour = await createSteam(ctx, {
			position: [2.2, 0.3, -1.2],
			size: [0.4, 0.1, 0.4],
			rate: 9,
		});
		return {
			shield,
			late: () => {
				spray.update();
				vapour.update();
			},
		};
	};
	const show = SHOW ? await buildShow() : null;
	return {
		onUpdate() {
			// Both wet materials keep their own values, so either side is ready when it draws. The
			// mirror's pass draws only while its own side does.
			wetOff.update(plainWet, time.now);
			if (onSide) wetOn.update(mirroredWet, time.now);
			if (show) show.shield.update(time.now);
		},
		onLateUpdate() {
			if (show) show.late();
		},
	};
});
