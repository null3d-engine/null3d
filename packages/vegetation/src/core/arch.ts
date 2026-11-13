// One curve for every bent part of a plant: a blade, a frond's midrib, a leaf stalk, a flowering
// stem, a cane's bow, an arm's elbow. A part is described by the angle it leaves at and how far it
// turns before its tip, and the turn runs one way only, so a part never bends back on itself. The
// turn may be held to a stretch of the length, with straight runs either side of it, and it may
// gather toward the far end of that stretch, as a blade curls most at its tip.
//
// The path is cut where it turns, not where it is long: a straight run is one segment, and the
// bending stretch is cut so every segment turns the same share. Each level of detail states the
// most two neighbouring segments may turn between them, and a path is never cut coarser than that,
// so fewer triangles shorten a straight run and never put a corner in an arch.
//
// A part measured on a photograph is given by its figures instead: its highest point, how far its
// tip ends below that, and how far out the tip reaches. `archFromFigures` finds the turn that
// stands nearest to them and says how far it misses.

import { cos, exp, log, radians, sin } from './math';

/**
 * A bent part's centre line, in the vertical plane it grows in.
 *
 * @category api/vegetation
 */
export interface Arch {
	/** The part's length along its curve, in metres. */
	readonly length: number;
	/** Degrees above the horizontal that the part leaves at: 90 stands plumb, 0 runs level. */
	readonly leave: number;
	/**
	 * Degrees the part turns toward the ground between its base and its tip. A negative turn carries
	 * it up, as an arm that leaves level and rises.
	 */
	readonly turn: number;
	/**
	 * How far the turn gathers toward the far end of its stretch, from 1 up: 1 turns evenly, as an arc
	 * of one radius, and 2 turns from nothing at a steadily rising rate. Left out, it is 1.
	 */
	readonly power?: number;
	/** The share of the length where the turn starts; the part runs straight before it. Left out, 0. */
	readonly from?: number;
	/** The share of the length where the turn ends; the part runs straight after it. Left out, 1. */
	readonly to?: number;
}

/**
 * A cut path: the points of an arch from its base to its tip.
 *
 * @category api/vegetation
 */
export interface ArchPath {
	/** Segments in the path; every array holds one more value than this. */
	readonly segments: number;
	/** Metres each point stands out from the base, along the part's heading. */
	readonly out: Float64Array;
	/** Metres each point stands above the base. */
	readonly up: Float64Array;
	/** The curve's own direction at each point, in radians above the horizontal. */
	readonly elevation: Float64Array;
	/** The share of the length at each point, from 0 to 1. */
	readonly along: Float64Array;
}

/**
 * The most two neighbouring segments of a path may turn between them at each level of detail, in
 * degrees. A path cut for a level never turns more than this at any point.
 *
 * @category api/vegetation
 */
export const MOST_TURN: readonly [number, number, number] = [8, 15, 25];

/** The most segments a path is cut into. */
const MOST_SEGMENTS = 512;
/** The least power: an even turn. */
const LEAST_POWER = 1;
/** The shortest stretch a turn may be held to, as a share of the length. */
const LEAST_STRETCH = 1e-6;
/** Where each step of a segment's sum is read, either side of its middle (Gauss and Legendre). */
const GAUSS = 1 / Math.sqrt(3);
/** The most a step of a segment's sum turns, in degrees. */
const SUM_TURN = 4;

/** An arch's turn stretch and power, with the defaults filled in and held in range. */
interface Stretch {
	readonly from: number;
	readonly to: number;
	readonly power: number;
}

function stretchOf(arch: Arch): Stretch {
	const from = Math.min(1, Math.max(0, arch.from ?? 0));
	const to = Math.min(1, Math.max(from + LEAST_STRETCH, arch.to ?? 1));
	return { from, to, power: Math.max(LEAST_POWER, arch.power ?? 1) };
}

/** A share from 0 to 1 raised to a power above 0. */
function raised(share: number, power: number): number {
	if (share <= 0) return 0;
	if (share >= 1) return 1;
	if (power === 1) return share;
	if (power === 2) return share * share;
	return exp(power * log(share));
}

/** The share of the whole turn that is behind a place along the length. */
function turned(stretch: Stretch, along: number): number {
	return raised((along - stretch.from) / (stretch.to - stretch.from), stretch.power);
}

