// The CPU plant preview's drawing: a grown plant's wood as tapered strokes at its real radii, and
// its shoot rows as their prototypes' own triangles with the leaf outline cut from them, through
// the package's card-bake rasteriser. A canvas keeps, per pixel, what covers it and a tone, so one
// drawing gives a colour picture, a matte and a coverage figure. Nothing here needs a browser or a
// GPU.
import type {
	PlantAsset,
	PrototypeArrays,
	ShootRows,
	SpeciesKitData,
} from '../../../packages/vegetation/src/asset.ts';
import type { MacroSkeleton } from '../../../packages/vegetation/src/core/graph.ts';
import { DETAILS } from '../../../packages/vegetation/src/core/types.ts';
import { SURFACE_LEAF } from '../../../packages/vegetation/src/leaf/writer.ts';
import { paletteOf } from '../../../packages/vegetation/src/lod/card-bake.ts';
import {
	type RasterTarget,
	rasterise,
	rasterTarget,
} from '../../../packages/vegetation/src/lod/raster.ts';
import { blank, type Rgba } from '../plant-review/image.ts';
import { type PreviewCamera, pixelsPerMetre, project } from './camera.ts';

/** What covers a pixel. */
export const COVER_NONE = 0;
export const COVER_WOOD = 1;
export const COVER_LEAF = 2;
export const COVER_MARK = 3;

/** Texels a side of the leaf outline mask the card bake makes. */
const MASK_SIZE = 512;

/**
 * A picture being drawn: its depth, what covers each pixel, a tone from 0 to 255, and the share of
 * each pixel left clear, which a matte reads. A card that covers part of a pixel leaves the rest
 * clear, and every card over a pixel takes its share of what the cards before it left.
 */
export interface Canvas {
	readonly width: number;
	readonly height: number;
	readonly target: RasterTarget;
	readonly cover: Uint8Array;
	readonly tone: Uint8Array;
	readonly clear: Float32Array;
}

/** An empty canvas of a size. */
export function canvas(width: number, height: number): Canvas {
	return {
		width,
		height,
		target: rasterTarget(width, height),
		cover: new Uint8Array(width * height),
		tone: new Uint8Array(width * height),
		clear: new Float32Array(width * height).fill(1),
	};
}

/** How the wood is drawn. */
export interface WoodStyle {
	/** The least width of a stroke in pixels, so a twig thinner than a pixel still shows; 0 for none. */
	readonly least?: number;
	/** The tone of each axis by its order, or one tone for all the wood. */
	readonly tone?: (order: number) => number;
	/** The finest order drawn; every order when absent. */
	readonly orders?: number;
}

const SIDES = 10;
const DISC = Array.from({ length: SIDES }, (_, k) => {
	const angle = (k / SIDES) * 2 * Math.PI;
	return [Math.cos(angle), Math.sin(angle)] as const;
});

/**
 * Draws a skeleton's wood: each internode a stroke from its parent node to its own, as wide at each
 * end as the wood is there, with a disc at the node so a bend closes.
 *
 * @param into The canvas.
 * @param camera The camera.
 * @param skeleton The skeleton.
 * @param style The least width, the tones and the orders drawn.
 */
