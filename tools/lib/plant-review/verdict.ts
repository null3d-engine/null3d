// A species' verdict for one run: for each of the twelve rows of the plant review standard, pass,
// fail, void or unjudged, with the pictures it rests on, the figure and its band where the row has
// one, who judged it, and the commit the run drew at. The review tool writes the rows a figure
// decides and the evidence of every row, and a reviewer fills the rows the eye decides. The ledger
// counts from these files alone, so no count is kept by hand.

import { rowGap, type StillResult } from './compare.ts';
import type { Coverage } from './coverage.ts';
import type { Slot } from './references.ts';
import type { PictureRuling, Standing } from './review-data.ts';

/** The name of the verdict file's format. */
export const VERDICT_SCHEMA = 'null3d-plant-verdict/1';

/** The file a run's verdict is kept in, beside its manifest. */
export const VERDICT_FILE = 'verdict.json';

/** The twelve rows of the standard, in order. */
export const ROW_NAMES = [
	'Structure',
	'Branch density',
	'Branch length and taper',
	'Leaf shape',
	'Leaf cluster density',
	'Foliage density and see-through',
	'Bark curviness',
	'Bark color and texture',
	'Proportions',
	'Color and season',
	'Distinctness',
	'Plausibility, neatness and pattern',
] as const;

/** What a row's verdict may be. */
export const ROW_VERDICTS = ['pass', 'fail', 'void', 'unjudged'] as const;

/** One row's verdict. */
export type RowVerdict = (typeof ROW_VERDICTS)[number];

/** The band a figure must fall in; a side left null is open. */
export interface Band {
	readonly min: number | null;
	readonly max: number | null;
}

/** One figure a row rests on. */
export interface Figure {
	/** What the figure measures. */
	readonly name: string;
	/** The reference picture it was measured beside. */
	readonly picture: string;
	readonly value: number;
	/** The reference's own figure, where the band is set from it. */
	readonly reference?: number;
	/** The band the standard gives the figure, or null where it gives none. */
	readonly band: Band | null;
	/** The run the figure was measured in. */
	readonly run: string;
	/** The level of detail the figure's picture was drawn at, where the page reported it. */
	readonly level?: string;
}

/** Who passed a row, when, and the review file that holds the reading. */
export interface Review {
	readonly reviewer: string;
	/** The day of the reading, as year, month and day. */
	readonly date: string;
	/** The review file that names the row: a path inside the run folder, or a full path. */
	readonly file: string;
}

/**
 * The balance of the plant through the eight angles of the standard's coverage rule, which can
 * fail a species alone. It is judged like a row and counted beside the twelve.
 */
export interface Balance {
	readonly verdict: RowVerdict;
	readonly judge: 'tool' | 'reviewer' | null;
	/** The turning video's sheets the balance rests on, as paths inside the run folder. */
	readonly evidence: readonly string[];
	/** The crown box's spread in width and in height, each against its band. */
	readonly figures: readonly Figure[];
	readonly reason?: string;
	readonly review?: Review;
}

