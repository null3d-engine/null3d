// The island's ground, drawn by the terrain add-on: meadow, dry earth, rock and sand, weighted by
// the place's height and steepness and by what stands there. The blocks near the camera split down
// to fine detail, and the far ones stay coarse, so the whole island fits one view and a close look
// stays sharp.
import { math, type QualityPreset, type SketchContext, type Texture } from '@null3d/engine';
import { createTerrain, type Terrain } from '@null3d/terrain';
import { Noise } from '../../lib/procedural';
import {
	beachShare,
	GROUND,
	golfShare,
	harbourShare,
	hypot,
	inland,
	onOutcrop,
	sandWidth,
	sandyBed,
	VILLAGES,
} from './island';
import { canopyAt, groundHeight, slopeAt } from './plan';

/** The height field's samples along a side and the splat map's texels, for each preset. */
const DETAIL: Record<QualityPreset, { samples: number; splat: number; texture: number }> = {
	low: { samples: 513, splat: 512, texture: 128 },
	medium: { samples: 769, splat: 768, texture: 256 },
	high: { samples: 1025, splat: 1024, texture: 256 },
	ultra: { samples: 1025, splat: 1536, texture: 512 },
};

const noise = new Noise(53);
const { smoothstep } = math;

/** How much rock shows on a crown's steep knob, in bands along its height, broken into patches. */
function crownRock(x: number, z: number, y: number, slope: number): number {
	const near = VILLAGES.some(([vx, vz, , r]) => hypot(x - vx, z - vz) < r * 0.7);
	if (!near) return 0;
	const strata = smoothstep(Math.sin(y * 1.6 + 2 * noise.fbm2(x * 0.05, z * 0.05, 2)), -0.1, 0.5);
	return smoothstep(slope, 0.5, 1) * (0.1 + 0.4 * strata);
}

/** The weights of forest floor, dry ground, rock and sand at a point. */
function splat(x: number, z: number, out: number[]): void {
	const d = inland(x, z);
	const y = groundHeight(x, z);
	const slope = slopeAt(x, z);
	const beach = beachShare(x, z);
	const quay = harbourShare(x, z);
	// Under the water, the shelf's bed is pale only over the bay's and the harbour's sand. Elsewhere it is
	// dark rock, broken by darker weed in patches that read as reef.
	const under = 1 - smoothstep(y, -1.2, -0.4);
	const sandy = sandyBed(x, z);
	const sand = Math.max(
		beach * (1 - smoothstep(d, sandWidth(x, z) - 2, sandWidth(x, z) + 5)),
		under * sandy,
	);
	const weed =
		under * (1 - sandy) * smoothstep(noise.fbm2(x * 0.035 + 9, z * 0.035, 3), -0.08, 0.02);
	// Bare rock stands in the cliffs, on the coast and on the steepest ground.
	const rock = Math.max(
		smoothstep(slope, 1.3, 2) * (1 - smoothstep(d, 30, 70)),
		// The named outcrops show their rock.
		onOutcrop(x, z) ? 1 : 0,
		// A crown's knob shows rock in strata and patches under its tower.
		crownRock(x, z, y, slope),
		// Crags stand in patches on the hills' steepest faces.
		smoothstep(slope, 0.95, 1.35) *
			smoothstep(noise.fbm2(x * 0.012 + 40, z * 0.012, 3), -0.05, 0.2) *
			smoothstep(y, 90, 130),
		(1 - beach) * (1 - quay) * (1 - smoothstep(d, 16, 36)),
		under * (1 - sandy) * (1 - weed),
	);
	// The ground lies dark under trees and dry in the open, mottled at a few meters. Wet sand darkens softly
	// toward the water.
	const under_trees = canopyAt(x, z);
	const mottle = smoothstep(noise.fbm2(x * 0.09 + 3, z * 0.09, 3), -0.25, 0.25);
	const kept = golfShare(x, z);
	const wet = beach * (1 - smoothstep(y, 0, 0.6)) * (1 - under) * 0.55;
	const dry = Math.max(0, 1 - under_trees * 1.2) * (0.55 + 0.45 * mottle) * (1 - kept);
	const earth = Math.max(dry, wet);
	out[3] = sand * (1 - wet);
	out[2] = rock * (1 - sand);
	out[1] = earth * (1 - rock) * (1 - sand * (1 - wet));
	out[0] = Math.max(0, 1 - (out[1] as number) - (out[2] as number) - (out[3] as number));
}

/** A tiling map from a color, a coarse mottle and a fine grain, with its height in alpha. */
function groundMap(
	{ textures }: SketchContext,
	size: number,
	color: readonly [number, number, number],
	dark: readonly [number, number, number],
	scale: number,
): Texture {
	const data = new Uint8Array(size * size * 4);
	const cells = Math.round(scale);
	for (let row = 0; row < size; row++)
		for (let column = 0; column < size; column++) {
			const u = column / size;
			const v = row / size;
			const mottle = noise.fbm2(u * cells, v * cells, 4, cells) * 0.5 + 0.5;
			// The grain stays well below the texel's size: a finer one forms rings of moire far off.
			const grain = noise.fbm2(u * 24, v * 24, 2, 24) * 0.5 + 0.5;
			const mix = Math.min(1, Math.max(0, mottle * 0.8 + grain * 0.2));
			const at = (row * size + column) * 4;
			for (let c = 0; c < 3; c++) {
				const low = dark[c] as number;
				data[at + c] = low + ((color[c] as number) - low) * mix;
			}
			data[at + 3] = 255 * mix;
		}
	return textures.fromData({
		width: size,
		height: size,
		data,
		colorSpace: 'srgb',
		wrap: 'repeat',
		mipmaps: true,
	});
}

/**
 * The screen error, in pixels, that a block's cell may show at each preset. A coarse block's grid spans
 * a road's cut and lifts ground through the road by about a quarter of its cell, so this keeps that
 * lift to a few pixels wherever such a block draws.
 */
export const GROUND_ERROR: Record<QualityPreset, number> = {
	low: 16,
	medium: 12,
	high: 10,
	ultra: 8,
};

/** Makes the island's ground for the preset. */
export function createLand(ctx: SketchContext): Terrain {
	const detail = DETAIL[ctx.quality.preset];
	const size = detail.texture;
	return createTerrain(ctx, {
		size: GROUND,
		height: groundHeight,
		resolution: detail.samples,
		layers: [
			// The dark floor under trees.
			{
				map: groundMap(ctx, size, [112, 98, 60], [72, 62, 38], 8),
				tile: 4,
				heightFrom: 'alpha',
				contrast: 0.25,
			},
			// Dry grass and warm earth in the open.
			{
				map: groundMap(ctx, size, [116, 106, 66], [76, 74, 44], 12),
				tile: 5,
				heightFrom: 'alpha',
				contrast: 0.25,
			},
			// Ochre and grey rock.
			{
				map: groundMap(ctx, size, [122, 112, 94], [74, 68, 58], 10),
				tile: 9,
				roughness: 0.9,
				heightFrom: 'alpha',
				contrast: 0.25,
			},
			// Golden sand.
			{
				map: groundMap(ctx, size, [232, 206, 154], [206, 176, 124], 16),
				tile: 7,
				roughness: 0.95,
				heightFrom: 'alpha',
				contrast: 0.25,
			},
		],
		splat,
		splatResolution: detail.splat,
		maxLevel: 5,
		error: GROUND_ERROR[ctx.quality.preset],
		// The blocks' own normals light the ground: a map of them bands on the gentlest slopes.
		bakedNormals: false,
		steepFaces: true,
	});
}