/**
 * The curve's direction at a place along an arch.
 *
 * @param arch The arch.
 * @param along The share of the length, from 0 to 1.
 * @returns Radians above the horizontal.
 * @category api/vegetation
 */
export function archElevation(arch: Arch, along: number): number {
	return radians(arch.leave - arch.turn * turned(stretchOf(arch), along));
}

/**
 * Fills the shares of the length where a path of `segments` segments is cut: `runBefore` even
 * segments of the straight run before the turn, `bends` segments that each take the same share of
 * the turn, and `runAfter` even segments of the straight run after it.
 */
function cuts(
	stretch: Stretch,
	runBefore: number,
	bends: number,
	runAfter: number,
	along: Float64Array,
): void {
	let at = 0;
	for (let i = 0; i < runBefore; i++) along[at++] = (stretch.from * i) / runBefore;
	const span = stretch.to - stretch.from;
	const root = 1 / stretch.power;
	for (let i = 0; i < bends; i++) along[at++] = stretch.from + span * raised(i / bends, root);
	for (let i = 0; i < runAfter; i++) along[at++] = stretch.to + ((1 - stretch.to) * i) / runAfter;
	along[at] = 1;
}

/** Lays the points of a path at its cuts. */
function lay(arch: Arch, stretch: Stretch, path: ArchPath): void {
	const { out, up, elevation, along, segments } = path;
	const leave = arch.leave;
	const turn = arch.turn;
	out[0] = 0;
	up[0] = 0;
	elevation[0] = radians(leave - turn * turned(stretch, 0));
	let x = 0;
	let y = 0;
	for (let i = 0; i < segments; i++) {
		const a = along[i] as number;
		const b = along[i + 1] as number;
		const share = turned(stretch, b) - turned(stretch, a);
		if (share === 0) {
			const angle = radians(leave - turn * turned(stretch, a));
			x += cos(angle) * (b - a);
			y += sin(angle) * (b - a);
		} else {
			// The segment is summed in steps that each turn about the same small angle, so a wide
			// segment of a far level lands where the near level's narrow ones do.
			const steps = Math.max(1, Math.ceil((Math.abs(turn) * share) / SUM_TURN));
			const half = (b - a) / steps / 2;
			for (let h = 0; h < steps; h++) {
				const mid = a + half * (2 * h + 1);
				for (let g = -1; g <= 1; g += 2) {
					const angle = radians(leave - turn * turned(stretch, mid + g * GAUSS * half));
					x += cos(angle) * half;
					y += sin(angle) * half;
				}
			}
		}
		out[i + 1] = x * arch.length;
		up[i + 1] = y * arch.length;
		elevation[i + 1] = radians(leave - turn * turned(stretch, b));
	}
}

/** The cosine of the largest turn between neighbouring segments of a laid path; 1 for one segment. */
function tightest(path: ArchPath): number {
	const { out, up, segments } = path;
	let least = 1;
	let px = (out[1] as number) - (out[0] as number);
	let py = (up[1] as number) - (up[0] as number);
	let pl = Math.sqrt(px * px + py * py);
	for (let i = 1; i < segments; i++) {
		const qx = (out[i + 1] as number) - (out[i] as number);
		const qy = (up[i + 1] as number) - (up[i] as number);
		const ql = Math.sqrt(qx * qx + qy * qy);
		if (pl > 0 && ql > 0) least = Math.min(least, (px * qx + py * qy) / (pl * ql));
		px = qx;
		py = qy;
		pl = ql;
	}
	return least;
}

/** A path with room for `segments` segments. */
function room(segments: number): ArchPath {
	return {
		segments,
		out: new Float64Array(segments + 1),
		up: new Float64Array(segments + 1),
		elevation: new Float64Array(segments + 1),
		along: new Float64Array(segments + 1),
	};
}

/**
 * Cuts an arch into a path for a level of detail. No two neighbouring segments turn more than the
 * level's `MOST_TURN` between them, whatever count is asked for: a count below what the turn needs
 * is raised to it. A straight run is one segment unless `least` asks for more.
 *
 * @param arch The arch.
 * @param level The level of detail, 0 the nearest.
 * @param least The least segments to cut, for a part that needs more than its turn does.
 * @returns The path.
 * @category api/vegetation
 */
