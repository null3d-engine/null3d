// The figures a plant generator is driven by, read from one outline of a whole plant: the stem below
// the crown, the outline's radius by height, the lumps on the crown's edge, and the sky inside the
// crown. Each takes a mask of one byte per pixel with the plant's box, the column of its axis and
// the row where its crown starts, and reads nothing else, so a drawn shape with a known answer
// checks it.
//
// Lengths are shares of the plant's height unless a figure says otherwise, so a figure read from a
// picture of any size compares with one read from another.
import { type Box, components, PIECE_BRIDGE, rowSpans } from '../lib/plant-review/references.ts';

/** Height bands of an outline's radius profile, from the ground up. */
export const ENVELOPE_BANDS = 16;
/** The share of the plant's height, from its foot, whose bands may hold the stem's own width. */
const STEM_BANDS = [
	[0, 0.06],
	[0.06, 0.12],
	[0.12, 0.18],
] as const;
/** The share of the plant's height that the bands reach up to. */
const STEM_REACH = STEM_BANDS[2][1];
/** How many widths of the stem below the crown a band above the crown's start may stand. */
const STEM_ALIKE = 1.5;
/** The most of a row's whole span that a stem behind hanging foliage may fill. */
const STEM_CLEAR = 0.5;
/** The most of the plant's height that a stem's width may be. */
const STEM_MOST = 0.5;
/** The least bare stem, as a share of the plant's height, that stems are counted on. */
const STEMS_LEAST = 0.03;
/** How many stem widths a row of the stem's run may stand before it is a fork or the crown. */
const BOLE_MULTIPLE = 2.5;
/** The share of the plant's widest row above which the foot's run is the plant itself, not a stem. */
const NO_STEM_SHARE = 0.5;
/** The share of the plant's height, at its foot, that the flare is read over. */
const FLARE_BAND = 0.04;
/** The place in the foot band's widths, narrowest first, that stands for the foot. */
const FLARE_QUANTILE = 0.75;
/** How many stem widths a row may stand and still be the stem alone, for the lean. */
const LEAN_WIDTH = 1.3;
/** The most the stem's middle may leave its line, in stem widths, for a lean to stand. */
const LEAN_STRAIGHT = 0.25;
/** The least rows of bare stem, as a share of the plant's height, that a lean is fitted through. */
const LEAN_ROWS = 0.03;
/** The rows on end that must hold more rising runs than the stem's foot for the stem to fork. */
const FORK_ROWS = 3;
/** The share of the plant's height, at its foot, that a stem must reach down into. */
const FOOT_BAND = 0.01;
/** Rays cast over the half turn above the crown's base. */
const LOBE_RAYS = 361;
/** Rays each side over which a ray takes the farthest reach, so a slit one ray wide is no notch. */
const LOBE_WINDOW = 3;
/**
 * The notch depths at which lumps are counted, as shares of the crown's size: the square root of
 * the area of the crown's convex hull.
 */
export const LOBE_DEPTHS = [0.02, 0.04, 0.08] as const;
/** The notch depth of the headline lump count. */
export const LOBE_DEPTH = 0.04;
/** The upper edges of the hole size classes: a hole's diameter as a share of the crown's width. */
export const HOLE_CLASSES = [0.01, 0.02, 0.05] as const;
/** The least share of the crown's outline a grid cell must hold for its gap to be read. */
const GRID_CELL_FLOOR = 0.01;

/** A value to a fixed number of decimal places, so the same input writes the same bytes. */
export function rounded(value: number, digits = 4): number {
	const fixed = Number(value.toFixed(digits));
	return fixed === 0 ? 0 : fixed;
}

/**
 * Each row's run of plant nearest the axis: its first and last column, or -1 for an empty row.
 * Below the crown the run is the stem, apart from the boughs and the foliage that hang beside it.
 */
export function axisRuns(mask: Uint8Array, width: number, box: Box, axis: number): Int32Array {
	const runs = new Int32Array((box.bottom + 1) * 2).fill(-1);
	for (let y = box.top; y <= box.bottom; y++) {
		let start = -1;
		let nearest = Number.POSITIVE_INFINITY;
		for (let x = box.left; x <= box.right + 1; x++) {
			const on = x <= box.right && mask[y * width + x] !== 0;
			if (on && start < 0) start = x;
			if (!on && start >= 0) {
				const end = x - 1;
				const distance = axis < start ? start - axis : axis > end ? axis - end : 0;
				if (distance < nearest) {
					nearest = distance;
					runs[y * 2] = start;
					runs[y * 2 + 1] = end;
				}
				start = -1;
			}
		}
	}
	return runs;
}

/**
 * The width between a row's outermost plant pixels, from the review's row spans, or 0 for a row
 * with no plant.
 */
