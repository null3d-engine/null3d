// The comparison of a review run with a species' reference folder: the measures of an outline
// pair (shape and frame overlap, width profile, gap fraction, crown box, colour differences), the
// framing a render takes from a reference, the pairing of a turning video's frames with the renders
// at their angles, the wind's motion by height band, and the contact sheets a reviewer reads.
//
// Outlines are compared after each is scaled to the same height and centred on its trunk, so the
// overlap measures shape rather than framing; the frame overlap, as framed, is reported beside it.
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { writePng } from '../../../packages/cli/src/png.js';
import type { PlantReviewQuery } from '../../../tests/pages/lib/plant-review/query.ts';
import { VIEW_SPECS } from '../../../tests/pages/lib/plant-review/views.ts';
import {
	blank,
	deltaE2000,
	drawText,
	fillBox,
	hexOf,
	labImage,
	labOf,
	onColour,
	paste,
	pasteFitted,
	probeVideo,
	type Rgba,
	readImage,
	resize,
	resizeToWidth,
	srgbOf,
	textWidth,
	videoFrames,
} from './image.ts';
import {
	anyPlantMask,
	type Box,
	boxOf,
	halfDarkMask,
	hangingParts,
	matteMask,
	matteOwnMask,
	measurePlant,
	PIECE_BRIDGE,
	type PlantHabit,
	type PlantMask,
	type PlantMeasures,
	type PlantPart,
	pieceCount,
	pieceParts,
	plantMask,
	type ReferenceSet,
	SOIL_MASK_GROUND_SHARE,
	skyMaskable,
	soilMaskable,
	type TurnVideo,
	WORK_WIDTH,
} from './references.ts';
import type { RunFrame } from './render.ts';
import { type PictureNote, type Standing, standReason } from './review-data.ts';
import type { SheathTarget } from './sheath.ts';
import {
	areaCovers,
	contractHeld,
	holdsWholePlant,
	lackReason,
	partsOf,
	regionsRead,
	voidReason,
} from './subject-check.ts';

/** The bins of an edge-direction profile: twelve of fifteen degrees across half a turn. */
const EDGE_BINS = 12;

/** Edges weaker than this, in CIELAB lightness per pixel, are paper, not structure. */
const EDGE_FLOOR = 6;

/**
 * The smallest run of pixels that counts as a piece of the plant. A smaller run is the outline's
 * own speckle rather than a part of the plant.
 */
const PIECE_AREA = 24;

/** The views that photograph the bark close up, whatever words a species puts in its file names. */
const BARK_VIEWS: ReadonlySet<string> = new Set([
	'bark-base',
	'bark-mid',
	'bark-limb',
	// A ground plant's bark is its sheath, so the sheath close view reads the material as a bark
	// close view does.
	'sheath',
]);

/**
 * The green of a leaf in CIELAB a*, below which a patch pixel is foliage rather than bark. Foliage
 * over a bark close-up stands well below this; the barks measured across the corpus stay above it.
 */
export const LEAF_GREEN = -5;

/**
 * The close views of the wood from among the plant's own parts: a limb's join, a fork, the trunk
 * inside the crown and the bole. Their photographs stand against leaves, woodland or the plant
 * itself, so a sky or a ground fitted to such a picture's border is not there to find. Only a
 * plain studio background gives one of them an outline.
 */
export const WOOD_CLOSE_VIEWS: ReadonlySet<string> = new Set([
	'junction',
	'fork',
	'inside',
	'trunk',
]);

/**
 * The views for which the standard states no figure: their rows are judged on them by eye. A picture
 * of one of them that gives no figure is drawn and not measured, which is its proper state. A
 * picture of any other view that gives no figure is a fault of the tool.
 */
export const EYE_VIEWS: ReadonlySet<string> = new Set([
	'below',
	'limb',
	'crown-underside',
	'inside',
	'junction',
	'fork',
	'trunk',
]);

/**
 * The views whose camera is solved from the plant's subjects, each with a contract. A picture of
 * one draws its matte too, so the contract's regions are checked on what was drawn.
 */
export const SOLVED_VIEWS: ReadonlySet<string> = new Set([
	...EYE_VIEWS,
	'bark-base',
	'bark-mid',
	'bark-limb',
]);

/**
 * Whether a comparison read any figure of its picture against its photograph: an outline, a
 * surface or bark colour, or a leaf colour. The edge-direction share is not one: it is a note for
 * the eye and no row's band.
 */
export function measured(pair: {
	readonly masked: boolean;
	readonly surfaceDeltaE: number | null;
	readonly foliageDeltaE: number | null;
	readonly barkDeltaE: number | null;
}): boolean {
	return (
		pair.masked ||
		pair.surfaceDeltaE !== null ||
		pair.foliageDeltaE !== null ||
		pair.barkDeltaE !== null
	);
}

/**
 * Whether a picture separates a plant from a plain background, so its outline can be read. A bark
 * close view photographs the bark against bark, and a bark texture is a cut-out of the material:
 * neither has a plant outline, and their rows read colour. A leaf texture is a cut-out on white
 * and keeps its outline. A species' slot can also name a picture whose own background is the
 * subject, such as a far scrub band that the fitted sky and ground admit; that picture carries no
 * outline either, and the crown box and its gap, which `measurePlant` reads from the same mask, go
 * with it rather than staying beside the null figures.
 */
export function hasSeparableOutline(view: string, kind: string, noOutline = false): boolean {
	return !noOutline && !(BARK_VIEWS.has(view) || (kind === 'texture' && !view.startsWith('leaf')));
}

/** The camera's framing of a reference, in screen shares, as the review page takes it. */
export interface ReferenceFraming {
	readonly horizon: number;
	readonly top: number;
	/** The plant base's row share, or undefined when the base is out of the frame. */
	readonly base?: number;
	readonly targetX: number;
	/** The share of the frame's width that the reference's plant fills, margin included. */
	readonly widthShare: number;
	/** The frame's width over its height. */
	readonly aspect: number;
	/** The plain sky's and the meadow's colours, as sRGB hex. */
	readonly sky: string;
	readonly ground?: string;
	/** Where the frames' light comes from, read off their crowns, when they say. */
	readonly light?: { readonly azimuth: number; readonly rise: number };
	/** How many of the frames gave a plant to measure. */
	readonly frames: number;
	/** What the estimate had to assume. */
	readonly notes: readonly string[];
}

