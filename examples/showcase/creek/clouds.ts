// The sea of cloud that the cliff stands in. Below the rim, a stack of thin shells draws the cloud's
// billowing tops, which drift on the wind. The lowest shell is the cloud's top itself: it covers
// everything, so no view sees the cliff's foot or the sky's own ground, and the billows' height and
// slope light it, bright on the heaps and grey in the hollows. The shells above are veils where the
// billows rise through them, which give the sea its depth beside the cliff. Each shell fades where
// it meets the rock, so the walls sink into the cloud with no line. Soft heaps of cloud drift on the
// sea round the cliff, banks of mist rise against the walls, and far out great towers of cloud stand
// past the horizon. A dome far round the camera carries the cloud on to the horizon and up into the
// overcast, so no view finds an edge. Every part takes the air's color and the main light from the
// stage each frame, greyed and cast lilac, so the clouds match every hour.
import type { QualityPreset, SketchContext } from '@null3d/engine';
import { createParticles, type ParticleSystem, particleTextures } from '@null3d/particles';
import { EFFECT_LAYER } from '../../lib/layers';
import type { Stage } from '../../lib/stage';
import { CLOUD_TOP, RIM } from './land';

/**
 * The cloud sea: the height of its highest tops, how deep its billows run under them, how far the
 * shells reach from the cliff, and the dome's radius, all in meters.
 */
export const CLOUD = { top: CLOUD_TOP, depth: 6.5, reach: 700, dome: 1600 } as const;
/** The shells at each preset: the cloud's top, and the veils over it. */
const SHELLS: Record<QualityPreset, number> = { low: 2, medium: 3, high: 4, ultra: 5 };
/** How fast the billows drift, in meters a second along x and z. */
const DRIFT = [0.45, 0.2] as const;
/**
 * The heaps of cloud on the sea round the cliff: how far out they lie, how many stand at each
 * preset, how long each lives, and their sizes, in meters.
 */
const HEAPS = { reach: 150, life: [70, 110] as const, size: [8, 20] as const };
const HEAP_COUNT: Record<QualityPreset, number> = { low: 90, medium: 160, high: 240, ultra: 320 };
/**
 * The towers: great heaps of cloud that stand far round the cliff and rise past the horizon, so no
 * view finds a level line where the sea meets the sky: how many groups, how far out, the puffs in
 * each, their lives and their sizes, in meters.
 */
const TOWERS = {
	groups: 10,
	reach: [190, 420] as const,
	puffs: 9,
	life: [240, 320] as const,
	size: [55, 120] as const,
} as const;
/** The banks of mist round the walls: how many, how many puffs each holds, and their lives. */
const BANKS = 16;
const BANK_PUFFS = 12;
const BANK_LIFE: readonly [number, number] = [26, 40];

/**
 * One shell of the sea: the cloud where the billows rise past the shell's height. The shells and the
 * dome each hold a copy of the cloud's light, between the markers, which `clouds.test.ts` holds equal.
 */