export function drawWood(
	into: Canvas,
	camera: PreviewCamera,
	skeleton: MacroSkeleton,
	style: WoodStyle = {},
): void {
	const { position, radius, parent, axisOf, axes } = skeleton;
	const least = (style.least ?? 0) / 2;
	const ends = new Float64Array(6);
	// A stroke's quad and the discs at its two ends: four corners, then two fans.
	const points = new Float64Array((4 + 2 * (SIDES + 1)) * 3);
	const indices: number[] = [0, 1, 2, 0, 2, 3];
	for (let fan = 0; fan < 2; fan++) {
		const centre = 4 + fan * (SIDES + 1);
		for (let k = 0; k < SIDES; k++)
			indices.push(centre, centre + 1 + k, centre + 1 + ((k + 1) % SIDES));
	}
	let tone = 60;
	const shade = (f: { x: number; y: number }): boolean => {
		const at = f.y * into.width + f.x;
		into.cover[at] = COVER_WOOD;
		into.tone[at] = tone;
		into.clear[at] = 0;
		return true;
	};
	for (let n = 0; n < skeleton.nodeCount; n++) {
		const p = parent[n] as number;
		if (p < 0) continue;
		const order = axes.order[axisOf[n] as number] as number;
		if (style.orders !== undefined && order > style.orders) continue;
		project(
			camera,
			position[p * 3] as number,
			position[p * 3 + 1] as number,
			position[p * 3 + 2] as number,
			ends,
			0,
		);
		project(
			camera,
			position[n * 3] as number,
			position[n * 3 + 1] as number,
			position[n * 3 + 2] as number,
			ends,
			3,
		);
		if (Number.isNaN(ends[0] as number) || Number.isNaN(ends[3] as number)) continue;
		// A side axis's first stroke starts on its parent's bark, at the side axis's own girth.
		const sameAxis = (axisOf[p] as number) === (axisOf[n] as number);
		const r1 = (radius[n] as number) * pixelsPerMetre(camera, ends[5] as number);
		const r0 = sameAxis ? (radius[p] as number) * pixelsPerMetre(camera, ends[2] as number) : r1;
		const w0 = Math.max(least, r0);
		const w1 = Math.max(least, r1);
		const dx = (ends[3] as number) - (ends[0] as number);
		const dy = (ends[4] as number) - (ends[1] as number);
		const length = Math.hypot(dx, dy);
		const nx = length > 1e-9 ? -dy / length : 1;
		const ny = length > 1e-9 ? dx / length : 0;
		const corners = [
			[(ends[0] as number) + nx * w0, (ends[1] as number) + ny * w0, ends[2] as number],
			[(ends[0] as number) - nx * w0, (ends[1] as number) - ny * w0, ends[2] as number],
			[(ends[3] as number) - nx * w1, (ends[4] as number) - ny * w1, ends[5] as number],
			[(ends[3] as number) + nx * w1, (ends[4] as number) + ny * w1, ends[5] as number],
		];
		corners.forEach((corner, k) => {
			points.set(corner as number[], k * 3);
		});
		// A stem's foot stands flat on the ground: its stroke's first disc would reach under it.
		const foot = (parent[p] as number) < 0;
		for (let fan = 0; fan < 2; fan++) {
			const cx = ends[fan * 3] as number;
			const cy = ends[fan * 3 + 1] as number;
			const cz = ends[fan * 3 + 2] as number;
			const w = fan === 0 ? (foot ? 0 : w0) : w1;
			const base = (4 + fan * (SIDES + 1)) * 3;
			points[base] = cx;
			points[base + 1] = cy;
			points[base + 2] = cz;
			DISC.forEach(([c, s], k) => {
				points[base + 3 + k * 3] = cx + c * w;
				points[base + 4 + k * 3] = cy + s * w;
				points[base + 5 + k * 3] = cz;
			});
		}
		tone = style.tone ? style.tone(order) : 60;
		rasterise(into.target, points, indices, shade);
	}
}

/** The lowest tier of a prototype's meshes that the kit holds. */
function drawnTier(kit: SpeciesKitData): number {
	for (let tier = 0; tier < DETAILS.length; tier++)
		if (kit.prototypes.some((p) => (p.tiers[tier]?.indices.length ?? 0) > 0)) return tier;
	return 0;
}

/**
 * Draws a plant's shoot rows: every triangle of each row's prototype, turned, scaled and placed as
 * the row places it, with a leaf's triangles kept only where its outline covers them. A row's tone
 * is the sky its crown light gives it, so the lit outer masses read lighter than the inside.
 *
 * @param into The canvas.
 * @param camera The camera.
 * @param kit The species' kit, whose prototypes the rows draw.
 * @param rows The shoot rows.
 * @returns The highest point any row's mesh reaches, in metres; 0 with no rows.
 */