/** One row of a verdict. */
export interface VerdictRow {
	readonly row: number;
	readonly name: string;
	readonly verdict: RowVerdict;
	/** Who judged the row, or null while nobody has. */
	readonly judge: 'tool' | 'reviewer' | null;
	/** The pictures the row rests on, as paths inside the run folder. */
	readonly evidence: readonly string[];
	readonly figures: readonly Figure[];
	/** Why the row fails or is void; a reviewer may give one for a pass too. */
	readonly reason?: string;
	/**
	 * What the row's figures say, for a row whose band the standard states: every figure in its
	 * band, or some figure outside, with which. It proposes and does not judge: a plant can hold
	 * every figure and still not look like its photograph, so only a reviewer passes a row.
	 */
	readonly proposed?: {
		readonly figures: 'in band' | 'out of band';
		readonly outside?: string;
	};
	/** Who passed the row, where a reviewer did. */
	readonly review?: Review;
	/** The row's reference pictures that the run did not compare, so the row was read without them. */
	readonly notCompared?: readonly string[];
	/** The row's pictures that show no subject, each with its reason: they decide nothing. */
	readonly voids?: readonly { readonly picture: string; readonly reason: string }[];
	/**
	 * The row's pictures whose view has no subject check: the tool cannot say that the picture
	 * shows what its photograph shows, so no row passes on such pictures alone.
	 */
	readonly unchecked?: readonly string[];
	/**
	 * The row's pictures of a part the plant does not have, though its photograph shows the part.
	 * The tool fails the row on them.
	 */
	readonly lacking?: readonly { readonly picture: string; readonly reason: string }[];
	/**
	 * The row's pictures that do not judge the primary plant, each with its reason: a second form of
	 * the species, a recorded limit of the reference set, or a stand of many plants. They are not
	 * among the row's evidence, and no figure of theirs is among its figures.
	 */
	readonly setAside?: readonly {
		readonly picture: string;
		readonly kind: Standing;
		readonly reason: string;
	}[];
	/** The row's pictures whose outline cannot be read, each with its reason: their outline figures are absent. */
	readonly outlineVoids?: readonly { readonly picture: string; readonly reason: string }[];
	/** The built neighbour that row 11 was judged against. */
	readonly neighbour?: string;
}

/** A species' verdict for one run. */
export interface Verdict {
	readonly schema: typeof VERDICT_SCHEMA;
	readonly species: string;
	/** The run the pictures and figures come from. */
	readonly run: string;
	/** The commit the run drew at, and whether its working tree had changes. */
	readonly commit: string;
	readonly dirty: boolean;
	readonly seed: number;
	readonly variant: number;
	readonly preset: string;
	/** Whether the run compared every reference file in use. */
	readonly coverage: {
		readonly complete: boolean;
		readonly compared: number;
		readonly inUse: number;
		/**
		 * The files drawn and not measured, because the standard states no figure for their view. The
		 * eye judges them: each counts toward a complete run and passes no row alone.
		 */
		readonly drawn?: readonly string[];
	};
	/** The plant's balance through eight angles, from the whole-plant turning video. */
	readonly balance: Balance;
	/**
	 * The pictures that a ruling takes out of their rows or of their outline figures, each with the
	 * ruling it cites, whether or not this run drew them.
	 */
	readonly rulings?: readonly PictureRuling[];
	readonly rows: readonly VerdictRow[];
}

/** The pictures each row is judged on, by the reference's number: the standard picture map. */
const ROW_PICTURES: Readonly<Record<number, readonly number[]>> = {
	1: [1, 2, 3, 18],
	2: [1, 2, 3, 9, 10, 21, 22],
	3: [7, 8, 9, 17, 21, 22],
	4: [12, 13, 24, 25],
	5: [4, 11, 23],
	6: [1, 2, 18],
	7: [3, 5, 7, 8, 14, 15, 16, 17],
	8: [14, 15, 16, 26, 28],
	9: [1, 2, 18],
	10: [1, 2],
	11: [1, 2, 18],
};

/** The rows judged on every whole view the set holds, beside their numbered pictures. */
const WHOLE_ROWS: ReadonlySet<number> = new Set([6, 9]);

/** How far a render's sky gap may stand above its reference's, and below it, for row 6. */
export const GAP_ABOVE = 0.05;
export const GAP_BELOW = 0.02;
/** The most a color difference may be, in CIEDE2000 steps, for rows 8 and 10. */
export const COLOUR_MOST = 3;
/**
 * A cut branch's four density figures against its photograph's: the wood per tip and the tips per
 * area within a quarter of it, the share of fan joints at most a tenth above it, and the kinks at
 * least half of it. The wood per tip and the kinks hold on bare wood only.
 */
export const CUT_WITHIN = 0.25;
export const CUT_FANS_ABOVE = 0.1;
export const CUT_KINKS_LEAST = 0.5;

