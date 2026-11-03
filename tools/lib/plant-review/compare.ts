// The comparison of a review run with a species' reference folder: the measures of an outline
// pair (shape and frame overlap, width profile, gap fraction, crown box, colour differences), the
// framing a render takes from a reference, the pairing of a turning video's frames with the renders
// at their angles, the wind's motion by height band, and the contact sheets a reviewer reads.
//
// Outlines are compared after each is scaled to the same height and centred on its trunk, so the
// overlap measures shape rather than framing; the frame overlap, as framed, is reported beside it.
import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { writePng } from '../../../packages/cli/src/png.js';
import type { PlantReviewQuery } from '../../../tests/pages/lib/plant-review/query.ts';
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
	srgbOf,
	textWidth,
	videoFrames,
} from './image.ts';
import {
	type Box,
	boxOf,
	matteMask,
	measurePlant,
	type PlantMask,
	type PlantMeasures,
	plantMask,
	type ReferenceSet,
	rowSpans,
	type TurnVideo,
	WORK_WIDTH,
} from './references.ts';
import type { RunFrame } from './render.ts';

/** The camera's framing of a reference, in screen shares, as the review page takes it. */
export interface ReferenceFraming {
	readonly horizon: number;
	readonly top: number;
	/** The plant base's row share, or undefined when the base is out of the frame. */
	readonly base?: number;
	readonly targetX: number;
	/** The frame's width over its height. */
	readonly aspect: number;
	/** The plain sky's and the meadow's colours, as sRGB hex. */
	readonly sky: string;
	readonly ground?: string;
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

/** The column of the plant's trunk at its base, or the box's middle when the base is cut off. */
export function anchorColumn(mask: Uint8Array, width: number, height: number, box: Box): number {
	if (box.bottom >= height - 1) return (box.left + box.right) / 2;
	const spans = rowSpans(mask, width, height);
	const rows = Math.max(2, Math.round((box.bottom - box.top + 1) * 0.04));
	const centres: number[] = [];
	for (let y = box.bottom; y > box.bottom - rows; y--) {
		const left = spans[y * 2] as number;
		if (left >= 0) centres.push((left + (spans[y * 2 + 1] as number)) / 2);
	}
	return median(centres) ?? (box.left + box.right) / 2;
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
	return {
		horizon: Number(horizon.toFixed(4)),
		top: Number((median(tops) as number).toFixed(4)),
		...(clipped ? {} : { base: Number((median(bases) as number).toFixed(4)) }),
		targetX: Number((median(columns) as number).toFixed(4)),
		aspect: Number((first.width / first.height).toFixed(5)),
		sky: meanHex(usable.map(({ m }) => m.sky)),
		...(usable.some(({ m }) => m.ground)
			? { ground: meanHex(usable.flatMap(({ m }) => (m.ground ? [m.ground] : []))) }
			: {}),
		frames: usable.length,
		notes,
	};
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
		sky: framing.sky,
		...(framing.ground ? { ground: framing.ground } : {}),
		...placed,
	};
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
	/** The mean overlap of the matched pairs. */
	readonly meanIou: number;
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
	let best: Alignment = { start: 0, direction: 1, meanIou: -1, pairs: [] };
	for (const direction of [1, -1] as const)
		for (let start = 0; start < n; start++) {
			const pairs = Array.from({ length: k }, (_, i) => {
				const step = Math.round(i * ratio);
				return (((start + direction * step) % n) + n) % n;
			});
			const meanIou = mean(pairs.map((j, i) => (scores[i] as readonly number[])[j] as number));
			if (meanIou > best.meanIou + 1e-9) best = { start, direction, meanIou, pairs };
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
): Side {
	const image = readImage(file);
	const plant = matte && existsSync(matte) ? matteMask(readImage(matte)) : plantMask(image);
	return side(label, image, plant, bottomCut);
}

/** A side of a comparison from a picture and its outline. */
function side(label: string, image: Rgba, plant: PlantMask, bottomCut: boolean): Side {
	const measures = measurePlant(image, plant);
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
	readonly gap: { readonly reference: number; readonly render: number } | null;
	readonly foliageDeltaE: number | null;
	readonly barkDeltaE: number | null;
	readonly crownBox: {
		readonly reference: { readonly width: number; readonly height: number };
		readonly render: { readonly width: number; readonly height: number };
	} | null;
	readonly foliage: { readonly reference: string | null; readonly render: string | null };
}

/** Compares a reference frame with a render frame. */
function pairMetrics(reference: Side, render: Side): PairMetrics {
	const both = reference.measures.box !== null && render.measures.box !== null;
	const colour = (a: { lab: readonly number[] } | null, b: { lab: readonly number[] } | null) =>
		a && b ? Number(deltaE2000(a.lab, b.lab).toFixed(2)) : null;
	return {
		reference: reference.label,
		render: render.label,
		shapeIou:
			reference.normal && render.normal
				? Number(iou(reference.normal, render.normal).toFixed(4))
				: null,
		frameIou: both ? Number(frameIou(reference.plant, render.plant).toFixed(4)) : null,
		profileError: both
			? Number(
					profileError(reference.measures.widthProfile, render.measures.widthProfile).toFixed(4),
				)
			: null,
		gap: both
			? { reference: reference.measures.gapFraction, render: render.measures.gapFraction }
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

/** The labels of a compared pair. */
function pairLines(head: readonly string[], pair: PairMetrics): string[] {
	return [
		...head,
		`SHAPE IOU ${fixed(pair.shapeIou)}`,
		`FRAME IOU ${fixed(pair.frameIou)}`,
		`WIDTH ERR ${fixed(pair.profileError, 3)}`,
		`GAP ${fixed(pair.gap?.reference)} / ${fixed(pair.gap?.render)}`,
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
	readonly sheets: readonly string[];
	readonly error?: string;
}

/** A render frame's side of a comparison. */
function renderSideOf(runDir: string, frame: RunFrame, label: string, bottomCut: boolean): Side {
	return renderSide(
		label,
		join(runDir, frame.file),
		frame.matte ? join(runDir, frame.matte) : undefined,
		bottomCut,
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
		alignment: { start: 0, direction: 1 as const, meanIou: 0 },
		covered: 0,
		pairs: [],
		spread: {
			angles: [],
			reference: { width: 0, height: 0 },
			render: { width: 0, height: 0 },
			metres: [],
		},
		maskCheck: null,
		sheets: [],
	};
	if (m === 0) return { ...empty, error: 'the run drew no frame of this turn' };
	const refMasks = references.map((image) => plantMask(image));
	const refMeasures = refMasks.map((mask, k) => measurePlant(references[k] as Rgba, mask));
	const bottomCut = refMeasures.filter((measure) => measure.clipped.bottom).length > n / 2;
	const refSides = references.map((image, k) =>
		side(`REF ${(k * frameStep).toFixed(1)}`, image, refMasks[k] as PlantMask, bottomCut),
	);
	const renderSides = usable.map((frame) =>
		renderSideOf(runDir, frame, `RENDER ${frame.turn.toFixed(1)}`, bottomCut),
	);
	const checks = usable.flatMap((frame, j) => {
		if (!frame.matte) return [];
		const coloured = plantMask((renderSides[j] as Side).image);
		return [frameIou(coloured, (renderSides[j] as Side).plant)];
	});
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
		`${title}  ${n} FRAMES OVER ${video.arc} DEG  MEAN SHAPE IOU ${alignment.meanIou.toFixed(3)}`,
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
			meanIou: Number(alignment.meanIou.toFixed(4)),
		},
		covered,
		pairs,
		spread: {
			angles,
			reference: spreadOf(refAt),
			render: spreadOf(renderAt),
			metres: atAngle.map((k) => metresOf(usable[alignment.pairs[k] as number])),
		},
		maskCheck: checks.length > 0 ? Number(mean(checks).toFixed(4)) : null,
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

/** One still or texture source beside the render of its view. */
export interface StillResult extends PairMetrics {
	readonly file: string;
	readonly kind: 'still' | 'texture';
	readonly view: string;
	readonly renderFile?: string;
	/** Whether both pictures gave an outline on a plain background, so the outline measures hold. */
	readonly masked: boolean;
	/** For a bark texture: the CIEDE2000 difference of the middle of each picture. */
	readonly surfaceDeltaE: number | null;
	readonly note?: string;
	readonly error?: string;
}

/** The mean CIELAB colour of a picture's middle third each way. */
function middleLab(image: Rgba): number[] {
	const lab = labImage(image);
	const sum = [0, 0, 0];
	let n = 0;
	for (let y = Math.floor(image.height / 3); y < Math.floor((image.height * 2) / 3); y++)
		for (let x = Math.floor(image.width / 3); x < Math.floor((image.width * 2) / 3); x++) {
			const at = (y * image.width + x) * 3;
			for (let c = 0; c < 3; c++) sum[c] = (sum[c] as number) + (lab[at + c] as number);
			n++;
		}
	return sum.map((v) => v / Math.max(1, n));
}

/** A still or texture source as the comparison reads it: a cut-out laid on white. */
function referencePicture(path: string): Rgba {
	return onColour(readImage(path), [255, 255, 255]);
}

/** Compares each in-use still and texture source with the render of its view, and writes sheets. */
export function compareStills(
	runDir: string,
	set: ReferenceSet,
	frames: readonly RunFrame[],
	title: string,
): { readonly pairs: readonly StillResult[]; readonly sheets: readonly string[] } {
	const byReference = new Map(
		frames.flatMap((frame) => (frame.reference ? [[frame.reference, frame]] : [])),
	);
	const results: StillResult[] = [];
	const rows: SheetRow[] = [];
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
				error,
			});
			rows.push({ reference: refImage, lines: [...head, 'NO RENDER', error.slice(0, 18)] });
			continue;
		}
		const refPlant = plantMask(refImage);
		const refSide = side(slot.file, refImage, refPlant, false);
		const render = renderSideOf(runDir, frame, frame.file, false);
		const masked = refPlant.background.plain && frame.matte !== undefined;
		const pair = pairMetrics(masked ? refSide : { ...refSide, normal: undefined }, render);
		const bark = slot.kind === 'texture' && !slot.view.startsWith('leaf');
		const surfaceDeltaE = bark
			? Number(deltaE2000(middleLab(refImage), middleLab(render.image)).toFixed(2))
			: null;
		const shown: PairMetrics = masked
			? pair
			: {
					...pair,
					shapeIou: null,
					frameIou: null,
					profileError: null,
					gap: null,
					barkDeltaE: null,
					crownBox: null,
					foliageDeltaE: refPlant.background.plain ? pair.foliageDeltaE : null,
				};
		results.push({
			...shown,
			file: slot.file,
			kind: slot.kind,
			view: slot.view,
			renderFile: frame.file,
			masked,
			surfaceDeltaE,
			...(slot.note ? { note: slot.note } : {}),
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