export function drawShoots(
	into: Canvas,
	camera: PreviewCamera | undefined,
	kit: SpeciesKitData,
	rows: ShootRows,
): number {
	const tier = drawnTier(kit);
	const mask = paletteOf(kit.record, kit.manifest).mask;
	let most = 0;
	for (const prototype of kit.prototypes)
		most = Math.max(most, (prototype.tiers[tier]?.positions.length ?? 0) / 3);
	const points = new Float64Array(most * 3);
	let mesh: PrototypeArrays | undefined;
	let tone = 0;
	const shade = (f: {
		triangle: number;
		x: number;
		y: number;
		w0: number;
		w1: number;
		w2: number;
	}): boolean => {
		const arrays = mesh as PrototypeArrays;
		const t = f.triangle * 3;
		const a = arrays.indices[t] as number;
		const b = arrays.indices[t + 1] as number;
		const c = arrays.indices[t + 2] as number;
		const leaf = (arrays.colors[a * 4 + 2] as number) === SURFACE_LEAF;
		if (leaf && mask) {
			const u =
				(arrays.uvs[a * 2] as number) * f.w0 +
				(arrays.uvs[b * 2] as number) * f.w1 +
				(arrays.uvs[c * 2] as number) * f.w2;
			const v =
				(arrays.uvs[a * 2 + 1] as number) * f.w0 +
				(arrays.uvs[b * 2 + 1] as number) * f.w1 +
				(arrays.uvs[c * 2 + 1] as number) * f.w2;
			const mx = Math.min(MASK_SIZE - 1, Math.max(0, Math.floor(u * MASK_SIZE)));
			const my = Math.min(MASK_SIZE - 1, Math.max(0, Math.floor(v * MASK_SIZE)));
			if (!mask[my * MASK_SIZE + mx]) return false;
		}
		const at = f.y * into.width + f.x;
		into.cover[at] = leaf ? COVER_LEAF : COVER_WOOD;
		into.tone[at] = leaf ? tone : 70;
		into.clear[at] = 0;
		return true;
	};
	let top = 0;
	const q = rows.rotation;
	for (let r = 0; r < rows.count; r++) {
		mesh = kit.prototypes[rows.prototype[r] as number]?.tiers[tier];
		if (!mesh || mesh.indices.length === 0) continue;
		const x = q[r * 4] as number;
		const y = q[r * 4 + 1] as number;
		const z = q[r * 4 + 2] as number;
		const w = q[r * 4 + 3] as number;
		const s = rows.scale[r] as number;
		// The row's rotation as a matrix, times its scale.
		const m00 = (1 - 2 * (y * y + z * z)) * s;
		const m01 = 2 * (x * y - z * w) * s;
		const m02 = 2 * (x * z + y * w) * s;
		const m10 = 2 * (x * y + z * w) * s;
		const m11 = (1 - 2 * (x * x + z * z)) * s;
		const m12 = 2 * (y * z - x * w) * s;
		const m20 = 2 * (x * z - y * w) * s;
		const m21 = 2 * (y * z + x * w) * s;
		const m22 = (1 - 2 * (x * x + y * y)) * s;
		const px = rows.position[r * 3] as number;
		const py = rows.position[r * 3 + 1] as number;
		const pz = rows.position[r * 3 + 2] as number;
		const positions = mesh.positions;
		const count = positions.length / 3;
		for (let i = 0; i < count; i++) {
			const vx = positions[i * 3] as number;
			const vy = positions[i * 3 + 1] as number;
			const vz = positions[i * 3 + 2] as number;
			const wy = py + m10 * vx + m11 * vy + m12 * vz;
			if (wy > top) top = wy;
			if (camera)
				project(
					camera,
					px + m00 * vx + m01 * vy + m02 * vz,
					wy,
					pz + m20 * vx + m21 * vy + m22 * vz,
					points,
					i * 3,
				);
		}
		if (!camera) continue;
		tone = 70 + Math.round(((rows.sky[r] as number) / 250) * 150);
		rasterise(into.target, points, mesh.indices, shade);
	}
	return top;
}

/** The second texture coordinate that marks a card's stalk, and how near it a vertex must stand. */
const STALK_PLANE = 0.75;
/** The coverage at which a card's texel counts as leaf: the plant material's own cutoff. */
const CARD_CUTOFF = 0.5;
/** How much a card's coverage rises for each mip level its sample reads, as the material raises it. */
const CARD_MIP_LIFT = 0.05;
/** The width in pixels of the still a review draws, which sets the mip level a card's sample reads. */
const STILL_WIDTH = 768;
/** The mip levels of the card atlas that a whole view can reach. */
const MIP_LEVELS = 4;
/** The largest step of a quantised position or texture coordinate. */
const TOP = 65535;

/**
 * The mip level a part's cards read at a still: the base-two log of the atlas texels that one of
 * the still's pixels spans, from the part's median triangle, and never below the atlas's own level.
 */
