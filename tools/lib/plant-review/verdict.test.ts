// A run's verdict file: what the tool writes of the twelve rows, what a reviewer's rows keep when a
// run is compared again, and what makes a verdict unsound.
import { describe, expect, test } from 'bun:test';
import type { StillResult } from './compare.ts';
import type { Slot } from './references.ts';
import {
	inBand,
	mergeVerdict,
	ROW_NAMES,
	toolVerdict,
	VERDICT_SCHEMA,
	type Verdict,
	type VerdictInput,
	type VerdictRow,
	verdictFaults,
} from './verdict.ts';

/** A reference slot of a number, at a view. */
function slot(number: number, name: string, view: Slot['view']): Slot {
	const file = `${String(number).padStart(2, '0')}-${name}.png`;
	return { file, number, name, kind: 'still', view, background: 'sky-meadow', framed: false };
}

/** A still's comparison with no figure, which a test fills. */
function pair(file: string, over: Partial<StillResult> = {}): StillResult {
	return {
		reference: file,
		render: `stills/${file}`,
		shapeIou: null,
		frameIou: null,
		profileError: null,
		gap: null,
		crownBoxGap: null,
		frameGap: null,
		foliageDeltaE: null,
		barkDeltaE: null,
		crownBox: null,
		foliage: { reference: null, render: null },
		file,
		kind: 'still',
		view: 'whole',
		renderFile: `stills/${file}`,
		masked: false,
		surfaceDeltaE: null,
		barkColour: null,
		edgeDifference: null,
		pieces: null,
		connectivity: null,
		...over,
	};
}

const SLOTS: Slot[] = [
	slot(1, 'whole-distant', 'whole'),
	slot(2, 'whole-profile', 'whole'),
	slot(7, 'limb-leaving-trunk', 'junction'),
	slot(8, 'limb-fork', 'fork'),
	slot(12, 'single-leaf-upper', 'leaf-upper'),
	slot(15, 'bark-mid-trunk', 'bark-mid'),
	slot(18, 'silhouette', 'silhouette'),
	slot(30, 'woodland-form-whole', 'whole'),
];

/** A run of the oak with sound whole views, a void fork and a bark close view. */
function input(over: Partial<Record<string, Partial<StillResult>>> = {}): VerdictInput {
	const whole = {
		gap: { reference: 0.1, render: 0.12 },
		crownBox: { reference: { width: 500, height: 250 }, render: { width: 480, height: 260 } },
		foliageDeltaE: 2.1,
		masked: true,
	};
	const results: Record<string, Partial<StillResult>> = {
		'01-whole-distant.png': whole,
		'02-whole-profile.png': { ...whole, gap: { reference: 0.2, render: 0.19 } },
		'07-limb-leaving-trunk.png': { view: 'junction' },
		'08-limb-fork.png': { view: 'fork', void: 'the view has no subject: no limb divides' },
		'12-single-leaf-upper.png': { view: 'leaf-upper', shapeIou: 0.84, masked: true },
		'15-bark-mid-trunk.png': { view: 'bark-mid', barkDeltaE: 2.4 },
		'18-silhouette.png': { ...whole, view: 'silhouette', foliageDeltaE: null },
		'30-woodland-form-whole.png': { ...whole, gap: { reference: 0.3, render: 0.31 } },
		...over,
	};
	return {
		species: 'pedunculate-oak',
		run: 'oak-run-1',
		commit: 'f1e060d9f0000000000000000000000000000000',
		dirty: false,
		seed: 11,
		variant: 0,
		preset: 'high',
		coverage: { complete: false, compared: 7, inUse: 8 },
		slots: SLOTS,
		stills: new Map(
			SLOTS.map((s) => [s.file, pair(s.file, results[s.file] as Partial<StillResult>)]),
		),
	};
}

/** A row of a verdict by its number. */
function rowOf(verdict: Verdict, row: number): VerdictRow {
	return verdict.rows.find((entry) => entry.row === row) as VerdictRow;
}