/** The median of a list of numbers, or undefined for an empty list. */
export function median(values: readonly number[]): number | undefined {
	if (values.length === 0) return undefined;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = sorted.length >> 1;
	return sorted.length % 2
		? sorted[mid]
		: ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/** The mean of a list of numbers, or 0 for an empty list. */
export function mean(values: readonly number[]): number {
	return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * The column of the plant's trunk at its base, or the box's middle when the base is cut off.
 *
 * A low limb that sweeps out near the foot merges with the trunk in a row's outer extent, so each
 * row of the base band gives the run nearest the plant's middle column, and the median of those
 * centres stands for the trunk. The lowest few rows of a broad crown are then outvoted.
 */
export function anchorColumn(mask: Uint8Array, width: number, height: number, box: Box): number {
	if (box.bottom >= height - 1) return (box.left + box.right) / 2;
	const middle = (box.left + box.right) / 2;
	const band = Math.max(2, Math.round((box.bottom - box.top + 1) * 0.15));
	const centres: number[] = [];
	for (let y = box.bottom; y > box.bottom - band; y--) {
		let best: number | null = null;
		let runStart = -1;
		for (let x = 0; x <= width; x++) {
			const on = x < width && mask[y * width + x] === 1;
			if (on && runStart < 0) runStart = x;
			if (!on && runStart >= 0) {
				const centre = (runStart + x - 1) / 2;
				if (best === null || Math.abs(centre - middle) < Math.abs(best - middle)) best = centre;
				runStart = -1;
			}
		}
		if (best !== null) centres.push(best);
	}
	return median(centres) ?? (box.left + box.right) / 2;
}

/**
 * The directions a frame's edges run in: the share of edge strength in each of twelve bins of
 * fifteen degrees, over the whole frame.
 *
 * A picture whose backdrop cannot be separated from the plant still has edges, and those edges carry
 * its structure: where a limb leaves a trunk, how a bough forks, whether twigs run out or up. Two
 * frames that put their weight in different bins are built differently, whatever their colours.
 *
 * @param image The picture.
 * @returns Twelve shares that sum to one, from level through to upright.
 */
export function edgeProfile(image: Rgba): Float32Array {
	const work = image.width > WORK_WIDTH ? resizeToWidth(image, WORK_WIDTH) : image;
	const { width, height } = work;
	const lab = labImage(work);
	const bins = new Float32Array(EDGE_BINS);
	// Sobel over the lightness channel, one bin per pixel weighted by how strong its edge is.
	for (let y = 1; y < height - 1; y++)
		for (let x = 1; x < width - 1; x++) {
			const at = (px: number, py: number) => lab[(py * width + px) * 3] as number;
			const gx =
				at(x + 1, y - 1) +
				2 * at(x + 1, y) +
				at(x + 1, y + 1) -
				at(x - 1, y - 1) -
				2 * at(x - 1, y) -
				at(x - 1, y + 1);
			const gy =
				at(x - 1, y + 1) +
				2 * at(x, y + 1) +
				at(x + 1, y + 1) -
				at(x - 1, y - 1) -
				2 * at(x, y - 1) -
				at(x + 1, y - 1);
			const strength = Math.hypot(gx, gy);
			if (strength < EDGE_FLOOR) continue;
			// A direction and its opposite are one direction: a ridge has two sides.
			let angle = Math.atan2(gy, gx);
			if (angle < 0) angle += Math.PI;
			if (angle >= Math.PI) angle -= Math.PI;
			const bin = Math.min(EDGE_BINS - 1, Math.floor((angle / Math.PI) * EDGE_BINS));
			bins[bin] = (bins[bin] as number) + strength;
		}
	let total = 0;
	for (const value of bins) total += value;
	if (total <= 0) return bins;
	for (let b = 0; b < EDGE_BINS; b++) bins[b] = (bins[b] as number) / total;
	return bins;
}

/**
 * How differently two frames' edges run: the share of edge strength that points elsewhere, 0 when
 * every direction carries the same weight in both and 1 when they share none.
 */
export function edgeDifference(a: Float32Array, b: Float32Array): number {
	let shared = 0;
	for (let i = 0; i < Math.min(a.length, b.length); i++)
		shared += Math.min(a[i] as number, b[i] as number);
	return Number((1 - shared).toFixed(4));
}

/** The mean of hex colours, taken in CIELAB. */
function meanHex(colours: readonly string[]): string {
	const labs = colours.map((hex) =>
		labOf(
			Number.parseInt(hex.slice(1, 3), 16),
			Number.parseInt(hex.slice(3, 5), 16),
			Number.parseInt(hex.slice(5, 7), 16),
		),
	);
	return hexOf(srgbOf([0, 1, 2].map((c) => mean(labs.map((lab) => lab[c] as number)))));
}

/**
 * The framing of a reference camera from the measures of its frames: the median horizon, plant top,
 * plant base and trunk column. A frame with no horizon in view puts it at the plant's base, or at
 * the frame's foot when the plant runs off the foot.
 */
export function estimateFraming(
	measures: readonly PlantMeasures[],
	masks: readonly PlantMask[],
): ReferenceFraming {
	const notes: string[] = [];
	const usable = measures
		.map((m, i) => ({ m, mask: masks[i] as PlantMask }))
		.filter(({ m }) => m.box !== null);
	if (usable.length === 0)
		throw new Error('no reference frame shows a plant on a plain background');
	const first = usable[0]?.m as PlantMeasures;
	const tops = usable.map(({ m }) => (m.box as Box).top / m.height);
	const clipped = usable.filter(({ m }) => m.clipped.bottom).length > usable.length / 2;
	const bases = usable.map(({ m }) => ((m.box as Box).bottom + 1) / m.height);
	const horizons = usable.flatMap(({ m }) => (m.horizon === null ? [] : [m.horizon]));
	let horizon = median(horizons);
	if (horizon === undefined) {
		horizon = clipped ? 1 : (median(bases) as number);
		notes.push(
			clipped
				? 'no horizon in view and the plant runs off the foot: the horizon is taken at the foot'
				: "no horizon in view: the horizon is taken at the plant's base",
		);
	}
	if (clipped) notes.push("the plant runs off the frame's foot: the camera stands at eye height");
	const columns = usable.map(
		({ m, mask }) => anchorColumn(mask.mask, mask.width, mask.height, m.box as Box) / m.width,
	);
	// The plant's width in its picture, margin included: a whole view stands back until the render
	// fills no more of its frame's width, so a plant wider than its reference keeps the same margin
	// instead of being cropped at the sides.
	const widths = usable.map(({ m }) => {
		const box = m.box as Box;
		return (box.right - box.left + 1) / m.width;
	});
	return {
		horizon: Number(horizon.toFixed(4)),
		top: Number((median(tops) as number).toFixed(4)),
		...(clipped ? {} : { base: Number((median(bases) as number).toFixed(4)) }),
		targetX: Number((median(columns) as number).toFixed(4)),
		widthShare: Number((median(widths) as number).toFixed(4)),
		aspect: Number((first.width / first.height).toFixed(5)),
		sky: meanHex(usable.map(({ m }) => m.sky)),
		...(usable.some(({ m }) => m.ground)
			? { ground: meanHex(usable.flatMap(({ m }) => (m.ground ? [m.ground] : []))) }
			: {}),
		...lightOf(
			usable.map(({ m }) => m.light),
			notes,
		),
		frames: usable.length,
		notes,
	};
}

/** The frames' common light: the median of what each frame's crown said, when any of them said. */
function lightOf(
	lights: readonly ({ readonly azimuth: number; readonly rise: number } | null)[],
	notes: string[],
): { light?: { azimuth: number; rise: number } } {
	const seen = lights.filter(
		(l): l is { readonly azimuth: number; readonly rise: number } => l !== null,
	);
	if (seen.length === 0) return {};
	if (seen.length < lights.length)
		notes.push(
			`the light is read from ${seen.length} of ${lights.length} frames that show a crown`,
		);
	const azimuth = median(seen.map((l) => l.azimuth)) as number;
	const rise = median(seen.map((l) => l.rise)) as number;
	return { light: { azimuth: Number(azimuth.toFixed(1)), rise: Number(rise.toFixed(1)) } };
}

/** The page query fields that frame a render as a reference camera framed its plant. */
export function framingQuery(framing: ReferenceFraming): Partial<PlantReviewQuery> {
	const placed =
		framing.base === undefined
			? { top: framing.top, eye: 1.6 }
			: { fill: framing.base - framing.top, targetY: (framing.base + framing.top) / 2 };
	return {
		horizon: Math.min(1, framing.horizon),
		targetX: framing.targetX,
		widthShare: framing.widthShare,
		sky: framing.sky,
		...(framing.ground ? { ground: framing.ground } : {}),
		...(framing.light ? { sunAzimuth: framing.light.azimuth, sunRise: framing.light.rise } : {}),
		...placed,
	};
}

/** A camera's stand from its target, in metres, and its vertical field of view, in degrees. */
export interface CameraStand {
	readonly distance: number;
	readonly fov: number;
}

/**
 * The share of the frame's width that a plant of `plantWidth` metres fills at the camera's target:
 * the frame holds twice the stand's distance times the half field of view's tangent, times the
 * aspect. A mask that runs off both side edges cannot report a width, so it reads this instead,
 * and the figure responds to a redraw's stand rather than saturating at the frame's edge.
 */
export function cameraWidthShare(
	plantWidth: number,
	stand: CameraStand,
	aspect: number,
): number | null {
	if (!(plantWidth > 0) || !(stand.distance > 0) || !(stand.fov > 0) || !(aspect > 0)) return null;
	const height = 2 * stand.distance * Math.tan((stand.fov * Math.PI) / 360);
	return plantWidth / (height * aspect);
}

/** The size of the canvas that outlines are compared on: the plant's height and the canvas width. */
export const NORMAL_HEIGHT = 160;
export const NORMAL_WIDTH = 640;

/**
 * An outline scaled so the plant's height fills the canvas's height, with its trunk on the canvas's
 * middle column. `bottom` is the row the plant's height runs to: its base, or the frame's foot when
 * the reference's plant runs off it. Each canvas pixel takes four samples and is plant when two are.
 */
export function normalise(
	plant: PlantMask,
	box: Box,
	anchor: number,
	bottom: number,
	height = NORMAL_HEIGHT,
	width = NORMAL_WIDTH,
): Uint8Array {
	const out = new Uint8Array(width * height);
	const tall = Math.max(1, bottom - box.top + 1);
	const s = height / tall;
	for (let v = 0; v < height; v++)
		for (let u = 0; u < width; u++) {
			let hits = 0;
			for (let k = 0; k < 4; k++) {
				const x = Math.floor(anchor + (u + 0.25 + 0.5 * (k & 1) - width / 2) / s);
				const y = Math.floor(box.top + (v + 0.25 + 0.5 * (k >> 1)) / s);
				if (x >= 0 && y >= 0 && x < plant.width && y < plant.height)
					hits += plant.mask[y * plant.width + x] as number;
			}
			out[v * width + u] = hits >= 2 ? 1 : 0;
		}
	return out;
}

/** The overlap of two outlines: the pixels in both over the pixels in either, from 0 to 1. */
export function iou(a: Uint8Array, b: Uint8Array): number {
	let both = 0;
	let either = 0;
	for (let i = 0; i < a.length; i++) {
		const x = a[i] as number;
		const y = b[i] as number;
		both += x & y;
		either += x | y;
	}
	return either === 0 ? 0 : both / either;
}

/** Two outlines resized to the same size, nearest pixel, and overlapped as framed. */
export function frameIou(a: PlantMask, b: PlantMask): number {
	const scaled = new Uint8Array(a.width * a.height);
	for (let y = 0; y < a.height; y++)
		for (let x = 0; x < a.width; x++) {
			const sx = Math.min(b.width - 1, Math.floor(((x + 0.5) * b.width) / a.width));
			const sy = Math.min(b.height - 1, Math.floor(((y + 0.5) * b.height) / a.height));
			scaled[y * a.width + x] = b.mask[sy * b.width + sx] as number;
		}
	return iou(a.mask, scaled);
}

/** The mean difference of two width profiles, in plant heights. */
export function profileError(a: readonly number[], b: readonly number[]): number {
	const n = Math.min(a.length, b.length);
	if (n === 0) return 0;
	let sum = 0;
	for (let i = 0; i < n; i++) sum += Math.abs((a[i] as number) - (b[i] as number));
	return sum / n;
}

/** How a render's turn lines up with a reference's. */
export interface Alignment {
	/** The render frame that matches the reference's first frame. */
	readonly start: number;
	/** 1 when the render turns the same way as the reference, -1 when the other way. */
	readonly direction: 1 | -1;
	/**
	 * The mean overlap of the matched pairs on outlines shrunk four times each way. It picks the
	 * pairing, and standing alone it says nothing about the plant: on a speckled crown it reads
	 * well above the frame-to-frame shape IoU.
	 */
	readonly coarseIou: number;
	/** For each reference frame, the render frame it is matched to. */
	readonly pairs: readonly number[];
}

/**
 * Lines a render's turn up with a reference's: tries every start frame and both directions, and
 * keeps the pairing whose mean overlap is best. `scores[k][j]` is the overlap of reference frame k
 * with render frame j; the renders stand at even turns round a full circle, and each reference
 * frame turns `ratio` render steps from the one before (the render count over the reference count
 * when both turn a full circle).
 */
export function alignTurn(
	scores: readonly (readonly number[])[],
	ratio = (scores[0]?.length ?? 0) / Math.max(1, scores.length),
): Alignment {
	const k = scores.length;
	const n = scores[0]?.length ?? 0;
	let best: Alignment = { start: 0, direction: 1, coarseIou: -1, pairs: [] };
	for (const direction of [1, -1] as const)
		for (let start = 0; start < n; start++) {
			const pairs = Array.from({ length: k }, (_, i) => {
				const step = Math.round(i * ratio);
				return (((start + direction * step) % n) + n) % n;
			});
			const coarseIou = mean(pairs.map((j, i) => (scores[i] as readonly number[])[j] as number));
			if (coarseIou > best.coarseIou + 1e-9) best = { start, direction, coarseIou, pairs };
		}
	return best;
}

/** The spread of a measure round a turn: its largest less its smallest, over its mean. */
export function spread(values: readonly number[]): number {
	const m = mean(values);
	return m === 0 ? 0 : (Math.max(...values) - Math.min(...values)) / m;
}

/**
 * The rubric's eight angles round a plant, those that a turning video's arc reaches, and the video
 * frame nearest each when its frames stand at even turns over the arc.
 */
export function rubricFrames(
	arc: number,
	frames: number,
): { readonly angles: number[]; readonly frames: number[] } {
	const frameStep = arc / frames;
	const angles = Array.from({ length: 8 }, (_, k) => k * 45).filter(
		(a) => a < arc + 1e-6 && a / frameStep < frames,
	);
	return { angles, frames: angles.map((a) => Math.min(frames - 1, Math.round(a / frameStep))) };
}

/** The spread of the crown box's width and height over the frames that show a plant. */
export function crownBoxSpread(measures: readonly PlantMeasures[]): {
	readonly width: number;
	readonly height: number;
} {
	const boxes = measures.flatMap((m) => (m.box ? [m.crownBox] : []));
	return {
		width: Number(spread(boxes.map((b) => b.width)).toFixed(4)),
		height: Number(spread(boxes.map((b) => b.height)).toFixed(4)),
	};
}

/**
 * The rubric's band for the crown box's spread round a turn, by growth form: 15 per cent for a
 * conifer, 25 for every other form. The reference's own spread widens it where it is wider.
 */
export function rubricBand(species: string, slug: string): number {
	return /spruce|pine|fir|cedar|larch|cypress|yew|sequoia|juniper|conifer/.test(
		`${species} ${slug}`,
	)
		? 0.15
		: 0.25;
}

/** One frame of either side of a comparison: its picture, its outline and its measures. */
interface Side {
	readonly label: string;
	readonly image: Rgba;
	readonly plant: PlantMask;
	readonly measures: PlantMeasures;
	/** The outline on the comparison canvas, or undefined when the frame has no plant. */
	readonly normal?: Uint8Array;
}

/** A frame of a render: its picture, with its matte's outline when the run drew one. */
function renderSide(
	label: string,
	file: string,
	matte: string | undefined,
	bottomCut: boolean,
	habit?: PlantHabit,
	piece = false,
	subject?: number,
): Side {
	const image = readImage(file);
	const plant = matte && existsSync(matte) ? matteMask(readImage(matte)) : plantMask(image);
	return side(label, image, plant, bottomCut, habit, piece, subject);
}

/** A side of a comparison from a picture and its outline. */
function side(
	label: string,
	image: Rgba,
	plant: PlantMask,
	bottomCut: boolean,
	habit?: PlantHabit,
	piece = false,
	subject?: number,
): Side {
	const measures = measurePlant(image, plant, habit, piece, subject);
	const box = measures.box;
	if (!box) return { label, image, plant, measures };
	const bottom = bottomCut ? plant.height - 1 : box.bottom;
	const anchor = anchorColumn(plant.mask, plant.width, plant.height, box);
	return { label, image, plant, measures, normal: normalise(plant, box, anchor, bottom) };
}

/** The measures of one matched pair. */
interface PairMetrics {
	readonly reference: string;
	readonly render: string;
	readonly shapeIou: number | null;
	readonly frameIou: number | null;
	readonly profileError: number | null;
	/**
	 * The sky enclosed by each crown's outline, a texel counted as sky or plant on both sides. The
	 * render's reading by its clear share is kept beside it, as the figure was read before.
	 */
	readonly gap: {
		readonly reference: number;
		readonly render: number;
		readonly renderByCoverage?: number;
	} | null;
	readonly crownBoxGap: { readonly reference: number; readonly render: number } | null;
	readonly frameGap: { readonly reference: number; readonly render: number } | null;
	/**
	 * The drawn plant's share of the frame's height over its photograph's: its scale against the
	 * photograph's. Where it differs from 1 by more than the frame band, the figures read on the
	 * frame as a whole, the overlap as framed and the whole frame's sky share, compare a larger or a
	 * smaller plant with the photograph's and are left out; the frame-free figures stand.
	 */
	readonly frameScale: number | null;
	/**
	 * The row share of each plant's foot, the lowest row of its outline. Every figure that is a
	 * share of the plant's height counts from this row, so it stands beside them.
	 */
	readonly footRow?: { readonly reference: number; readonly render: number } | null;
	readonly foliageDeltaE: number | null;
	readonly barkDeltaE: number | null;
	readonly crownBox: {
		readonly reference: { readonly width: number; readonly height: number };
		readonly render: { readonly width: number; readonly height: number };
	} | null;
	readonly foliage: { readonly reference: string | null; readonly render: string | null };
}

/**
 * How far a drawn plant's scale may stand from its photograph's before the figures read on the
 * frame as a whole no longer compare like with like.
 */
export const FRAME_SCALE_BAND = 0.05;

/**
 * The drawn plant's share of the frame's height over its photograph's, from both outlines' boxes:
 * its scale against the photograph's.
 */
export function frameScale(reference: FramedBox, render: FramedBox): number {
	const tall = (side: FramedBox) => (side.box.bottom - side.box.top + 1) / side.height;
	return Number((tall(render) / tall(reference)).toFixed(3));
}

/** Whether figures read on the frame as a whole compare like with like at a drawn plant's scale. */
export function frameFiguresHold(scale: number | null): boolean {
	return scale !== null && Math.abs(scale - 1) <= FRAME_SCALE_BAND;
}

/** Compares a reference frame with a render frame. */
function pairMetrics(reference: Side, render: Side): PairMetrics {
	const both = reference.measures.box !== null && render.measures.box !== null;
	const scale =
		reference.measures.box && render.measures.box
			? frameScale(
					{
						box: reference.measures.box,
						width: reference.plant.width,
						height: reference.plant.height,
					},
					{ box: render.measures.box, width: render.plant.width, height: render.plant.height },
				)
			: null;
	const framed = frameFiguresHold(scale);
	const colour = (a: { lab: readonly number[] } | null, b: { lab: readonly number[] } | null) =>
		a && b ? Number(deltaE2000(a.lab, b.lab).toFixed(2)) : null;
	return {
		reference: reference.label,
		render: render.label,
		shapeIou:
			reference.normal && render.normal
				? Number(iou(reference.normal, render.normal).toFixed(4))
				: null,
		frameIou: both && framed ? Number(frameIou(reference.plant, render.plant).toFixed(4)) : null,
		frameScale: scale,
		footRow:
			reference.measures.box && render.measures.box
				? {
						reference: Number(
							((reference.measures.box.bottom + 1) / reference.plant.height).toFixed(4),
						),
						render: Number(((render.measures.box.bottom + 1) / render.plant.height).toFixed(4)),
					}
				: null,
		profileError: both
			? Number(
					profileError(reference.measures.widthProfile, render.measures.widthProfile).toFixed(4),
				)
			: null,
		gap: both
			? {
					reference: reference.measures.gapFraction,
					render: render.measures.gapFraction,
					...(render.measures.gapByCoverage !== null && {
						renderByCoverage: render.measures.gapByCoverage,
					}),
				}
			: null,
		crownBoxGap: both
			? { reference: reference.measures.crownBoxGap, render: render.measures.crownBoxGap }
			: null,
		frameGap:
			both && framed
				? { reference: reference.measures.frameGap, render: render.measures.frameGap }
				: null,
		foliageDeltaE: colour(reference.measures.foliage, render.measures.foliage),
		barkDeltaE: colour(reference.measures.bark, render.measures.bark),
		crownBox: both
			? { reference: reference.measures.crownBox, render: render.measures.crownBox }
			: null,
		foliage: {
			reference: reference.measures.foliage?.hex ?? null,
			render: render.measures.foliage?.hex ?? null,
		},
	};
}

/** The width of a contact sheet, in pixels: what a reviewer reads at once. */
export const SHEET_WIDTH = 1600;
/** The width of a sheet's label column. */
const LABEL_WIDTH = 214;
/** The gap between a sheet's cells. */
const GAP = 8;
/** A sheet's colours. */
const INK = [235, 235, 235];
const DIM = [150, 150, 150];
const PAPER = [18, 18, 18];
const REFERENCE_COLOUR = [214, 0, 170];
const RENDER_COLOUR = [0, 160, 60];

/**
 * The outline overlay of two outlines on the comparison canvas, or on another canvas of the size
 * given, cropped to both and fitted to a box: the reference's outline magenta, the render's green,
 * their shared area grey and each one's own area tinted with its colour.
 */
export function overlay(
	reference: Uint8Array,
	render: Uint8Array,
	width: number,
	height: number,
	canvasWidth = NORMAL_WIDTH,
	canvasHeight = NORMAL_HEIGHT,
): Rgba {
	const union = new Uint8Array(reference.length);
	for (let i = 0; i < union.length; i++)
		union[i] = (reference[i] as number) | (render[i] as number);
	const box = boxOf(union, canvasWidth, canvasHeight) ?? {
		left: 0,
		top: 0,
		right: canvasWidth - 1,
		bottom: canvasHeight - 1,
	};
	const margin = 4;
	const left = Math.max(0, box.left - margin);
	const top = Math.max(0, box.top - margin);
	const cropW = Math.min(canvasWidth, box.right + margin + 1) - left;
	const cropH = Math.min(canvasHeight, box.bottom + margin + 1) - top;
	const s = Math.min(width / cropW, height / cropH);
	const w = Math.max(1, Math.floor(cropW * s));
	const h = Math.max(1, Math.floor(cropH * s));
	const sample = (mask: Uint8Array) => {
		const grey = blank(cropW, cropH, [0, 0, 0]);
		for (let y = 0; y < cropH; y++)
			for (let x = 0; x < cropW; x++) {
				const v = (mask[(top + y) * canvasWidth + left + x] as number) * 255;
				grey.data[(y * cropW + x) * 4] = v;
			}
		const big = resize(grey, w, h);
		const out = new Uint8Array(w * h);
		for (let i = 0; i < out.length; i++) out[i] = (big.data[i * 4] as number) >= 128 ? 1 : 0;
		return out;
	};
	const a = sample(reference);
	const b = sample(render);
	const edge = (m: Uint8Array, i: number) => {
		if (!m[i]) return false;
		const x = i % w;
		const y = (i - x) / w;
		return (
			x === 0 ||
			y === 0 ||
			x === w - 1 ||
			y === h - 1 ||
			!m[i - 1] ||
			!m[i + 1] ||
			!m[i - w] ||
			!m[i + w]
		);
	};
	const out = blank(w, h, [250, 250, 250]);
	for (let i = 0; i < w * h; i++) {
		const ra = a[i] === 1;
		const rb = b[i] === 1;
		let colour: readonly number[] = [250, 250, 250];
		if (ra && rb) colour = [196, 196, 196];
		else if (ra) colour = [246, 196, 236];
		else if (rb) colour = [196, 236, 204];
		if (edge(a, i)) colour = REFERENCE_COLOUR;
		else if (edge(b, i)) colour = RENDER_COLOUR;
		out.data[i * 4] = colour[0] as number;
		out.data[i * 4 + 1] = colour[1] as number;
		out.data[i * 4 + 2] = colour[2] as number;
	}
	const cell = blank(width, height, [250, 250, 250]);
	paste(cell, out, Math.floor((width - w) / 2), Math.floor((height - h) / 2));
	return cell;
}

/** One row of a contact sheet: two pictures, their overlay when both have outlines, and labels. */
export interface SheetRow {
	readonly reference?: Rgba;
	readonly render?: Rgba;
	readonly overlay?: Rgba;
	readonly lines: readonly string[];
}

/** Draws contact sheets of rows, several rows a page, and returns the pages. */
export function contactSheets(
	title: string,
	rows: readonly SheetRow[],
	aspect: number,
	perPage = 6,
	paired = true,
): Rgba[] {
	const cellW = Math.floor((SHEET_WIDTH - LABEL_WIDTH - GAP * 4) / 3);
	const cellH = Math.min(420, Math.max(120, Math.round(cellW / aspect)));
	const header = 76;
	const pages: Rgba[] = [];
	for (let first = 0; first < rows.length; first += perPage) {
		const slice = rows.slice(first, first + perPage);
		const page = blank(SHEET_WIDTH, header + slice.length * (cellH + GAP) + GAP, PAPER);
		const pageTitle =
			rows.length > perPage
				? `${title}  (PAGE ${first / perPage + 1} OF ${Math.ceil(rows.length / perPage)})`
				: title;
		drawText(page, pageTitle, GAP, 10, 3, INK);
		// A sheet of renders alone has no reference column and no outlines to key.
		const columns = paired ? ['REFERENCE', 'RENDER', 'OUTLINES:'] : ['RENDER', 'RENDER', 'RENDER'];
		for (const [c, text] of columns.entries())
			drawText(page, text, LABEL_WIDTH + GAP + c * (cellW + GAP), 50, 2, DIM);
		if (paired) {
			const keyX = LABEL_WIDTH + GAP + 2 * (cellW + GAP) + textWidth('OUTLINES: ', 2);
			drawText(page, 'REFERENCE', keyX, 50, 2, REFERENCE_COLOUR);
			drawText(page, 'RENDER', keyX + textWidth('REFERENCE ', 2), 50, 2, RENDER_COLOUR);
		}
		for (const [r, row] of slice.entries()) {
			const y = header + r * (cellH + GAP);
			for (const [l, line] of row.lines.entries())
				drawText(page, line, GAP, y + 4 + l * 20, 2, l === 0 ? INK : DIM);
			const cells = [row.reference, row.render, row.overlay];
			for (const [c, image] of cells.entries()) {
				const x = LABEL_WIDTH + GAP + c * (cellW + GAP);
				if (image) pasteFitted(page, image, x, y, cellW, cellH);
				else {
					fillBox(page, x, y, cellW, cellH, [34, 34, 34]);
					if (paired) drawText(page, c === 2 ? 'NO OUTLINE' : 'NONE', x + 12, y + 12, 2, DIM);
				}
			}
		}
		pages.push(page);
	}
	return pages;
}

/** A number for a label, or a dash for none. */
export function fixed(value: number | null | undefined, digits = 2): string {
	return value === null || value === undefined ? '-' : value.toFixed(digits);
}

/**
 * A note when a crown's box holds only a small share of its plant's own, which is the sign that the
 * crown's foot was found inside the foliage: a kit-cut piece has no bare stem below its leaves, and a
 * thick bole can fill the whole margin the finder looks for. The gap and crown figures then measure a
 * slice of the plant rather than its crown, so the run says so instead of letting a reader trust them.
 */
function crownNote(reference: PlantMeasures, render: PlantMeasures): string | undefined {
	const share = (measure: PlantMeasures): number => {
		const box = measure.box;
		if (!box) return 1;
		const tall = box.bottom - box.top + 1;
		return tall > 0 ? measure.crownBox.height / tall : 1;
	};
	const least = Math.min(share(reference), share(render));
	// A view of the wood alone has no crown to measure, so nothing is being read from it.
	if (least >= 0.4 || least <= 0.05) return undefined;
	const percent = (least * 100).toFixed(0);
	return `the crown's box holds ${percent} per cent of the plant's height, so its foot sits inside the foliage and its gap and crown figures measure a slice`;
}

/** A CIELAB triple as three rounded figures, in the order light, red to green, blue to yellow. */
function labTriple(lab: readonly number[]): string {
	return lab.map((v) => v.toFixed(1)).join(' ');
}

/**
 * A reference outlined against a fitted background rather than a plain one: the surface that
 * separated the plant, its fit and residual, and — for a ground — the horizon's share and both
 * surfaces' figures, so a bad model is on the record and never silently masked.
 */
export interface FittedMaskNote {
	readonly kind: 'sky' | 'ground';
	readonly skyFit: number;
	readonly skyNoise: number;
	readonly groundFit?: number;
	readonly groundNoise?: number;
	readonly horizonShare?: number;
	readonly plantToGround?: number;
}

/** The summary's note when a reference's outline comes from a fitted background. */
export function fittedMaskClause(pair: { readonly fittedMask?: FittedMaskNote }): string {
	const note = pair.fittedMask;
	if (!note) return '';
	if (note.kind === 'sky')
		return ` — the outline comes from a fitted sky (fit ${note.skyFit.toFixed(4)}, residual ${note.skyNoise.toFixed(1)})`;
	const groundShare = 1 - (note.horizonShare ?? 0);
	const ground =
		note.groundFit === undefined
			? ''
			: `; ground fit ${note.groundFit.toFixed(4)}, residual ${(note.groundNoise ?? 0).toFixed(1)}`;
	const [least, most] = SOIL_MASK_GROUND_SHARE;
	const flagged =
		groundShare < least || groundShare > most
			? `; the ground region holds ${groundShare.toFixed(3)} of the frame, outside a soil band's usual share, so the fit may cover the plant`
			: '';
	const closeness =
		note.plantToGround === undefined
			? ''
			: `; the plant's median colour sits ${note.plantToGround.toFixed(1)} CIEDE2000 steps from the ground`;
	return ` — the outline comes from a fitted ground at horizon share ${(note.horizonShare ?? 0).toFixed(3)}, ground region ${groundShare.toFixed(3)} (sky fit ${note.skyFit.toFixed(4)}, residual ${note.skyNoise.toFixed(1)}${ground})${closeness}${flagged}`;
}

/** The labels of a compared pair. */
function pairLines(head: readonly string[], pair: PairMetrics): string[] {
	return [
		...head,
		`SHAPE IOU ${fixed(pair.shapeIou)}`,
		`FRAME IOU ${fixed(pair.frameIou)}`,
		`WIDTH ERR ${fixed(pair.profileError, 3)}`,
		`GAP BOX ${fixed(pair.crownBoxGap?.reference)} / ${fixed(pair.crownBoxGap?.render)}`,
		`GAP FRAME ${fixed(pair.frameGap?.reference)} / ${fixed(pair.frameGap?.render)}`,
		`LEAF DE ${fixed(pair.foliageDeltaE, 1)}`,
		`BARK DE ${fixed(pair.barkDeltaE, 1)}`,
		pair.crownBox
			? `REF CROWN ${pair.crownBox.reference.width}X${pair.crownBox.reference.height}`
			: 'REF CROWN -',
		pair.crownBox
			? `REN CROWN ${pair.crownBox.render.width}X${pair.crownBox.render.height}`
			: 'REN CROWN -',
	];
}

/** Writes a group's sheet pages into the run folder, and returns their file names. */
export function writeSheets(runDir: string, group: string, pages: readonly Rgba[]): string[] {
	return pages.map((page, p) => {
		const name = `sheet-${group}-${String(p + 1).padStart(2, '0')}.png`;
		writePng(join(runDir, name), page);
		return name;
	});
}

/** One tile of a grid sheet: a reference frame over the render it was matched to, and labels. */
export interface GridTile {
	readonly reference?: Rgba;
	readonly render?: Rgba;
	readonly overlay?: Rgba;
	readonly lines: readonly string[];
}

/**
 * Grid sheets of matched frames: each tile holds the reference over its render and their outline
 * overlay, with its labels, `columns` tiles a row, as many rows as fit a page.
 */
export function gridSheets(
	title: string,
	tiles: readonly GridTile[],
	aspect: number,
	columns = 6,
	rowsPerPage = 4,
): Rgba[] {
	const tileW = Math.floor((SHEET_WIDTH - GAP * (columns + 1)) / columns);
	const imageH = Math.max(40, Math.round(tileW / aspect));
	const overlayH = Math.round(imageH * 0.6);
	const labelH = 46;
	const tileH = imageH * 2 + overlayH + labelH + GAP;
	const header = 64;
	const perPage = columns * rowsPerPage;
	const pages: Rgba[] = [];
	for (let first = 0; first < tiles.length; first += perPage) {
		const slice = tiles.slice(first, first + perPage);
		const rows = Math.ceil(slice.length / columns);
		const page = blank(SHEET_WIDTH, header + rows * (tileH + GAP) + GAP, PAPER);
		const count = Math.ceil(tiles.length / perPage);
		drawText(
			page,
			count > 1 ? `${title}  (PAGE ${first / perPage + 1} OF ${count})` : title,
			GAP,
			10,
			3,
			INK,
		);
		drawText(page, 'EACH TILE: REFERENCE, RENDER, OUTLINES', GAP, 40, 2, DIM);
		const keyX = GAP + textWidth('EACH TILE: REFERENCE, RENDER, OUTLINES  ', 2);
		drawText(page, 'REFERENCE', keyX, 40, 2, REFERENCE_COLOUR);
		drawText(page, 'RENDER', keyX + textWidth('REFERENCE ', 2), 40, 2, RENDER_COLOUR);
		for (const [t, tile] of slice.entries()) {
			const x = GAP + (t % columns) * (tileW + GAP);
			const y = header + Math.floor(t / columns) * (tileH + GAP);
			const cells: [Rgba | undefined, number][] = [
				[tile.reference, imageH],
				[tile.render, imageH],
				[tile.overlay, overlayH],
			];
			let at = y;
			for (const [image, h] of cells) {
				if (image) pasteFitted(page, image, x, at, tileW, h);
				else fillBox(page, x, at, tileW, h, [34, 34, 34]);
				at += h;
			}
			for (const [l, line] of tile.lines.entries())
				drawText(page, line, x + 2, at + 4 + l * 14, 1, l === 0 ? INK : DIM);
		}
		pages.push(page);
	}
	return pages;
}

/** An outline on the comparison canvas shrunk four times each way, a cell set when any pixel is. */
function coarse(normal: Uint8Array): Uint8Array {
	const w = NORMAL_WIDTH / 4;
	const h = NORMAL_HEIGHT / 4;
	const out = new Uint8Array(w * h);
	for (let y = 0; y < NORMAL_HEIGHT; y++)
		for (let x = 0; x < NORMAL_WIDTH; x++)
			if (normal[y * NORMAL_WIDTH + x]) out[(y >> 2) * w + (x >> 2)] = 1;
	return out;
}

/** The turn of a render frame in degrees from 0 to 360. */
function wrap(angle: number): number {
	return ((angle % 360) + 360) % 360;
}

/** The angular distance between two turns, in degrees. */
function apart(a: number, b: number): number {
	const d = Math.abs(wrap(a) - wrap(b));
	return Math.min(d, 360 - d);
}

/** One reference frame of a turning video beside the render it was matched to. */
export interface TurnPair extends PairMetrics {
	readonly frame: number;
	readonly referenceAngle: number;
	readonly renderAngle: number;
	readonly renderFile: string;
	/** Degrees between the frame's angle and its render's, once aligned. */
	readonly offBy: number;
}

/** The result of comparing one turning video with a run's turn of its view. */
export interface TurnResult {
	readonly video: string;
	readonly arc: number;
	readonly frames: number;
	readonly renders: number;
	/** Degrees one video frame turns, and one render turn. */
	readonly frameStep: number;
	readonly renderStep: number;
	readonly alignment: Omit<Alignment, 'pairs'>;
	/** The mean of the matched frames' shape IoU, over the frames that carry one. */
	readonly meanShapeIou: number | null;
	/** The video frames whose render lies within half a frame's turn of the frame's own angle. */
	readonly covered: number;
	readonly pairs: readonly TurnPair[];
	/** The crown box's spread over the eight angles of the rubric that the video covers. */
	readonly spread: {
		readonly angles: readonly number[];
		readonly reference: { readonly width: number; readonly height: number };
		readonly render: { readonly width: number; readonly height: number };
		/** The render's crown box in metres at those angles, from the page's own measures. */
		readonly metres: readonly ({ readonly width: number; readonly height: number } | null)[];
	};
	readonly maskCheck: number | null;
	/** The frames the check read, and the frames whose colour outline saw no plant to read. */
	readonly maskCheckFrames: number;
	readonly maskCheckUnreadable: number;
	/** The gate the turn's background takes, and whether its check falls below the gate. */
	readonly maskCheckThreshold: number | null;
	readonly maskCheckFailed: boolean;
	/** Whether the subject is too small for the figure to judge, so the check only reports. */
	readonly maskCheckSmall: boolean;
	readonly maskCheckSubject: number | null;
	readonly sheets: readonly string[];
	readonly error?: string;
}

/**
 * The mask check's gates, measured over every turn check in the tree on 12 November 2026. A frame's
 * colour outline can only be read against its matte when the outline is a plant outline, so the
 * gates are set from the corpus of sound turns and give a margin under each kind's lowest reading.
 * A turn on a natural background reads a frame as low as 0.717 and a sound turn as low as 0.750, so
 * its gate sits 0.15 under that. A plain-background cut piece reads 0.941 to 0.978 a frame, so its
 * gate sits 0.045 under. A colour outline under the plant mask's own fitted-subject floor cannot see
 * the plant at all, so that frame is reported as unreadable rather than scored.
 */
export const MASK_GATE_NATURAL = 0.6;
export const MASK_GATE_PLAIN = 0.9;
export const MASK_SUBJECT_FLOOR = 0.02;

/** A turning video's mask check: the readable frames' mean overlap, or none when no frame is read. */
export interface MaskCheck {
	readonly value: number | null;
	readonly frames: number;
	readonly unreadable: number;
	readonly threshold: number | null;
	readonly failed: boolean;
	/** Whether the subject is too small for the figure to judge, and only reports. */
	readonly small: boolean;
	/** The matte's share of the frame, averaged over the readable frames. */
	readonly subject: number | null;
}

/**
 * A plain background's subject under this share of the frame reports rather than fails: the overlap
 * is dominated by the boundary band at that size, so a one-pixel edge costs a large share of it. The
 * holm oak's subbranch turn reads 0.846 with its colour outline at 2.7 to 4.0 per cent and its matte
 * at 2 to 3, where a one-pixel band costs about 0.15 of the overlap.
 */
export const MASK_SMALL_SUBJECT = 0.05;

/**
 * The mask check a turning video's frames give. A null check is a frame whose colour outline covers
 * under the subject floor, which the fitted background cannot see the plant in.
 *
 * @param checks Each frame's overlap and its matte's share of the frame, or null where unreadable.
 * @param plain Whether the turn drew on a plain background, as a cut piece does.
 * @returns The readable frames' mean overlap and the gate it is judged against.
 */
export function maskCheckOf(
	checks: readonly ({ readonly iou: number; readonly subject: number } | null)[],
	plain: boolean,
): MaskCheck {
	const readable = checks.filter(
		(check): check is { readonly iou: number; readonly subject: number } => check !== null,
	);
	const unreadable = checks.length - readable.length;
	if (readable.length === 0)
		return {
			value: null,
			frames: 0,
			unreadable,
			threshold: null,
			failed: false,
			small: false,
			subject: null,
		};
	const value = Number(mean(readable.map((check) => check.iou)).toFixed(4));
	const subject = mean(readable.map((check) => check.subject));
	const small = plain && subject < MASK_SMALL_SUBJECT;
	const threshold = plain ? MASK_GATE_PLAIN : MASK_GATE_NATURAL;
	return {
		value,
		frames: readable.length,
		unreadable,
		threshold,
		failed: !small && value < threshold,
		small,
		subject: Number(subject.toFixed(4)),
	};
}

/** Whether a turn's frames drew a plain background, as a cut piece does, rather than sky and ground. */
export function plainTurnOf(background: string | undefined): boolean {
	return background !== undefined && background !== 'sky-meadow';
}

/** The parts a picture draws that meet nothing inside its frame, as the gate reports them. */
/** The rows the plant's feet land on, as the page posted them, in the picture's pixels. */
export function groundBandOf(
	frame: RunFrame,
	height: number,
): { top: number; base: number } | null {
	const rows = (
		frame.facts as { plant?: { groundRows?: { top: number; base: number } } } | undefined
	)?.plant?.groundRows;
	if (!rows || !Number.isFinite(rows.top) || !Number.isFinite(rows.base)) return null;
	return { top: Math.round(rows.top * height), base: Math.round(rows.base * height) };
}

/** The band a read's pieces are grounded against, where the page named it. */
function bandFor(frame: RunFrame, height: number): { top: number; base: number } | undefined {
	return groundBandOf(frame, height) ?? undefined;
}

export function floatingParts(
	list: readonly PlantPart[],
	band?: { readonly top: number; readonly base: number },
): readonly { readonly area: number; readonly box: string }[] {
	return hangingParts(list, band).parts.map((part) => ({
		area: part.area,
		box: `${part.right - part.left + 1}x${part.bottom - part.top + 1}@${part.left},${part.top}`,
	}));
}

/** The row where the plant stands: the lowest row a piece reaches. */
export function footRowOf(list: readonly PlantPart[]): number {
	return hangingParts(list).footRow;
}

/**
 * The piece test at a picture's own width: the work width's area and gap tolerance scaled to the
 * picture, so its finer pixels neither add a part nor lose a join the work-width read keeps.
 */
export function piecePartsAtOwnWidth(mask: Uint8Array, width: number, height: number): PlantPart[] {
	const scale = width / WORK_WIDTH;
	return pieceParts(
		mask,
		width,
		height,
		Math.max(1, Math.round(PIECE_AREA * scale * scale)),
		Math.max(PIECE_BRIDGE, Math.ceil(PIECE_BRIDGE * scale)),
	);
}

/** A sweep picture's readings: its components and floating pieces, and the render's crown-box gap. */
export interface SweepMeasures {
	readonly components: number;
	/** The row where the plant stands: a piece meeting it is rooted in the soil, not floating. */
	readonly footRow: number;
	/** The rows the plant's own feet land on, where the page named them: a piece inside it stands. */
	readonly groundBand: { readonly top: number; readonly base: number } | null;
	readonly floating: readonly { readonly area: number; readonly box: string }[];
	/**
	 * The same read at the tool's work width, kept beside the picture's own: a downscale can drop a
	 * hairline join the picture keeps. Only the picture's own read decides whether a piece floats.
	 */
	readonly workWidth: {
		readonly components: number;
		readonly floating: readonly { readonly area: number; readonly box: string }[];
	} | null;
	readonly crownBoxGap: number | null;
}

/**
 * Reads one sweep picture: the matte's components and any piece that meets nothing inside the frame,
 * read at the picture's own width, and the crown box's gap. The picture has no reference, so its
 * figures stand alone and are read against the record's band and each other.
 */
export function sweepMeasures(runDir: string, frame: RunFrame): SweepMeasures {
	const render = renderSideOf(runDir, frame, `SWEEP ${frame.file}`, false);
	const parts = pieceParts(
		anyPlantMask(render.plant),
		render.plant.width,
		render.plant.height,
		PIECE_AREA,
	);
	const own =
		frame.matte === undefined
			? null
			: (() => {
					const mask = matteOwnMask(readImage(join(runDir, frame.matte as string)));
					return piecePartsAtOwnWidth(mask.mask, mask.width, mask.height);
				})();
	const read = own ?? parts;
	const band = bandFor(frame, render.plant.height);
	return {
		components: read.length,
		footRow: footRowOf(read),
		groundBand: band ?? null,
		floating: floatingParts(read, band),
		workWidth: own ? { components: parts.length, floating: floatingParts(parts, band) } : null,
		crownBoxGap: render.measures.crownBoxGap ?? null,
	};
}

/** A render frame's side of a comparison. */
function renderSideOf(
	runDir: string,
	frame: RunFrame,
	label: string,
	bottomCut: boolean,
	habit?: PlantHabit,
	piece = false,
	subject?: number,
): Side {
	return renderSide(
		label,
		join(runDir, frame.file),
		frame.matte ? join(runDir, frame.matte) : undefined,
		bottomCut,
		habit,
		piece,
		subject,
	);
}

/** The crown box in metres that the page measured for a render frame, if it did. */
function metresOf(frame: RunFrame | undefined): { width: number; height: number } | null {
	const measure = (frame?.cell as { measure?: { crownBox?: { width: number; height: number } } })
		?.measure;
	return measure?.crownBox
		? {
				width: Number(measure.crownBox.width.toFixed(3)),
				height: Number(measure.crownBox.height.toFixed(3)),
			}
		: null;
}

/**
 * Compares every frame of a turning video with a run's turn of the same view: the run's renders
 * stand at even turns round a full circle, the video's frames at even turns over its arc. The
 * pairing searches the render that matches the video's first frame and the turning direction, by
 * the mean outline overlap, and pairs each frame with the render nearest its own angle.
 */
export function compareTurn(
	runDir: string,
	group: string,
	video: TurnVideo,
	frames: readonly RunFrame[],
	title: string,
	habit?: PlantHabit,
): TurnResult {
	const facts = probeVideo(video.path);
	const references = videoFrames(video.path, facts, WORK_WIDTH);
	const n = references.length;
	const usable = frames.filter((frame) => !frame.error).sort((a, b) => a.turn - b.turn);
	const m = usable.length;
	const frameStep = video.arc / n;
	const renderStep = 360 / Math.max(1, m);
	const empty = {
		video: video.file,
		arc: video.arc,
		frames: n,
		renders: m,
		frameStep,
		renderStep,
		alignment: { start: 0, direction: 1 as const, coarseIou: 0 },
		meanShapeIou: null,
		covered: 0,
		pairs: [],
		spread: {
			angles: [],
			reference: { width: 0, height: 0 },
			render: { width: 0, height: 0 },
			metres: [],
		},
		maskCheck: null,
		maskCheckFrames: 0,
		maskCheckUnreadable: 0,
		maskCheckThreshold: null,
		maskCheckFailed: false,
		maskCheckSmall: false,
		maskCheckSubject: null,
		sheets: [],
	};
	if (m === 0) return { ...empty, error: 'the run drew no frame of this turn' };
	// A turn of a cut piece takes its subject share from the first reference frame, so every frame
	// of the turn bounds the same part of the piece.
	const piece = video.piece !== 'whole';
	const refMasks = references.map((image) => plantMask(image));
	const refMeasures = refMasks.map((mask, k) => measurePlant(references[k] as Rgba, mask, habit));
	const firstBox = refMeasures[0]?.box;
	const subject =
		piece && firstBox
			? refMeasures[0]!.crownBox.height / (firstBox.bottom - firstBox.top + 1)
			: undefined;
	const bottomCut = refMeasures.filter((measure) => measure.clipped.bottom).length > n / 2;
	const refSides = references.map((image, k) =>
		side(
			`REF ${(k * frameStep).toFixed(1)}`,
			image,
			refMasks[k] as PlantMask,
			bottomCut,
			habit,
			piece,
			subject,
		),
	);
	const renderSides = usable.map((frame) =>
		renderSideOf(
			runDir,
			frame,
			`RENDER ${frame.turn.toFixed(1)}`,
			bottomCut,
			habit,
			piece,
			subject,
		),
	);
	const checks = usable.flatMap((frame, j) => {
		if (!frame.matte) return [];
		const coloured = plantMask((renderSides[j] as Side).image);
		const share = coloured.mask.reduce((sum, value) => sum + value, 0) / coloured.mask.length;
		if (share < MASK_SUBJECT_FLOOR) return [null];
		const matte = (renderSides[j] as Side).plant.mask;
		const subject = matte.reduce((sum, value) => sum + value, 0) / matte.length;
		return [{ iou: frameIou(coloured, (renderSides[j] as Side).plant), subject }];
	});
	const mask = maskCheckOf(checks, plainTurnOf((usable[0] as RunFrame).query?.background));
	const refCoarse = refSides.map((s) => (s.normal ? coarse(s.normal) : undefined));
	const renderCoarse = renderSides.map((s) => (s.normal ? coarse(s.normal) : undefined));
	const scores = refCoarse.map((r) => renderCoarse.map((s) => (r && s ? iou(r, s) : 0)));
	const alignment = alignTurn(scores, frameStep / renderStep);
	const firstTurn = (usable[0] as RunFrame).turn;
	const pairs: TurnPair[] = refSides.map((r, k) => {
		const j = alignment.pairs[k] as number;
		const frame = usable[j] as RunFrame;
		const wanted =
			firstTurn +
			(alignment.start + alignment.direction * k * (frameStep / renderStep)) * renderStep;
		return {
			...pairMetrics(r, renderSides[j] as Side),
			frame: k,
			referenceAngle: Number((k * frameStep).toFixed(3)),
			renderAngle: Number(wrap(frame.turn).toFixed(3)),
			renderFile: frame.file,
			offBy: Number(apart(wanted, frame.turn).toFixed(3)),
		};
	});
	const covered = pairs.filter((pair) => pair.offBy <= frameStep / 2 + 1e-6).length;
	const ious = pairs.flatMap((pair) => (pair.shapeIou === null ? [] : [pair.shapeIou]));
	const meanShapeIou = ious.length === 0 ? null : Number(mean(ious).toFixed(4));
	const { angles, frames: atAngle } = rubricFrames(video.arc, n);
	const refAt = atAngle.map((k) => refSides[k] as Side);
	const renderAt = atAngle.map((k) => renderSides[alignment.pairs[k] as number] as Side);
	const spreadOf = (sides: readonly Side[]) => crownBoxSpread(sides.map((s) => s.measures));
	const tiles: GridTile[] = pairs.map((pair, k) => {
		const r = refSides[k] as Side;
		const s = renderSides[alignment.pairs[k] as number] as Side;
		return {
			reference: r.image,
			render: s.image,
			...(r.normal && s.normal ? { overlay: overlay(r.normal, s.normal, 300, 120) } : {}),
			lines: [
				`F${k} REF ${pair.referenceAngle.toFixed(1)} REN ${pair.renderAngle.toFixed(1)}`,
				`IOU ${fixed(pair.shapeIou)} WIDTH ${fixed(pair.profileError, 3)} LEAF DE ${fixed(pair.foliageDeltaE, 1)}`,
			],
		};
	});
	const first = references[0] as Rgba;
	const pages = gridSheets(
		`${title}  ${n} FRAMES OVER ${video.arc} DEG  MEAN SHAPE IOU ${meanShapeIou === null ? '-' : meanShapeIou.toFixed(3)}`,
		tiles,
		first.width / first.height,
	);
	return {
		video: video.file,
		arc: video.arc,
		frames: n,
		renders: m,
		frameStep: Number(frameStep.toFixed(4)),
		renderStep: Number(renderStep.toFixed(4)),
		alignment: {
			start: alignment.start,
			direction: alignment.direction,
			coarseIou: Number(alignment.coarseIou.toFixed(4)),
		},
		meanShapeIou,
		covered,
		pairs,
		spread: {
			angles,
			reference: spreadOf(refAt),
			render: spreadOf(renderAt),
			metres: atAngle.map((k) => metresOf(usable[alignment.pairs[k] as number])),
		},
		maskCheck: mask.value,
		maskCheckFrames: mask.frames,
		maskCheckUnreadable: mask.unreadable,
		maskCheckThreshold: mask.threshold,
		maskCheckFailed: mask.failed,
		maskCheckSmall: mask.small,
		maskCheckSubject: mask.subject,
		sheets: writeSheets(runDir, group, pages),
	};
}

/** The result of comparing a wind video with a run's clip of the plant in the same wind. */
export interface WindResult {
	readonly video: string;
	readonly duration: number;
	/** Seconds from the clip's first frame to its last, and between its frames. */
	readonly span: number;
	readonly interval: number;
	readonly frames: number;
	/** Per height band of the plant, base first: the share of its outline that changes frame to frame. */
	readonly motion: { readonly reference: readonly number[]; readonly render: readonly number[] };
	readonly sheets: readonly string[];
	readonly error?: string;
}

/** Height bands the wind's motion is measured in. */
const MOTION_BANDS = 6;

/**
 * How much an outline moves per height band between frames of a clip: in each band of the first
 * frame's plant box, base first, the pixels that differ between frames over the pixels in either,
 * averaged over the clip.
 */
export function motionProfile(masks: readonly PlantMask[]): number[] {
	const first = masks[0];
	const box = first ? boxOf(first.mask, first.width, first.height) : null;
	if (!first || !box || masks.length < 2) return new Array(MOTION_BANDS).fill(0);
	const tall = box.bottom - box.top + 1;
	const sums = new Array(MOTION_BANDS).fill(0);
	for (let f = 1; f < masks.length; f++) {
		const a = (masks[f - 1] as PlantMask).mask;
		const b = (masks[f] as PlantMask).mask;
		const changed = new Array(MOTION_BANDS).fill(0);
		const either = new Array(MOTION_BANDS).fill(0);
		for (let y = box.top; y <= box.bottom; y++) {
			const band = Math.min(MOTION_BANDS - 1, Math.floor(((box.bottom - y) / tall) * MOTION_BANDS));
			for (let x = 0; x < first.width; x++) {
				const at = y * first.width + x;
				const p = a[at] as number;
				const q = b[at] as number;
				changed[band] += p ^ q;
				either[band] += p | q;
			}
		}
		for (let k = 0; k < MOTION_BANDS; k++)
			sums[k] += either[k] > 0 ? (changed[k] as number) / (either[k] as number) : 0;
	}
	return sums.map((sum) => Number((sum / (masks.length - 1)).toFixed(4)));
}

/**
 * Compares a wind video with a run's clip of the plant in wind: each render frame, at its time on
 * the wind clock from the clip's start, beside the video frame at the same time, and how much each
 * height band of the outline moves over each clip.
 */
export function compareWind(
	runDir: string,
	group: string,
	path: string,
	frames: readonly RunFrame[],
	start: number,
	title: string,
): WindResult {
	const facts = probeVideo(path);
	const usable = frames.filter((frame) => !frame.error).sort((a, b) => a.hold - b.hold);
	const times = usable.map((frame) => frame.hold - start);
	const base = {
		video: basename(path),
		duration: Number(facts.duration.toFixed(3)),
		span:
			times.length > 0 ? Number(((times.at(-1) as number) - (times[0] as number)).toFixed(3)) : 0,
		interval:
			times.length > 1
				? Number(Math.max(...times.slice(1).map((t, k) => t - (times[k] as number))).toFixed(3))
				: 0,
		frames: usable.length,
	};
	if (usable.length === 0)
		return {
			...base,
			motion: { reference: [], render: [] },
			sheets: [],
			error: 'the run drew no frame of this clip',
		};
	const references = videoFrames(path, facts, WORK_WIDTH);
	const picked = times.map(
		(t) => references[Math.min(references.length - 1, Math.round(t * facts.fps))] as Rgba,
	);
	const refMasks = picked.map((image) => plantMask(image));
	const renderMasks = usable.map((frame) =>
		frame.matte
			? matteMask(readImage(join(runDir, frame.matte)))
			: plantMask(readImage(join(runDir, frame.file))),
	);
	const reference = motionProfile(refMasks);
	const render = motionProfile(renderMasks);
	const tiles: GridTile[] = usable.map((frame, k) => ({
		reference: picked[k] as Rgba,
		render: readImage(join(runDir, frame.file)),
		lines: [`T ${(times[k] as number).toFixed(2)} S`],
	}));
	const first = picked[0] as Rgba;
	const pages = gridSheets(
		`${title}  MOTION BY BAND, BASE FIRST: REF ${reference.map((v) => v.toFixed(3)).join(' ')}  REN ${render.map((v) => v.toFixed(3)).join(' ')}`,
		tiles,
		first.width / first.height,
		8,
		4,
	);
	return { ...base, motion: { reference, render }, sheets: writeSheets(runDir, group, pages) };
}

/**
 * The sheath target's shape and its parser live in the review-data module; a junction or crown-foot
 * still of a species whose review data names one is read against it, because its subject is the
 * sheath itself.
 */
export type { SheathTarget };

/** A sheath surface's two ends as a picture shows them: mean CIELAB colour and pixels. */
export interface SheathPatches {
	readonly foot: { readonly colour: readonly number[]; readonly pixels: number };
	readonly collar: { readonly colour: readonly number[]; readonly pixels: number };
}

/** A sheath surface's figure: the render against the photograph, and against the record. */
export interface SheathDifference {
	/**
	 * The render's foot and collar against the photograph's, both lit by the view: the row's mark.
	 * Null when the photograph's sheath cannot be isolated in its picture.
	 */
	readonly photograph: { readonly foot: number; readonly collar: number } | null;
	/** The render's ends against the record's authored colours: the material check, not the row. */
	readonly record: { readonly foot: number; readonly collar: number };
	/** The pixels the render's two patches cover, so a reader can tell a figure from an empty patch. */
	readonly footPixels: number;
	readonly collarPixels: number;
	/** The photograph's patch areas, when it gave a figure. */
	readonly photographFootPixels?: number;
	readonly photographCollarPixels?: number;
}

/** One still or texture source beside the render of its view. */
export interface StillResult extends PairMetrics {
	readonly file: string;
	readonly kind: 'still' | 'texture';
	readonly view: string;
	readonly renderFile?: string;
	/**
	 * A reference outlined against a fitted background rather than a plain one: the surface, its
	 * fit and residual, and the horizon share for a ground, so the figure's basis is on the record.
	 */
	readonly fittedMask?: FittedMaskNote;
	/** Whether both pictures gave an outline on a plain background, so the outline measures hold. */
	readonly masked: boolean;
	/** For a bark texture: the CIEDE2000 difference of the middle of each picture. */
	readonly surfaceDeltaE: number | null;
	/**
	 * For a bark close view: the two pictures' bark colours in CIELAB, each the mean of nine patches
	 * spread across the picture. A close bark photograph does not separate from the bark that is its
	 * own background, so it draws no matte and has no outline to measure inside; the patches compare
	 * the material, which is what the row asks. The pair keeps the direction of the difference, so a
	 * reader can tell which way the drawn bark is off and which way to move a tint.
	 */
	readonly barkColour: {
		readonly reference: readonly number[];
		readonly render: readonly number[];
	} | null;
	/** How differently the two pictures' edges run, 0 when they run the same way. */
	readonly edgeDifference: number | null;
	/**
	 * The separate pieces each plant is drawn as, when both outlines come from a plain background.
	 * A plant hangs together, so a part that meets nothing shows here as an extra piece.
	 */
	readonly pieces: { readonly reference: number | null; readonly render: number } | null;
	/**
	 * The render matte's components and any piece that meets nothing inside the frame, read at the
	 * picture's own width. A piece that touches the frame's border may run on outside the picture,
	 * so it is not counted as floating.
	 */
	readonly connectivity: {
		readonly components: number;
		/** The row where the plant stands: a piece meeting it is rooted in the soil, not floating. */
		readonly footRow: number;
		/** The rows the plant's own feet land on, where the page named them: a piece inside it stands. */
		readonly groundBand: { readonly top: number; readonly base: number } | null;
		readonly floating: readonly { readonly area: number; readonly box: string }[];
		/**
		 * The same read at the tool's work width, kept beside the picture's own: a downscale can drop
		 * a hairline join the picture keeps, and so show a piece hanging free that the picture does
		 * not. Only the picture's own read decides whether a piece floats.
		 */
		readonly workWidth: {
			readonly components: number;
			readonly floating: readonly { readonly area: number; readonly box: string }[];
		} | null;
	} | null;
	/** The sparseness the picture was drawn at, where its query names one above the record. */
	readonly sparse?: number;
	/** What a close view's camera framed, and how clear it found its subject, as the page posted it. */
	readonly framing?: CloseFraming;
	/**
	 * For a junction or crown-foot still of a species whose record names its sheath's colours: the
	 * render's foot and collar patches, each read against the record under the view's own light.
	 */
	readonly sheath?: SheathDifference;
	/**
	 * Why the picture does not judge the primary plant, where the species' review data sets it
	 * aside: it shows a second form, it is a recorded limit of the reference, or it shows a stand of
	 * many plants. A stand is not measured at all; the others are measured and kept out of the rows.
	 */
	readonly standing?: { readonly kind: Standing; readonly reason: string };
	/** Why the picture's outline is not read, where the review data says its reference's cannot be. */
	readonly outlineVoid?: string;
	/**
	 * Why the plant fails the picture: it has no such part as the photograph shows, or the camera
	 * holds the part's place and the picture does not show it. No figure is read from the picture
	 * but its areas', and the rows it carries fail on it.
	 */
	readonly lacks?: string;
	/**
	 * The cover of each area of a solved view's contract, read from its picture of the parts: wood
	 * of the subject's thickness, leaves over it, open sky. Figures for the eye beside the
	 * photograph, and the reasons of a void or a fail.
	 */
	readonly areas?: readonly { readonly name: string; readonly cover: number }[];
	/**
	 * Whether a check confirmed that the picture shows its photograph's subject: a solved view
	 * whose contract held and whose regions were read from the picture, or a whole view that passed
	 * the framing check. A picture without one may show another subject, so no row passes on such
	 * pictures alone.
	 */
	readonly subjectChecked?: boolean;
	/**
	 * The level of detail the page drew the picture at, as it posted it: the leaf form, a card
	 * level or the far card. A figure read from the picture holds for that level alone.
	 */
	readonly level?: string;
	/**
	 * A cut branch's four density figures on both pictures, where the run measured them. A side
	 * is null where its picture gave no measure. `bare` says the piece carries no leaf: two of the
	 * figures are sound on bare wood only.
	 */
	readonly cutBranch?: {
		readonly reference: CutBranchFigures | null;
		readonly render: CutBranchFigures | null;
		readonly bare?: boolean;
	};
	/**
	 * Why the picture is void: its view has no subject in the plant, or the picture does not show
	 * it. A void picture carries no figure and decides no row. It is a fault of the tool's camera or
	 * of the reference's mapping to a view, never a judgement of the plant.
	 */
	readonly void?: string;
	readonly note?: string;
	readonly error?: string;
}

/**
 * The four figures a cut branch's density is judged by, read on one picture of the piece. Lengths
 * are in piece lengths, so a photograph and a drawing of one piece compare whatever their scale. A
 * figure is null where the picture cannot give it.
 */
export interface CutBranchFigures {
	/** Piece lengths of wood for each twig tip. */
	readonly woodPerTip: number | null;
	/** Twig tips for each square piece length of the piece's outline. */
	readonly tipsPerArea: number | null;
	/** The share of joints where four or more twigs leave one point; null where the piece has no joint. */
	readonly fanShare: number | null;
	/** Bends in the wood for each piece length of it. */
	readonly kinks: number | null;
}

/** The least share of the frame a close view's subject takes to be in its picture at all. */
const SUBJECT_LEAST_SHARE = 0.01;

/**
 * Why a close picture has no subject in it, where its page measured the subject's share of the
 * frame and found none: a camera that stands in the plane of what it frames sees it edge on.
 */
export function emptySubject(facts: unknown): string | undefined {
	const framing = closeFraming(facts);
	return framing && framing.fill !== null && framing.fill < SUBJECT_LEAST_SHARE
		? `the subject, ${framing.subject}, takes ${framing.fill.toFixed(2)} of the frame`
		: undefined;
}

/**
 * Why a picture answers no photograph of its own: the page drew the very picture it drew for an
 * earlier reference, though the two were asked for differently. Each asked-for difference, such
 * as a light or a height, then changed nothing, and one drawing must not count for two.
 */
export function sameDrawing(
	seen: Map<string, { readonly file: string; readonly query: string }>,
	file: string,
	frame: RunFrame,
): string | undefined {
	if (frame.sha256 === undefined) return undefined;
	const query = JSON.stringify(frame.query);
	const first = seen.get(frame.sha256);
	if (!first) {
		seen.set(frame.sha256, { file, query });
		return undefined;
	}
	return first.query === query
		? undefined
		: `the page drew the same picture as for ${first.file}, though the two were asked for differently`;
}

/** The share of a frame above which, or at none of which, the plant leaves no outline to read. */
const BLANK_MOST = 0.98;

/** Why a whole view's frame has no outline to read: the plant covers all of it, or none. */
export function blankFrame(plant: {
	readonly mask: Uint8Array;
	readonly width: number;
	readonly height: number;
}): string | undefined {
	let covered = 0;
	for (let at = 0; at < plant.mask.length; at++) covered += plant.mask[at] ? 1 : 0;
	const share = covered / Math.max(1, plant.mask.length);
	if (share === 0) return 'the frame holds no plant';
	return share > BLANK_MOST
		? `the plant covers ${share.toFixed(2)} of the frame, so the frame holds no outline`
		: undefined;
}

/** The level of detail a page posted for a cell, in words; undefined where it posted none. */
export function levelName(cell: unknown): string | undefined {
	const level = (cell as { level?: { name?: unknown; forced?: unknown } } | undefined)?.level;
	if (!level || typeof level.name !== 'string') return undefined;
	return level.forced === true ? `${level.name}, forced` : level.name;
}

/** How far a whole view's drawn plant may differ in size from its photograph's, as a share of it. */
export const FRAME_SIZE_BAND = 0.2;

/** A plant's box in a picture of a size. */
export interface FramedBox {
	readonly box: Box;
	readonly width: number;
	readonly height: number;
}

/** The edges of a frame, in the order a crop is named. */
const EDGES = ['left', 'top', 'right', 'bottom'] as const;

/**
 * Why a whole view's render crops the plant, or undefined when it does not: the render's plant runs
 * to an edge of the frame that the photograph's plant stands clear of. A cropped plant's outline,
 * gap and width are the crop's, so no figure is read from it. A photograph that itself crops the
 * plant at an edge allows the same crop.
 */
export function cropFault(
	reference: Readonly<Record<(typeof EDGES)[number], boolean>>,
	render: Readonly<Record<(typeof EDGES)[number], boolean>>,
): string | undefined {
	const cropped = EDGES.filter((edge) => render[edge] && !reference[edge]);
	return cropped.length === 0
		? undefined
		: `the render's plant runs off the frame's ${cropped.join(' and ')} edge${cropped.length === 1 ? '' : 's'}, where the photograph holds it whole`;
}

/**
 * Why a whole view's render does not hold the plant at its photograph's size, or undefined when it
 * does. A render smaller in both height and width by more than the size band, or larger in both,
 * was framed from the wrong distance, and every outline figure would then compare a small plant
 * with a large one. One side alone may differ, since that is the plant's own shape. The plant's
 * place in the frame is not compared: a photograph's outline can cut its foot short, and a render's
 * can run on to the frame's lower edge, so neither foot row is a sound mark.
 */
export function framingFault(reference: FramedBox, render: FramedBox): string | undefined {
	const shares = (side: FramedBox) => ({
		tall: (side.box.bottom - side.box.top + 1) / side.height,
		wide: (side.box.right - side.box.left + 1) / side.width,
	});
	const ref = shares(reference);
	const ren = shares(render);
	const tall = ren.tall / ref.tall;
	const wide = ren.wide / ref.wide;
	const small = tall < 1 - FRAME_SIZE_BAND && wide < 1 - FRAME_SIZE_BAND;
	const large = tall > 1 + FRAME_SIZE_BAND && wide > 1 + FRAME_SIZE_BAND;
	return small || large
		? `the render's plant takes ${ren.tall.toFixed(2)} of the frame's height and ${ren.wide.toFixed(2)} of its width, against the photograph's ${ref.tall.toFixed(2)} and ${ref.wide.toFixed(2)}, so it is drawn too ${small ? 'small' : 'large'}`
		: undefined;
}

/**
 * What a close view's camera framed: its subject, and the shares of the frame that the rest of the
 * plant covers in front of the subject and behind it, and that the subject itself fills. The camera
 * stands where the plant shows its subject clearest, so these are the plant's best, and a crown too
 * dense for a clear view shows here as a number. A warning says what the camera had to give up,
 * such as the subject it looks for, which a plain camera then stands in for.
 */
export interface CloseFraming {
	readonly subject: string;
	readonly front: number | null;
	readonly behind: number | null;
	readonly fill: number | null;
	readonly warning?: string;
}

/** The framing a page posted for a close view, if it posted one. */
export function closeFraming(facts: unknown): CloseFraming | undefined {
	const subject = (
		facts as {
			subject?: { kind?: unknown; clutter?: Record<string, unknown>; warning?: unknown };
		}
	)?.subject;
	if (!subject || typeof subject.kind !== 'string') return undefined;
	const share = (value: unknown) => (typeof value === 'number' ? Number(value.toFixed(3)) : null);
	return {
		subject: subject.kind,
		front: share(subject.clutter?.front),
		behind: share(subject.clutter?.behind),
		fill: share(subject.clutter?.subject),
		...(typeof subject.warning === 'string' && { warning: subject.warning }),
	};
}

/**
 * The mean CIELAB colour of nine patches spread across a picture. Each patch is a fifth of the
 * picture a side, centred at a fifth, a half and four fifths each way, so the patches do not overlap
 * and together they cover different phases of a bark tile. Averaging them measures the material
 * rather than the one window the camera happens to frame.
 *
 * With `onPlant`, pixels as close to a corner colour as the backdrop are dropped. With `barkOnly`,
 * leaf-green pixels are dropped as well: a limb close-up carries leaves across the bark, and the
 * material the figure is about is the bark. A patch that is leaf from edge to edge has no bark to
 * read, so it falls back to the plant-filtered mean.
 */
export function patchLab(image: Rgba, onPlant = false, barkOnly = false): number[] {
	const lab = labImage(image);
	// A picture's own background, read from its four corners: a close view lays a stem on sky or
	// on a plain studio ground, so the corners are the backdrop wherever the stem does not reach.
	// Each corner is read on its own, since a view can stand a stem against sky above and meadow
	// below: a single mean of the four would match neither, and the sky would be counted as bark.
	const corners = [
		[0, 0],
		[image.width - 1, 0],
		[0, image.height - 1],
		[image.width - 1, image.height - 1],
	].map(([x, y]) =>
		[0, 1, 2].map((c) => lab[((y as number) * image.width + (x as number)) * 3 + c] as number),
	);
	const sum = [0, 0, 0];
	let n = 0;
	const share = 0.2;
	for (const fy of [0.2, 0.5, 0.8])
		for (const fx of [0.2, 0.5, 0.8]) {
			const x0 = Math.round((fx - share / 2) * image.width);
			const x1 = Math.round((fx + share / 2) * image.width);
			const y0 = Math.round((fy - share / 2) * image.height);
			const y1 = Math.round((fy + share / 2) * image.height);
			for (let y = y0; y < y1; y++)
				for (let x = x0; x < x1; x++) {
					const at = (y * image.width + x) * 3;
					if (onPlant) {
						// A patch pixel as close to any corner as the paint itself is not the paint.
						const backdrop = corners.some(
							(corner) =>
								Math.hypot(
									(lab[at] as number) - (corner[0] as number),
									(lab[at + 1] as number) - (corner[1] as number),
									(lab[at + 2] as number) - (corner[2] as number),
								) < 8,
						);
						if (backdrop) continue;
					}
					if (barkOnly && (lab[at + 1] as number) < LEAF_GREEN) continue;
					for (let c = 0; c < 3; c++) sum[c] = (sum[c] as number) + (lab[at + c] as number);
					n++;
				}
		}
	if (n === 0 && barkOnly) return patchLab(image, onPlant);
	return sum.map((v) => v / Math.max(1, n));
}

/**
 * The colour difference between two pictures' nine-patch means, read on the plant alone when asked.
 * A texture source and its render are cut out on different colours, so asking for the plant drops
 * both backdrops and compares the material. With `barkOnly`, both sides drop their foliage too.
 */
export function patchDifference(
	reference: Rgba,
	render: Rgba,
	onPlant = false,
	barkOnly = false,
): number {
	return Number(
		deltaE2000(patchLab(reference, onPlant, barkOnly), patchLab(render, onPlant, barkOnly)).toFixed(
			2,
		),
	);
}

/**
 * The share of a sheath's length, at each end, that a patch reads. The record's collar share caps
 * it, so a colour that takes over only near the tip is not read a fifth of the way down.
 */
const SHEATH_PATCH_SHARE = 0.2;

/** The views whose subject is the sheath surface at the crown's foot. */
export const SHEATH_VIEWS: ReadonlySet<string> = new Set(['junction', 'crown-foot']);

/** A blade's green in CIELAB: a leaf is green on the a axis and warm on b, where a sheath is not. */
const GREEN_A = -8;
const GREEN_B = 5;

/** A linear reflectance as the sRGB byte the picture shows. */
function srgbByte(value: number): number {
	const v = Math.min(1, Math.max(0, value));
	return Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));
}