function mipLevel(
	points: Float64Array,
	uvs: Uint16Array,
	indices: ArrayLike<number>,
	size: number,
	canvasPerStill: number,
): number {
	const spans: number[] = [];
	const step = Math.max(3, Math.floor(indices.length / 3 / 400) * 3);
	for (let t = 0; t + 2 < indices.length; t += step) {
		const a = indices[t] as number;
		const b = indices[t + 1] as number;
		const c = indices[t + 2] as number;
		const pixels = Math.abs(
			((points[b * 3] as number) - (points[a * 3] as number)) *
				((points[c * 3 + 1] as number) - (points[a * 3 + 1] as number)) -
				((points[b * 3 + 1] as number) - (points[a * 3 + 1] as number)) *
					((points[c * 3] as number) - (points[a * 3] as number)),
		);
		const texels =
			Math.abs(
				((uvs[b * 2] as number) - (uvs[a * 2] as number)) *
					((uvs[c * 2 + 1] as number) - (uvs[a * 2 + 1] as number)) -
					((uvs[b * 2 + 1] as number) - (uvs[a * 2 + 1] as number)) *
						((uvs[c * 2] as number) - (uvs[a * 2] as number)),
			) *
			(size / TOP) *
			(size / TOP);
		if (pixels > 1e-6 && Number.isFinite(pixels)) spans.push(Math.sqrt(texels / pixels));
	}
	if (spans.length === 0) return 0;
	spans.sort((x, y) => x - y);
	const perCanvasPixel = spans[spans.length >> 1] as number;
	return Math.max(0, Math.log2(Math.max(1, perCanvasPixel * canvasPerStill)));
}

/** A quantised part's points for a camera, and each vertex's height in metres. */
function partPoints(
	camera: PreviewCamera,
	kit: SpeciesKitData,
	positions: Uint16Array,
): { readonly points: Float64Array; readonly heights: Float32Array } {
	const { min, max } = kit.box;
	const sx = (max[0] - min[0]) / TOP;
	const sy = (max[1] - min[1]) / TOP;
	const sz = (max[2] - min[2]) / TOP;
	const count = positions.length / 3;
	const points = new Float64Array(count * 3);
	const heights = new Float32Array(count);
	for (let i = 0; i < count; i++) {
		const y = min[1] + (positions[i * 3 + 1] as number) * sy;
		heights[i] = y;
		project(
			camera,
			min[0] + (positions[i * 3] as number) * sx,
			y,
			min[2] + (positions[i * 3 + 2] as number) * sz,
			points,
			i * 3,
		);
	}
	return { points, heights };
}

/**
 * Draws a detail level's solid parts as the plant's material draws them: its wood, with the root
 * flare, the roots and the joins the wood mesher builds, and its extras, read back from the level's
 * own quantised parts. What stands below the ground is not drawn, as a review's ground hides it.
 *
 * @param into The canvas.
 * @param camera The camera.
 * @param kit The species' kit, whose box the parts are quantised against.
 * @param asset The grown variant.
 * @param level The detail level.
 * @returns Whether the level holds wood to draw.
 */
export function drawLevelWood(
	into: Canvas,
	camera: PreviewCamera,
	kit: SpeciesKitData,
	asset: PlantAsset,
	level: 0 | 1 | 2,
): boolean {
	let drawn = false;
	for (const part of asset.levels[level].parts) {
		if (part.name !== 'wood' && part.name !== 'extras') continue;
		if (part.name === 'wood') drawn = true;
		const { indices } = part.arrays;
		const { points, heights } = partPoints(camera, kit, part.arrays.positions);
		const tone = part.name === 'wood' ? 60 : 90;
		rasterise(into.target, points, indices, (f) => {
			const t = f.triangle * 3;
			const y =
				(heights[indices[t] as number] as number) * f.w0 +
				(heights[indices[t + 1] as number] as number) * f.w1 +
				(heights[indices[t + 2] as number] as number) * f.w2;
			if (y < 0) return false;
			const at = f.y * into.width + f.x;
			into.cover[at] = COVER_WOOD;
			into.tone[at] = tone;
			into.clear[at] = 0;
			return true;
		});
	}
	return drawn;
}

/**
 * Draws a card level's cards as the plant's material draws them: each card's quad, read back from
 * the level's own quantised part, with the card atlas's coverage at the mip level a review's still
 * reads. A whole view of a tree stands past the distance where its shoots hand over to their cards,
 * so this is the foliage a review's whole view shows. The colours keep a card where its coverage
 * passes the material's cutoff; the matte takes every card's own coverage, one over another, as the
 * matte material blends them. A card's tone is its row's sky.
 *
 * @param into The canvas.
 * @param camera The camera.
 * @param kit The species' kit, whose card atlas the cards read.
 * @param asset The grown variant.
 * @param level The card level.
 */