export function archPath(arch: Arch, level: 0 | 1 | 2, least = 1): ArchPath {
	const stretch = stretchOf(arch);
	const most = MOST_TURN[level];
	const turn = Math.abs(arch.turn);
	const bound = cos(radians(most)) - 1e-12;
	const before = stretch.from > 0 ? 1 : 0;
	const after = stretch.to < 1 ? 1 : 0;
	if (turn === 0) {
		const path = room(Math.max(1, Math.floor(least)));
		for (let i = 0; i <= path.segments; i++) path.along[i] = i / path.segments;
		lay(arch, stretch, path);
		return path;
	}
	// A run meets the bend at half a bend segment's turn, so the bend alone sets the count.
	let bends = Math.max(1, Math.ceil(turn / most));
	for (;;) {
		// Segments beyond what the turn needs are shared among the two runs and the bend by length.
		const spare = Math.max(0, Math.floor(least) - (before + bends + after));
		const moreBefore = Math.floor(spare * stretch.from);
		const moreAfter = Math.floor(spare * (1 - stretch.to));
		const runBefore = before + moreBefore;
		const runAfter = after + moreAfter;
		const bent = bends + spare - moreBefore - moreAfter;
		const path = room(runBefore + bent + runAfter);
		cuts(stretch, runBefore, bent, runAfter, path.along);
		lay(arch, stretch, path);
		if (tightest(path) >= bound || path.segments >= MOST_SEGMENTS) return path;
		bends++;
	}
}

/**
 * The least segments an arch may be cut into at a level of detail: the count `archPath` gives when
 * asked for no more than the turn needs.
 *
 * @param arch The arch.
 * @param level The level of detail, 0 the nearest.
 * @returns The segment count.
 * @category api/vegetation
 */
export function archSegments(arch: Arch, level: 0 | 1 | 2): number {
	return archPath(arch, level).segments;
}

/**
 * A bent part as measured on a photograph, in metres.
 *
 * @category api/vegetation
 */
export interface ArchFigures {
	/** The part's length along its curve. Left out, the fit finds it. */
	readonly length?: number;
	/** Degrees above the horizontal that the part leaves at. Left out, the fit finds it. */
	readonly leave?: number;
	/** How far the highest point stands above the base. */
	readonly apex?: number;
	/** How far the tip ends below the highest point. */
	readonly drop?: number;
	/** How far out from the base the tip ends. */
	readonly reach?: number;
	/**
	 * Degrees below the horizontal that the tip points at, from 0 to 90, for a part whose tip was
	 * read on the photograph. Left out, the fit finds how far the part turns.
	 */
	readonly tip?: number;
}

/**
 * The arch nearest a set of figures, and how far it stands from them.
 *
 * @category api/vegetation
 */
export interface ArchFit {
	/** The arch. */
	readonly arch: Arch;
	/** The largest distance between a figure and the arch's own, in metres. */
	readonly miss: number;
}

/** Steps a trial arch is summed over while the fit searches. */
const FIT_STEPS = 32;
/** The logarithm of each step's middle share, so a trial's power costs one exponential a step. */
const FIT_LOG = Float64Array.from({ length: FIT_STEPS }, (_, k) => log((k + 0.5) / FIT_STEPS));
/** The largest power the fit tries. */
const FIT_MOST_POWER = 4;
/** The lowest a fitted part's tip may point, in degrees above the horizontal: plumb down. */
const FIT_TIP = -90;

/** The least share of its length that a fitted part's turn takes. */
const FIT_LEAST_TO = 0.3;

/** A trial arch's own figures in metres, its length, and its distance from the measured ones. */
const trial = { apex: 0, drop: 0, reach: 0, length: 0, miss: 0, distance: 0 };

/**
 * Sums a trial arch whose turn runs from its base to a share of its length, and fills `trial`. A
 * part whose length was not measured takes the length that brings its figures nearest the measured
 * ones.
 */