/**
 * Reads a sheath surface's foot and collar off a picture, in the plant's own box. The surface's
 * rows are the plant's pixels that are not leaf-green, since a sheath draws brown and pale where a
 * blade draws green; a view whose surface fills the frame takes the whole box. A surface that draws
 * green too — a record whose field the grower does not yet read — leaves the box as the surface.
 *
 * @param image The picture.
 * @param box The plant's box in the mask's pixels, as the measures give it.
 * @param plant The picture's mask, whose pixels are the plant's own.
 * @returns The two patches and their pixel counts, or null when an end holds no plant.
 */
export function sheathPatches(
	image: Rgba,
	box: Box,
	plant: PlantMask,
	reach: number,
): SheathPatches | null {
	if (box.right < box.left || box.bottom < box.top) return null;
	const work = image.width > plant.width ? resizeToWidth(image, plant.width) : image;
	const width = Math.min(plant.width, work.width);
	const height = Math.min(plant.height, work.height);
	const lab = labImage(work);
	const band = (top: number, bottom: number): { colour: number[]; pixels: number } => {
		const sum = [0, 0, 0];
		let pixels = 0;
		for (let y = Math.max(0, top); y <= Math.min(height - 1, bottom); y++)
			for (let x = Math.max(0, box.left); x <= Math.min(width - 1, box.right); x++) {
				if (!plant.mask[y * plant.width + x]) continue;
				const at = (y * width + x) * 3;
				for (let c = 0; c < 3; c++) sum[c] = (sum[c] as number) + (lab[at + c] as number);
				pixels++;
			}
		return { colour: sum.map((v) => v / Math.max(1, pixels)), pixels };
	};
	let surfaceTop = Number.POSITIVE_INFINITY;
	let surfaceBottom = Number.NEGATIVE_INFINITY;
	for (let y = Math.max(0, box.top); y <= Math.min(height - 1, box.bottom); y++)
		for (let x = Math.max(0, box.left); x <= Math.min(width - 1, box.right); x++) {
			if (!plant.mask[y * plant.width + x]) continue;
			const at = (y * width + x) * 3;
			if ((lab[at + 1] as number) < GREEN_A && (lab[at + 2] as number) > GREEN_B) continue;
			surfaceTop = Math.min(surfaceTop, y);
			surfaceBottom = Math.max(surfaceBottom, y);
		}
	const rows = surfaceBottom - surfaceTop;
	const top = rows >= 3 ? surfaceTop : Math.max(0, box.top);
	const bottom = rows >= 3 ? surfaceBottom : Math.min(height - 1, box.bottom);
	const surfaceHeight = bottom - top + 1;
	const collarRows = Math.max(1, Math.round(surfaceHeight * Math.min(SHEATH_PATCH_SHARE, reach)));
	const footRows = Math.max(1, Math.round(surfaceHeight * Math.min(SHEATH_PATCH_SHARE, 1 - reach)));
	const collar = band(top, top + collarRows - 1);
	const foot = band(bottom - footRows + 1, bottom);
	if (collar.pixels === 0 || foot.pixels === 0) return null;
	return { foot, collar };
}

