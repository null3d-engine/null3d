// One pedunculate oak drawn at three distances from one camera, with the whole crown in each
// frame, and the share of each crown's own box that its foliage covers. The three copies stand in
// the bands of distance that the plant core draws its card levels in, so the reading shows whether
// a farther card level keeps the density of a nearer one: a level whose cards thinned without
// growing would leave holes, and its share would fall.
//
// Each copy is scaled with its distance, so every crown fills the same share of the frame and the
// three boxes never meet. The background is black and the only light is the sky's ambient light,
// so a pixel either holds a leaf or stays dark, as the leaf card coverage test measured.
import type { Camera, SketchContext } from '@null3d/engine';
import {
	growPlant,
	loadSpecies,
	type PlantAsset,
	placePlants,
	plantMaterials,
	prepareSpecies,
} from '@null3d/vegetation';

/** The picture's size in pixels. */
export const FRAME = { width: 1280, height: 720 } as const;

/** The camera's vertical field of view in degrees. */
export const FOV = 40;

/** The seed and variant that grow the crown, so every run draws the same plant. */
const SEED = 11;
const VARIANT = 0;

/** The mesh tier the kit keeps, so a preset cannot change the picture. */
const DETAIL = 'medium' as const;

/** The crown's diameter as a share of the frame's height, the same at every distance. */
const CROWN_SHARE = 0.34;

/** Where each crown's centre sits across the frame, from its left edge. */
const ACROSS = [1 / 6, 1 / 2, 5 / 6] as const;

/** The world height of every crown's centre, which the camera looks along. */
const HEIGHT = 30;

/** The view at which an asset measures its level distances: a 1080-pixel render at 60 degrees. */
const ASSET_VIEW = { height: 1080, fov: 60 } as const;

/** A rectangle of a picture, in pixels. */
export interface Box {
	readonly left: number;
	readonly top: number;
	readonly right: number;
	readonly bottom: number;
}

/** One crown's distance, scale and box on the picture. */
export interface Crown {
	/** The distance from the camera to the crown's centre, in metres. */
	readonly distance: number;
	/** The scale the copy draws at. */
	readonly scale: number;
	/** The world half-extents of the crown's box. */
	readonly half: readonly [number, number, number];
}

/** What the sketch posts: where the copies stand and where their boxes lie on the picture. */
export interface CoverageFacts {
	readonly distances: readonly number[];
	/** The two level boundaries, in metres at this page's view. */
	readonly levels: { readonly nearSplit: number; readonly secondStart: number };
	readonly boxes: readonly Box[];
}

/** The page's own controls, which a proving run turns and the manifest test leaves alone. */
export interface CoverageOptions {
	/** How far toward its sparse form the plant grows, from 0 to 1. */
	readonly sparse?: number;
	/** The card material's coverage cutoff, in place of the plant core's own. */
	readonly cardCutoff?: number;
}

const TAN_HALF = Math.tan((FOV * Math.PI) / 360);

/** The factor from the asset's reference view's distances to this page's. */
const VIEW_SCALE =
	FRAME.height / TAN_HALF / (ASSET_VIEW.height / Math.tan((ASSET_VIEW.fov * Math.PI) / 360));

/** The largest value a spread takes. */
function spreadMax(spread: number | { readonly mean: number; readonly spread: number }): number {
	return typeof spread === 'number' ? spread : spread.mean + spread.spread;
}

/** What the coverage row needs after setup: the camera and each crown's box. */
export interface CoverageRow {
	readonly camera: Camera;
	readonly distances: readonly number[];
	readonly levels: CoverageFacts['levels'];
	readonly crowns: readonly {
		readonly centre: readonly [number, number, number];
		readonly half: readonly [number, number, number];
	}[];
}

/**
 * Grows the oak and places three copies at three distances: two in the first band of the plant
 * core's card levels and one in the second.
 *
 * @param ctx The sketch's context.
 * @param options The proving controls; the record's own grow by default.
 * @returns The camera and each crown's centre and half-extents.
 */
