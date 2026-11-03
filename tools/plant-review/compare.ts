// Compares a render run of the plant review with a species' reference folder, frame by frame and
// view by view, and writes what a reviewer reads: contact sheets of reference, render and outline
// overlay, one row per angle or slot; the measures as metrics.json; and a short summary.md.
//
// - The whole plant's turn: the reference camera's framing is estimated from its video (the
//   horizon's row and the plant's box), which render.ts passes to the page. The render's frames are
//   matched to the video's by searching the start angle and the turning direction that give the
//   best mean outline overlap (IoU). Each frame then gets its overlap, its width-profile error, its
//   crown box, its gap fraction and its colour difference (CIEDE2000).
// - The slots: each reference still beside the render of its view, with the same measures where
//   the still's background is plain.
// - The cut pieces: the branch, sub-branch and leaf-cluster turns beside their studio videos.
//
// Outlines are compared after each is scaled to the same height and centred on its trunk, so the
// overlap measures shape rather than framing; the frame overlap, as framed, is reported beside it.
//
//   bun tools/plant-review/compare.ts --run <run folder> --refs <reference folder> [--frames 16]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { writePng } from '../../packages/cli/src/png.js';
import type { PlantReviewQuery } from '../../tests/pages/lib/plant-review.ts';
import {
	blank,
	deltaE2000,
	drawText,
	fillBox,
	hexOf,
	labOf,
	paste,
	pasteFitted,
	type Rgba,
	readImage,
	resize,
	srgbOf,
	textWidth,
} from './image.ts';
import {
	type Box,
	boxOf,
	matteMask,
	measurePlant,
	type PlantMask,
	type PlantMeasures,
	plantMask,
	readReferenceSet,
	rowSpans,
	turnFrames,
} from './references.ts';

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
		aspect: framing.aspect,
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
 * with render frame j; the frames of each are at even angles round a full turn.
 */