const shellWgsl = /* wgsl */ `
#import null3d::noise::{worley2, fbm2}

struct Uniforms {
    air: vec3f,
    height: f32,
    toward: vec3f,
    solid: f32,
    sun: vec3f,
    soft: f32,
    tint: vec3f,
    top: f32,
    drift: vec2f,
    depth: f32,
    reach: f32,
}

// light {
/// The cloud's own tone of the air: the air's color, greyed toward its brightness and cast a faint
/// lilac, since a cloud is never as blue as the sky at the horizon.
fn cloud_air() -> vec3f {
    let grey = dot(material.air, vec3f(0.2126, 0.7152, 0.0722));
    return mix(vec3f(grey), material.air, 0.15) * material.tint;
}

/// The cloud's color: the air's, darker in the hollows, with the main light on the tops that face it.
fn cloud_color(lift: f32, facing: f32) -> vec3f {
    // The sky lights the tops and leaves the hollows grey; the side toward the main light is a
    // step brighter even under cloud, and the light itself adds where it breaks through.
    let shade = mix(3.4, 6.2, lift * lift * (3.0 - 2.0 * lift)) * (0.95 + 0.07 * facing);
    return cloud_air() * shade + material.sun * material.tint * 0.3 * max(facing, 0.0) * (0.4 + 0.6 * lift);
}

/// The air between the camera and a point: the cloud fades into the air's own color with distance.
fn aerial(color: vec3f, distance: f32) -> vec3f {
    return mix(color, cloud_air() * 5.9, 1.0 - exp(-distance / 380.0));
}
// } light

/// The cloud's billows at a point of the ground, from 0 in the deepest hollow to 1 on a top.
fn billows(p: vec2f) -> f32 {
    let q = p + material.drift * frame.time;
    // Fine billows fade with distance, so the far sea never shows a repeating grain.
    let far = smoothstep(80.0, 420.0, length(p - camera.position.xz));
    // Smooth heaps of cloud, warped by a broad noise so no two share a size or a shape: big soft
    // masses, smaller lumps on them, and broad swells over the whole sea.
    let warp = vec2f(fbm2(q / 60.0, 2u), fbm2(q / 60.0 + vec2f(5.2, 1.3), 2u)) * 6.0;
    let r = q + warp;
    let masses = fbm2(r / 30.0, 3u) * 0.5 + 0.5;
    let lumps = (fbm2(r / 9.0 + vec2f(7.3, 1.9), 2u) * 0.5 + 0.5) * (1.0 - far);
    let swell = fbm2(q / 140.0, 2u) * 0.5 + 0.5;
    let raw = 0.62 * masses + 0.16 * lumps + 0.3 * swell + 0.08 * far;
    // Spread over the whole depth, so the heaps stand clear of the grey gaps between them.
    return smoothstep(0.38, 0.74, raw);
}

/// The distance in front of the camera of a depth value, as sceneDistance converts the copy's.
fn distance_of(depth: f32) -> f32 {
    let near = engine_frame.camera_range.x;
    let far = engine_frame.camera_range.y;
    if engine_frame.camera_position.w > 0.5 {
        return near * far / (near + depth * (far - near));
    }
    return far - depth * (far - near);
}

fn unlit(input: SurfaceInput) -> vec4f {
    let p = input.worldPosition.xz;
    let surface = material.top - material.depth + material.depth * billows(p);
    // The billows' slope on the ground, from their change across the pixel, lights their sides.
    let dh = vec2f(dpdx(surface), dpdy(surface));
    let dwx = dpdx(p);
    let dwy = dpdy(p);
    let det = dwx.x * dwy.y - dwx.y * dwy.x;
    let slope = select(vec2f(0.0), vec2f(dh.x * dwy.y - dh.y * dwx.y, dh.y * dwx.x - dh.x * dwy.x) / det, abs(det) > 1e-10);
    let normal = normalize(vec3f(-slope.x, 1.0, -slope.y) + vec3f(0.0, 0.5, 0.0));
    // The lowest shell is the cloud's lit top itself: it covers everything, and the billows' height
    // and slope shade it. The shells above are veils where the billows rise through them, which give
    // the sea its depth by the cliff; a broad noise frays each veil into wisps.
    let fray = fbm2(p / 4.5 + material.drift * frame.time * 0.4, 2u) * material.soft;
    let veil = 0.4 * smoothstep(material.height - material.soft, material.height + material.soft, surface + fray);
    // The veils give depth beside the cliff and thin away from it, where the heaps carry the form.
    var alpha = mix(veil * (1.0 - smoothstep(45.0, 110.0, length(p))), 1.0, material.solid);
    // The shell thins toward its far edge, where the dome carries the cloud on.
    alpha *= 1.0 - smoothstep(material.reach * 0.6, material.reach, length(p));
    // The shell fades where it meets the rock, so the walls sink into the cloud with no line.
    let uv = input.fragCoord.xy / frame.resolution;
    let own = distance_of(input.fragCoord.z);
    let behind = sceneDistance(uv);
    alpha *= select(1.0, smoothstep(0.0, 3.0, behind - own), behind > 0.0);
    let level = clamp((material.height - (material.top - material.depth)) / material.depth, 0.0, 1.0);
    let lift = mix(level, (surface - (material.top - material.depth)) / material.depth, material.solid);
    let color = cloud_color(lift, dot(normal, material.toward));
    return vec4f(aerial(color, length(input.relativePosition)), alpha);
}
`;