/**
 * The sheath surface's figure: the render's foot and collar against the photograph's, both lit by
 * the view, which is the row's mark; and against the record's authored colours, which is the
 * material check. A record is an albedo, so a shaded sheath cannot pass it; the photograph is the
 * same lit surface the render draws.
 *
 * @param reference The photograph and its mask, or a null box when its sheath cannot be isolated.
 * @param render The render and its mask.
 * @param sheath The record's foot and collar colours and its collar share.
 * @returns The photograph and record steps and the patch areas, or null when the render holds none.
 */
export function sheathDifference(
	reference: { readonly image: Rgba; readonly box: Box | null; readonly plant: PlantMask },
	render: { readonly image: Rgba; readonly box: Box; readonly plant: PlantMask },
	sheath: SheathTarget,
): SheathDifference | null {
	const rendered = sheathPatches(render.image, render.box, render.plant, sheath.reach);
	if (!rendered) return null;
	const target = (rgb: readonly [number, number, number]) =>
		labOf(srgbByte(rgb[0]), srgbByte(rgb[1]), srgbByte(rgb[2]));
	const record = {
		foot: Number(deltaE2000(rendered.foot.colour, target(sheath.foot)).toFixed(2)),
		collar: Number(deltaE2000(rendered.collar.colour, target(sheath.collar)).toFixed(2)),
	};
	const photographed = reference.box
		? sheathPatches(reference.image, reference.box, reference.plant, sheath.reach)
		: null;
	const photograph = photographed
		? {
				foot: Number(deltaE2000(rendered.foot.colour, photographed.foot.colour).toFixed(2)),
				collar: Number(deltaE2000(rendered.collar.colour, photographed.collar.colour).toFixed(2)),
			}
		: null;
	return {
		photograph,
		record,
		footPixels: rendered.foot.pixels,
		collarPixels: rendered.collar.pixels,
		...(photographed
			? {
					photographFootPixels: photographed.foot.pixels,
					photographCollarPixels: photographed.collar.pixels,
				}
			: {}),
	};
}