export function drawCards(
	into: Canvas,
	camera: PreviewCamera,
	kit: SpeciesKitData,
	asset: PlantAsset,
	level: 1 | 2,
): void {
	const { size, color } = kit.cards;
	if (size === 0) return;
	// The front layer's coverage and its mip levels, each the mean of four texels of the one below,
	// as the GPU's sampler reads a card that spans fewer pixels than its cell holds texels.
	const levels: { readonly side: number; readonly alpha: Float32Array }[] = [];
	const base = new Float32Array(size * size);
	for (let i = 0; i < size * size; i++) base[i] = (color[i * 4 + 3] as number) / 255;
	levels.push({ side: size, alpha: base });
	for (let k = 1; k <= MIP_LEVELS && size >> k >= 1; k++) {
		const below = levels[k - 1] as { readonly side: number; readonly alpha: Float32Array };
		const side = below.side >> 1;
		const alpha = new Float32Array(side * side);
		for (let y = 0; y < side; y++)
			for (let x = 0; x < side; x++) {
				const at = y * 2 * below.side + x * 2;
				alpha[y * side + x] =
					((below.alpha[at] as number) +
						(below.alpha[at + 1] as number) +
						(below.alpha[at + below.side] as number) +
						(below.alpha[at + below.side + 1] as number)) /
					4;
			}
		levels.push({ side, alpha });
	}
	/** One mip level's coverage at a point of the texture, between its four nearest texels. */
	const sample = (k: number, u: number, v: number): number => {
		const { side, alpha } = levels[k] as { readonly side: number; readonly alpha: Float32Array };
		const x = Math.min(side - 1.001, Math.max(0, u * side - 0.5));
		const y = Math.min(side - 1.001, Math.max(0, v * side - 0.5));
		const x0 = Math.floor(x);
		const y0 = Math.floor(y);
		const fx = x - x0;
		const fy = y - y0;
		const at = y0 * side + x0;
		return (
			((alpha[at] as number) * (1 - fx) + (alpha[at + 1] as number) * fx) * (1 - fy) +
			((alpha[at + side] as number) * (1 - fx) + (alpha[at + side + 1] as number) * fx) * fy
		);
	};
	let mip = 0;
	/** The atlas's coverage at a point of the texture, between the two mip levels a card reads. */
	const coverage = (u: number, v: number): number => {
		const low = Math.min(levels.length - 1, Math.floor(mip));
		const high = Math.min(levels.length - 1, low + 1);
		const share = mip - low;
		return share > 0 && high !== low
			? sample(low, u, v) * (1 - share) + sample(high, u, v) * share
			: sample(low, u, v);
	};
	// The mip level a card's sample reads at the review's still: the atlas texels one of the still's
	// pixels spans, from the texels a canvas pixel spans on a card of the mean row's size.
	const shown = new Float32Array(into.width * into.height).fill(Infinity);
	let lift = 1;
	for (const part of asset.levels[level].parts) {
		if (part.name !== 'cards') continue;
		const { uvs, uvs1, colors, indices } = part.arrays;
		const { points } = partPoints(camera, kit, part.arrays.positions);
		mip = mipLevel(points, uvs, indices, size, into.width / STILL_WIDTH);
		lift = 1 + CARD_MIP_LIFT * mip;
		rasterise(into.target, points, indices, (f) => {
			const t = f.triangle * 3;
			const a = indices[t] as number;
			const b = indices[t + 1] as number;
			const c = indices[t + 2] as number;
			// A stalk is a line the material widens on screen; its quad has no area here.
			if (Math.abs((uvs1[a * 2 + 1] as number) / TOP - STALK_PLANE) < 0.1) return false;
			const u =
				((uvs[a * 2] as number) * f.w0 +
					(uvs[b * 2] as number) * f.w1 +
					(uvs[c * 2] as number) * f.w2) /
				TOP;
			const v =
				((uvs[a * 2 + 1] as number) * f.w0 +
					(uvs[b * 2 + 1] as number) * f.w1 +
					(uvs[c * 2 + 1] as number) * f.w2) /
				TOP;
			const at = f.y * into.width + f.x;
			const alpha = Math.min(1, coverage(u, v) * lift);
			into.clear[at] = (into.clear[at] as number) * (1 - alpha);
			if (alpha < CARD_CUTOFF) return false;
			// A card nearer than the leaf already drawn here takes the pixel's colour; the depth stays
			// the wood's, so every card in front of the wood adds its coverage whatever their order.
			if (f.depth < (shown[at] as number)) {
				shown[at] = f.depth;
				into.cover[at] = COVER_LEAF;
				into.tone[at] = 70 + Math.round(((colors[a * 4 + 3] as number) / 250) * 150);
			}
			return false;
		});
	}
}