/**
 * The dome far round the camera: the far sea below the horizon, which the view meets at the cloud's
 * top, and the banks round the horizon that rise and merge into the sky.
 */
const domeWgsl = /* wgsl */ `
#import null3d::noise::{worley2, fbm2}

struct Uniforms {
    air: vec3f,
    top: f32,
    toward: vec3f,
    reach: f32,
    sun: vec3f,
    tint: vec3f,
}

// light {
/// The cloud's own tone of the air: the air's color, greyed toward its brightness and cast a faint
/// lilac, since a cloud is never as blue as the sky at the horizon.
fn cloud_air() -> vec3f {
    let grey = dot(material.air, vec3f(0.2126, 0.7152, 0.0722));
    return mix(vec3f(grey), material.air, 0.15) * material.tint;
}

/// The cloud's color: the air's, darker in the hollows, with the main light on the tops that face it.
fn cloud_color(lift: f32, facing: f32) -> vec3f {
    // The sky lights the tops and leaves the hollows grey; the side toward the main light is a
    // step brighter even under cloud, and the light itself adds where it breaks through.
    let shade = mix(3.4, 6.2, lift * lift * (3.0 - 2.0 * lift)) * (0.95 + 0.07 * facing);
    return cloud_air() * shade + material.sun * material.tint * 0.3 * max(facing, 0.0) * (0.4 + 0.6 * lift);
}

/// The air between the camera and a point: the cloud fades into the air's own color with distance.
fn aerial(color: vec3f, distance: f32) -> vec3f {
    return mix(color, cloud_air() * 5.9, 1.0 - exp(-distance / 380.0));
}
// } light

fn unlit(input: SurfaceInput) -> vec4f {
    let dir = normalize(input.relativePosition);
    let around = vec2f(dir.x, dir.z) / max(length(vec2f(dir.x, dir.z)), 1e-4);
    // The banks round the horizon: taller in places, with billowing tops.
    let bank = 0.05 + 0.17 * (fbm2(around * 1.7 + vec2f(3.1, 0.4), 3u) * 0.5 + 0.5)
        + 0.03 * (1.0 - worley2(around * 9.0));
    let cover = 1.0 - smoothstep(bank - 0.06, bank + 0.03, dir.y);
    // Above the banks the air stays thick, and the overcast thins up to the sky's own cloud overhead.
    let haze = mix(0.95, 0.7, smoothstep(bank, 0.9, dir.y));
    // Below the horizon, the far sea: where the view meets the cloud's top, its broad swells.
    let down = max(-dir.y, 1e-3);
    let reach = (camera.position.y - material.top) / down;
    let far = camera.position.xz + around * reach * length(vec2f(dir.x, dir.z));
    let swell = fbm2(far / 160.0, 3u) * 0.5 + 0.5;
    let below = step(dir.y, 0.0);
    let lift = mix(0.75, 1.0, swell) * below + (1.0 - below);
    let color = cloud_color(lift, 0.4 * material.toward.y + 0.3);
    let distance = select(material.reach * 3.0, reach, dir.y < 0.0);
    // Overhead the overcast is a little darker than at the horizon, where the light comes through.
    let overhead = mix(1.1, 0.9, smoothstep(0.1, 1.0, dir.y));
    return vec4f(aerial(color, distance) * overhead, max(cover, haze));
}
`;

/** The cloud sea round the cliff, and what each frame and preset change on it. */
export interface Clouds {
	/** Gives the clouds the air's linear color at the horizon and the main light, from the stage. */
	update(air: readonly [number, number, number], light: Stage['light']): void;
	/** Shows the shells of a preset: fewer on weaker devices. */
	fit(preset: QualityPreset): void;
	/** Steps the heaps', the banks' and the towers' particles, which a frame calls in its late update. */
	step(): void;
}