function spanWidth(spans: Int32Array, y: number): number {
	const left = spans[y * 2] as number;
	return left < 0 ? 0 : (spans[y * 2 + 1] as number) - left + 1;
}

/** The middle value of a list, or undefined for an empty one. The list is sorted in place. */
function middle(values: number[]): number | undefined {
	values.sort((a, b) => a - b);
	return values[values.length >> 1];
}

/** The stem below the crown, with a reason for each figure the outline cannot give. */
export interface StemFigures {
	/** The bare stem's share of the plant's height: from the foot to the first fork or foliage. */
	readonly bareShare: number | null;
	/** The stem's own width over the plant's height, clear of the flare at its foot. */
	readonly width: number | null;
	/**
	 * Whether the foot's run reaches the plant's top with no fork: the plant is one column. An
	 * outline cannot say whether a column is a stem, as a cactus's, or foliage, as a cypress's.
	 */
	readonly column: boolean;
	/** The stem's width at breast height over the plant's height. */
	readonly breastHeightWidth: number | null;
	/** The width at the foot over the stem's own width. */
	readonly flare: number | null;
	/** Degrees the bare stem leans from upright, positive to the picture's right. */
	readonly lean: number | null;
	/** The stems that stand apart between the foot and the crown. */
	readonly stems: number | null;
	/** The row where the bare stem ends, or null without one. */
	readonly topRow: number | null;
	/** Why each null figure is null. */
	readonly missing: Readonly<Record<string, string>>;
}

/**
 * Reads the stem below the crown.
 *
 * @param mask The plant's outline.
 * @param width The mask's width.
 * @param box The plant's box.
 * @param axis The column of the plant's foot.
 * @param crownRow The row where the crown starts.
 * @param breastShare Breast height as a share of the plant's height, or null when it is not known.
 * @param trustedBottom The lowest row whose outline is trusted: the plant's foot, or the row above
 *   the horizon where the foot stands below it and the ground hides part of the stem.
 * @param fine The width of the stem's run in a row, in mask pixels, read from the picture at its
 *   own size, or null where it cannot be read. The stem's width, its width at breast height and
 *   its flare take it in place of the mask's whole pixels, which read a slim stem a pixel wide or
 *   narrow.
 */
