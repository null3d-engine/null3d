// The envelope of a plant from the outlines of its turning video: the visual hull of the views.
// Each view, at the camera's turn θ, bounds the crown at every height in a slab across the view: a
// point of the crown at azimuth φ and radius r lies right of the trunk by r·cos(φ + θ), which is at
// most the outline's right extent, and left of it by at most the left extent. So each view bounds
// the radius at each azimuth by an extent over a cosine: the support function of the crown's
// section in the view's direction. The radius is the bound a few views from the smallest, which
// passes over the views where a generated plant drifts from the rest. Heights and radii are shares
// of the plant's height, azimuths turn from +X toward +Z, and the view at turn 0 looks from +Z.

import type { RadialEnvelope } from '../../packages/vegetation/src/core/record.ts';
import {
	type EnvelopeVolume,
	envelopeSilhouette,
	envelopeVolume,
	type SilhouetteFrame,
} from '../../packages/vegetation/src/grow/envelope.ts';
import { iou, mean } from '../lib/plant-review/compare.ts';
import { CELLS, COLUMNS, columnX } from './silhouettes.ts';

/** Azimuths the envelope holds a radius at. */
export const AZIMUTHS = 16;
/** Heights the envelope holds radii at, from the crown's base to the plant's top. */
export const LEVELS = 15;
/** The share of a height's bounds, from the smallest, that the radius passes over. */
export const DRIFT_SHARE = 0.07;
/** The most the hull's radii widen to match the views' mean width. */
const MOST_WIDENING = 1.5;
/** Halvings of the search for the widening. */
const WIDENING_STEPS = 12;
/** The width in plant heights from which a row counts as crown rather than stem. */
const CROWN_WIDTH = 0.2;
/**
 * The share of a plant's widest row that a crown row passes, where the plant is narrower than
 * CROWN_WIDTH: a column with parallel sides is under a fifth of its height across at every row, so
 * a fixed width would read its whole slackened foot as bare stem.
 */
const NARROW_CROWN_SHARE = 0.5;
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
	/** The video frame, or the still's own negative number. */
	readonly frame: number;
	/** Radians the camera has turned round the plant since the first frame. */
	readonly turn: number;
	/** The outline on the grid, rows from the ground up. */
	readonly grid: Uint8Array;
	/** The camera's distance from the plant's axis in plant heights, when it is not the video's. */
	readonly distance?: number;
	/** The still's reference file, when the view is a still. */
	readonly file?: string;
	/** Degrees round the plant that the review draws a still at, when the view is a still. */
	readonly stillTurn?: number;
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
 * the median of those over the views. A row counts as crown when it passes a fifth of the plant's
 * height, or half the plant's widest row where the plant is narrower than that. A trunk's flared
 * foot is wide but stands below a narrow stem, so it is not crown; a tuft, a column or a crown that
 * sweeps down to the ground runs wide to the ground.
 */