/** Whether a figure lies in its band; a figure with no band is not judged by it. */
export function inBand(figure: Figure): boolean | null {
	if (!figure.band) return null;
	const { min, max } = figure.band;
	return (min === null || figure.value >= min) && (max === null || figure.value <= max);
}

/** What the tool reads of a run to write its verdict. */
export interface VerdictInput {
	readonly species: string;
	readonly run: string;
	readonly commit: string;
	readonly dirty: boolean;
	readonly seed: number;
	readonly variant: number;
	readonly preset: string;
	readonly coverage: Pick<Coverage, 'complete' | 'compared' | 'inUse'> &
		Partial<Pick<Coverage, 'drawn'>>;
	/** The set's stills and texture sources, and each one's comparison. */
	readonly slots: readonly Slot[];
	readonly stills: ReadonlyMap<string, StillResult>;
	/** The species' pictures that a ruling takes out of their rows or of their outline figures. */
	readonly rulings?: readonly PictureRuling[];
	/** The run's picture of the wood alone, which rows 1 to 3 are judged on, where it drew one. */
	readonly skeleton?: string;
	/**
	 * The whole-plant turning video's crown box spread at the standard's eight angles, with the
	 * band its growth form takes and the sheets that show it, where the run compared the video.
	 */
	readonly turn?: {
		readonly video: string;
		readonly reference: { readonly width: number; readonly height: number };
		readonly render: { readonly width: number; readonly height: number };
		readonly band: number;
		readonly sheets: readonly string[];
	};
}

/** The rows judged on the picture of the wood alone, beside their reference pictures. */
const SKELETON_ROWS: ReadonlySet<number> = new Set([1, 2, 3]);

/**
 * The balance as the tool can write it: the render's spread in width and in height against the
 * band, which the reference's own spread widens. A spread outside its band fails the balance,
 * since the figure is the rule; a spread inside it waits for a reviewer, who looks at the turn.
 */
function toolBalance(input: VerdictInput): Balance {
	const turn = input.turn;
	if (!turn) return { verdict: 'unjudged', judge: null, evidence: [], figures: [] };
	const figure = (side: 'width' | 'height'): Figure => ({
		name: `crown box ${side} spread over eight angles`,
		picture: turn.video,
		run: input.run,
		value: turn.render[side],
		reference: turn.reference[side],
		band: { min: null, max: rounded(Math.max(turn.band, turn.reference[side])) },
	});
	const figures = [figure('width'), figure('height')];
	const outside = figures.filter((entry) => inBand(entry) === false);
	const base = { evidence: turn.sheets, figures };
	return outside.length === 0
		? { ...base, verdict: 'unjudged', judge: null }
		: {
				...base,
				verdict: 'fail',
				judge: 'tool',
				reason: outside
					.map((entry) => `${entry.name} ${entry.value} above ${entry.band?.max}`)
					.join('; '),
			};
}

/** A number rounded to four places, as the metrics keep it. */
function rounded(value: number): number {
	return Number(value.toFixed(4));
}