export function stemOf(
	mask: Uint8Array,
	width: number,
	box: Box,
	axis: number,
	crownRow: number,
	breastShare: number | null,
	trustedBottom = box.bottom,
	fine?: (row: number) => number | null,
): StemFigures {
	const tall = box.bottom - box.top + 1;
	const bottom = Math.min(box.bottom, Math.max(box.top, trustedBottom));
	const runs = axisRuns(mask, width, box, axis);
	const runWidth = (y: number): number => spanWidth(runs, y);
	const fineWidth = (y: number): number => (runWidth(y) > 0 ? (fine?.(y) ?? runWidth(y)) : 0);
	const spans = rowSpans(mask, width, box.bottom + 1);
	const none = (reason: string): StemFigures => ({
		bareShare: null,
		width: null,
		column: false,
		breastHeightWidth: null,
		flare: null,
		lean: null,
		stems: null,
		topRow: null,
		missing: Object.fromEntries(
			['bareShare', 'width', 'breastHeightWidth', 'flare', 'lean', 'stems'].map((k) => [k, reason]),
		),
	});
	// The stem's own width is the narrowest middle width of the bands of rows at the foot: a flare
	// widens the rows at the ground, so the stem lies in a band above them. The rows below the
	// crown give it first. A band that reaches above the crown's start counts only where its run
	// stays a stem's: foliage can hang beside a stem that still stands clear behind it. Where no
	// trusted row lies below the crown, such a band counts when sky parts the run from the foliage
	// beside it, so the run is well under the row's whole span.
	const band = (
		from: number,
		to: number,
		floor: number,
	): { readonly width: number; readonly ofSpan: number } | undefined => {
		const low: number[] = [];
		const shares: number[] = [];
		const first = Math.min(bottom, box.bottom - Math.round(tall * from));
		const last = Math.max(floor, box.bottom - Math.max(2, Math.round(tall * to)));
		for (let y = first; y > last; y--) {
			low.push(fineWidth(y));
			const across = spanWidth(spans, y);
			shares.push(across === 0 ? 1 : runWidth(y) / across);
		}
		const median = low.length >= 2 ? middle(low) : undefined;
		return median !== undefined && median > 0
			? { width: median, ofSpan: middle(shares) as number }
			: undefined;
	};
	let below = Number.POSITIVE_INFINITY;
	for (const [from, to] of STEM_BANDS)
		below = Math.min(below, band(from, to, crownRow)?.width ?? Number.POSITIVE_INFINITY);
	let stem = below;
	for (const [from, to] of STEM_BANDS) {
		const found = band(from, to, box.top - 1);
		if (!found) continue;
		const alike = Number.isFinite(below)
			? found.width <= below * STEM_ALIKE
			: found.ofSpan <= STEM_CLEAR;
		if (alike) stem = Math.min(stem, found.width);
	}
	if (!Number.isFinite(stem))
		return none(
			box.bottom - crownRow < 2
				? 'the crown starts at the foot, so no stem shows below it'
				: bottom - Math.max(crownRow, box.bottom - Math.round(tall * STEM_REACH)) < 2
					? 'the stem below the crown stands under the horizon, where the ground hides it'
					: 'the outline holds no run of plant at its foot',
		);
	if (stem > tall * STEM_MOST)
		return none('the run of plant at the foot is wider than a stem: a mass, not a stem');
	let widest = 0;
	for (let y = box.top; y <= box.bottom; y++) widest = Math.max(widest, spanWidth(spans, y));
	if (stem > widest * NO_STEM_SHARE)
		return none(
			'the plant stands as wide at its foot as through its crown, so no stem shows below it',
		);
	// The flare is the wide stretch at the ground; the bare stem runs on above it until a row of
	// its run stands wider than a stem can, where it forks or meets the foliage, or until it ends.
	// A limb that rises beside the stem leaves its run narrow, so the stem also ends where more
	// runs rise from the foot than rose at the flare's top, for a few rows on end.
	const limit = stem * BOLE_MULTIPLE;
	const rising = risingRuns(mask, width, box);
	const risen = (row: number): number => (rising[row - box.top] as Run[]).length;
	let y = bottom;
	while (y > box.top && runWidth(y) > limit) y--;
	const flareTop = y;
	const stood = risen(flareTop);
	const forks = (row: number): boolean => {
		for (let k = 0; k < FORK_ROWS; k++)
			if (row - k < box.top || risen(row - k) <= stood) return false;
		return true;
	};
	while (y > box.top && runWidth(y) > 0 && runWidth(y) <= limit && !forks(y)) y--;
	const topRow = y;
	const missing: Record<string, string> = {};
	const hidden = (box.bottom - bottom) / tall;
	let flare: number | null = null;
	if (hidden > FLARE_BAND)
		missing.flare = `the foot stands below the horizon for ${Math.round(hidden * 100)} per cent of the height, where the ground hides it`;
	else {
		const foot: number[] = [];
		for (let r = bottom; r > bottom - Math.max(2, Math.round(tall * FLARE_BAND)); r--)
			foot.push(fineWidth(r));
		foot.sort((p, q) => p - q);
		// The wider rows of the foot band: a row broken by grass reads narrow, and is not the foot.
		flare = rounded((foot[Math.floor(foot.length * FLARE_QUANTILE)] as number) / stem, 3);
	}
	let breastHeightWidth: number | null = null;
	if (breastShare === null)
		missing.breastHeightWidth =
			'breast height is not placed on this plant: source.breastHeight gives the reason';
	else {
		const row = box.bottom - Math.round(breastShare * tall);
		if (row <= topRow)
			missing.breastHeightWidth = 'breast height stands above the bare stem in this view';
		else if (row > bottom)
			missing.breastHeightWidth = 'breast height stands below the horizon in this view';
		else breastHeightWidth = rounded(fineWidth(row) / tall);
	}
	// A line through the middle of the stem's run in each row where the run is the stem alone.
	let lean: number | null = null;
	const centres: [number, number][] = [];
	for (let r = flareTop; r > topRow; r--)
		if (runWidth(r) <= stem * LEAN_WIDTH)
			centres.push([box.bottom - r, ((runs[r * 2] as number) + (runs[r * 2 + 1] as number)) / 2]);
	if (centres.length < Math.max(6, Math.round(tall * LEAN_ROWS)))
		missing.lean = 'the bare stem above its flare is too short to fit a line through';
	else {
		const n = centres.length;
		let sumU = 0;
		let sumX = 0;
		let sumUU = 0;
		let sumUX = 0;
		for (const [u, x] of centres) {
			sumU += u;
			sumX += x;
			sumUU += u * u;
			sumUX += u * x;
		}
		const slope = (n * sumUX - sumU * sumX) / (n * sumUU - sumU * sumU);
		const start = (sumX - slope * sumU) / n;
		let off = 0;
		for (const [u, x] of centres) off += (x - start - slope * u) ** 2;
		if (Math.sqrt(off / n) > stem * LEAN_STRAIGHT)
			missing.lean =
				'the middle of the stem does not follow a line: a limb or foliage joins its run';
		else lean = rounded((Math.atan(slope) * 180) / Math.PI, 2);
	}
	const stemTop = Math.max(topRow, crownRow);
	let stems: number | null = null;
	if (bottom - stemTop < Math.max(4, Math.round(tall * STEMS_LEAST)))
		missing.stems = 'too little bare stem shows below the foliage to tell the stems apart';
	else {
		const counts: number[] = [];
		let hanging = false;
		for (const share of [0.25, 0.5, 0.75]) {
			const row = bottom - Math.round((bottom - stemTop) * share);
			const runsHere = rising[row - box.top] as Run[];
			counts.push(runsHere.length);
			// A pixel of the row outside every rising run hangs from above.
			for (let x = box.left; x <= box.right && !hanging; x++)
				if (mask[row * width + x] && !runsHere.some((run) => x >= run.left && x <= run.right))
					hanging = true;
		}
		if (hanging)
			missing.stems =
				'foliage hangs beside the stem down to its foot, so stems cannot be told from it';
		// A stem stands at every probe; a tuft of grass at the foot reaches only the lowest.
		else stems = Math.min(...counts);
	}
	return {
		bareShare: rounded((box.bottom - topRow) / tall),
		width: rounded(stem / tall),
		column: topRow <= box.top,
		breastHeightWidth,
		flare,
		lean,
		stems,
		topRow,
		missing,
	};
}

