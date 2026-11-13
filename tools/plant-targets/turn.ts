// A turning video, measured frame by frame: each frame of the whole plant's video at its own angle
// gives the figures a still gives, and the frames together give each figure's range round the
// plant and the outline's radius by height and by direction. The fit tool's hull envelope of the
// same video stands beside them. A cut piece's video gives the piece figures' ranges the same way.
import { median } from '../lib/plant-review/compare.ts';
import { probeVideo, type Rgba, videoFrames } from '../lib/plant-review/image.ts';
import { type TurnVideo, WORK_WIDTH } from '../lib/plant-review/references.ts';
import { AZIMUTHS } from '../plant-fit/envelope.ts';
import { type FitStill, fitTurn } from '../plant-fit/turn.ts';
import { measurePiece, type PieceFigures } from './piece.ts';
import { ENVELOPE_BANDS, rounded } from './shape.ts';
import { measureView, type ViewFigures } from './whole.ts';

/** The most a frame's plant height may leave the turn's middle height, as a share of it. */
const HEIGHT_BAND = 0.15;
/** The most frames of a cut piece's video that are measured, spread evenly over it. */
const PIECE_FRAMES = 24;

/** A figure's range over the frames that give it. */
export interface Stat {
	readonly min: number;
	/** The value a tenth of the way up the frames' values, the middle value, and nine tenths up. */
	readonly low: number;
	readonly median: number;
	readonly high: number;
	readonly mean: number;
	readonly max: number;
	/** The largest less the smallest, over the mean; 0 where the mean is 0. */
	readonly spread: number;
	/** The frames that give the figure. */
	readonly frames: number;
}

/** The range of a list of values, leaving out the nulls, or null when none is a number. */
export function statOf(values: readonly (number | null | undefined)[]): Stat | null {
	const known = values.filter((v): v is number => typeof v === 'number');
	if (known.length === 0) return null;
	let min = Number.POSITIVE_INFINITY;
	let max = Number.NEGATIVE_INFINITY;
	let sum = 0;
	for (const v of known) {
		min = Math.min(min, v);
		max = Math.max(max, v);
		sum += v;
	}
	const mean = sum / known.length;
	const sorted = [...known].sort((a, b) => a - b);
	const at = (share: number): number =>
		rounded(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))] as number);
	return {
		min: rounded(min),
		low: at(0.1),
		median: rounded(median(sorted) as number),
		high: at(0.9),
		mean: rounded(mean),
		max: rounded(max),
		spread: mean === 0 ? 0 : rounded((max - min) / Math.abs(mean)),
		frames: known.length,
	};
}

/** The scalar figures of a view that a turn gives the range of, by name. */
export const TURN_FIGURES = {
	heightToWidth: (f: ViewFigures) => f.heightToWidth,
	crownHeightToWidth: (f: ViewFigures) => f.crown.heightToWidth,
	crownBase: (f: ViewFigures) => f.crown.base,
	crownWidth: (f: ViewFigures) => f.crown.width,
	bareTrunk: (f: ViewFigures) => f.trunk.bareShare,
	trunkWidth: (f: ViewFigures) => f.trunk.width,
	breastHeightWidth: (f: ViewFigures) => f.trunk.breastHeightWidth,
	flare: (f: ViewFigures) => f.trunk.flare,
	lean: (f: ViewFigures) => f.trunk.lean,
	stems: (f: ViewFigures) => f.trunk.stems,
	limbs: (f: ViewFigures) => f.limbs?.count ?? null,
	lobes: (f: ViewFigures) => f.lobes.count,
	enclosedGap: (f: ViewFigures) => f.sky.enclosedGap,
	boxGap: (f: ViewFigures) => f.sky.boxGap,
	holeCount: (f: ViewFigures) => f.sky.holes.count,
	holeShare: (f: ViewFigures) => f.sky.holes.share,
	unevenness: (f: ViewFigures) => f.sky.unevenness,
} as const;

/** The name of a figure a turn gives the range of. */
export type TurnFigureName = keyof typeof TURN_FIGURES;