export function alignTurn(scores: readonly (readonly number[])[]): Alignment {
	const k = scores.length;
	const n = scores[0]?.length ?? 0;
	let best: Alignment = { start: 0, direction: 1, meanIou: -1, pairs: [] };
	for (const direction of [1, -1] as const)
		for (let start = 0; start < n; start++) {
			const pairs = Array.from({ length: k }, (_, i) => {
				const step = Math.round((i * n) / k);
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
 * The outline overlay of two outlines on the comparison canvas, cropped to both and fitted to a
 * box: the reference's outline magenta, the render's green, their shared area grey and each one's
 * own area tinted with its colour.
 */
export function overlay(
	reference: Uint8Array,
	render: Uint8Array,
	width: number,
	height: number,
): Rgba {
	const union = new Uint8Array(reference.length);
	for (let i = 0; i < union.length; i++)
		union[i] = (reference[i] as number) | (render[i] as number);
	const box = boxOf(union, NORMAL_WIDTH, NORMAL_HEIGHT) ?? {
		left: 0,
		top: 0,
		right: NORMAL_WIDTH - 1,
		bottom: NORMAL_HEIGHT - 1,
	};
	const margin = 4;
	const left = Math.max(0, box.left - margin);
	const top = Math.max(0, box.top - margin);
	const cropW = Math.min(NORMAL_WIDTH, box.right + margin + 1) - left;
	const cropH = Math.min(NORMAL_HEIGHT, box.bottom + margin + 1) - top;
	const s = Math.min(width / cropW, height / cropH);
	const w = Math.max(1, Math.floor(cropW * s));
	const h = Math.max(1, Math.floor(cropH * s));
	const sample = (mask: Uint8Array) => {
		const grey = blank(cropW, cropH, [0, 0, 0]);
		for (let y = 0; y < cropH; y++)
			for (let x = 0; x < cropW; x++) {
				const v = (mask[(top + y) * NORMAL_WIDTH + left + x] as number) * 255;
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

/** The fields of a render run's manifest that the comparison reads. */
export interface RunManifest {
	readonly species: string;
	readonly run: string;
	readonly commit: string;
	readonly references?: string;
	readonly frames: readonly RunFrame[];
}

/** One frame of a render run, as the manifest records it. */
export interface RunFrame {
	readonly group: string;
	readonly name: string;
	readonly file: string;
	readonly matte?: string;
	readonly query: PlantReviewQuery;
	readonly reference?: string;
	readonly error?: string;
	readonly facts?: unknown;
}

/** A number for a label, or a dash for none. */
function fixed(value: number | null | undefined, digits = 2): string {
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

/** The result of comparing one turn: the alignment, each pair, and the spreads round the turn. */
interface TurnResult {
	readonly video: string;
	readonly alignment: Alignment;
	readonly pairs: readonly (PairMetrics & {
		readonly referenceAngle: number;
		readonly renderAngle: number;
	})[];
	readonly spread: {
		readonly reference: { readonly width: number; readonly height: number };
		readonly render: { readonly width: number; readonly height: number };
	};
	readonly maskCheck: number | null;
	readonly sheets: readonly string[];
}

/** Compares a render run's turn of one group with a reference video, and writes its sheets. */
function compareTurn(
	runDir: string,
	group: string,
	frames: readonly RunFrame[],
	video: string,
	title: string,
): TurnResult {
	const usable = frames.filter((frame) => !frame.error);
	const n = usable.length;
	const reference = turnFrames(video, n);
	const refMasks = reference.map((frame) => plantMask(frame.image));
	const refMeasures = refMasks.map((mask, i) =>
		measurePlant((reference[i] as { image: Rgba }).image, mask),
	);
	const bottomCut = refMeasures.filter((m) => m.clipped.bottom).length > n / 2;
	const refSides = reference.map((frame, i) =>
		side(`REF ${frame.angle.toFixed(0)}°`, frame.image, refMasks[i] as PlantMask, bottomCut),
	);
	const renderSides = usable.map((frame) =>
		renderSide(
			`RENDER ${(frame.query.turn ?? 0).toFixed(0)}°`,
			join(runDir, frame.file),
			frame.matte ? join(runDir, frame.matte) : undefined,
			bottomCut,
		),
	);
	// How well the colour outline finds a render's plant, against the matte's exact outline.
	const checks = usable.flatMap((frame, i) => {
		if (!frame.matte) return [];
		const coloured = plantMask(renderSides[i]?.image as Rgba);
		return [frameIou(coloured, (renderSides[i] as Side).plant)];
	});
	const scores = refSides.map((r) =>
		renderSides.map((s) => (r.normal && s.normal ? iou(r.normal, s.normal) : 0)),
	);
	const alignment = alignTurn(scores);
	const pairs = refSides.map((r, k) => {
		const j = alignment.pairs[k] as number;
		const s = renderSides[j] as Side;
		return {
			...pairMetrics(r, s),
			referenceAngle: (reference[k] as { angle: number }).angle,
			renderAngle: usable[j]?.query.turn ?? 0,
		};
	});
	const crown = (sides: readonly Side[]) => ({
		width: Number(
			spread(sides.flatMap((s) => (s.measures.box ? [s.measures.crownBox.width] : []))).toFixed(4),
		),
		height: Number(
			spread(sides.flatMap((s) => (s.measures.box ? [s.measures.crownBox.height] : []))).toFixed(4),
		),
	});
	const rows: SheetRow[] = pairs.map((pair, k) => {
		const r = refSides[k] as Side;
		const s = renderSides[alignment.pairs[k] as number] as Side;
		return {
			reference: r.image,
			render: s.image,
			...(r.normal && s.normal ? { overlay: overlay(r.normal, s.normal, 456, 256) } : {}),
			lines: pairLines([r.label, s.label], pair),
		};
	});
	const first = reference[0]?.image as Rgba;
	const pages = contactSheets(
		`${title}  MEAN SHAPE IOU ${alignment.meanIou.toFixed(3)}`,
		rows,
		first.width / first.height,
		8,
	);
	const sheets = pages.map((page, p) => {
		const name = `sheet-${group}-${String(p + 1).padStart(2, '0')}.png`;
		writePng(join(runDir, name), page);
		return name;
	});
	return {
		video: basename(video),
		alignment,
		pairs,
		spread: { reference: crown(refSides), render: crown(renderSides) },
		maskCheck: checks.length > 0 ? Number(mean(checks).toFixed(4)) : null,
		sheets,
	};
}

/** Compares a run's slot renders with their reference stills, and writes the slots' sheets. */
function compareSlots(runDir: string, refs: string, frames: readonly RunFrame[], title: string) {
	const notes = new Map(readReferenceSet(refs).stills.map((slot) => [slot.file, slot.note]));
	const results: (PairMetrics & { slot: string; view: string; masked: boolean; note?: string })[] =
		[];
	const rows: SheetRow[] = [];
	for (const frame of frames) {
		if (!frame.reference) continue;
		const refImage = readImage(join(refs, frame.reference));
		const refPlant = plantMask(refImage);
		const framed = frame.matte !== undefined;
		const refSide = side(frame.reference, refImage, refPlant, false);
		if (frame.error) {
			rows.push({
				reference: refImage,
				lines: [frame.reference, `RENDER FAILED`, frame.error.slice(0, 18)],
			});
			continue;
		}
		const renderSideOf = renderSide(
			frame.name,
			join(runDir, frame.file),
			frame.matte ? join(runDir, frame.matte) : undefined,
			false,
		);
		// Outline measures need the whole plant on a plain background in both pictures. A close view
		// on a plain background, such as a leaf on white, keeps only its foliage colour difference.
		const masked = refPlant.background.plain && framed;
		const pair = pairMetrics(masked ? refSide : { ...refSide, normal: undefined }, renderSideOf);
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
		const note = notes.get(frame.reference);
		results.push({
			...shown,
			slot: frame.reference,
			view: frame.query.view ?? 'whole',
			masked,
			...(note ? { note } : {}),
		});
		const head = [
			frame.reference.replace(/\.\w+$/, '').slice(0, 17),
			`VIEW ${frame.query.view ?? 'whole'}`,
		];
		rows.push({
			reference: refImage,
			render: renderSideOf.image,
			...(masked && refSide.normal && renderSideOf.normal
				? { overlay: overlay(refSide.normal, renderSideOf.normal, 456, 300) }
				: {}),
			lines: masked
				? pairLines(head, shown)
				: [
						...head,
						...(shown.foliageDeltaE !== null ? [`LEAF DE ${fixed(shown.foliageDeltaE, 1)}`] : []),
						'NO PLAIN OUTLINE',
					],
		});
	}
	const pages = contactSheets(title, rows, 1.5, 6);
	const sheets = pages.map((page, p) => {
		const name = `sheet-slots-${String(p + 1).padStart(2, '0')}.png`;
		writePng(join(runDir, name), page);
		return name;
	});
	return { pairs: results, sheets };
}

/** Writes a sheet of a run's single views, which have no reference to pair with. */
function sheetOfViews(
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
			lines: ok.slice(i, i + 3).map((frame) => frame.name.slice(-17)),
		});
	}
	const first = ok[0] ? readImage(join(runDir, ok[0].file)) : undefined;
	const aspect = first ? first.width / first.height : 0.75;
	return contactSheets(title, rows, aspect, 6, false).map((page, p) => {
		const name = `sheet-${group}-${String(p + 1).padStart(2, '0')}.png`;
		writePng(join(runDir, name), page);
		return name;
	});
}

/** The rubric's band for the crown box's spread round a turn: 15 per cent for a conifer, else 25. */
function band(species: string): number {
	return /spruce|pine|fir|cedar|larch|cypress|yew|sequoia|juniper|conifer/.test(species)
		? 0.15
		: 0.25;
}

/** One line of the summary for a turn's result. */
function turnSummary(name: string, result: TurnResult, species: string): string[] {
	const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
	// The mean of the values a measure has, or a dash when no pair has one.
	const meanOf = (values: readonly (number | null | undefined)[], digits: number) => {
		const present = values.filter((v): v is number => v !== null && v !== undefined);
		return present.length === 0 ? '-' : mean(present).toFixed(digits);
	};
	const limit = band(species);
	const ref = result.spread.reference;
	const ren = result.spread.render;
	// A reference that varies more round its turn than the band widens the band to its own spread,
	// width and height each on their own.
	const wide = Math.max(limit, ref.width);
	const tall = Math.max(limit, ref.height);
	const verdict = (render: number, allowed: number) =>
		`${pct(allowed)}${allowed > limit ? " (the reference's own)" : ''}, so ${render <= allowed ? 'inside' : 'outside'}`;
	return [
		`### ${name} (${result.video})`,
		'',
		`- Alignment: the render's frame ${result.alignment.start} matches the video's first frame, turning ${result.alignment.direction === 1 ? 'the same way' : 'the other way'}; mean shape IoU ${result.alignment.meanIou.toFixed(3)}.`,
		`- Shape IoU per frame: ${result.pairs.map((p) => fixed(p.shapeIou)).join(', ')}.`,
		`- Width-profile error, mean: ${meanOf(
			result.pairs.map((p) => p.profileError),
			3,
		)} plant heights.`,
		`- Crown box spread round the turn: reference ${pct(ref.width)} wide and ${pct(ref.height)} tall; render ${pct(ren.width)} wide and ${pct(ren.height)} tall. The band is ${pct(limit)}: in width ${verdict(ren.width, wide)}; in height ${verdict(ren.height, tall)}.`,
		`- Gap fraction, mean: reference ${meanOf(
			result.pairs.map((p) => p.gap?.reference),
			3,
		)}, render ${meanOf(
			result.pairs.map((p) => p.gap?.render),
			3,
		)}.`,
		`- Foliage colour difference (CIEDE2000), mean: ${meanOf(
			result.pairs.map((p) => p.foliageDeltaE),
			1,
		)}; bark: ${meanOf(
			result.pairs.map((p) => p.barkDeltaE),
			1,
		)}.`,
		...(result.maskCheck !== null
			? [
					`- Mask check: the colour outline of the render frames overlaps their exact matte by ${result.maskCheck.toFixed(3)} IoU.`,
				]
			: []),
		`- Sheets: ${result.sheets.join(', ')}.`,
		'',
	];
}

/** One named option from the command line, or its default. */
function option(name: string, fallback?: string): string {
	const at = process.argv.indexOf(`--${name}`);
	const value = at >= 0 ? process.argv[at + 1] : undefined;
	if (value === undefined) {
		if (fallback !== undefined) return fallback;
		throw new Error(`--${name} is required.`);
	}
	return value;
}

async function main(): Promise<void> {
	const runDir = option('run');
	const manifest = JSON.parse(readFileSync(join(runDir, 'manifest.json'), 'utf8')) as RunManifest;
	const refs = option('refs', manifest.references ?? '');
	if (!refs) throw new Error('give --refs <reference folder>; the run names none');
	const set = readReferenceSet(refs);
	const byGroup = new Map<string, RunFrame[]>();
	for (const frame of manifest.frames) {
		const list = byGroup.get(frame.group) ?? [];
		list.push(frame);
		byGroup.set(frame.group, list);
	}
	const label = `${manifest.species} VS ${set.slug}`;
	const metrics: Record<string, unknown> = {
		run: manifest.run,
		commit: manifest.commit,
		species: manifest.species,
		references: refs,
	};
	const summary: string[] = [
		`# ${manifest.species} against ${set.slug}`,
		'',
		`Run \`${manifest.run}\` at commit \`${manifest.commit}\`. Shape IoU compares outlines scaled to the same height and centred on the trunk; frame IoU compares them as framed. Gap fraction is the share of the crown's outline that shows background. Colour differences are CIEDE2000, where about 2 is a visible step.`,
		'',
	];
	const turntable = byGroup.get('turntable');
	if (turntable && set.turntable) {
		const result = compareTurn(
			runDir,
			'turntable',
			turntable,
			set.turntable,
			`${label}  TURNTABLE`,
		);
		metrics.turntable = result;
		summary.push(...turnSummary('Whole plant turning', result, manifest.species));
	}
	for (const piece of ['branch', 'subbranch', 'cluster'] as const) {
		const frames = byGroup.get(`close-${piece}`);
		const video = set.close[piece];
		if (!frames) continue;
		if (!video) {
			summary.push(
				`### ${piece}`,
				'',
				`- The reference folder has no ${piece} video yet, so the render's turn is drawn alone.`,
				'',
			);
			metrics[`close-${piece}`] = {
				sheets: sheetOfViews(
					runDir,
					`close-${piece}`,
					frames,
					`${label}  ${piece.toUpperCase()} (NO REFERENCE VIDEO)`,
				),
			};
			continue;
		}
		const result = compareTurn(
			runDir,
			`close-${piece}`,
			frames,
			video,
			`${label}  ${piece.toUpperCase()}`,
		);
		metrics[`close-${piece}`] = result;
		summary.push(...turnSummary(`Cut ${piece}`, result, manifest.species));
	}
	const slots = byGroup.get('slots');
	if (slots) {
		const result = compareSlots(runDir, refs, slots, `${label}  SLOTS`);
		metrics.slots = result;
		const masked = result.pairs.filter((p) => p.masked);
		summary.push(
			'### Slots',
			'',
			`- ${result.pairs.length} stills paired with a render of their view; ${masked.length} of them show the whole plant on a plain background and carry outline measures.`,
			...masked.map(
				(p) =>
					`- ${p.slot}: shape IoU ${fixed(p.shapeIou)}, width error ${fixed(p.profileError, 3)}, gap ${fixed(p.gap?.reference)} against ${fixed(p.gap?.render)}, foliage colour difference ${fixed(p.foliageDeltaE, 1)}.`,
			),
			...result.pairs.flatMap((p) => (p.note ? [`- ${p.slot}: ${p.note}.`] : [])),
			`- Sheets: ${result.sheets.join(', ')}.`,
			'',
		);
	}
	const views = byGroup.get('views');
	if (views) {
		metrics.views = { sheets: sheetOfViews(runDir, 'views', views, `${manifest.species}  VIEWS`) };
		summary.push(
			'### Views',
			'',
			`- Sheets: ${(metrics.views as { sheets: string[] }).sheets.join(', ')}.`,
			'',
		);
	}
	summary.push(
		'### Limits of the measures',
		'',
		"- The reference outline comes from colour against a plain background. Below the horizon it keeps only the plant that hangs down from above and is not a darker copy of the meadow, so foliage that sweeps the ground can be lost and a trunk's foot can be cut short.",
		"- The render outline comes from the run's matte where the run drew one, so it is exact.",
		'- A turning video is taken to turn at a steady rate through one full turn; the alignment cannot repair a video that speeds up or stops short.',
		'',
	);
	writeFileSync(join(runDir, 'metrics.json'), `${JSON.stringify(metrics, null, '\t')}\n`);
	writeFileSync(join(runDir, 'summary.md'), `${summary.join('\n')}\n`);
	console.log(summary.join('\n'));
}

if (import.meta.main) {
	main().catch((error: unknown) => {
		console.error(`error: ${(error as Error).message}`);
		process.exit(1);
	});
}