/** The figures a picture gives a row, where the row has figures. */
function figuresOf(row: number, pair: StillResult, run: string): Figure[] {
	const base = { picture: pair.file, run, ...(pair.level !== undefined && { level: pair.level }) };
	switch (row) {
		case 2: {
			// A cut branch's density, where the run measured it on both pictures of the piece. A
			// figure that either picture could not give is left out. The wood per tip and the kinks
			// are read on bare wood only: on a piece in leaf, a leaf across a stem makes false tips
			// and a straight twig passes the kinks, so neither is quoted there.
			const cut = pair.cutBranch;
			if (!cut?.reference || !cut.render) return [];
			const { reference, render } = cut;
			const both = (
				name: keyof typeof reference,
				band: (reference: number) => Band,
				label: string,
				bareOnly = false,
			): Figure[] => {
				const [value, against] = [render[name], reference[name]];
				if (value === null || against === null || (bareOnly && !cut.bare)) return [];
				return [{ ...base, name: label, value, reference: against, band: band(against) }];
			};
			const within = (against: number): Band => ({
				min: rounded(against * (1 - CUT_WITHIN)),
				max: rounded(against * (1 + CUT_WITHIN)),
			});
			return [
				...both('woodPerTip', within, 'cut branch wood per tip', true),
				...both('tipsPerArea', within, 'cut branch tips per area'),
				...both(
					'fanShare',
					(against) => ({ min: null, max: rounded(against + CUT_FANS_ABOVE) }),
					'cut branch share of fan joints',
				),
				...both(
					'kinks',
					(against) => ({ min: rounded(against * CUT_KINKS_LEAST), max: null }),
					'cut branch kinks',
					true,
				),
			];
		}
		case 4:
			return pair.shapeIou === null
				? []
				: [{ ...base, name: 'leaf outline overlap', value: pair.shapeIou, band: null }];
		case 6: {
			// The sky seen through the crown: the gap enclosed by the plant's own outline, read on the
			// matte. The crown box's sky share is not this figure: on a plant that does not fill its
			// box by shape, such as a spire or a cone, it measures the taper.
			if (!pair.gap) return [];
			// The matte's gap, or the colour still's where the two part by more than the colour band.
			const read = rowGap(pair.gap);
			return pair.gap
				? [
						{
							...base,
							name:
								read.read === 'matte'
									? 'sky gap enclosed by the crown outline'
									: 'sky gap enclosed by the crown outline, read on the colour still',
							value: read.value,
							reference: pair.gap.reference,
							band: {
								min: rounded(pair.gap.reference - GAP_BELOW),
								max: rounded(pair.gap.reference + GAP_ABOVE),
							},
						},
					]
				: [];
		}
		case 8: {
			const value = pair.surfaceDeltaE ?? pair.barkDeltaE;
			return value === null
				? []
				: [
						{
							...base,
							name: 'bark color difference',
							value,
							band: { min: null, max: COLOUR_MOST },
						},
					];
		}
		case 9:
			return pair.crownBox
				? [
						{
							...base,
							name: 'crown width over height',
							value: rounded(pair.crownBox.render.width / pair.crownBox.render.height),
							reference: rounded(pair.crownBox.reference.width / pair.crownBox.reference.height),
							band: null,
						},
					]
				: [];
		case 10:
			return pair.foliageDeltaE === null
				? []
				: [
						{
							...base,
							name: 'foliage color difference',
							value: pair.foliageDeltaE,
							band: { min: null, max: COLOUR_MOST },
						},
					];
		default:
			return [];
	}
}

/**
 * The rows whose figures all carry a band the standard states, so the tool can say whether they
 * hold it. Row 2 holds a cut branch's four figures with their bands beside the limb count, which
 * the reviewer makes.
 */
const FIGURE_ROWS: ReadonlySet<number> = new Set([6, 8, 10]);

/**
 * A run's verdict as the tool can write it. Every row gets its evidence pictures and its figures.
 * The tool passes no row: a row whose figures all carry a stated band gets a proposal, in band or
 * out of band, and waits for a reviewer with every other row. Row 12 fails where a picture draws a
 * piece that hangs free, since that fault needs no eye. A row whose pictures all show no subject
 * is void.
 */