/** A run of plant in one row: its first and last column. */
export interface Run {
	readonly left: number;
	readonly right: number;
}

/**
 * In each row of the plant's box, the runs of plant that rise to it from the plant's foot: each
 * joins the foot through plant that lies in that row or below it. A stem or a limb rises from the
 * foot; foliage that hangs down beside it joins the plant only from above, so it is not counted.
 * Runs a bridge apart are one run.
 *
 * @returns The runs of each row, left to right, the box's top row first.
 */
export function risingRuns(mask: Uint8Array, width: number, box: Box): Run[][] {
	const tall = box.bottom - box.top + 1;
	const across = box.right - box.left + 1;
	const footTop = box.bottom - Math.max(1, Math.round(tall * FOOT_BAND)) + 1;
	// Rows join from the foot up. Each pixel joins the plant beside it and below it, so once a row
	// is in, the pixels that share the foot's set are those that rise to it.
	const foot = across * tall;
	const parent = new Int32Array(foot + 1);
	for (let i = 0; i <= foot; i++) parent[i] = i;
	const find = (i: number): number => {
		let root = i;
		while (parent[root] !== root) root = parent[root] as number;
		while (parent[i] !== root) {
			const next = parent[i] as number;
			parent[i] = root;
			i = next;
		}
		return root;
	};
	const join = (a: number, b: number): void => {
		const ra = find(a);
		const rb = find(b);
		if (ra !== rb) parent[ra] = rb;
	};
	const plant = (x: number, y: number): boolean =>
		x >= 0 && x < across && mask[(y + box.top) * width + x + box.left] !== 0;
	const rows: Run[][] = new Array(tall);
	for (let y = tall - 1; y >= 0; y--) {
		for (let x = 0; x < across; x++) {
			if (!plant(x, y)) continue;
			const at = y * across + x;
			if (y + box.top >= footTop) join(at, foot);
			if (plant(x - 1, y)) join(at, at - 1);
			if (y + 1 < tall)
				for (let dx = -1; dx <= 1; dx++) if (plant(x + dx, y + 1)) join(at, at + across + dx);
		}
		const found: Run[] = [];
		const base = find(foot);
		let start = -1;
		let last = -1;
		for (let x = 0; x < across; x++) {
			if (!plant(x, y) || find(y * across + x) !== base) continue;
			if (start >= 0 && x - last - 1 > PIECE_BRIDGE) {
				found.push({ left: start + box.left, right: last + box.left });
				start = -1;
			}
			if (start < 0) start = x;
			last = x;
		}
		if (start >= 0) found.push({ left: start + box.left, right: last + box.left });
		rows[y] = found;
	}
	return rows;
}

/**
 * The outline's reach to each side of the axis in each height band, from the ground up, as shares
 * of the plant's height.
 */
export function envelopeOf(
	mask: Uint8Array,
	width: number,
	box: Box,
	axis: number,
	bands = ENVELOPE_BANDS,
): { readonly left: number[]; readonly right: number[] } {
	const tall = box.bottom - box.top + 1;
	const left = new Array<number>(bands).fill(0);
	const right = new Array<number>(bands).fill(0);
	const spans = rowSpans(mask, width, box.bottom + 1);
	for (let y = box.top; y <= box.bottom; y++) {
		if ((spans[y * 2] as number) < 0) continue;
		const band = Math.min(bands - 1, Math.floor(((box.bottom - y) * bands) / tall));
		left[band] = Math.max(left[band] as number, axis - (spans[y * 2] as number));
		right[band] = Math.max(right[band] as number, (spans[y * 2 + 1] as number) - axis);
	}
	return {
		left: left.map((v) => rounded(Math.max(0, v) / tall)),
		right: right.map((v) => rounded(Math.max(0, v) / tall)),
	};
}

/** A point of a hull. */
type Point = readonly [number, number];

