// Haze at the far end of a gorge, where a scene's land runs out: a stack of thin, unlit sheets
// across the gorge, each a little thicker than the one before it, so the land, the water and the
// walls fade into the haze with distance and the last sheet hides the end of the world. Each sheet is
// thick near the ground and thins with height, so the sky shows above the haze. The sheets take the
// color of the air at the horizon, which the scene's stage gives each frame, so the haze matches the
// sky at every hour.
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
	/** The height up to which the last sheet hides everything, in meters above y = 0. */
	solid: number;
	/** The height over which the haze thins away above that, in meters. */
	fade: number;
	/** The sheets from the start to the end. */
	sheets: number;
}

/** The haze of a scene, whose color follows the air's. */
export interface Haze {
	/** Gives the haze the air's linear color at the horizon. */
	setColor(color: readonly [number, number, number]): void;
}

const wgsl = /* wgsl */ `
struct Uniforms { air: vec3f, share: f32, solid: f32, fade: f32 }

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    // Unlit: the sheet adds the air's own color and hides what lies behind it by its share.
    s.baseColor = vec3f(0.0);
    s.roughness = 1.0;
    s.metalness = 0.0;
    s.emissive = material.air;
    let height = input.worldPosition.y;
    let thins = 1.0 - smoothstep(material.solid, material.solid + material.fade, height);
    // The sheet's sides fade, so no straight edge shows where it reaches past the walls.
    let side = 1.0 - smoothstep(0.7, 1.0, abs(input.uv.x * 2.0 - 1.0));
    s.alpha = material.share * thins * side;
    return s;
}
`;

/** Makes the haze across a gorge. */
export function createHaze(
	{ scene, geometry, materials }: SketchContext,
	options: HazeOptions,
): Haze {
	const { bearing, from, to, halfWidth, solid, fade, sheets } = options;
	const height = solid + fade;
	const along = [Math.cos(bearing), Math.sin(bearing)] as const;
	// The sheets face back toward the middle: a plane in x and y, whose normal +z turns about +y to
	// point back along the bearing.
	const yaw = Math.atan2(-along[0], -along[1]);
	const turn = [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)] as const;
	const plane = geometry.plane({ width: 2 * halfWidth, height });
	const color: [number, number, number] = [0, 0, 0];
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
			uniforms: { air: color, share, solid, fade },
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
	return {
		setColor(next) {
			if (next[0] === color[0] && next[1] === color[1] && next[2] === color[2]) return;
			color[0] = next[0];
			color[1] = next[1];
			color[2] = next[2];
			for (const material of layers) material.set({ air: color });
		},
	};
}