/**
 * Marks points on a canvas with small squares, in front of everything: the bud sites a skeleton
 * picture shows at its branch ends.
 *
 * @param into The canvas.
 * @param camera The camera.
 * @param positions Three per point, in plant space.
 * @param half The square's half-width in pixels.
 * @param tone The mark's tone.
 */
export function drawMarks(
	into: Canvas,
	camera: PreviewCamera,
	positions: ArrayLike<number>,
	half: number,
	tone: number,
): void {
	const at = new Float64Array(3);
	for (let i = 0; i + 2 < positions.length; i += 3) {
		project(
			camera,
			positions[i] as number,
			positions[i + 1] as number,
			positions[i + 2] as number,
			at,
			0,
		);
		if (Number.isNaN(at[0] as number)) continue;
		const cx = Math.round(at[0] as number);
		const cy = Math.round(at[1] as number);
		for (let y = cy - half; y <= cy + half; y++)
			for (let x = cx - half; x <= cx + half; x++) {
				if (x < 0 || y < 0 || x >= into.width || y >= into.height) continue;
				into.cover[y * into.width + x] = COVER_MARK;
				into.tone[y * into.width + x] = tone;
			}
	}
}

/** The colours a canvas is painted with. */
export interface Paint {
	readonly sky: readonly [number, number, number];
	/** A wood pixel's colour from its tone. */
	readonly wood: (tone: number) => readonly [number, number, number];
	/** A leaf pixel's colour from its tone. */
	readonly leaf: (tone: number) => readonly [number, number, number];
	readonly mark: readonly [number, number, number];
}

/** A plant in its own colours on a pale sky: brown wood, green leaves lighter where they see sky. */
export const NATURAL: Paint = {
	sky: [226, 234, 242],
	wood: (tone) => [tone + 28, tone + 8, tone - 12],
	leaf: (tone) => [Math.round(tone * 0.42), Math.round(tone * 0.72), Math.round(tone * 0.2)],
	mark: [230, 40, 40],
};

/**
 * A canvas as a picture, shrunk by a whole factor: each pixel the mean of the canvas pixels it
 * covers, so thin wood and leaf edges keep their share of a pixel.
 *
 * @param from The canvas.
 * @param factor Canvas pixels per picture pixel, a side.
 * @param paint The colours.
 * @returns The picture.
 */
export function painted(from: Canvas, factor: number, paint: Paint): Rgba {
	const width = Math.floor(from.width / factor);
	const height = Math.floor(from.height / factor);
	const out = blank(width, height, paint.sky);
	const samples = factor * factor;
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			let r = 0;
			let g = 0;
			let b = 0;
			for (let sy = 0; sy < factor; sy++)
				for (let sx = 0; sx < factor; sx++) {
					const at = (y * factor + sy) * from.width + x * factor + sx;
					const cover = from.cover[at] as number;
					const tone = from.tone[at] as number;
					const colour =
						cover === COVER_NONE
							? paint.sky
							: cover === COVER_WOOD
								? paint.wood(tone)
								: cover === COVER_LEAF
									? paint.leaf(tone)
									: paint.mark;
					r += colour[0];
					g += colour[1];
					b += colour[2];
				}
			const to = (y * width + x) * 4;
			out.data[to] = Math.min(255, Math.max(0, Math.round(r / samples)));
			out.data[to + 1] = Math.min(255, Math.max(0, Math.round(g / samples)));
			out.data[to + 2] = Math.min(255, Math.max(0, Math.round(b / samples)));
		}
	return out;
}

/**
 * A canvas as a matte, shrunk by a whole factor: the plant dark on white, each pixel as dark as the
 * share of it the plant covers, which is the picture the review tool reads a render's outline from.
 *
 * @param from The canvas.
 * @param factor Canvas pixels per matte pixel, a side.
 * @returns The matte.
 */
export function matte(from: Canvas, factor: number): Rgba {
	const width = Math.floor(from.width / factor);
	const height = Math.floor(from.height / factor);
	const out = blank(width, height, [255, 255, 255]);
	const samples = factor * factor;
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			let clear = 0;
			for (let sy = 0; sy < factor; sy++)
				for (let sx = 0; sx < factor; sx++)
					clear += from.clear[(y * factor + sy) * from.width + x * factor + sx] as number;
			const value = Math.round((255 * clear) / samples);
			const to = (y * width + x) * 4;
			out.data[to] = value;
			out.data[to + 1] = value;
			out.data[to + 2] = value;
		}
	return out;
}
