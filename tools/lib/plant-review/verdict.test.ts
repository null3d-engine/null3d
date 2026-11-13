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
		subjectChecked: true,
		...over,
	};
}

/** A reviewer's pass, with all that makes it one. */
const PASS = {
	verdict: 'pass',
	judge: 'reviewer',
	reason: 'read beside its pictures',
	review: { reviewer: 'a reviewer', date: '2026-11-13', file: 'review.md' },
} as const;

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
		skeleton: 'views/skeleton.png',
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

	test('proposes row 6 from the sky gap of every whole view, and leaves the pass to a reviewer', () => {
		const row = rowOf(verdict, 6);
		expect(row.verdict).toBe('unjudged');
		expect(row.judge).toBe(null);
		expect(row.proposed).toEqual({ figures: 'in band' });
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
			name: 'sky gap enclosed by the crown outline',
			value: 0.12,
			reference: 0.1,
			band: { min: 0.08, max: 0.15 },
		});
		expect(row.evidence).toContain('stills/01-whole-distant.png');
	});

	test('says which view is more open or more closed than its band, and still judges nothing', () => {
		const open = toolVerdict(
			input({ '02-whole-profile.png': { gap: { reference: 0.2, render: 0.26 }, masked: true } }),
		);
		expect(rowOf(open, 6).verdict).toBe('unjudged');
		expect(rowOf(open, 6).proposed).toEqual({
			figures: 'out of band',
			outside:
				'02-whole-profile.png: sky gap enclosed by the crown outline 0.26 outside 0.18 to 0.25',
		});
		const closed = toolVerdict(
			input({ '02-whole-profile.png': { gap: { reference: 0.2, render: 0.17 }, masked: true } }),
		);
		expect(rowOf(closed, 6).proposed?.figures).toBe('out of band');
		expect(verdictFaults(open)).toEqual([]);
	});

	test('proposes the color rows in band at three steps or fewer, and out of band above', () => {
		expect(rowOf(verdict, 10).proposed).toEqual({ figures: 'in band' });
		expect(rowOf(verdict, 10).figures.length).toBe(2);
		expect(rowOf(verdict, 8).proposed).toEqual({ figures: 'in band' });
		const off = toolVerdict(input({ '15-bark-mid-trunk.png': { barkDeltaE: 10.5 } }));
		expect(rowOf(off, 8).verdict).toBe('unjudged');
		expect(rowOf(off, 8).proposed?.outside).toContain(
			'bark color difference 10.5 outside any to 3',
		);
		// No row of a tool's verdict passes.
		expect(verdict.rows.filter((row) => row.verdict === 'pass')).toEqual([]);
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
			'views/skeleton.png',
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

describe('the pictures a verdict keeps apart', () => {
	test('sets a second form aside: it is no evidence, and its figures judge nothing', () => {
		// The woodland form's whole view is far more open than its band allows.
		const verdict = toolVerdict(
			input({
				'30-woodland-form-whole.png': {
					gap: { reference: 0.3, render: 0.6 },
					masked: true,
					standing: { kind: 'second-form', reason: 'a named second form' },
				},
			}),
		);
		const row = rowOf(verdict, 6);
		expect(row.proposed).toEqual({ figures: 'in band' });
		expect(row.figures.map((figure) => figure.picture)).not.toContain('30-woodland-form-whole.png');
		expect(row.evidence).not.toContain('stills/30-woodland-form-whole.png');
		expect(row.setAside).toEqual([
			{ picture: '30-woodland-form-whole.png', kind: 'second-form', reason: 'a named second form' },
		]);
		expect(verdictFaults(verdict)).toEqual([]);
	});

	test('names a picture whose outline cannot be read, and reads no outline figure from it', () => {
		const verdict = toolVerdict(
			input({
				'01-whole-distant.png': {
					gap: null,
					crownBox: null,
					foliageDeltaE: 2.1,
					outlineVoid: 'the far bank joins the outline',
				},
			}),
		);
		const row = rowOf(verdict, 6);
		expect(row.outlineVoids).toEqual([
			{ picture: '01-whole-distant.png', reason: 'the far bank joins the outline' },
		]);
		expect(row.figures.map((figure) => figure.picture)).not.toContain('01-whole-distant.png');
		// Its color still judges row 10.
		expect(rowOf(verdict, 10).figures.map((figure) => figure.picture)).toContain(
			'01-whole-distant.png',
		);
	});

	test("holds a cut branch's four figures on row 2, each with the band the standard gives", () => {
		const slots = [...SLOTS, slot(21, 'branch-studio', 'branch')];
		const base = input();
		const stills = new Map(base.stills);
		stills.set(
			'21-branch-studio.png',
			pair('21-branch-studio.png', {
				view: 'branch',
				cutBranch: {
					reference: { woodPerTip: 0.2, tipsPerArea: 40, fanShare: 0.1, kinks: 6 },
					render: { woodPerTip: 0.22, tipsPerArea: 55, fanShare: 0.15, kinks: 2 },
					bare: true,
				},
			}),
		);
		const row = rowOf(toolVerdict({ ...base, slots, stills }), 2);
		expect(row.figures.map((figure) => [figure.name, figure.value, figure.band])).toEqual([
			['cut branch wood per tip', 0.22, { min: 0.15, max: 0.25 }],
			['cut branch tips per area', 55, { min: 30, max: 50 }],
			['cut branch share of fan joints', 0.15, { min: null, max: 0.2 }],
			['cut branch kinks', 2, { min: 3, max: null }],
		]);
		expect(row.figures.map((figure) => inBand(figure))).toEqual([true, false, true, false]);
		// The reviewer judges the row: it also counts the limbs.
		expect(row.verdict).toBe('unjudged');
		// A piece in leaf quotes neither the wood per tip nor the kinks, and a figure that a picture
		// could not give is left out: here the photograph's piece has no joint.
		stills.set(
			'21-branch-studio.png',
			pair('21-branch-studio.png', {
				view: 'branch',
				cutBranch: {
					reference: { woodPerTip: 0.2, tipsPerArea: 40, fanShare: null, kinks: 6 },
					render: { woodPerTip: 0.22, tipsPerArea: 55, fanShare: 0.15, kinks: 2 },
				},
			}),
		);
		const leafy = rowOf(toolVerdict({ ...base, slots, stills }), 2);
		expect(leafy.figures.map((figure) => figure.name)).toEqual(['cut branch tips per area']);
		// A side with no measure at all gives the row no cut-branch figure.
		stills.set(
			'21-branch-studio.png',
			pair('21-branch-studio.png', {
				view: 'branch',
				cutBranch: { reference: null, render: null, bare: true },
			}),
		);
		expect(rowOf(toolVerdict({ ...base, slots, stills }), 2).figures).toEqual([]);
	});
});

describe('what the tool writes without a reviewer', () => {
	test('fails the rows of a picture whose part the plant lacks, with the reason', () => {
		const verdict = toolVerdict(
			input({
				'08-limb-fork.png': {
					view: 'fork',
					lacks: 'no limb divides into two arms of like size: 0 divisions, none even and open',
				},
			}),
		);
		// Picture 08 carries rows 3 and 7.
		for (const row of [3, 7]) {
			expect(rowOf(verdict, row)).toMatchObject({
				verdict: 'fail',
				judge: 'tool',
				reason:
					'08-limb-fork.png: no limb divides into two arms of like size: 0 divisions, none even and open',
			});
		}
		expect(rowOf(verdict, 1).verdict).toBe('unjudged');
		expect(verdictFaults(verdict)).toEqual([]);
	});

	test('names the reference pictures of a row that the run did not compare', () => {
		const verdict = toolVerdict(input({ '15-bark-mid-trunk.png': { error: 'not drawn' } }));
		expect(rowOf(verdict, 8).notCompared).toEqual(['15-bark-mid-trunk.png']);
		expect(rowOf(verdict, 8).evidence).toEqual([]);
		expect(rowOf(verdict, 6).notCompared).toBe(undefined);
	});

	test('names the pictures no subject check confirmed, and the wood alone on rows 1 to 3', () => {
		const verdict = toolVerdict(
			input({
				'12-single-leaf-upper.png': { view: 'leaf-upper', shapeIou: 0.84, subjectChecked: false },
			}),
		);
		expect(rowOf(verdict, 4).unchecked).toEqual(['12-single-leaf-upper.png']);
		expect(rowOf(verdict, 6).unchecked).toBe(undefined);
		for (const row of [1, 2, 3])
			expect(rowOf(verdict, row).evidence).toContain('views/skeleton.png');
		expect(rowOf(verdict, 4).evidence).not.toContain('views/skeleton.png');
	});

	test('fails the balance on a spread outside its band, and leaves one inside it to a reviewer', () => {
		const turn = {
			video: 'oak-turntable.mp4',
			reference: { width: 0.2, height: 0.1 },
			render: { width: 0.4, height: 0.12 },
			band: 0.25,
			sheets: ['sheet-turn-oak-turntable-01.png'],
		};
		const lopsided = toolVerdict({ ...input(), turn }).balance;
		expect(lopsided).toMatchObject({
			verdict: 'fail',
			judge: 'tool',
			reason: 'crown box width spread over eight angles 0.4 above 0.25',
			evidence: ['sheet-turn-oak-turntable-01.png'],
		});
		const even = toolVerdict({
			...input(),
			turn: { ...turn, render: { width: 0.22, height: 0.12 } },
		});
		expect(even.balance.verdict).toBe('unjudged');
		expect(even.balance.figures.length).toBe(2);
		// A reference less regular than the band sets the band.
		const wide = toolVerdict({
			...input(),
			turn: { ...turn, reference: { width: 0.45, height: 0.1 } },
		}).balance;
		expect(wide.verdict).toBe('unjudged');
		expect(wide.figures[0]?.band).toEqual({ min: null, max: 0.45 });
		// A run with no turning video compared has no balance to judge.
		expect(toolVerdict(input()).balance).toEqual({
			verdict: 'unjudged',
			judge: null,
			evidence: [],
			figures: [],
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
					? { ...row, ...PASS, neighbour: 'holm-oak' }
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
		expect(rowOf(merged, 6).proposed?.figures).toBe('out of band');
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
			"row 6 quotes sky gap enclosed by the crown outline of 01-whole-distant.png from run oak-run-0, not the file's run oak-run-1",
		]);
	});

	test('judges a row with no judge, or fails one with no reason', () => {
		expect(verdictFaults(withRow(1, { ...PASS, judge: null }))).toEqual([
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

	test('passes a row with no reason, no reviewer, no day or no review file', () => {
		expect(verdictFaults(withRow(7, { verdict: 'pass', judge: 'reviewer' }))).toEqual([
			'row 7 passes and gives no reason',
			'row 7 passes and names no reviewer',
			'row 7 passes with no day of review, as year, month and day',
			'row 7 passes and names no review file',
		]);
		expect(
			verdictFaults(withRow(7, { ...PASS, review: { ...PASS.review, date: 'yesterday' } })),
		).toEqual(['row 7 passes with no day of review, as year, month and day']);
		expect(verdictFaults(withRow(7, PASS))).toEqual([]);
	});

	test('passes a row on nothing, on void pictures, or on pictures no check confirmed', () => {
		expect(verdictFaults(withRow(5, PASS))).toEqual(['row 5 passes on no picture']);
		const voided = withRow(4, {
			...PASS,
			voids: [{ picture: '12-single-leaf-upper.png', reason: 'no subject' }],
		});
		expect(verdictFaults(voided)).toEqual([
			'row 4 passes though every picture it names shows no subject',
		]);
		// A cut piece's view has no subject check, so the row cannot pass on it alone.
		expect(verdictFaults(withRow(4, { ...PASS, unchecked: ['12-single-leaf-upper.png'] }))).toEqual(
			['row 4 passes on pictures whose subject no check confirmed'],
		);
		// The tool passes no row, whatever its figures say.
		expect(verdictFaults(withRow(10, { ...PASS, judge: 'tool' }))).toEqual([
			'row 10 is passed by the tool: only a reviewer passes a row',
		]);
	});

	test('passes rows 1 to 3 without the picture of the wood alone, or over a part the plant lacks', () => {
		const row = rowOf(sound, 1);
		const bare = row.evidence.filter((path) => !path.includes('skeleton'));
		expect(verdictFaults(withRow(1, { ...PASS, evidence: bare }))).toEqual([
			'row 1 passes without the picture of the wood alone, which the row is judged on',
		]);
		expect(
			verdictFaults(
				withRow(3, {
					...PASS,
					lacking: [{ picture: '08-limb-fork.png', reason: 'no limb divides' }],
				}),
			),
		).toEqual(['row 3 passes though the plant lacks a part its photograph shows']);
	});

	test('passes row 11 with no built neighbour named', () => {
		expect(verdictFaults(withRow(11, PASS))).toEqual([
			'row 11 passes and names no built neighbour',
		]);
	});

	test('holds no balance, or passes it without a reviewer and a turning video', () => {
		expect(verdictFaults({ ...sound, balance: undefined })).toEqual(['it holds no balance entry']);
		expect(
			verdictFaults({ ...sound, balance: { ...sound.balance, verdict: 'pass', judge: 'tool' } }),
		).toContain('the balance is passed by the tool: only a reviewer passes it');
		expect(verdictFaults({ ...sound, balance: { ...sound.balance, ...PASS } })).toEqual([
			'the balance passes on no turning video',
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