describe("the tool's verdict of a run", () => {
	const verdict = toolVerdict(input());

	test('names the run, its commit and all twelve rows, and is sound', () => {
		expect(verdict.schema).toBe(VERDICT_SCHEMA);
		expect(verdict.run).toBe('oak-run-1');
		expect(verdict.rows.map((row) => row.row)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
		expect(verdict.rows.map((row) => row.name)).toEqual([...ROW_NAMES]);
		expect(verdict.coverage).toEqual({ complete: false, compared: 7, inUse: 8 });
		expect(verdictFaults(verdict)).toEqual([]);
	});

	test('passes row 6 on the sky gap of every whole view, each inside its band', () => {
		const row = rowOf(verdict, 6);
		expect(row.verdict).toBe('pass');
		expect(row.judge).toBe('tool');
		// The two numbered whole views, the silhouette and the other whole view of the set.
		expect(row.figures.map((figure) => figure.picture)).toEqual([
			'01-whole-distant.png',
			'02-whole-profile.png',
			'18-silhouette.png',
			'30-woodland-form-whole.png',
		]);
		expect(row.figures[0]).toEqual({
			picture: '01-whole-distant.png',
			run: 'oak-run-1',
			name: 'sky gap through the crown',
			value: 0.12,
			reference: 0.1,
			band: { min: 0.08, max: 0.15 },
		});
		expect(row.evidence).toContain('stills/01-whole-distant.png');
	});

	test('fails row 6 when one view is more open or more closed than its band, and says which', () => {
		const open = toolVerdict(
			input({ '02-whole-profile.png': { gap: { reference: 0.2, render: 0.26 }, masked: true } }),
		);
		expect(rowOf(open, 6).verdict).toBe('fail');
		expect(rowOf(open, 6).reason).toBe(
			'02-whole-profile.png: sky gap through the crown 0.26 outside 0.18 to 0.25',
		);
		const closed = toolVerdict(
			input({ '02-whole-profile.png': { gap: { reference: 0.2, render: 0.17 }, masked: true } }),
		);
		expect(rowOf(closed, 6).verdict).toBe('fail');
	});

	test('passes the color rows at three steps or fewer, and fails them above', () => {
		expect(rowOf(verdict, 10).verdict).toBe('pass');
		expect(rowOf(verdict, 10).figures.length).toBe(2);
		expect(rowOf(verdict, 8).verdict).toBe('pass');
		const off = toolVerdict(input({ '15-bark-mid-trunk.png': { barkDeltaE: 10.5 } }));
		expect(rowOf(off, 8).verdict).toBe('fail');
		expect(rowOf(off, 8).reason).toContain('bark color difference 10.5 outside any to 3');
	});

	test('leaves a row unjudged where the standard states no band, with its figures', () => {
		const leaf = rowOf(verdict, 4);
		expect(leaf.verdict).toBe('unjudged');
		expect(leaf.judge).toBe(null);
		expect(leaf.figures).toEqual([
			{
				picture: '12-single-leaf-upper.png',
				run: 'oak-run-1',
				name: 'leaf outline overlap',
				value: 0.84,
				band: null,
			},
		]);
		expect(inBand(leaf.figures[0] as (typeof leaf.figures)[number])).toBe(null);
		expect(rowOf(verdict, 9).verdict).toBe('unjudged');
		expect(rowOf(verdict, 9).figures[0]?.value).toBeCloseTo(480 / 260, 4);
		// The rows the eye judges wait for a reviewer, with their pictures named.
		expect(rowOf(verdict, 1).verdict).toBe('unjudged');
		expect(rowOf(verdict, 1).evidence).toEqual([
			'stills/01-whole-distant.png',
			'stills/02-whole-profile.png',
			'stills/18-silhouette.png',
		]);
	});

	test('names a void picture beside its row, and reads no figure from it', () => {
		const row = rowOf(verdict, 3);
		expect(row.voids).toEqual([
			{ picture: '08-limb-fork.png', reason: 'the view has no subject: no limb divides' },
		]);
		// The junction picture still stands, so the row waits for a reviewer.
		expect(row.verdict).toBe('unjudged');
		const gone = toolVerdict(
			input({
				'12-single-leaf-upper.png': { view: 'leaf-upper', void: 'the subject is not in the frame' },
			}),
		);
		expect(rowOf(gone, 4)).toMatchObject({
			verdict: 'void',
			judge: 'tool',
			figures: [],
			reason: 'every picture of this row shows no subject',
		});
		expect(verdictFaults(gone)).toEqual([]);
	});

	test('fails row 12 where a picture draws a piece that hangs free', () => {
		expect(rowOf(verdict, 12).verdict).toBe('unjudged');
		// Row 12 rests on every picture of the set.
		expect(rowOf(verdict, 12).evidence.length).toBe(8);
		const loose = toolVerdict(
			input({
				'18-silhouette.png': {
					view: 'silhouette',
					connectivity: {
						components: 2,
						footRow: 600,
						groundBand: null,
						floating: [{ area: 40, box: '12x9@300,200' }],
						workWidth: null,
					},
				},
			}),
		);
		expect(rowOf(loose, 12)).toMatchObject({
			verdict: 'fail',
			judge: 'tool',
			reason: 'a piece hangs free in 18-silhouette.png',
		});
	});
});

describe("a reviewer's rows", () => {
	const fresh = toolVerdict(input());
	const judged: Verdict = {
		...fresh,
		rows: fresh.rows.map((row) =>
			row.row === 1
				? { ...row, verdict: 'fail', judge: 'reviewer', reason: 'the limbs leave too steeply' }
				: row.row === 11
					? { ...row, verdict: 'pass', judge: 'reviewer', neighbour: 'holm-oak' }
					: row,
		),
	};

	test('are sound with their reasons, and are kept when the run is compared again', () => {
		expect(verdictFaults(judged)).toEqual([]);
		const again = toolVerdict(
			input({ '01-whole-distant.png': { gap: { reference: 0.1, render: 0.3 }, masked: true } }),
		);
		const merged = mergeVerdict(judged, again);
		expect(rowOf(merged, 1)).toMatchObject({
			verdict: 'fail',
			judge: 'reviewer',
			reason: 'the limbs leave too steeply',
		});
		expect(rowOf(merged, 11).neighbour).toBe('holm-oak');
		// The tool's own rows are the fresh ones.
		expect(rowOf(merged, 6).verdict).toBe('fail');
	});

	test('are not carried to another run, whose pictures they never saw', () => {
		const other = toolVerdict({ ...input(), run: 'oak-run-2' });
		expect(() => mergeVerdict(judged, other)).toThrow('the verdict file holds run oak-run-1');
	});
});

describe('an unsound verdict', () => {
	const sound = toolVerdict(input());
	const withRow = (row: number, over: Partial<VerdictRow>): Verdict => ({
		...sound,
		rows: sound.rows.map((entry) => (entry.row === row ? { ...entry, ...over } : entry)),
	});

	test('lacks a row, or holds one twice', () => {
		const short = { ...sound, rows: sound.rows.filter((row) => row.row !== 7) };
		expect(verdictFaults(short)).toEqual(['row 7 is missing']);
		const twice = { ...sound, rows: [...sound.rows, rowOf(sound, 3)] };
		expect(verdictFaults(twice)).toEqual(['row 3 appears 2 times']);
	});

	test('quotes a figure from another run than its own', () => {
		const row = rowOf(sound, 6);
		const borrowed = withRow(6, {
			figures: [{ ...(row.figures[0] as (typeof row.figures)[number]), run: 'oak-run-0' }],
		});
		expect(verdictFaults(borrowed)).toEqual([
			"row 6 quotes sky gap through the crown of 01-whole-distant.png from run oak-run-0, not the file's run oak-run-1",
		]);
	});

	test('judges a row with no judge, or fails one with no reason', () => {
		expect(verdictFaults(withRow(1, { verdict: 'pass', judge: null }))).toEqual([
			'row 1 is judged pass and names no judge',
		]);
		expect(verdictFaults(withRow(1, { verdict: 'fail', judge: 'reviewer' }))).toEqual([
			'row 1 is fail and gives no reason',
		]);
		expect(verdictFaults(withRow(1, { verdict: 'unjudged', judge: 'reviewer' }))).toEqual([
			'row 1 is unjudged and names a judge',
		]);
		expect(verdictFaults(withRow(1, { verdict: 'maybe' as never }))).toEqual([
			'row 1 has the verdict maybe',
		]);
	});

	test('passes a row on nothing, on void pictures, or against a figure', () => {
		expect(verdictFaults(withRow(5, { verdict: 'pass', judge: 'reviewer' }))).toEqual([
			'row 5 passes on no picture',
		]);
		const voided = withRow(4, {
			verdict: 'pass',
			judge: 'reviewer',
			voids: [{ picture: '12-single-leaf-upper.png', reason: 'no subject' }],
		});
		expect(verdictFaults(voided)).toEqual([
			'row 4 passes though every picture it names shows no subject',
		]);
		// The tool passes only on figures inside stated bands.
		expect(verdictFaults(withRow(4, { verdict: 'pass', judge: 'tool' }))).toEqual([
			'row 4 is passed by the tool though leaf outline overlap of 12-single-leaf-upper.png is without a band',
		]);
		const row = rowOf(sound, 10);
		const out = {
			figures: [{ ...(row.figures[0] as (typeof row.figures)[number]), value: 7 }],
		};
		expect(verdictFaults(withRow(10, { ...out, verdict: 'pass', judge: 'tool' }))).toEqual([
			'row 10 is passed by the tool though foliage color difference of 01-whole-distant.png is outside its band',
		]);
		// A reviewer may overrule the figure, and says why.
		expect(verdictFaults(withRow(10, { ...out, verdict: 'pass', judge: 'reviewer' }))).toEqual([
			'row 10 is passed by a reviewer against a figure outside its band, and gives no reason',
		]);
		expect(
			verdictFaults(
				withRow(10, { ...out, verdict: 'pass', judge: 'reviewer', reason: 'the light differs' }),
			),
		).toEqual([]);
	});

	test('passes row 11 with no built neighbour named', () => {
		expect(verdictFaults(withRow(11, { verdict: 'pass', judge: 'reviewer' }))).toEqual([
			'row 11 passes and names no built neighbour',
		]);
	});

	test('names a picture outside its run folder, or is no verdict at all', () => {
		expect(verdictFaults(withRow(2, { evidence: ['../other-run/stills/01.png'] }))).toEqual([
			'row 2 names the picture ../other-run/stills/01.png, which is not inside the run folder',
		]);
		expect(verdictFaults(null)).toEqual(['the file holds no verdict']);
		expect(verdictFaults({ schema: 'x', rows: [] }).slice(0, 2)).toEqual([
			`its format is x, not ${VERDICT_SCHEMA}`,
			'it names no species',
		]);
	});
});