/** What the whole plant's turning video gives. */
export interface TurnFigures {
	readonly video: string;
	/** Degrees the video turns through. */
	readonly arc: number;
	/** The video's frames, and those that gave an outline. */
	readonly frames: number;
	readonly read: number;
	/** The frames that gave no outline, by the reason. */
	readonly skipped: Readonly<Record<string, number>>;
	/** Each figure's range over the frames, or null when no frame gives it. */
	readonly stats: Readonly<Record<TurnFigureName, Stat | null>>;
	readonly envelope: {
		/**
		 * The outline's reach from the axis in each height band from the ground up, over both sides
		 * of every frame: the largest, the mean, and the largest less the smallest over the mean.
		 */
		readonly max: readonly number[];
		readonly mean: readonly number[];
		readonly spread: readonly number[];
		/**
		 * The mean reach in each band by direction round the plant, one row for each direction: a
		 * frame's right side stands a quarter turn on from its angle and its left side a quarter
		 * turn back. Outlines cannot tell which way a video turns, so the directions run with the
		 * frames or against them. A direction no frame faces is null.
		 */
		readonly byDirection: readonly (readonly number[] | null)[];
	};
	/** The mean of each grid cell's gap over the frames, top row first; null where no frame reads it. */
	readonly grid: {
		readonly enclosed: readonly (readonly (number | null)[])[];
		readonly box: readonly (readonly number[])[];
	};
	/** The lumps on the crown's edge: each frame's count, as counts of frames by lump count. */
	readonly lobeCounts: Readonly<Record<string, number>>;
	/** Four figures frame by frame, null where a frame gave no outline, with each frame's angle. */
	readonly series: {
		readonly angles: readonly number[];
		readonly heightToWidth: readonly (number | null)[];
		readonly crownBase: readonly (number | null)[];
		readonly enclosedGap: readonly (number | null)[];
		readonly lobes: readonly (number | null)[];
	};
	/** The fit tool's hull envelope of the same video, or null where it measures none. */
	readonly hull: {
		readonly heights: readonly number[];
		readonly radii: readonly (number | readonly number[])[];
		/** Crown width over plant height, the mean over the hull's views. */
		readonly aspect: number;
		readonly crownBase: number;
		/** The overlap of the hull's outlines with the views it came from. */
		readonly consistency: {
			readonly lowest: number;
			readonly mean: number;
			readonly highest: number;
		};
	} | null;
	/** How far a full turn's last frame shows the first frame's plant again. */
	readonly closing: number | null;
	/** Why the fit tool calls the video poor to measure from; empty when it does not. */
	readonly problems: readonly string[];
	/** Why each null figure is null. */
	readonly missing: Readonly<Record<string, string>>;
}

/** The reason most frames gave for a null figure. */
function commonest(reasons: readonly string[]): string {
	const counts = new Map<string, number>();
	for (const reason of reasons) counts.set(reason, (counts.get(reason) ?? 0) + 1);
	let best = '';
	let most = 0;
	for (const [reason, count] of [...counts].sort((a, b) => a[0].localeCompare(b[0])))
		if (count > most) {
			most = count;
			best = reason;
		}
	return best;
}

/** The figure names a turn reads from a view's own missing list. */
const MISSING_NAME: Readonly<Partial<Record<TurnFigureName, string>>> = {
	bareTrunk: 'trunk.bareShare',
	trunkWidth: 'trunk.width',
	breastHeightWidth: 'trunk.breastHeightWidth',
	flare: 'trunk.flare',
	lean: 'trunk.lean',
	stems: 'trunk.stems',
	limbs: 'limbs',
};

/**
 * Gathers the frames of a whole plant's turn into ranges.
 *
 * @param video The video's file name and arc.
 * @param views Each frame's figures, or the reason it gave none, in frame order.
 */