export function crownBaseRow(views: readonly Extents[]): number {
	const rows = views.map((e) => {
		const width = (row: number) => (e.left[row] as number) + (e.right[row] as number);
		let widest = 0;
		for (let row = 1; row < CELLS; row++) if (width(row) > width(widest)) widest = row;
		// A narrow plant's crown rows are measured against half its own widest row, since no row of
		// a column passes the width that a broad crown's rows do.
		const crownWidth = Math.min(CROWN_WIDTH, width(widest) * NARROW_CROWN_SHARE);
		let base = widest;
		let narrow = 0;
		for (let row = widest - 1; row >= 0 && narrow <= STEM_GAP; row--) {
			if (width(row) > crownWidth) {
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
 * faces it, sorted, and the one past a share of the smallest. A view's camera stands at a
 * distance from the plant's axis, in plant heights, and draws a point nearer to it larger: a point
 * at radius r reaches r times the cosine across the view, times the distance over the distance less
 * its reach toward the camera. So a near side bounds the radius tighter than its outline's reach and
 * a far side looser, and a crown heavier on one side comes out wider from that side, as the video
 * drew it. An infinite distance is a view from afar.
 */
function hullRows(
	views: readonly HullView[],
	extents: readonly Extents[],
	distance: number,
	share: number,
): Float64Array[] {
	const rows: Float64Array[] = [];
	for (let row = 0; row < CELLS; row++) {
		const radii = new Float64Array(AZIMUTHS);
		for (let a = 0; a < AZIMUTHS; a++) {
			const phi = (2 * Math.PI * a) / AZIMUTHS;
			const bounds: number[] = [];
			views.forEach((view, k) => {
				// The video's views set the hull through a low bound; the stills are overlaid whole.
				if (view.file !== undefined) return;
				const bound = viewBound(extents[k] as Extents, view, row, phi, distance);
				if (bound > 0) bounds.push(bound);
			});
			bounds.sort((p, q) => p - q);
			radii[a] = bounds[Math.min(Math.floor(share * bounds.length), bounds.length - 1)] ?? 0;
		}
		// A still bounds the crown's broad side at the direction it faces, with the extent its own
		// photograph showed there, and does not narrow the video's hull anywhere: the shape is broad
		// where the stills are broad and narrow where the video is narrow.
		views.forEach((view, k) => {
			if (view.file === undefined) return;
			const e = extents[k] as Extents;
			const right = azIndex(-view.turn);
			const left = (right + AZIMUTHS / 2) % AZIMUTHS;
			const broad = e.right[row] as number;
			const other = e.left[row] as number;
			if (broad > (radii[right] as number)) radii[right] = broad;
			if (other > (radii[left] as number)) radii[left] = other;
		});
		rows.push(radii);
	}
	return rows;
}

/** The envelope's azimuth index nearest a direction, in radians. */
function azIndex(direction: number): number {
	const turns = direction / (2 * Math.PI);
	return Math.round((((turns % 1) + 1) % 1) * AZIMUTHS) % AZIMUTHS;
}

/** The radius a view's outline allows in one direction at one row, or 0 where it does not face it. */
function viewBound(
	extent: Extents,
	view: HullView,
	row: number,
	phi: number,
	distance: number,
): number {
	const c = Math.cos(phi + view.turn);
	const toward = Math.sin(phi + view.turn);
	const at = view.distance ?? distance;
	if (c > LEAST_COSINE) return nearBound(extent.right[row] as number, c, toward, at);
	if (c < -LEAST_COSINE) return nearBound(extent.left[row] as number, -c, toward, at);
	return 0;
}

/**
 * The most radius a point may have where a view's outline reaches an extent beside the axis: r with
 * r × across × distance / (distance − r × toward) at most the extent.
 */
function nearBound(extent: number, across: number, toward: number, distance: number): number {
	const looming = Number.isFinite(distance) ? (extent / distance) * toward : 0;
	return extent / Math.max(across + looming, LEAST_COSINE);
}

/**
 * The outline of an envelope seen at a turn by a camera at a distance from the plant's axis, in
 * plant heights, on an outline grid: each point drawn larger by the distance over the distance less
 * its reach toward the camera. An infinite distance draws the outline from afar.
 *
 * @param volume The envelope's volume.
 * @param turn Radians the camera has turned round the plant.
 * @param frame The grid.
 * @param distance The camera's distance from the plant's axis.
 * @returns The outline.
 */
export function nearSilhouette(
	volume: EnvelopeVolume,
	turn: number,
	frame: SilhouetteFrame,
	distance: number,
): Uint8Array {
	if (!Number.isFinite(distance)) return envelopeSilhouette(volume, turn, frame);
	const mask = new Uint8Array(frame.cols * frame.rows);
	const steps = 180;
	for (let row = 0; row < frame.rows; row++) {
		const y = (row + 0.5) * frame.cell;
		let right = 0;
		let left = 0;
		let inside = false;
		for (let s = 0; s < steps; s++) {
			const azimuth = (s / steps) * 2 * Math.PI;
			const r = volume.radius(y, azimuth);
			if (r <= 0) continue;
			inside = true;
			const x =
				(r * Math.cos(azimuth + turn) * distance) /
				Math.max(distance - r * Math.sin(azimuth + turn), 1e-6);
			right = Math.max(right, x);
			left = Math.max(left, -x);
		}
		if (!inside) continue;
		for (let col = 0; col < frame.cols; col++) {
			const x = frame.left + (col + 0.5) * frame.cell;
			if (x <= right && x >= -left) mask[row * frame.cols + col] = 1;
		}
	}
	return mask;
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
	/**
	 * The way the video turns against the envelope's azimuths: 1 as its frames' turns run, −1 the
	 * other way. A view at a frame's turn sees the envelope at that turn times the direction.
	 */
	readonly direction: 1 | -1;
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
 * The envelope from the hull's bounds, widened by a factor: each level's radii at its row, eased
 * over the neighbouring azimuths, and a stemmed crown's lowest level drawn in from the next.
 */
function envelopeAt(
	views: readonly HullView[],
	extents: readonly Extents[],
	base: number,
	distance: number,
	widening: number,
	from: string,
): RadialEnvelope {
	const rows = hullRows(views, extents, distance, DRIFT_SHARE);
	for (const row of rows) for (let a = 0; a < AZIMUTHS; a++) row[a] = (row[a] as number) * widening;
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
	const stills = views
		.filter((view) => view.file !== undefined && view.frame < 0)
		.map((view) => ({
			file: view.file as string,
			turn: round(view.stillTurn as number, 2),
		}));
	const envelope: RadialEnvelope = {
		kind: 'radial',
		heights,
		radii: radii.map((level) => {
			if (typeof level === 'number') return level;
			const rounded = level.map((r) => round(r));
			return rounded.every((r) => r === rounded[0]) ? (rounded[0] as number) : rounded;
		}),
		source: {
			method: 'turntable-hull',
			from,
			views: views.length,
			...(stills.length > 0 && { stills }),
		},
	};
	return envelope;
}

/** The widest row of an outline, in plant heights. */
function spanOf(grid: Uint8Array): number {
	let most = 0;
	for (let row = 0; row < CELLS; row++) {
		let low = COLUMNS;
		let high = -1;
		for (let col = 0; col < COLUMNS; col++)
			if (grid[row * COLUMNS + col]) {
				low = Math.min(low, col);
				high = Math.max(high, col);
			}
		if (high >= low) most = Math.max(most, (high - low + 1) / CELLS);
	}
	return most;
}

/**
 * The envelope of a plant from views of it round a turn.
 *
 * @param views The views, each with its turn and outline; at least two.
 * @param from The reference file, which the envelope's source names.
 * @param distance The video camera's distance from the plant's axis, in plant heights; infinite
 *   for views from afar.
 * @param direction The way the video turns, when already known; fitted from the views otherwise.
 */
export function hullEnvelope(
	views: readonly HullView[],
	from: string,
	distance = Number.POSITIVE_INFINITY,
	direction?: 1 | -1,
): HullFit {
	if (views.length < 2) throw new Error('an envelope needs at least two views of the plant');
	if (direction === 1) return hullOnce(views, from, distance, 1);
	if (direction === -1)
		return hullOnce(
			views.map((view) => ({ ...view, turn: -view.turn })),
			from,
			distance,
			-1,
		);
	const forward = hullOnce(views, from, distance, 1);
	if (!Number.isFinite(distance)) return forward;
	// Seen from afar a plant and its mirror image show the same outlines from opposite turns, but a
	// near camera draws the side toward it larger, which tells the way the video turns: the hull is
	// fitted both ways and keeps the one whose outlines match the views better.
	const mirrored = hullOnce(
		views.map((view) => ({ ...view, turn: -view.turn })),
		from,
		distance,
		-1,
	);
	return mirrored.consistency.mean > forward.consistency.mean ? mirrored : forward;
}

/** The hull of views taken to turn one way: 1 as given, −1 with every turn reversed. */
function hullOnce(
	views: readonly HullView[],
	from: string,
	distance: number,
	direction: 1 | -1,
): HullFit {
	const extents = views.map((view) => extentsOf(view.grid));
	const base = crownBaseRow(extents);
	const frame = { left: -COLUMNS / 2 / CELLS, cell: 1 / CELLS, cols: COLUMNS, rows: CELLS };
	// A hull keeps only what every view allows, so a generated video whose plant jitters narrower
	// in some frames than in others leaves it narrower than the views on average. The hull widens
	// by the least factor that draws the crown, through the video's camera, as wide on average as
	// its views; a plant that holds its shape needs none.
	// The video alone sets the drift widening; the stills are overlaid after it, so they widen the
	// broad sides without moving the video's own fit.
	const videoIndices = views.flatMap((view, k) => (view.file === undefined ? [k] : []));
	const videoViews = videoIndices.map((k) => views[k] as HullView);
	const videoExtents = videoIndices.map((k) => extents[k] as Extents);
	const viewWidth = mean(videoViews.map((view) => spanOf(crownOnly(view.grid, base))));
	const drawnWidth = (widening: number) => {
		const shape = envelopeAt(videoViews, videoExtents, base, distance, widening, from);
		const volume = envelopeVolume(shape, 1, 0);
		return mean(
			videoViews.map((view) => spanOf(nearSilhouette(volume, view.turn, frame, distance))),
		);
	};
	let widening = 1;
	if (drawnWidth(1) < viewWidth) {
		let low = 1;
		let high = MOST_WIDENING;
		for (let step = 0; step < WIDENING_STEPS; step++) {
			const middle = (low + high) / 2;
			if (drawnWidth(middle) < viewWidth) low = middle;
			else high = middle;
		}
		widening = high;
	}
	const envelope = envelopeAt(views, extents, base, distance, widening, from);
	const volume = envelopeVolume(envelope, 1, 0);
	const scores = views.map((view) => ({
		frame: view.frame,
		iou: round(
			iou(
				nearSilhouette(volume, view.turn, frame, view.distance ?? distance),
				crownOnly(view.grid, base),
			),
			4,
		),
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
		direction,
		crownBase: round(base / CELLS),
		aspect: round(mean(widths), 2),
		consistency: {
			views: scores,
			lowest: Math.min(...values),
			mean: round(mean(values), 4),
			highest: Math.max(...values),
		},
	};
}