export function toolVerdict(input: VerdictInput): Verdict {
	const whole = (slot: Slot) => slot.view === 'whole' || slot.view === 'silhouette';
	const rows = ROW_NAMES.map((name, index): VerdictRow => {
		const row = index + 1;
		const numbers = ROW_PICTURES[row];
		const slots = input.slots.filter(
			(slot) =>
				numbers === undefined ||
				numbers.includes(slot.number) ||
				(WHOLE_ROWS.has(row) && whole(slot)),
		);
		const pairs: StillResult[] = [];
		const notCompared: string[] = [];
		for (const slot of slots) {
			const pair = input.stills.get(slot.file);
			if (pair && !pair.error) pairs.push(pair);
			else notCompared.push(slot.file);
		}
		// A picture the review data sets aside does not judge the primary plant.
		const setAside = pairs.flatMap((pair) =>
			pair.standing === undefined ? [] : [{ picture: pair.file, ...pair.standing }],
		);
		const judging = pairs.filter((pair) => pair.standing === undefined);
		const voids = judging.flatMap((pair) =>
			pair.void === undefined ? [] : [{ picture: pair.file, reason: pair.void }],
		);
		const outlineVoids = judging.flatMap((pair) =>
			pair.outlineVoid === undefined ? [] : [{ picture: pair.file, reason: pair.outlineVoid }],
		);
		const lacking = judging.flatMap((pair) =>
			pair.lacks === undefined ? [] : [{ picture: pair.file, reason: pair.lacks }],
		);
		const sound = judging.filter((pair) => pair.void === undefined && pair.lacks === undefined);
		const unchecked = sound.flatMap((pair) => (pair.subjectChecked ? [] : [pair.file]));
		const evidence = [
			...judging.flatMap((pair) => (pair.renderFile ? [pair.renderFile] : [])),
			...(SKELETON_ROWS.has(row) && input.skeleton !== undefined ? [input.skeleton] : []),
		];
		const figures = sound.flatMap((pair) => figuresOf(row, pair, input.run));
		const base = {
			row,
			name,
			evidence,
			figures,
			...(notCompared.length > 0 && { notCompared }),
			...(voids.length > 0 && { voids }),
			...(unchecked.length > 0 && { unchecked }),
			...(lacking.length > 0 && { lacking }),
			...(setAside.length > 0 && { setAside }),
			...(outlineVoids.length > 0 && { outlineVoids }),
		};
		// A part the photograph shows and the plant does not have fails the rows its picture carries.
		if (lacking.length > 0)
			return {
				...base,
				verdict: 'fail',
				judge: 'tool',
				reason: lacking.map((entry) => `${entry.picture}: ${entry.reason}`).join('; '),
			};
		if (judging.length > 0 && sound.length === 0)
			return {
				...base,
				verdict: 'void',
				judge: 'tool',
				reason: 'every picture of this row shows no subject',
			};
		if (row === 12) {
			const floating = sound.filter((pair) => (pair.connectivity?.floating.length ?? 0) > 0);
			if (floating.length > 0)
				return {
					...base,
					verdict: 'fail',
					judge: 'tool',
					reason: `a piece hangs free in ${floating.map((pair) => pair.file).join(', ')}`,
				};
		}
		if (!FIGURE_ROWS.has(row) || figures.length === 0)
			return { ...base, verdict: 'unjudged', judge: null };
		const outside = figures.filter((figure) => inBand(figure) === false);
		return {
			...base,
			verdict: 'unjudged',
			judge: null,
			proposed:
				outside.length === 0
					? { figures: 'in band' }
					: {
							figures: 'out of band',
							outside: outside
								.map(
									(figure) =>
										`${figure.picture}: ${figure.name} ${figure.value} outside ${figure.band?.min ?? 'any'} to ${figure.band?.max ?? 'any'}`,
								)
								.join('; '),
						},
		};
	});
	return {
		schema: VERDICT_SCHEMA,
		species: input.species,
		run: input.run,
		commit: input.commit,
		dirty: input.dirty,
		seed: input.seed,
		variant: input.variant,
		preset: input.preset,
		coverage: {
			complete: input.coverage.complete,
			compared: input.coverage.compared,
			inUse: input.coverage.inUse,
			...(input.coverage.drawn &&
				input.coverage.drawn.length > 0 && { drawn: input.coverage.drawn }),
		},
		balance: toolBalance(input),
		...(input.rulings && input.rulings.length > 0 && { rulings: input.rulings }),
		rows,
	};
}

/**
 * A fresh tool verdict laid over the run's existing one: a row a reviewer judged keeps the
 * reviewer's verdict, reason and neighbour, and takes the fresh evidence, figures and void
 * pictures, so comparing a run again never loses a reviewer's reading. A file of another run is
 * refused, since its judgements belong to other pictures.
 */