export function gatherTurn(
	video: { readonly file: string; readonly arc: number },
	views: readonly ({ readonly figures: ViewFigures } | { readonly problem: string })[],
): Omit<TurnFigures, 'hull' | 'closing' | 'problems'> {
	const n = views.length;
	const read = views.flatMap((view) => ('figures' in view ? [view.figures] : []));
	const skipped: Record<string, number> = {};
	for (const view of views)
		if ('problem' in view) skipped[view.problem] = (skipped[view.problem] ?? 0) + 1;
	const missing: Record<string, string> = {};
	const stats = {} as Record<TurnFigureName, Stat | null>;
	for (const name of Object.keys(TURN_FIGURES) as TurnFigureName[]) {
		const stat = statOf(read.map(TURN_FIGURES[name]));
		stats[name] = stat;
		if (stat) continue;
		const key = MISSING_NAME[name];
		const reasons = key ? read.flatMap((f) => (f.missing[key] ? [f.missing[key]] : [])) : [];
		missing[`stats.${name}`] =
			read.length === 0
				? 'no frame of the video gives an outline'
				: `no frame gives it: ${commonest(reasons) || 'the crown shows no gap to spread'}`;
	}
	const bandMax = new Array<number>(ENVELOPE_BANDS).fill(0);
	const bandMin = new Array<number>(ENVELOPE_BANDS).fill(Number.POSITIVE_INFINITY);
	const bandSum = new Array<number>(ENVELOPE_BANDS).fill(0);
	const directionSum = Array.from({ length: AZIMUTHS }, () =>
		new Array<number>(ENVELOPE_BANDS).fill(0),
	);
	const directionCount = new Array<number>(AZIMUTHS).fill(0);
	const angleOf = (k: number) => (n > 1 ? (video.arc * k) / (n - 1) : 0);
	views.forEach((view, k) => {
		if (!('figures' in view)) return;
		for (const [side, quarter] of [
			[view.figures.envelope.right, 90],
			[view.figures.envelope.left, 270],
		] as const) {
			const direction = Math.round((((angleOf(k) + quarter) % 360) * AZIMUTHS) / 360) % AZIMUTHS;
			directionCount[direction] = (directionCount[direction] as number) + 1;
			for (let band = 0; band < ENVELOPE_BANDS; band++) {
				const reach = side[band] as number;
				bandMax[band] = Math.max(bandMax[band] as number, reach);
				bandMin[band] = Math.min(bandMin[band] as number, reach);
				bandSum[band] = (bandSum[band] as number) + reach;
				(directionSum[direction] as number[])[band] =
					((directionSum[direction] as number[])[band] as number) + reach;
			}
		}
	});
	const sides = Math.max(1, read.length * 2);
	const gridSum = Array.from({ length: 9 }, () => ({ enclosed: 0, cells: 0, box: 0 }));
	const lobeCounts: Record<string, number> = {};
	for (const figures of read) {
		lobeCounts[figures.lobes.count] = (lobeCounts[figures.lobes.count] ?? 0) + 1;
		for (let cell = 0; cell < 9; cell++) {
			const sum = gridSum[cell] as { enclosed: number; cells: number; box: number };
			const enclosed = (figures.sky.grid.enclosed[Math.floor(cell / 3)] as (number | null)[])[
				cell % 3
			];
			if (typeof enclosed === 'number') {
				sum.enclosed += enclosed;
				sum.cells++;
			}
			sum.box += (figures.sky.grid.box[Math.floor(cell / 3)] as number[])[cell % 3] as number;
		}
	}
	const rows = <T>(cell: (sum: { enclosed: number; cells: number; box: number }) => T): T[][] =>
		[0, 1, 2].map((row) =>
			[0, 1, 2].map((column) =>
				cell(gridSum[row * 3 + column] as { enclosed: number; cells: number; box: number }),
			),
		);
	const series = <T>(pick: (f: ViewFigures) => T): (T | null)[] =>
		views.map((view) => ('figures' in view ? pick(view.figures) : null));
	if (read.length === 0) missing.envelope = 'no frame of the video gives an outline';
	return {
		video: video.file,
		arc: video.arc,
		frames: n,
		read: read.length,
		skipped: Object.fromEntries(Object.entries(skipped).sort((a, b) => a[0].localeCompare(b[0]))),
		stats,
		envelope: {
			max: bandMax.map((v) => rounded(v)),
			mean: bandSum.map((v) => rounded(v / sides)),
			spread: bandSum.map((sum, band) =>
				sum === 0
					? 0
					: rounded(((bandMax[band] as number) - (bandMin[band] as number)) / (sum / sides), 3),
			),
			byDirection: directionSum.map((sum, direction) =>
				directionCount[direction] === 0
					? null
					: sum.map((v) => rounded(v / (directionCount[direction] as number))),
			),
		},
		grid: {
			enclosed: rows((sum) => (sum.cells === 0 ? null : rounded(sum.enclosed / sum.cells))),
			box: rows((sum) => rounded(sum.box / Math.max(1, read.length))),
		},
		lobeCounts,
		series: {
			angles: views.map((_, k) => rounded(angleOf(k), 1)),
			heightToWidth: series((f) => f.heightToWidth),
			crownBase: series((f) => f.crown.base),
			enclosedGap: series((f) => f.sky.enclosedGap),
			lobes: series((f) => f.lobes.count),
		},
		missing,
	};
}

/**
 * Measures the whole plant's turning video.
 *
 * @param video The video.
 * @param breastShare Breast height as a share of the plant's height, or null when it is not known.
 * @param stills The whole-plant stills the fit tool's hull honours.
 */