function measure(
	figures: ArchFigures,
	leave: number,
	turn: number,
	power: number,
	to: number,
): void {
	let x = 0;
	let y = 0;
	let top = 0;
	const step = 1 / FIT_STEPS;
	const end = log(to);
	const hang = radians(leave - turn);
	const hangX = cos(hang) * step;
	const hangY = sin(hang) * step;
	for (let k = 0; k < FIT_STEPS; k++) {
		const behind = (FIT_LOG[k] as number) - end;
		if (behind >= 0) {
			x += hangX;
			y += hangY;
		} else {
			const angle = radians(leave - turn * exp(power * behind));
			x += cos(angle) * step;
			y += sin(angle) * step;
		}
		if (y > top) top = y;
	}
	const { apex, drop, reach } = figures;
	let length = figures.length;
	if (length === undefined) {
		let across = 0;
		let own = 0;
		if (apex !== undefined) {
			across += apex * top;
			own += top * top;
		}
		if (drop !== undefined) {
			across += drop * (top - y);
			own += (top - y) * (top - y);
		}
		if (reach !== undefined) {
			across += reach * x;
			own += x * x;
		}
		length = own > 0 ? Math.max(0, across / own) : 0;
	}
	trial.length = length;
	trial.apex = top * length;
	trial.drop = (top - y) * length;
	trial.reach = x * length;
	const da = apex === undefined ? 0 : trial.apex - apex;
	const dd = drop === undefined ? 0 : trial.drop - drop;
	const dr = reach === undefined ? 0 : trial.reach - reach;
	trial.distance = da * da + dd * dd + dr * dr;
	trial.miss = Math.max(Math.abs(da), Math.abs(dd), Math.abs(dr));
}

/**
 * Finds the arch that stands nearest a part's measured figures. The arch turns toward the ground
 * from its base, more and more toward the end of its turn, and its tip never points past plumb: a
 * part that has turned as far as it goes hangs straight from there, as a limp blade tip does. The
 * search is a fixed grid and then a walk of halving steps, so the same figures always give the
 * same arch. Figures that leave more unknown than they measure are met by the first arch the
 * search reaches.
 *
 * @param figures The measured figures.
 * @returns The arch, and how far it misses the figures.
 * @category api/vegetation
 */
export function archFromFigures(figures: ArchFigures): ArchFit {
	const freeLeave = figures.leave === undefined;
	// The unknowns: the leaving angle, the share of the widest allowed turn, the power, and the
	// share of the length where the turn ends.
	const value: [number, number, number, number] = [figures.leave ?? 45, 0, 1, 1];
	const low: readonly number[] = [-30, 0, 1, FIT_LEAST_TO];
	const high: readonly number[] = [90, 1, FIT_MOST_POWER, 1];
	// A measured tip fixes the turn, whatever the leaving angle the search tries.
	const tip = figures.tip === undefined ? undefined : -Math.min(90, Math.max(0, figures.tip));
	const turnOf = (): number =>
		tip === undefined ? value[1] * (value[0] - FIT_TIP) : Math.max(0, value[0] - tip);
	const sum = (): void => measure(figures, value[0], turnOf(), value[2], value[3]);
	let best = Number.POSITIVE_INFINITY;
	const start = [...value];
	for (let l = freeLeave ? 0 : 4; l <= 4; l++)
		for (let t = 0; t <= 6; t++)
			for (let p = 0; p <= 2; p++)
				for (let e = 0; e <= 3; e++) {
					if (freeLeave) value[0] = 10 + 20 * l;
					value[1] = t / 6;
					value[2] = 1 + 1.5 * p;
					value[3] = 0.4 + 0.2 * e;
					sum();
					if (trial.distance < best) {
						best = trial.distance;
						for (let k = 0; k < 4; k++) start[k] = value[k] as number;
					}
				}
	for (let k = 0; k < 4; k++) value[k] = start[k] as number;
	const step = [freeLeave ? 10 : 0, 0.08, 0.5, 0.1];
	const finest: readonly number[] = [0.05, 0.0005, 0.01, 0.002];
	const first = freeLeave ? 0 : 1;
	for (let round = 0; round < 400; round++) {
		let moved = false;
		for (let axis = first; axis < 4; axis++)
			for (let side = -1; side <= 1; side += 2) {
				const kept = value[axis] as number;
				const next = Math.min(
					high[axis] as number,
					Math.max(low[axis] as number, kept + side * (step[axis] as number)),
				);
				if (next === kept) continue;
				value[axis] = next;
				sum();
				if (trial.distance < best) {
					best = trial.distance;
					moved = true;
				} else value[axis] = kept;
			}
		if (moved) continue;
		let fine = true;
		for (let axis = first; axis < 4; axis++) {
			step[axis] = (step[axis] as number) / 2;
			if ((step[axis] as number) > (finest[axis] as number)) fine = false;
		}
		if (fine) break;
	}
	sum();
	return {
		arch: {
			length: trial.length,
			leave: value[0],
			turn: turnOf(),
			power: value[2],
			to: value[3],
		},
		miss: trial.miss,
	};
}