export function mergeVerdict(existing: Verdict, fresh: Verdict): Verdict {
	if (existing.run !== fresh.run || existing.commit !== fresh.commit)
		throw new Error(
			`the verdict file holds run ${existing.run} at ${existing.commit}, not ${fresh.run} at ${fresh.commit}: move it away before this run writes its own`,
		);
	const judged = new Map(
		existing.rows.filter((row) => row.judge === 'reviewer').map((row) => [row.row, row]),
	);
	return {
		...fresh,
		rows: fresh.rows.map((row) => {
			const kept = judged.get(row.row);
			if (!kept) return row;
			const { verdict, judge, reason, neighbour, review } = kept;
			const { reason: _reason, neighbour: _neighbour, ...rest } = row;
			return {
				...rest,
				verdict,
				judge,
				...(reason !== undefined && { reason }),
				...(neighbour !== undefined && { neighbour }),
				...(review !== undefined && { review }),
			};
		}),
		// A reviewer's reading of the balance is kept as a reviewer's row is, with the fresh figures.
		balance:
			existing.balance?.judge === 'reviewer'
				? {
						...fresh.balance,
						verdict: existing.balance.verdict,
						judge: 'reviewer',
						...(existing.balance.reason !== undefined && { reason: existing.balance.reason }),
						...(existing.balance.review !== undefined && { review: existing.balance.review }),
					}
				: fresh.balance,
	};
}

/** Whether a render's path in the run folder is the render of a reference picture. */
function sameStill(path: string, picture: string): boolean {
	return path.endsWith(`/${picture.replace(/\.\w+$/, '')}.png`);
}

/** What a pass lacks of the entry that makes it a reviewer's: a reason, a name, a day and a review file. */
function passFaults(
	at: string,
	entry: { readonly reason?: string; readonly review?: Review },
): string[] {
	const faults: string[] = [];
	if (!entry.reason) faults.push(`${at} passes and gives no reason`);
	const review = entry.review;
	if (!review?.reviewer) faults.push(`${at} passes and names no reviewer`);
	if (!review?.date || !/^\d{4}-\d{2}-\d{2}$/.test(review.date))
		faults.push(`${at} passes with no day of review, as year, month and day`);
	if (!review?.file) faults.push(`${at} passes and names no review file`);
	return faults;
}

/**
 * What is wrong with a verdict, one line each; none for a sound one. A verdict is unsound when a
 * row is missing or repeated, a judgement lacks its judge or its reason, a figure names another run
 * than the file's, a pass is the tool's or rests on nothing, or a picture's path leaves the run
 * folder.
 */