export function measureTurn(
	video: TurnVideo,
	breastShare: number | null,
	stills: readonly FitStill[],
): TurnFigures {
	const frames = videoFrames(video.path, probeVideo(video.path), WORK_WIDTH);
	const views = frames.map((frame) => measureView(frame, breastShare));
	// A frame whose plant stands much taller or shorter than the turn's middle height has lost its
	// foot or its top against the background, and its figures are not the plant's.
	const middle = median(views.flatMap((view) => ('tall' in view ? [view.tall] : []))) ?? 0;
	const gathered = gatherTurn(
		video,
		views.map((view) =>
			'tall' in view && Math.abs(view.tall - middle) > middle * HEIGHT_BAND
				? {
						problem: `the plant's height in the frame leaves the turn's middle height by more than ${Math.round(HEIGHT_BAND * 100)} per cent`,
					}
				: view,
		),
	);
	const fit = fitTurn(video, frames, stills);
	const missing = { ...gathered.missing };
	if (!fit.hull) missing.hull = fit.problems[0] ?? 'the fit tool measures no hull from the video';
	if (fit.closing === null)
		missing.closing =
			'the video turns through less than a full turn, or an end frame has no outline';
	return {
		...gathered,
		hull: fit.hull
			? {
					heights: fit.hull.envelope.heights,
					radii: fit.hull.envelope.radii,
					aspect: fit.hull.aspect,
					crownBase: fit.hull.crownBase,
					consistency: {
						lowest: fit.hull.consistency.lowest,
						mean: fit.hull.consistency.mean,
						highest: fit.hull.consistency.highest,
					},
				}
			: null,
		closing: fit.closing,
		problems: fit.problems,
		missing,
	};
}

/** The figures of a cut piece that its turning video gives the range of, by name. */
const PIECE_STATS = {
	heightToWidth: (f: PieceFigures) => f.heightToWidth,
	boxShare: (f: PieceFigures) => f.boxShare,
	foliageShare: (f: PieceFigures) => f.foliageShare,
	woodShare: (f: PieceFigures) => f.woodShare,
	tips: (f: PieceFigures) => f.branch?.tips ?? null,
	woodPerTip: (f: PieceFigures) => f.branch?.woodPerTip ?? null,
	tipsPerArea: (f: PieceFigures) => f.branch?.tipsPerArea ?? null,
	fanShare: (f: PieceFigures) => f.branch?.fanShare ?? null,
	kinksPerLength: (f: PieceFigures) => f.branch?.kinksPerLength ?? null,
} as const;

/** What a cut piece's turning video gives. */
export interface PieceTurn {
	readonly video: string;
	/** The piece the video turns round: a branch, a sub-branch or a leaf cluster. */
	readonly piece: string;
	readonly arc: number;
	/** The frames measured, spread evenly over the video, and those that gave an outline. */
	readonly frames: number;
	readonly read: number;
	/** Each figure's range over the measured frames, or null when no frame gives it. */
	readonly stats: Readonly<Record<keyof typeof PIECE_STATS, Stat | null>>;
	/** Why each null figure is null. */
	readonly missing: Readonly<Record<string, string>>;
}

/**
 * Measures a cut piece's turning video.
 *
 * @param video The video.
 * @param frames Its frames, when already read; read through ffmpeg otherwise.
 */
export function measurePieceTurn(video: TurnVideo, frames?: readonly Rgba[]): PieceTurn {
	const all = frames ?? videoFrames(video.path, probeVideo(video.path), WORK_WIDTH);
	const count = Math.min(PIECE_FRAMES, all.length);
	const picked = Array.from(
		{ length: count },
		(_, k) => all[Math.min(all.length - 1, Math.round((k * all.length) / count))] as Rgba,
	);
	// A leaf cluster shows one shoot, so the cut-branch figures do not apply to it.
	const results = picked.map((frame) =>
		measurePiece(frame, false, true, video.piece !== 'cluster'),
	);
	const read = results.flatMap((result) => ('figures' in result ? [result.figures] : []));
	const missing: Record<string, string> = {};
	const stats = {} as Record<keyof typeof PIECE_STATS, Stat | null>;
	for (const name of Object.keys(PIECE_STATS) as (keyof typeof PIECE_STATS)[]) {
		const stat = statOf(read.map(PIECE_STATS[name]));
		stats[name] = stat;
		if (stat) continue;
		const key = name === 'foliageShare' || name === 'woodShare' ? name : 'branch';
		missing[`stats.${name}`] =
			read.length === 0
				? `no frame gives an outline: ${commonest(results.flatMap((r) => ('problem' in r ? [r.problem] : [])))}`
				: `no frame gives it: ${commonest(read.flatMap((f) => (f.missing[key] ? [f.missing[key]] : []))) || 'the wood has no joint'}`;
	}
	return {
		video: video.file,
		piece: video.piece,
		arc: video.arc,
		frames: count,
		read: read.length,
		stats,
		missing,
	};
}