export async function addCoverageRow(
	ctx: SketchContext,
	options: CoverageOptions = {},
): Promise<CoverageRow> {
	const { scene } = ctx;
	scene.setBackground('#000000');
	// The sky's ambient light alone, so every drawn surface stands above the black background.
	scene.createAmbientLight({ intensity: 1 });

	const module = await loadSpecies('pedunculate-oak');
	const kit = await prepareSpecies(ctx, module, { detail: DETAIL, placeholders: 'missing' });
	const asset: PlantAsset = await growPlant(kit, {
		seed: SEED,
		variant: VARIANT,
		near: true,
		...(options.sparse !== undefined && { sparse: options.sparse }),
	});
	const materials = plantMaterials(ctx, kit, {});
	if (options.cardCutoff !== undefined) materials.cards.set({ alphaCutoff: options.cardCutoff });

	const crown = asset.crown;
	// The distance at which the longest shoot covers the record's first switch pixels, which is
	// where the nearest level hands over to the first card level.
	const scale = kit.record.shoots ? spreadMax(kit.record.shoots.placement.scale) : 1;
	let longest = 0;
	for (const prototype of kit.prototypes) longest = Math.max(longest, prototype.length);
	const switchPixels = kit.record.lod.switchPixels;
	const nearSplit = (longest * scale * FRAME.height) / (2 * TAN_HALF * switchPixels[0]);
	// The second card level's own start, measured at the asset's reference view.
	const secondStart = asset.levels[2].from * VIEW_SCALE;
	// Two distances in the first band and one in the second, away from the hand-over edges: the first
	// card level draws from the shoot split to the second's start, and the second from its start out.
	const distances = [Math.max(nearSplit * 2, 20), secondStart * 0.5, secondStart * 1.25];

	// A crown keeps the same share of the frame at every distance, so its scale follows the
	// distance.
	const perMetre = (CROWN_SHARE * TAN_HALF) / crown.radius;
	const position = new Float32Array(distances.length * 3);
	const turn = new Float32Array(distances.length);
	const scales = new Float32Array(distances.length);
	const variant = new Uint8Array(distances.length);
	const crowns = distances.map((distance, index) => {
		const size = perMetre * distance;
		// The camera looks down +z with the world's up, so its right-hand direction is -x. A crown
		// centre lands at the place across the frame that ACROSS names.
		const across = ((ACROSS[index] as number) - 0.5) * 2;
		const x = -across * distance * TAN_HALF * (FRAME.width / FRAME.height);
		position[index * 3] = x - crown.centre[0] * size;
		position[index * 3 + 1] = HEIGHT - crown.centre[1] * size;
		position[index * 3 + 2] = distance - crown.centre[2] * size;
		scales[index] = size;
		const halfHeight = Math.max(0, crown.top - crown.base) / 2;
		return {
			centre: [x, HEIGHT, distance] as const,
			half: [crown.radius * size, halfHeight * size, crown.radius * size] as const,
		};
	});
	placePlants(
		ctx,
		kit,
		[asset],
		{
			count: distances.length,
			position,
			turn,
			scale: scales,
			variant,
		},
		{ materials, view: { height: FRAME.height, fov: FOV }, castShadows: false },
	);

	const camera = scene.createPerspectiveCamera({
		fov: FOV,
		near: 0.1,
		far: 10_000,
		position: [0, HEIGHT, 0],
		target: [0, HEIGHT, 1],
	});
	scene.setActiveCamera(camera);
	return { camera, distances, levels: { nearSplit, secondStart }, crowns };
}

/**
 * The rectangle that a crown's world box covers on the picture, with a small margin for the
 * silhouettes' edges.
 *
 * @param camera The camera that the frame draws with, from `addCoverageRow`.
 * @param crown The crown's world centre and half-extents.
 * @param margin How many pixels to add past each edge.
 * @returns The box's edges in pixels.
 */
export function projectCrown(
	camera: Camera,
	crown: CoverageRow['crowns'][number],
	margin = 3,
): Box {
	const out: [number, number, number] = [0, 0, 0];
	let left = Number.POSITIVE_INFINITY;
	let top = Number.POSITIVE_INFINITY;
	let right = Number.NEGATIVE_INFINITY;
	let bottom = Number.NEGATIVE_INFINITY;
	for (const sx of [-1, 1])
		for (const sy of [-1, 1])
			for (const sz of [-1, 1]) {
				const point: readonly [number, number, number] = [
					(crown.centre[0] as number) + sx * (crown.half[0] as number),
					(crown.centre[1] as number) + sy * (crown.half[1] as number),
					(crown.centre[2] as number) + sz * (crown.half[2] as number),
				];
				camera.worldToScreen(point, out);
				left = Math.min(left, out[0]);
				top = Math.min(top, out[1]);
				right = Math.max(right, out[0]);
				bottom = Math.max(bottom, out[1]);
			}
	return {
		left: Math.floor(left) - margin,
		top: Math.floor(top) - margin,
		right: Math.ceil(right) + margin,
		bottom: Math.ceil(bottom) + margin,
	};
}

/**
 * The share of each crown's own box that draws anything at all, from a frame's RGBA pixels.
 *
 * @param pixels The frame's pixels, four a texel, in row order from the top.
 * @param width The picture's width in pixels.
 * @param height The picture's height in pixels.
 * @param boxes The crown boxes.
 * @returns The covered share of each box, in the order given.
 */
export function measureCoverage(
	pixels: Uint8Array,
	width: number,
	height: number,
	boxes: readonly Box[],
): number[] {
	return boxes.map((box) => {
		let drawn = 0;
		let total = 0;
		for (let y = Math.max(0, box.top); y < Math.min(height, box.bottom); y++)
			for (let x = Math.max(0, box.left); x < Math.min(width, box.right); x++) {
				const at = (y * width + x) * 4;
				total += 1;
				// The background is black, so any lit leaf stands above it.
				const lit = (pixels[at] ?? 0) + (pixels[at + 1] ?? 0) + (pixels[at + 2] ?? 0);
				if (lit > 12) drawn += 1;
			}
		return total > 0 ? drawn / total : 0;
	});
}