export function verdictFaults(value: unknown): string[] {
	const verdict = value as Partial<Verdict> | null;
	if (!verdict || typeof verdict !== 'object') return ['the file holds no verdict'];
	const faults: string[] = [];
	if (verdict.schema !== VERDICT_SCHEMA)
		faults.push(`its format is ${String(verdict.schema)}, not ${VERDICT_SCHEMA}`);
	for (const field of ['species', 'run', 'commit'] as const)
		if (typeof verdict[field] !== 'string' || verdict[field] === '')
			faults.push(`it names no ${field}`);
	if (
		!verdict.coverage ||
		typeof verdict.coverage.complete !== 'boolean' ||
		typeof verdict.coverage.compared !== 'number' ||
		typeof verdict.coverage.inUse !== 'number'
	)
		faults.push('it states no coverage');
	const balance = verdict.balance;
	if (!balance || !ROW_VERDICTS.includes(balance.verdict)) faults.push('it holds no balance entry');
	else {
		if (balance.verdict !== 'unjudged' && balance.judge !== 'tool' && balance.judge !== 'reviewer')
			faults.push(`the balance is judged ${balance.verdict} and names no judge`);
		if ((balance.verdict === 'fail' || balance.verdict === 'void') && !balance.reason)
			faults.push(`the balance is ${balance.verdict} and gives no reason`);
		if (balance.verdict === 'pass') {
			if (balance.judge === 'tool')
				faults.push('the balance is passed by the tool: only a reviewer passes it');
			faults.push(...passFaults('the balance', balance));
			if ((balance.figures ?? []).length === 0)
				faults.push('the balance passes on no turning video');
		}
		for (const figure of balance.figures ?? [])
			if (figure.run !== verdict.run)
				faults.push(
					`the balance quotes ${figure.name} from run ${String(figure.run)}, not the file's run ${String(verdict.run)}`,
				);
	}
	const rows = Array.isArray(verdict.rows) ? (verdict.rows as readonly VerdictRow[]) : [];
	for (let row = 1; row <= ROW_NAMES.length; row++) {
		const found = rows.filter((entry) => entry?.row === row);
		if (found.length === 0) faults.push(`row ${row} is missing`);
		if (found.length > 1) faults.push(`row ${row} appears ${found.length} times`);
	}
	for (const entry of rows) {
		if (!entry || typeof entry.row !== 'number') {
			faults.push('a row has no number');
			continue;
		}
		const at = `row ${entry.row}`;
		if (!Number.isInteger(entry.row) || entry.row < 1 || entry.row > ROW_NAMES.length) {
			faults.push(`${at} is not one of the twelve rows`);
			continue;
		}
		if (!ROW_VERDICTS.includes(entry.verdict)) {
			faults.push(`${at} has the verdict ${String(entry.verdict)}`);
			continue;
		}
		const judged = entry.verdict !== 'unjudged';
		if (judged && entry.judge !== 'tool' && entry.judge !== 'reviewer')
			faults.push(`${at} is judged ${entry.verdict} and names no judge`);
		if (!judged && entry.judge !== null) faults.push(`${at} is unjudged and names a judge`);
		if ((entry.verdict === 'fail' || entry.verdict === 'void') && !entry.reason)
			faults.push(`${at} is ${entry.verdict} and gives no reason`);
		const evidence = Array.isArray(entry.evidence) ? entry.evidence : [];
		const figures = Array.isArray(entry.figures) ? entry.figures : [];
		for (const path of evidence)
			if (typeof path !== 'string' || path.startsWith('/') || path.split('/').includes('..'))
				faults.push(`${at} names the picture ${String(path)}, which is not inside the run folder`);
		for (const figure of figures)
			if (figure.run !== verdict.run)
				faults.push(
					`${at} quotes ${figure.name} of ${figure.picture} from run ${String(figure.run)}, not the file's run ${String(verdict.run)}`,
				);
		if (entry.verdict === 'pass') {
			faults.push(...passFaults(at, entry));
			const taken = [
				...(entry.voids ?? []).map((item) => item.picture),
				...(entry.unchecked ?? []),
			];
			if (
				(entry.unchecked?.length ?? 0) > 0 &&
				evidence.every((path) => taken.some((picture) => sameStill(path, picture)))
			)
				faults.push(`${at} passes on pictures whose subject no check confirmed`);
			if (SKELETON_ROWS.has(entry.row) && !evidence.some((path) => path.includes('skeleton')))
				faults.push(
					`${at} passes without the picture of the wood alone, which the row is judged on`,
				);
			if ((entry.lacking?.length ?? 0) > 0)
				faults.push(`${at} passes though the plant lacks a part its photograph shows`);
			if (evidence.length === 0) faults.push(`${at} passes on no picture`);
			if (entry.voids && entry.voids.length >= evidence.length && evidence.length > 0)
				faults.push(`${at} passes though every picture it names shows no subject`);
			if (entry.judge === 'tool')
				faults.push(`${at} is passed by the tool: only a reviewer passes a row`);
			// The eye may overrule a figure, and then the reviewer says so.
			if (
				entry.judge === 'reviewer' &&
				!entry.reason &&
				figures.some((figure) => inBand(figure) === false)
			)
				faults.push(
					`${at} is passed by a reviewer against a figure outside its band, and gives no reason`,
				);
			if (entry.row === 11 && !entry.neighbour)
				faults.push(`${at} passes and names no built neighbour`);
		}
	}
	return faults;
}