/** The convex hull of a set of points, counter-clockwise, by the monotone chain. */
function convexHull(points: readonly Point[]): Point[] {
	const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
	const cross = (o: Point, a: Point, b: Point) =>
		(a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
	const half = (list: readonly Point[]): Point[] => {
		const out: Point[] = [];
		for (const p of list) {
			while (out.length >= 2 && cross(out[out.length - 2] as Point, out.at(-1) as Point, p) <= 0)
				out.pop();
			out.push(p);
		}
		out.pop();
		return out;
	};
	return [...half(sorted), ...half(sorted.reverse())];
}

/** The lumps on a crown's edge. */
export interface LobeFigures {
	/** The lumps that notches of the headline depth divide the edge into. */
	readonly count: number;
	/** The lump count at each notch depth, a share of the crown's size. */
	readonly byDepth: readonly { readonly depth: number; readonly count: number }[];
	/** Each lump's share of the crown's area as the rays sweep it, largest first. */
	readonly areaShares: readonly number[];
	/** Each lump's width between its notches over the crown's width, in the same order. */
	readonly widthShares: readonly number[];
	/** Each notch's depth inside the crown's hull over the crown's size, deepest first. */
	readonly notchDepths: readonly number[];
}

/**
 * The notches of a depth profile: each local peak that stands at least `least` above the saddle
 * that joins it to a higher peak, or above the profile's ends where it is the highest.
 */
function notchesOf(depth: Float64Array, least: number): number[] {
	const found: number[] = [];
	const n = depth.length;
	for (let i = 0; i < n; i++) {
		const d = depth[i] as number;
		if (d < least) continue;
		// The first sample of a level stretch stands for the whole stretch.
		if (i > 0 && (depth[i - 1] as number) >= d) continue;
		let end = i;
		while (end + 1 < n && depth[end + 1] === d) end++;
		if (end + 1 < n && (depth[end + 1] as number) > d) continue;
		let leftLow = d;
		let leftHigher = false;
		for (let k = i - 1; k >= 0; k--) {
			const v = depth[k] as number;
			if (v > d) {
				leftHigher = true;
				break;
			}
			leftLow = Math.min(leftLow, v);
		}
		let rightLow = d;
		let rightHigher = false;
		for (let k = end + 1; k < n; k++) {
			const v = depth[k] as number;
			// A later stretch at the same depth is the same notch's peer: the earlier one keeps it.
			if (v >= d) {
				rightHigher = true;
				break;
			}
			rightLow = Math.min(rightLow, v);
		}
		if (!leftHigher) leftLow = Math.min(leftLow, 0);
		if (!rightHigher) rightLow = Math.min(rightLow, 0);
		if (d - Math.max(leftLow, rightLow) >= least) found.push((i + end) >> 1);
	}
	return found;
}

/**
 * Counts the lumps on a crown's edge. Rays leave the axis at the crown's base over the half turn
 * above it, and each takes the farthest plant it meets. A lump is a stretch of that edge between
 * two notches, and a notch is a place where the edge falls inside the crown's convex hull by a set
 * share of the crown's size, the square root of the hull's area. A convex crown, however long or
 * wide, is one lump.
 *
 * @param mask The plant's outline.
 * @param width The mask's width.
 * @param box The plant's box.
 * @param axis The column of the plant's foot.
 * @param crownRow The row where the crown starts.
 */
export function lobesOf(
	mask: Uint8Array,
	width: number,
	box: Box,
	axis: number,
	crownRow: number,
): LobeFigures {
	const reach = new Float64Array(LOBE_RAYS);
	const far = Math.hypot(box.right - box.left + 1, crownRow - box.top + 1) + 1;
	const origin: Point = [Math.min(box.right, Math.max(box.left, axis)), crownRow];
	const angle = (i: number) => (Math.PI * i) / (LOBE_RAYS - 1);
	for (let i = 0; i < LOBE_RAYS; i++) {
		const cos = Math.cos(angle(i));
		const sin = Math.sin(angle(i));
		for (let r = far; r > 0; r -= 0.5) {
			const x = Math.round(origin[0] + r * cos);
			const y = Math.round(origin[1] - r * sin);
			if (x < box.left || x > box.right || y < box.top || y > crownRow) continue;
			if (mask[y * width + x]) {
				reach[i] = r;
				break;
			}
		}
	}
	const edge = new Float64Array(LOBE_RAYS);
	for (let i = 0; i < LOBE_RAYS; i++) {
		let most = 0;
		for (let k = Math.max(0, i - LOBE_WINDOW); k <= Math.min(LOBE_RAYS - 1, i + LOBE_WINDOW); k++)
			most = Math.max(most, reach[k] as number);
		edge[i] = most;
	}
	const pointAt = (i: number): Point => [
		origin[0] + (edge[i] as number) * Math.cos(angle(i)),
		origin[1] - (edge[i] as number) * Math.sin(angle(i)),
	];
	const hull = convexHull([origin, ...Array.from({ length: LOBE_RAYS }, (_, i) => pointAt(i))]);
	// The hull's area by the shoelace rule; its square root is the crown's size.
	let twice = 0;
	for (let h = 0; h < hull.length; h++) {
		const p = hull[h] as Point;
		const q = hull[(h + 1) % hull.length] as Point;
		twice += p[0] * q[1] - q[0] * p[1];
	}
	const size = Math.sqrt(Math.abs(twice) / 2);
	// A point's depth is its distance to the nearest side of the hull: how far the edge falls
	// inside the hull there, whatever way the ray that found it runs.
	const depth = new Float64Array(LOBE_RAYS);
	if (size > 0 && hull.length >= 3)
		for (let i = 0; i < LOBE_RAYS; i++) {
			const [px, py] = pointAt(i);
			let least = Number.POSITIVE_INFINITY;
			for (let h = 0; h < hull.length; h++) {
				const p = hull[h] as Point;
				const q = hull[(h + 1) % hull.length] as Point;
				const ex = q[0] - p[0];
				const ey = q[1] - p[1];
				const along = Math.max(
					0,
					Math.min(1, ((px - p[0]) * ex + (py - p[1]) * ey) / (ex * ex + ey * ey || 1)),
				);
				least = Math.min(least, Math.hypot(px - p[0] - along * ex, py - p[1] - along * ey));
			}
			depth[i] = least / size;
		}
	const byDepth = LOBE_DEPTHS.map((least) => ({
		depth: least,
		count: notchesOf(depth, least).length + 1,
	}));
	const notches = notchesOf(depth, LOBE_DEPTH);
	const bounds = [0, ...notches, LOBE_RAYS - 1];
	let total = 0;
	for (let i = 0; i < LOBE_RAYS; i++) total += (edge[i] as number) ** 2;
	const spans = rowSpans(mask, width, crownRow + 1);
	let crownWidth = 0;
	for (let y = box.top; y <= crownRow; y++) crownWidth = Math.max(crownWidth, spanWidth(spans, y));
	const lumps = bounds.slice(0, -1).map((from, k) => {
		const to = bounds[k + 1] as number;
		let area = 0;
		for (let i = from; i < to; i++) area += (edge[i] as number) ** 2;
		const a = pointAt(from);
		const b = pointAt(to);
		return {
			area: total > 0 ? area / total : 0,
			width: crownWidth > 0 ? Math.hypot(a[0] - b[0], a[1] - b[1]) / crownWidth : 0,
		};
	});
	lumps.sort((a, b) => b.area - a.area);
	return {
		count: notches.length + 1,
		byDepth,
		areaShares: lumps.map((l) => rounded(l.area, 3)),
		widthShares: lumps.map((l) => rounded(l.width, 3)),
		notchDepths: notches.map((i) => rounded(depth[i] as number, 3)).sort((a, b) => b - a),
	};
}

/** The sky inside a crown. */
export interface SkyFigures {
	/** The holes: background that plant closes in on every side. */
	readonly holes: {
		readonly count: number;
		/** The holes' share of the crown's box. */
		readonly share: number;
		/** The largest hole's share of the crown's box. */
		readonly largest: number;
		/** The middle hole's diameter, as a circle of its area, over the crown's width. */
		readonly medianDiameter: number;
		/** Holes by diameter over the crown's width: one count for each class and one above the last. */
		readonly bySize: readonly number[];
	};
	/** A three by three grid over the crown's box, top row first. */
	readonly grid: {
		/** Each cell's background between its rows' outermost plant, over what those rows span. */
		readonly enclosed: readonly (readonly (number | null)[])[];
		/** Each cell's background over the whole cell. */
		readonly box: readonly (readonly number[])[];
	};
	/**
	 * How unevenly the enclosed gap is spread: the standard deviation of the grid's cells over their
	 * mean. Null when fewer than two cells hold enough of the crown, or the crown shows no gap.
	 */
	readonly unevenness: number | null;
}

/**
 * Reads the sky inside a crown: its holes, and the gap in each cell of a grid over the crown's box.
 *
 * @param mask The plant's outline.
 * @param width The mask's width.
 * @param box The plant's box.
 * @param crownRow The row where the crown starts.
 */
export function skyOf(mask: Uint8Array, width: number, box: Box, crownRow: number): SkyFigures {
	let left = box.right;
	let right = box.left;
	const rows = crownRow - box.top + 1;
	// The crown's rows alone, the crown's top row first.
	const spans = rowSpans(mask, width, crownRow + 1).subarray(box.top * 2);
	for (let y = 0; y < rows; y++) {
		if ((spans[y * 2] as number) < 0) continue;
		left = Math.min(left, spans[y * 2] as number);
		right = Math.max(right, spans[y * 2 + 1] as number);
	}
	const across = Math.max(1, right - left + 1);
	const area = across * rows;
	// The background of the crown's box with a ring of sky round it: what joins the ring is open
	// sky, and every other part is a hole.
	const ringed = new Uint8Array((across + 2) * (rows + 2)).fill(1);
	for (let y = 0; y < rows; y++)
		for (let x = 0; x < across; x++)
			if (mask[(y + box.top) * width + x + left]) ringed[(y + 1) * (across + 2) + x + 1] = 0;
	const { labels, sizes } = fourJoined(ringed, across + 2, rows + 2);
	const open = labels[0] as number;
	const holes = sizes.filter((size, label) => label > 0 && label !== open && size > 0);
	holes.sort((a, b) => a - b);
	const diameter = (size: number) => Math.sqrt((4 * size) / Math.PI) / across;
	const bySize = new Array<number>(HOLE_CLASSES.length + 1).fill(0);
	let held = 0;
	for (const size of holes) {
		held += size;
		let k = 0;
		while (k < HOLE_CLASSES.length && diameter(size) >= (HOLE_CLASSES[k] as number)) k++;
		bySize[k] = (bySize[k] as number) + 1;
	}
	const enclosed: (number | null)[][] = [];
	const boxed: number[][] = [];
	const cells: number[] = [];
	let hull = 0;
	for (let y = 0; y < rows; y++) hull += spanWidth(spans, y);
	for (let gy = 0; gy < 3; gy++) {
		const enclosedRow: (number | null)[] = [];
		const boxRow: number[] = [];
		const y0 = Math.floor((gy * rows) / 3);
		const y1 = Math.floor(((gy + 1) * rows) / 3);
		for (let gx = 0; gx < 3; gx++) {
			const x0 = left + Math.floor((gx * across) / 3);
			const x1 = left + Math.floor(((gx + 1) * across) / 3);
			let inside = 0;
			let gaps = 0;
			let sky = 0;
			for (let y = y0; y < y1; y++) {
				const first = spans[y * 2] as number;
				const last = spans[y * 2 + 1] as number;
				for (let x = x0; x < x1; x++) {
					const plant = mask[(y + box.top) * width + x] !== 0;
					if (!plant) sky++;
					if (first >= 0 && x >= first && x <= last) {
						inside++;
						if (!plant) gaps++;
					}
				}
			}
			const cell = Math.max(1, (y1 - y0) * (x1 - x0));
			boxRow.push(rounded(sky / cell));
			const read = hull > 0 && inside / hull >= GRID_CELL_FLOOR;
			enclosedRow.push(read ? rounded(gaps / inside) : null);
			if (read) cells.push(gaps / inside);
		}
		enclosed.push(enclosedRow);
		boxed.push(boxRow);
	}
	const cellMean = cells.reduce((a, b) => a + b, 0) / Math.max(1, cells.length);
	const deviation = Math.sqrt(
		cells.reduce((a, b) => a + (b - cellMean) ** 2, 0) / Math.max(1, cells.length),
	);
	return {
		holes: {
			count: holes.length,
			share: rounded(held / area),
			largest: rounded((holes.at(-1) ?? 0) / area),
			medianDiameter: holes.length > 0 ? rounded(diameter(holes[holes.length >> 1] as number)) : 0,
			bySize,
		},
		grid: { enclosed, box: boxed },
		unevenness: cells.length >= 2 && cellMean > 0 ? rounded(deviation / cellMean, 3) : null,
	};
}

/**
 * The parts of a mask joined edge to edge, labelled from 1. Sky that meets other sky only at a
 * corner is parted by the plant that meets itself there, so the holes are counted this way while
 * the plant's own pieces are counted corner to corner.
 */
function fourJoined(
	mask: Uint8Array,
	width: number,
	height: number,
): { labels: Int32Array; sizes: number[] } {
	const labels = new Int32Array(width * height);
	const sizes: number[] = [0];
	const stack: number[] = [];
	for (let start = 0; start < mask.length; start++) {
		if (!mask[start] || labels[start]) continue;
		const label = sizes.length;
		let size = 0;
		labels[start] = label;
		stack.push(start);
		while (stack.length > 0) {
			const at = stack.pop() as number;
			size++;
			const x = at % width;
			const beside = [
				x > 0 ? at - 1 : -1,
				x < width - 1 ? at + 1 : -1,
				at - width,
				at + width < mask.length ? at + width : -1,
			];
			for (const next of beside)
				if (next >= 0 && mask[next] && !labels[next]) {
					labels[next] = label;
					stack.push(next);
				}
		}
		sizes.push(size);
	}
	return { labels, sizes };
}

/** The plant's largest piece alone: a mask of the same size that keeps only it. */
export function largestPiece(mask: Uint8Array, width: number, height: number): Uint8Array {
	const { labels, sizes } = components(mask, width, height);
	let best = 0;
	for (let label = 1; label < sizes.length; label++)
		if ((sizes[label] as number) > (sizes[best] as number) || best === 0) best = label;
	const out = new Uint8Array(mask.length);
	if (best > 0) for (let at = 0; at < out.length; at++) out[at] = labels[at] === best ? 1 : 0;
	return out;
}

/** The distances from the fork, in stem widths, at which the limbs are counted. */
const LIMB_RADII = [1.5, 2, 2.5] as const;
/** The widest stretch of plant, in stem widths, that reads as a limb rather than as foliage. */
const LIMB_ARC = 1.5;
/** Degrees each side of upright that the count sweeps round the fork. */
const LIMB_SWEEP = 100;
/** The least stem width, in pixels, at which limbs can be told apart. */
const LIMB_STEM_PIXELS = 4;

/** The limbs that leave the stem at its first fork. */
export interface LimbFigures {
	/** The limbs that show apart round the fork. */
	readonly count: number;
	/** Each limb's angle from upright in degrees, negative to the picture's left, left to right. */
	readonly angles: readonly number[];
}

/**
 * Counts the limbs that leave the top of the bare stem. Arcs at three distances round the fork
 * each cross the limbs. A count stands only when no arc meets a stretch of plant too wide to be a
 * limb and all three arcs agree, so a fork that foliage covers gives no count. The stem's own
 * line on above the fork counts as a limb.
 *
 * @param mask The plant's outline.
 * @param width The mask's width.
 * @param height The mask's height.
 * @param box The plant's box.
 * @param axis The column of the plant's foot.
 * @param stem The stem's figures, from `stemOf`.
 * @returns The limbs, or the reason they cannot be counted.
 */
export function limbsOf(
	mask: Uint8Array,
	width: number,
	height: number,
	box: Box,
	axis: number,
	stem: StemFigures,
): LimbFigures | { readonly reason: string } {
	if (stem.topRow === null || stem.width === null)
		return { reason: 'no stem shows below the crown, so no fork shows' };
	const tall = box.bottom - box.top + 1;
	const stemPixels = stem.width * tall;
	if (stemPixels < LIMB_STEM_PIXELS)
		return { reason: 'the stem is too thin in the picture to tell its limbs apart' };
	if (stem.topRow <= box.top) return { reason: 'the stem runs to the top of the plant unforked' };
	const forkRow = Math.min(box.bottom, stem.topRow + 1);
	const runs = axisRuns(mask, width, box, axis);
	const forkColumn = ((runs[forkRow * 2] as number) + (runs[forkRow * 2 + 1] as number)) / 2;
	const counts: number[] = [];
	// Each arc's crossings as points, left to right.
	const crossings: [number, number][][] = [];
	for (const radii of LIMB_RADII) {
		const radius = radii * stemPixels;
		const steps = Math.max(8, Math.ceil(((2 * LIMB_SWEEP * Math.PI) / 180) * radius));
		const points: [number, number][] = [];
		const at = (k: number): [number, number] => {
			const turn = ((-LIMB_SWEEP + (2 * LIMB_SWEEP * k) / steps) * Math.PI) / 180;
			return [forkColumn + radius * Math.sin(turn), forkRow - radius * Math.cos(turn)];
		};
		let start = -1;
		let covered = false;
		for (let k = 0; k <= steps + 1; k++) {
			const [px, py] = at(k);
			const x = Math.round(px);
			const y = Math.round(py);
			const on =
				k <= steps && x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] !== 0;
			if (on && start < 0) start = k;
			if (!on && start >= 0) {
				if (((k - start) * 2 * LIMB_SWEEP * Math.PI * radius) / 180 / steps > LIMB_ARC * stemPixels)
					covered = true;
				points.push(at((start + k - 1) / 2));
				start = -1;
			}
		}
		if (covered) return { reason: 'foliage covers the fork, so the limbs do not show apart' };
		counts.push(points.length);
		crossings.push(points);
	}
	if (counts.some((count) => count !== counts[0]))
		return {
			reason: `the counts at ${LIMB_RADII.join(', ')} stem widths from the fork disagree (${counts.join(', ')})`,
		};
	if (counts[0] === 0) return { reason: 'no wood shows above the bare stem' };
	// A limb's angle is its own run's, from where the nearest arc crosses it to where the farthest
	// does, so it does not turn on where the limbs are taken to meet.
	const near = crossings[0] as [number, number][];
	const far = crossings.at(-1) as [number, number][];
	return {
		count: counts[0] as number,
		angles: near.map((from, k) => {
			const to = far[k] as [number, number];
			return rounded((Math.atan2(to[0] - from[0], from[1] - to[1]) * 180) / Math.PI, 1);
		}),
	};
}
