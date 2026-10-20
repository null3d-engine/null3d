// Haze at the far end of a gorge, where a scene's land runs out: a stack of thin, unlit sheets
// across the gorge, each a little thicker than the one before it, so the land, the water and the
// walls fade into the haze with distance and the last sheet hides the end of the world. Each sheet is
// thick near the ground and thins with height, so the sky shows above the haze. Over the gorge's
// floor the haze lies low, so a sun that rises or sets down the gorge shows almost to the water, and
// it climbs with the walls either side, which it hides where they end. The sheets take the color of
// the air at the horizon, which the scene's stage gives each frame, so the haze matches the sky at
// every hour, and they glow toward the sun with the light they scatter forward.
import type { SketchContext } from '@null3d/engine';

/** Where a scene's haze stands. */
export interface HazeOptions {
	/** The bearing that the haze lies along from the middle, in radians from +x toward +z. */
	bearing: number;
	/** Where the haze starts and ends along that bearing, in meters from the middle. */
	from: number;
	to: number;
	/** How far either side of the bearing's line the sheets reach, in meters. */
	halfWidth: number;
	/** The height up to which the last sheet hides everything over the walls, in meters above y = 0. */
	solid: number;
	/** The height over which the haze thins away above that, in meters. */
	fade: number;
	/**
	 * The gap over the gorge's floor, where the haze lies lower: its half width, the width over which
	 * the haze climbs from it to the walls' height, and its own solid and thinning heights, in meters.
	 */
	floor: { halfWidth: number; rise: number; solid: number; fade: number };
	/** The sheets from the start to the end. */
	sheets: number;
}

/** The main light that the haze glows toward: the direction toward it, and its linear color. */
export interface HazeLight {
	toward: readonly [number, number, number];
	color: readonly [number, number, number];
}

/** The haze of a scene, whose color follows the air's. */
export interface Haze {
	/** Gives the haze the air's linear color at the horizon, and the light it glows toward. */
	update(air: readonly [number, number, number], light: HazeLight): void;
}

const wgsl = /* wgsl */ `
struct Uniforms {
    air: vec3f,
    share: f32,
    sun: vec3f,
    solid: f32,
    glow: vec3f,
    fade: f32,
    half: f32,
    gap: f32,
    rise: f32,
    low: f32,
    thin: f32,
}

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    // Unlit: the sheet adds the air's own color and hides what lies behind it by its share. Toward
    // the light the air scatters it forward, a wide glow with a bright core about the sun.
    s.baseColor = vec3f(0.0);
    s.roughness = 1.0;
    s.metalness = 0.0;
    let toward = max(dot(-input.viewDirection, material.sun), 0.0);
    let lobe = 0.3 * pow(toward, 6.0) + pow(toward, 80.0);
    s.emissive = material.air + material.glow * lobe;
    // Over the floor the haze lies low, and it climbs with the walls either side of it.
    let across = abs(input.uv.x * 2.0 - 1.0) * material.half;
    let walls = smoothstep(material.gap, material.gap + material.rise, across);
    let solid = mix(material.low, material.solid, walls);
    let fade = mix(material.thin, material.fade, walls);
    let thins = 1.0 - smoothstep(solid, solid + fade, input.worldPosition.y);
    // The sheet's sides fade, so no straight edge shows where it reaches past the walls.
    let side = 1.0 - smoothstep(0.7, 1.0, abs(input.uv.x * 2.0 - 1.0));
    s.alpha = material.share * thins * side;
    return s;
}
`;

/** How much of the main light the haze scatters toward the camera at the core of its glow. */
const GLOW = 0.35;

/** Makes the haze across a gorge. */
export function createHaze(
	{ scene, geometry, materials }: SketchContext,
	options: HazeOptions,
): Haze {
	const { bearing, from, to, halfWidth, solid, fade, floor, sheets } = options;
	const height = solid + fade;
	const along = [Math.cos(bearing), Math.sin(bearing)] as const;
	// The sheets face back toward the middle: a plane in x and y, whose normal +z turns about +y to
	// point back along the bearing.
	const yaw = Math.atan2(-along[0], -along[1]);
	const turn = [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)] as const;
	const plane = geometry.plane({ width: 2 * halfWidth, height });
	const air: [number, number, number] = [0, 0, 0];
	const sun: [number, number, number] = [0, 1, 0];
	const glow: [number, number, number] = [0, 0, 0];
	const layers = Array.from({ length: sheets }, (_, k) => {
		const t = sheets === 1 ? 1 : k / (sheets - 1);
		const distance = from + (to - from) * t;
		// Each sheet hides a little more than the one before, and the last hides all.
		const share = k === sheets - 1 ? 1 : 0.06 + 0.22 * t * t;
		const material = materials.shader({
			wgsl,
			fog: false,
			doubleSided: true,
			alphaMode: 'blend',
			depthWrite: false,
			uniforms: {
				air,
				share,
				sun,
				solid,
				glow,
				fade,
				half: halfWidth,
				gap: floor.halfWidth,
				rise: floor.rise,
				low: floor.solid,
				thin: floor.fade,
			},
		});
		scene.createMesh({
			mesh: plane,
			material,
			position: [along[0] * distance, height / 2 - 4, along[1] * distance],
			rotation: turn,
			castShadows: false,
			receiveShadows: false,
		});
		return material;
	});
	/** Writes `next` into `into`, and says whether any value changed. */
	const take = (into: [number, number, number], next: readonly number[], scale = 1): boolean => {
		let changed = false;
		for (let c = 0; c < 3; c++) {
			const value = (next[c] as number) * scale;
			if (value !== into[c]) changed = true;
			into[c] = value;
		}
		return changed;
	};
	return {
		update(nextAir, light) {
			const changed = [
				take(air, nextAir),
				take(sun, light.toward),
				take(glow, light.color, GLOW),
			].some(Boolean);
			if (!changed) return;
			for (const material of layers) material.set({ air, sun, glow });
		},
	};
}