/** A still or texture source as the comparison reads it: a cut-out laid on white. */
function referencePicture(path: string): Rgba {
	return onColour(readImage(path), [255, 255, 255]);
}

/** The cut subjects a species' reference pass wrote, or undefined when it has none. */
function subjectLoader(
	species: string | undefined,
): Record<string, { readonly bottom: number }> | undefined {
	if (!species) return undefined;
	try {
		return JSON.parse(
			readFileSync(join('tools/lib/plant-review/slots', `${species}-subjects.json`), 'utf8'),
		) as Record<string, { readonly bottom: number }>;
	} catch {
		return undefined;
	}
}

/** Compares each in-use still and texture source with the render of its view, and writes sheets. */
export function compareStills(
	runDir: string,
	set: ReferenceSet,
	frames: readonly RunFrame[],
	title: string,
	habit?: PlantHabit,
	sheath?: SheathTarget,
	pictures: Readonly<Record<string, PictureNote>> = {},
): { readonly pairs: readonly StillResult[]; readonly sheets: readonly string[] } {
	const byReference = new Map(
		frames.flatMap((frame) => (frame.reference ? [[frame.reference, frame]] : [])),
	);
	const subjectFile = subjectLoader(frames[0]?.query?.species);
	const results: StillResult[] = [];
	const rows: SheetRow[] = [];
	// The first reference each drawn picture answered, by the picture's hash, with its query.
	const drawnFor = new Map<string, { readonly file: string; readonly query: string }>();
	for (const slot of set.stills) {
		const refImage = referencePicture(join(set.folder, slot.file));
		const frame = byReference.get(slot.file);
		const head = [slot.file.replace(/\.\w+$/, '').slice(0, 17), `VIEW ${slot.view}`];
		const blankPair = {
			reference: slot.file,
			render: '',
			shapeIou: null,
			frameIou: null,
			profileError: null,
			gap: null,
			crownBoxGap: null,
			frameGap: null,
			frameScale: null,
			foliageDeltaE: null,
			barkDeltaE: null,
			crownBox: null,
			foliage: { reference: null, render: null },
		};
		if (!frame || frame.error) {
			const error = frame?.error ?? 'the run drew no render of this view';
			results.push({
				...blankPair,
				file: slot.file,
				kind: slot.kind,
				view: slot.view,
				masked: false,
				surfaceDeltaE: null,
				barkColour: null,
				edgeDifference: null,
				pieces: null,
				connectivity: null,
				error,
			});
			rows.push({ reference: refImage, lines: [...head, 'NO RENDER', error.slice(0, 18)] });
			continue;
		}
		// The matte at the picture's own width, which the subject check and the connectivity gate read.
		const own =
			frame.matte === undefined ? undefined : matteOwnMask(readImage(join(runDir, frame.matte)));
		// A picture that no figure is read from: it is laid on the sheet beside its reference with
		// the words that say why.
		const unread = (why: Partial<StillResult>, lines: readonly string[]) => {
			const framing = closeFraming(frame.facts);
			results.push({
				...blankPair,
				render: frame.file,
				file: slot.file,
				kind: slot.kind,
				view: slot.view,
				renderFile: frame.file,
				masked: false,
				surfaceDeltaE: null,
				barkColour: null,
				edgeDifference: null,
				pieces: null,
				connectivity: null,
				...why,
				...(framing ? { framing } : {}),
			});
			rows.push({
				reference: refImage,
				render: readImage(join(runDir, frame.file)),
				lines: [...head, ...lines],
			});
		};
		const pictureNote = pictures[slot.file];
		// A photograph of a stand needs several plants, which one plant cannot draw: it is not judged.
		if (pictureNote?.standing === 'stand') {
			unread({ standing: { kind: 'stand', reason: standReason(pictureNote) } }, [
				'NOT JUDGED',
				'A STAND OF PLANTS',
			]);
			continue;
		}
		// The parts in flat colours, where the run drew them: the areas of a solved view's contract
		// are read from that picture, which is cut and layered as the colour picture is.
		const partsPicture =
			frame.parts === undefined ? undefined : partsOf(readImage(join(runDir, frame.parts)));
		const areas = areaCovers(frame.facts, partsPicture);
		// A part the photograph shows and the plant does not have, or hides where the camera holds
		// its place, is the plant's fault: the picture carries no figure but its areas', and the
		// rows it carries fail on it.
		const lacks = lackReason(frame.facts, own, partsPicture);
		if (lacks !== undefined) {
			unread({ lacks, ...(areas.length > 0 && { areas }) }, [
				'PLANT LACKS OR',
				'HIDES THE SUBJECT',
			]);
			continue;
		}
		// A picture whose camera or framing failed decides nothing, and no figure is read from it.
		const voided =
			voidReason(frame.facts, own, partsPicture) ??
			emptySubject(frame.facts) ??
			sameDrawing(drawnFor, slot.file, frame);
		if (voided !== undefined) {
			unread({ void: voided }, ['VOID', 'SUBJECT MISSING']);
			continue;
		}
		// A cut piece is measured on its picture's own subject share, written by --subjects.
		const drawnEarly = frame.query?.view ?? slot.view;
		const piece = VIEW_SPECS[drawnEarly]?.cutting !== undefined;
		const subject = piece ? subjectFile?.[slot.file]?.bottom : undefined;
		// A silhouette is black on white in both pictures, so the photograph is read by the matte's
		// own rule: a texel is plant where it is darker than half.
		const refPlant =
			slot.view === 'silhouette'
				? halfDarkMask(plantMask(refImage), refImage)
				: plantMask(refImage);
		const refSide = side(slot.file, refImage, refPlant, false, habit, piece, subject);
		const render = renderSideOf(runDir, frame, frame.file, false, habit, piece, subject);
		// A whole view whose plant is cropped by the frame, or stands at another size than its
		// photograph's, compares unlike things, so it is void before any figure is read.
		const framingChecked = Boolean(
			slot.framed &&
				(slot.view === 'whole' || slot.view === 'silhouette') &&
				frame.matte !== undefined &&
				pictureNote?.outline === undefined &&
				refSide.measures.box &&
				render.measures.box,
		);
		const misframed =
			framingChecked && refSide.measures.box && render.measures.box
				? (cropFault(refSide.measures.clipped, render.measures.clipped) ??
					framingFault(
						{ box: refSide.measures.box, width: refPlant.width, height: refPlant.height },
						{ box: render.measures.box, width: render.plant.width, height: render.plant.height },
					))
				: undefined;
		if (misframed !== undefined) {
			unread({ void: `the frame does not hold the plant as its photograph does: ${misframed}` }, [
				'VOID',
				'FRAMING DIFFERS',
			]);
			continue;
		}
		// A whole view whose frame is all plant or holds none has no outline to read.
		const blank =
			(slot.view === 'whole' || slot.view === 'silhouette') && frame.matte !== undefined
				? blankFrame(render.plant)
				: undefined;
		if (blank !== undefined) {
			unread({ void: blank }, ['VOID', 'NO OUTLINE']);
			continue;
		}
		// A bark close view photographs the bark against bark, and a bark texture is a cut-out of
		// the material, so neither separates a plant from a background. Their rows read colour,
		// never an outline: a mask fitted to a picture with no plain border invents one.
		// The same holds for a picture whose slot names its own background as the subject,
		// such as a far scrub band the fitted sky and ground admit.
		const drawn = frame.query?.view ?? slot.view;
		// A reference whose outline joins its background, as the review data records, has none to read.
		// A solved close view stands inside the plant, where the frame cuts it and a matte reads
		// fuller than the picture. Its outline is not compared and its pieces are not counted, save
		// where its camera holds the whole plant, as a low plant's does.
		const closeInside = partsPicture !== undefined && !holdsWholePlant(frame.facts);
		const noOutline =
			closeInside ||
			!hasSeparableOutline(
				drawn,
				slot.kind,
				frame.query?.noOutline === true || pictureNote?.outline !== undefined,
			);
		// A close view of the wood takes no fitted sky or ground: its photograph has neither.
		const fittedKind =
			refPlant.background.plain || WOOD_CLOSE_VIEWS.has(drawn)
				? null
				: skyMaskable(refPlant.background)
					? ('sky' as const)
					: soilMaskable(refPlant.background, refPlant.height)
						? ('ground' as const)
						: null;
		// An outline is compared only where the photograph separates its plant: on a plain
		// background, or on a sky or a ground that the fit found.
		const separable = refPlant.background.plain || fittedKind !== null;
		const masked =
			!noOutline &&
			separable &&
			(frame.matte !== undefined || (fittedKind !== null && render.measures.box !== undefined));
		const pair = pairMetrics(masked ? refSide : { ...refSide, normal: undefined }, render);
		const bark = slot.kind === 'texture' && !slot.view.startsWith('leaf');
		// The shot carries the query the page was asked for, which is where a species' slot file
		// reaches; the reference rule's own query is a different thing and is often empty.
		const barkMaskOn = frame.query?.barkMask === true;
		// A texture source is a cut-out laid on one colour and the render stands on another, so an
		// unmasked average lifts both sides and the lifts nearly cancel. With the flag set, the
		// material is read on the bark alone.
		const surfaceDeltaE = bark ? patchDifference(refImage, render.image, barkMaskOn) : null;
		// A bark close view photographs the bark against the bark, so neither picture separates
		// from its own background and neither draws a matte. The patches compare the material.
		// A close view of the bark is named by the view it draws, not by the words in its file name: a
		// species whose photographs are called roots or petiole-section still draws the trunk close up,
		// and its colour is read the same way as any other bark's.
		// The view the picture was drawn at, from the shot's own query, is what decides whether its
		// colour is a bark colour: a species that names a picture's view draws that view, and the
		// reference's number must not overrule it.
		const barkClose = slot.kind !== 'texture' && BARK_VIEWS.has(drawn);
		// A limb close-up shows leaves over the bark, so a picture that names them reads the bark
		// alone on both sides; the blend would otherwise be a leaf colour on one side of the pair.
		const barkOnly = frame.query?.leafyBark === true;
		const barkColour = barkClose
			? {
					reference: patchLab(refImage, barkMaskOn, barkOnly),
					render: patchLab(render.image, barkMaskOn, barkOnly),
				}
			: null;
		// A junction or crown-foot still's subject is the sheath surface itself, so its foot and
		// collar are read against the record's own colours. No other view takes this figure.
		const sheathFigure =
			sheath && SHEATH_VIEWS.has(drawn) && render.measures.box
				? sheathDifference(
						{ image: refImage, box: refSide.measures.box, plant: refPlant },
						{ image: render.image, box: render.measures.box, plant: render.plant },
						sheath,
					)
				: null;
		const edges = Number(
			edgeDifference(edgeProfile(refImage), edgeProfile(render.image)).toFixed(3),
		);
		// A plant hangs together, so the number of pieces it is drawn as should match its
		// reference's. A part that meets nothing, such as a fruit on a stalk, adds a piece here
		// while every other figure stays sound. The render's own outline is exact wherever the run
		// drew a matte, so the render's count stands on its own when the reference does not separate.
		const parts =
			noOutline || frame.matte === undefined
				? null
				: pieceParts(
						anyPlantMask(render.plant),
						render.plant.width,
						render.plant.height,
						PIECE_AREA,
					);
		// The connectivity gate reads the matte at the picture's own width: a downscale to the work
		// width can drop a hairline shoot the picture keeps and so invent a piece hanging free. The
		// work-width read is kept beside it as a second figure.
		// A fork's picture draws only the wood near the joint's depth, so the cut leaves pieces that
		// hang free in it by design, and the gate does not read it.
		const ownParts =
			own && drawn !== 'fork' && !closeInside
				? piecePartsAtOwnWidth(own.mask, own.width, own.height)
				: null;
		const pieces = parts
			? {
					reference:
						refSide.measures.box !== null && separable
							? pieceCount(anyPlantMask(refPlant), refPlant.width, refPlant.height, PIECE_AREA)
							: null,
					render: parts.length,
				}
			: null;
		// The largest run is the plant's body; any other run that the frame's border does not carry
		// meets nothing inside the picture, which is a generator fault rather than a row's fault.
		const band = bandFor(frame, render.plant.height);
		const connectivity = ownParts
			? {
					components: ownParts.length,
					footRow: footRowOf(ownParts),
					groundBand: band ?? null,
					floating: floatingParts(ownParts, band),
					workWidth: parts
						? { components: parts.length, floating: floatingParts(parts, band) }
						: null,
				}
			: null;
		const shown: PairMetrics = masked
			? pair
			: {
					...pair,
					shapeIou: null,
					frameIou: null,
					profileError: null,
					gap: null,
					crownBoxGap: null,
					frameGap: null,
					frameScale: null,
					barkDeltaE: null,
					crownBox: null,
					foliageDeltaE: refPlant.background.plain ? pair.foliageDeltaE : null,
				};
		const framing = closeFraming(frame.facts);
		// The crown's box is read from an outline, so only a picture compared by outline has its note.
		const note = (masked ? crownNote(refSide.measures, render.measures) : undefined) ?? slot.note;
		results.push({
			...shown,
			file: slot.file,
			kind: slot.kind,
			view: slot.view,
			renderFile: frame.file,
			masked,
			...(fittedKind === null
				? {}
				: {
						fittedMask: {
							kind: fittedKind,
							skyFit: refPlant.background.sky.fit,
							skyNoise: refPlant.background.sky.noise,
							...(fittedKind === 'ground' && refPlant.background.ground
								? {
										groundFit: refPlant.background.ground.fit,
										groundNoise: refPlant.background.ground.noise,
										horizonShare: (refPlant.background.horizon ?? 0) / refPlant.height,
										...(refPlant.plantToGround !== undefined
											? { plantToGround: refPlant.plantToGround }
											: {}),
									}
								: {}),
						},
					}),
			surfaceDeltaE,
			barkColour,
			// A bark close view reads its bark difference off the same patches: the page's own figure
			// averages a plant mask, which a bark picture does not have and which on a thin stem is
			// mostly the backdrop.
			barkDeltaE: barkColour
				? Number(deltaE2000(barkColour.reference, barkColour.render).toFixed(2))
				: shown.barkDeltaE,
			edgeDifference: edges,
			pieces,
			connectivity,
			...(frame.query?.sparse !== undefined ? { sparse: frame.query.sparse } : {}),
			...(sheathFigure ? { sheath: sheathFigure } : {}),
			...(framing ? { framing } : {}),
			...(levelName(frame.cell) !== undefined && { level: levelName(frame.cell) }),
			...(areas.length > 0 && { areas }),
			// A solved view whose contract held, or a whole view that passed the framing check.
			subjectChecked:
				(contractHeld(frame.facts) &&
					regionsRead(frame.facts, own !== undefined, partsPicture !== undefined)) ||
				framingChecked,
			...(pictureNote?.outline !== undefined ? { outlineVoid: pictureNote.outline } : {}),
			...(pictureNote?.standing !== undefined && pictureNote.reason !== undefined
				? { standing: { kind: pictureNote.standing, reason: pictureNote.reason } }
				: {}),
			...(note ? { note } : {}),
		});
		rows.push({
			reference: refImage,
			render: render.image,
			...(masked && refSide.normal && render.normal
				? { overlay: overlay(refSide.normal, render.normal, 456, 300) }
				: {}),
			lines: masked
				? pairLines(head, shown)
				: [
						...head,
						...(shown.foliageDeltaE !== null ? [`LEAF DE ${fixed(shown.foliageDeltaE, 1)}`] : []),
						...(surfaceDeltaE !== null ? [`SURFACE DE ${fixed(surfaceDeltaE, 1)}`] : []),
						...(barkColour !== null
							? [
									`BARK DE ${fixed(deltaE2000(barkColour.reference, barkColour.render), 1)}`,
									`BARK REF ${labTriple(barkColour.reference)}`,
									`BARK REN ${labTriple(barkColour.render)}`,
								]
							: []),
						'NO PLAIN OUTLINE',
					],
		});
	}
	return {
		pairs: results,
		sheets: writeSheets(runDir, 'stills', contactSheets(title, rows, 1.5, 6)),
	};
}

/** A sheet of a run's views that no reference pairs with, three a row. */
export function viewSheets(
	runDir: string,
	group: string,
	frames: readonly RunFrame[],
	title: string,
): string[] {
	const ok = frames.filter((frame) => !frame.error);
	const rows: SheetRow[] = [];
	for (let i = 0; i < ok.length; i += 3) {
		const [a, b, c] = ok.slice(i, i + 3).map((frame) => readImage(join(runDir, frame.file)));
		rows.push({
			...(a ? { reference: a } : {}),
			...(b ? { render: b } : {}),
			...(c ? { overlay: c } : {}),
			lines: ok.slice(i, i + 3).map((frame) => basename(frame.file, '.png').slice(-17)),
		});
	}
	return writeSheets(runDir, group, contactSheets(title, rows, 4 / 3, 5, false));
}
