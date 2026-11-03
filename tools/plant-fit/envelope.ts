// The envelope of a plant from the outlines of its turning video: the visual hull of the views.
// Each view, at the camera's turn θ, bounds the crown at every height in a slab across the view: a
// point of the crown at azimuth φ and radius r lies right of the trunk by r·cos(φ + θ), which is at
// most the outline's right extent, and left of it by at most the left extent. So each view bounds
// the radius at each azimuth by an extent over a cosine: the support function of the crown's
// section in the view's direction. The radius is the bound a few views from the smallest, which
// passes over the views where a generated plant drifts from the rest. Heights and radii are shares
// of the plant's height, azimuths turn from +X toward +Z, and the view at turn 0 looks from +Z.

import type { RadialEnvelope } from '../../packages/vegetation/src/core/record.ts';
import { envelopeSilhouette, envelopeVolume } from '../../packages/vegetation/src/grow/envelope.ts';
import { iou, mean } from '../lib/plant-review/compare.ts';
import { CELLS, COLUMNS, columnX } from './silhouettes.ts';

/** Azimuths the envelope holds a radius at. */
export const AZIMUTHS = 16;
/** Heights the envelope holds radii at, from the crown's base to the plant's top. */
export const LEVELS = 15;
/** The share of a height's bounds, from the smallest, that the radius passes over. */
export const DRIFT_SHARE = 0.07;
/** The width in plant heights from which a row counts as crown rather than stem. */
const CROWN_WIDTH = 0.2;
/** The most rows of stem that a crown's run of wide rows passes over. */
const STEM_GAP = 2;
/** Below this share of the height, a crown's base sits on the ground and the plant has no stem. */
const STEM_SHARE = 0.02;
/** The share of the next height's radii that the crown's lowest height takes on a stemmed plant. */
const BASE_SHARE = 0.85;
/** A view bounds an azimuth only where the cosine between them passes this. */
const LEAST_COSINE = 0.05;

/** One view of the plant: the camera's turn from the video's first frame and its outline. */
export interface HullView {
	/** The video frame. */
	readonly frame: number;
	/** Radians the camera has turned round the plant since the first frame. */
	readonly turn: number;
	/** The outline on the grid, rows from the ground up. */
	readonly grid: Uint8Array;
}

/** A view's reach to the right and to the left of the trunk at each row, in plant heights. */
export interface Extents {
	readonly right: Float64Array;
	readonly left: Float64Array;
}

/** The right and left extents of an outline at each row. */
function extentsOf(grid: Uint8Array): Extents {
	const right = new Float64Array(CELLS);
	const left = new Float64Array(CELLS);
	for (let row = 0; row < CELLS; row++)
		for (let col = 0; col < COLUMNS; col++)
			if (grid[row * COLUMNS + col]) {
				const x = columnX(col);
				if (x > (right[row] as number)) right[row] = x;
				if (-x > (left[row] as number)) left[row] = -x;
			}
	return { right, left };
}

/**
 * The row where the crown starts: in each view, the lowest row of the run of rows wider than a stem
 * that holds the view's widest row, where narrow stretches of a few rows do not break the run; and
 * the median of those over the views. A trunk's flared foot is wide but stands below a narrow stem,
 * so it is not crown; a tuft or a crown that sweeps down to the ground runs wide to the ground.
 */
export function crownBaseRow(views: readonly Extents[]): number {
	const rows = views.map((e) => {
		const width = (row: number) => (e.left[row] as number) + (e.right[row] as number);
		let widest = 0;
		for (let row = 1; row < CELLS; row++) if (width(row) > width(widest)) widest = row;
		let base = widest;
		let narrow = 0;
		for (let row = widest - 1; row >= 0 && narrow <= STEM_GAP; row--) {
			if (width(row) > CROWN_WIDTH) {
				base = row;
				narrow = 0;
			} else narrow++;
		}
		return base;
	});
	rows.sort((a, b) => a - b);
	return rows[Math.floor(rows.length / 2)] ?? 0;
}

/**
 * The hull's radius at each row and azimuth, in plant heights: at each, the bound of each view that
 * faces it, sorted, and the one past the drift share of the smallest.
 */