/** The faint lilac cast of the concept's cloud, never pure white. */
const TINT = [1.0, 0.975, 1.02] as const;

/** Makes the cloud sea, its far dome and the banks round the walls. */
export async function createClouds(ctx: SketchContext, preset: QualityPreset): Promise<Clouds> {
	const { scene, geometry, materials, textures } = ctx;
	const air: [number, number, number] = [0.6, 0.62, 0.66];
	const toward: [number, number, number] = [0, 1, 0];
	const sun: [number, number, number] = [0, 0, 0];
	const most = SHELLS.ultra;
	const plane = geometry.plane({ width: CLOUD.reach * 2, height: CLOUD.reach * 2 });
	const flat = [Math.sin(-Math.PI / 4), 0, 0, Math.cos(-Math.PI / 4)] as const;
	const uniforms = {
		air,
		toward,
		sun,
		tint: [...TINT] as [number, number, number],
		top: CLOUD.top,
		depth: CLOUD.depth,
		drift: [...DRIFT] as [number, number],
		reach: CLOUD.reach,
	};
	/**
	 * Each shell's height, from the lowest up, for a stack of `count`: the lit top at the billows'
	 * middle height, and the veils spread over the upper half, where the tops rise through them.
	 */
	const heightOf = (k: number, count: number) =>
		k === 0
			? CLOUD.top - CLOUD.depth * 0.6
			: CLOUD.top - CLOUD.depth * 0.5 + (CLOUD.depth * 0.45 * k) / Math.max(1, count - 1);
	const shells = Array.from({ length: most }, (_, k) => {
		const material = materials.shader({
			wgsl: shellWgsl,
			fog: false,
			alphaMode: 'blend',
			depthWrite: false,
			sceneInputs: ['sceneDepth'],
			uniforms: {
				...uniforms,
				height: heightOf(k, most),
				solid: k === 0 ? 1 : 0,
				soft: 0.8 + 0.5 * (k / most),
			},
		});
		const mesh = scene.createMesh({
			mesh: plane,
			material,
			position: [0, heightOf(k, most), 0],
			rotation: flat,
			castShadows: false,
			receiveShadows: false,
		});
		mesh.setRenderOrder(-10 + k);
		return { material, mesh };
	});
	const dome = materials.shader({
		wgsl: domeWgsl,
		fog: false,
		alphaMode: 'blend',
		depthWrite: false,
		doubleSided: true,
		uniforms: { air, toward, sun, tint: uniforms.tint, top: CLOUD.top, reach: CLOUD.reach },
	});
	scene
		.createMesh({
			mesh: geometry.sphere({ radius: CLOUD.dome, widthSegments: 48, heightSegments: 24 }),
			material: dome,
			castShadows: false,
			receiveShadows: false,
		})
		.setRenderOrder(-20);

	// The banks: puffs of mist that rise slowly against the walls, below the rim and past it.
	const smoke = particleTextures.smoke(textures, { size: 128 });
	const color: [number, number, number] = [...air];
	// The heaps: soft masses of cloud that sit on the sea's top round the cliff and drift with it,
	// so the sea reads as billows rather than a sheet. Each is a large puff seen from above.
	const heaps = await createParticles(ctx, {
		...smoke,
		layers: EFFECT_LAYER,
		prewarm: true,
		seed: 89,
		position: [0, CLOUD.top - CLOUD.depth * 0.35, 0],
		shape: { type: 'box', size: [HEAPS.reach * 2, CLOUD.depth * 0.4, HEAPS.reach * 2] },
		rate: HEAP_COUNT[preset] / HEAPS.life[1],
		lifetime: HEAPS.life,
		speed: [0, 0],
		velocity: [DRIFT[0], 0, DRIFT[1]],
		size: HEAPS.size,
		colorOverLife: [color, color],
		alphaOverLife: [0, 0.8, 0.8, 0.8, 0],
		softness: 3,
		blending: 'normal',
	});
	const banked: ParticleSystem[] = await Promise.all(
		Array.from({ length: BANKS }, (_, k) => {
			const bearing = (k / BANKS) * Math.PI * 2 + 0.31 * Math.sin(k * 2.7);
			const out = RIM + 2.5 + 2 * Math.sin(k * 1.9);
			const rising = k % 4 === 0;
			return createParticles(ctx, {
				...smoke,
				layers: EFFECT_LAYER,
				prewarm: true,
				seed: 91 + k,
				position: [Math.cos(bearing) * out, rising ? -8 : -11, Math.sin(bearing) * out],
				shape: { type: 'sphere', radius: 5 },
				rate: BANK_PUFFS / BANK_LIFE[1],
				lifetime: BANK_LIFE,
				speed: [0, 0.05],
				velocity: [DRIFT[0] * 0.5, rising ? 0.22 : 0.06, DRIFT[1] * 0.5],
				size: rising ? [7, 11] : [6, 10],
				colorOverLife: [color, color],
				alphaOverLife: [0, 0.42, 0.42, 0],
				softness: 4,
				blending: 'normal',
			});
		}),
	);
	const towers: ParticleSystem[] = await Promise.all(
		Array.from({ length: TOWERS.groups }, (_, k) => {
			const bearing = (k / TOWERS.groups) * Math.PI * 2 + 0.4 * Math.sin(k * 3.1);
			const out =
				TOWERS.reach[0] + (TOWERS.reach[1] - TOWERS.reach[0]) * (0.5 + 0.5 * Math.sin(k * 2.3));
			return createParticles(ctx, {
				...smoke,
				layers: EFFECT_LAYER,
				prewarm: true,
				seed: 131 + k,
				position: [Math.cos(bearing) * out, CLOUD.top + 14, Math.sin(bearing) * out],
				shape: { type: 'box', size: [110, 26, 110] },
				rate: TOWERS.puffs / TOWERS.life[1],
				lifetime: TOWERS.life,
				speed: [0, 0],
				velocity: [DRIFT[0], 0, DRIFT[1]],
				size: TOWERS.size,
				colorOverLife: [color, color],
				alphaOverLife: [0, 0.85, 0.85, 0.85, 0],
				softness: 8,
				blending: 'normal',
			});
		}),
	);
	const systems: readonly ParticleSystem[] = [heaps, ...banked, ...towers];
	/** The particles' color last written, which a frame changes only past a visible step. */
	const shown: [number, number, number] = [-1, -1, -1];
	const fit = (next: QualityPreset) => {
		const count = SHELLS[next];
		shells.forEach(({ mesh, material }, k) => {
			// The lowest shell always draws; the others spread evenly over the rest of the depth.
			mesh.setVisible(k < count);
			const height = heightOf(k, count);
			mesh.setPosition(0, height, 0);
			material.setUniform('height', height);
			material.setUniform('soft', 0.8 + 0.5 * (k / count));
		});
	};
	fit(preset);
	return {
		update(nextAir, light) {
			for (let c = 0; c < 3; c++) {
				air[c] = nextAir[c] as number;
				toward[c] = light.toward[c] as number;
				sun[c] = light.color[c] as number;
			}
			dome.setUniform('air', air);
			dome.setUniform('toward', toward);
			dome.setUniform('sun', sun);
			for (const { material } of shells) {
				material.setUniform('air', air);
				material.setUniform('toward', toward);
				material.setUniform('sun', sun);
			}
			if (
				Math.abs(air[0] - shown[0]) + Math.abs(air[1] - shown[1]) + Math.abs(air[2] - shown[2]) >
				0.01
			) {
				// The cloud's own tone, as the shaders' `cloud_air` gives it: the air greyed and cast lilac.
				const grey = 0.2126 * air[0] + 0.7152 * air[1] + 0.0722 * air[2];
				for (let c = 0; c < 3; c++) {
					shown[c] = air[c] as number;
					color[c] = (grey + ((air[c] as number) - grey) * 0.15) * (TINT[c] as number) * 5.6;
				}
				for (const system of systems) system.set({ colorOverLife: [color, color] });
			}
		},
		fit,
		step() {
			for (const system of systems) system.update();
		},
	};
}