function hullRows(views: readonly HullView[], extents: readonly Extents[]): Float64Array[] {
	const rows: Float64Array[] = [];
	for (let row = 0; row < CELLS; row++) {
		const radii = new Float64Array(AZIMUTHS);
		for (let a = 0; a < AZIMUTHS; a++) {
			const phi = (2 * Math.PI * a) / AZIMUTHS;
			const bounds: number[] = [];
			views.forEach((view, k) => {
				const e = extents[k] as Extents;
				const c = Math.cos(phi + view.turn);
				if (c > LEAST_COSINE) bounds.push((e.right[row] as number) / c);
				else if (c < -LEAST_COSINE) bounds.push((e.left[row] as number) / -c);
			});
			bounds.sort((p, q) => p - q);
			radii[a] = bounds[Math.min(Math.floor(DRIFT_SHARE * bounds.length), bounds.length - 1)] ?? 0;
		}
		rows.push(radii);
	}
	return rows;
}

/** A radius rounded for the record. */
function round(value: number, places = 3): number {
	const f = 10 ** places;
	return Math.round(value * f) / f;
}

/** How well the envelope's own outlines match the views it was measured from. */
export interface Consistency {
	/** The overlap of the envelope's outline with each view's crown, in view order. */
	readonly views: readonly { readonly frame: number; readonly iou: number }[];
	readonly lowest: number;
	readonly mean: number;
	readonly highest: number;
}

/** What the hull measured. */
export interface HullFit {
	readonly envelope: RadialEnvelope;
	/** The crown's base as a share of the plant's height. */
	readonly crownBase: number;
	/** Crown width over plant height, the mean over the views. */
	readonly aspect: number;
	readonly consistency: Consistency;
}

/** The crown of an outline: its rows from the crown's base up. */
function crownOnly(grid: Uint8Array, base: number): Uint8Array {
	const out = grid.slice();
	out.fill(0, 0, base * COLUMNS);
	return out;
}

/**
 * The envelope of a plant from views of it round a turn.
 *
 * @param views The views, each with its turn and outline; at least two.
 * @param from The reference file, which the envelope's source names.
 */
export function hullEnvelope(views: readonly HullView[], from: string): HullFit {
	if (views.length < 2) throw new Error('an envelope needs at least two views of the plant');
	const extents = views.map((view) => extentsOf(view.grid));
	const base = crownBaseRow(extents);
	const rows = hullRows(views, extents);
	for (let row = 0; row < base; row++) (rows[row] as Float64Array).fill(0);
	const baseShare = base / CELLS;
	const heights: number[] = [];
	const radii: (number | number[])[] = [];
	for (let k = 0; k < LEVELS; k++) {
		const t = baseShare + ((1 - baseShare) * k) / (LEVELS - 1);
		heights.push(round(t));
		if (k === LEVELS - 1) {
			radii.push(0);
			continue;
		}
		const row = rows[Math.min(CELLS - 1, Math.max(0, Math.round(t * CELLS - 0.5)))] as Float64Array;
		radii.push(
			Array.from(
				row,
				(_, a) =>
					0.25 * (row[(a + AZIMUTHS - 1) % AZIMUTHS] as number) +
					0.5 * (row[a] as number) +
					0.25 * (row[(a + 1) % AZIMUTHS] as number),
			),
		);
	}
	if (baseShare > STEM_SHARE) radii[0] = (radii[1] as number[]).map((r) => BASE_SHARE * r);
	const envelope: RadialEnvelope = {
		kind: 'radial',
		heights,
		radii: radii.map((level) => {
			if (typeof level === 'number') return level;
			const rounded = level.map((r) => round(r));
			return rounded.every((r) => r === rounded[0]) ? (rounded[0] as number) : rounded;
		}),
		source: { method: 'turntable-hull', from, views: views.length },
	};
	const volume = envelopeVolume(envelope, 1, 0);
	const frame = { left: -COLUMNS / 2 / CELLS, cell: 1 / CELLS, cols: COLUMNS, rows: CELLS };
	const scores = views.map((view) => ({
		frame: view.frame,
		iou: round(iou(envelopeSilhouette(volume, view.turn, frame), crownOnly(view.grid, base)), 4),
	}));
	const values = scores.map((s) => s.iou);
	const widths = extents.map((e) => {
		let right = 0;
		let left = 0;
		for (let row = base; row < CELLS; row++) {
			right = Math.max(right, e.right[row] as number);
			left = Math.max(left, e.left[row] as number);
		}
		return right + left;
	});
	return {
		envelope,
		crownBase: round(baseShare),
		aspect: round(mean(widths), 2),
		consistency: {
			views: scores,
			lowest: Math.min(...values),
			mean: round(mean(values), 4),
			highest: Math.max(...values),
		},
	};
}
