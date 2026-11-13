// The ledger: the species by row table and its total over the standard's twenty species, counted
// from verdict files in their run folders, and what stops the count.
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ledgerOf, ledgerText, REVIEW_SPECIES, verdictPaths } from './ledger.ts';
import {
	ROW_NAMES,
	type RowVerdict,
	VERDICT_FILE,
	VERDICT_SCHEMA,
	type Verdict,
} from './verdict.ts';

const root = mkdtempSync(join(tmpdir(), 'null3d-ledger-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const COMMIT = 'abc123def4567890abc123def4567890abc123de';
const REVIEW = { reviewer: 'a reviewer', date: '2026-11-13', file: 'review.md' };

/** A sound verdict of a species whose rows take the letters of `rows`: P, F, V or a dash. */
function verdictOf(
	species: string,
	run: string,
	rows: string,
	over: Partial<Verdict> = {},
): Verdict {
	const letters: Record<string, RowVerdict> = { P: 'pass', F: 'fail', V: 'void', '-': 'unjudged' };
	return {
		schema: VERDICT_SCHEMA,
		species,
		run,
		commit: COMMIT,
		dirty: false,
		seed: 11,
		variant: 0,
		preset: 'high',
		coverage: { complete: true, compared: 30, inUse: 30 },
		balance: { verdict: 'unjudged', judge: null, evidence: [], figures: [] },
		rows: ROW_NAMES.map((name, index) => {
			const verdict = letters[rows[index] as string] as RowVerdict;
			return {
				row: index + 1,
				name,
				verdict,
				judge: verdict === 'unjudged' ? null : 'reviewer',
				evidence: ['stills/01-whole-distant.png', ...(index < 3 ? ['views/skeleton.png'] : [])],
				figures: [],
				...(verdict === 'unjudged' ? {} : { reason: 'as the picture shows' }),
				...(verdict === 'pass' ? { review: REVIEW } : {}),
				...(index === 10 && verdict === 'pass' ? { neighbour: 'holm-oak' } : {}),
			};
		}),
		...over,
	};
}

/** A run folder with its verdict, its manifest, the pictures the rows name and a review file. */
function runFolder(parent: string, verdict: Verdict, manifest: object = verdict): string {
	const folder = join(parent, verdict.run);
	mkdirSync(join(folder, 'stills'), { recursive: true });
	mkdirSync(join(folder, 'views'), { recursive: true });
	writeFileSync(join(folder, VERDICT_FILE), JSON.stringify(verdict));
	writeFileSync(join(folder, 'manifest.json'), JSON.stringify(manifest));
	writeFileSync(join(folder, 'stills/01-whole-distant.png'), '');
	writeFileSync(join(folder, 'views/skeleton.png'), '');
	writeFileSync(
		join(folder, 'review.md'),
		`${ROW_NAMES.map((name, index) => `Row ${index + 1}, ${name}: read.`).join('\n')}\nThe balance: read.\n`,
	);
	return folder;
}

/** The faults of a ledger with the scratch folder's own path taken out. */
function faultsOf(folder: string): string[] {
	return ledgerOf([folder]).faults.map((fault) => fault.replace(/^.*verdict\.json: /, ''));
}

describe('the ledger of a folder of runs', () => {
	const runs = join(root, 'sound');
	runFolder(runs, verdictOf('silver-birch', 'birch-1', 'PPF-PPVFPPPF'));
	runFolder(runs, verdictOf('pedunculate-oak', 'oak-1', 'FPPPVP--PPFF'));

	test('counts over the twenty species, so a species with no verdict is none of twelve', () => {
		const ledger = ledgerOf([runs]);
		expect(ledger.faults).toEqual([]);
		expect(ledger.species.length).toBe(20);
		expect(ledger.rows).toBe(240);
		expect(
			ledger.species.filter((line) => line.passes > 0).map((line) => [line.species, line.passes]),
		).toEqual([
			['pedunculate-oak', 6],
			['silver-birch', 7],
		]);
		// The two species' own rows, and 216 unjudged rows of the eighteen with no verdict.
		expect(ledger.totals).toEqual({ pass: 13, fail: 6, void: 2, unjudged: 3 + 216 });
		expect(ledger.complete).toBe(0);
	});

	test('prints each species with its run, and the total over 240', () => {
		const text = ledgerText(ledgerOf([runs]));
		expect(text).toContain(
			'pedunculate-oak   F  P  P  P  V  P  -  -  P  P  F  F    -     6  complete  oak-1 at abc123def',
		);
		expect(text).toContain(
			'olive             -  -  -  -  -  -  -  -  -  -  -  -    -     0  -         no verdict',
		);
		expect(text).toContain(
			'Total: 13 of 240 rows pass; 6 fail, 2 void, 219 unjudged. 0 of 20 species are done.',
		);
	});

	test('calls a species done only with twelve passes, the balance passed and every reference compared', () => {
		const folder = join(root, 'done');
		const twelve = verdictOf('olive', 'olive-1', 'P'.repeat(12));
		runFolder(folder, twelve);
		expect(ledgerOf([folder]).complete).toBe(0);
		const balanced = join(root, 'done-balanced');
		runFolder(
			balanced,
			verdictOf('olive', 'olive-2', 'P'.repeat(12), {
				balance: {
					verdict: 'pass',
					judge: 'reviewer',
					evidence: [],
					figures: [
						{
							name: 'crown box width spread over eight angles',
							picture: 'olive-turntable.mp4',
							value: 0.1,
							band: { min: null, max: 0.25 },
							run: 'olive-2',
						},
					],
					reason: 'the turn reads balanced',
					review: REVIEW,
				},
			}),
		);
		const ledger = ledgerOf([balanced]);
		expect(ledger.faults).toEqual([]);
		expect(ledger.complete).toBe(1);
	});

	test('prints the pictures taken out of each row, so none leaves without a trace', () => {
		const folder = join(root, 'taken');
		const verdict = verdictOf('olive', 'olive-3', '-'.repeat(12), {
			coverage: {
				complete: true,
				compared: 28,
				inUse: 30,
				drawn: ['07-limb-leaving-trunk.png', '17-trunk-taper.png'],
			},
			rulings: [
				{
					picture: '30-x.png',
					effect: 'second-form',
					reason: 'r',
					ruling: 'the owner ruled it a second form',
				},
			],
		});
		runFolder(folder, {
			...verdict,
			rows: verdict.rows.map((row) =>
				row.row === 3
					? {
							...row,
							voids: [{ picture: '08-limb-fork.png', reason: 'the camera missed it' }],
							unchecked: ['21-branch-studio.png', '22-subbranch-studio.png'],
						}
					: row.row === 6
						? {
								...row,
								notCompared: ['18-silhouette.png'],
								setAside: [{ picture: '30-x.png', kind: 'second-form', reason: 'r' }],
							}
						: row,
			),
		});
		expect(ledgerText(ledgerOf([folder]))).toContain(
			'pictures out of the rows: row 3: 1 void, 2 with no subject check; row 6: 1 not compared, 1 set aside',
		);
		expect(ledgerText(ledgerOf([folder]))).toContain(
			'2 drawn and not measured, for the eye: 07-limb-leaving-trunk.png, 17-trunk-taper.png',
		);
		expect(ledgerText(ledgerOf([folder]))).toContain(
			'by ruling, 30-x.png is set aside as second-form: the owner ruled it a second form',
		);
	});

	test('reads a run folder or a folder of run folders, and no verdict kept anywhere else', () => {
		expect(verdictPaths(runs).found).toEqual([
			join(runs, 'birch-1', VERDICT_FILE),
			join(runs, 'oak-1', VERDICT_FILE),
		]);
		expect(verdictPaths(join(runs, 'oak-1')).found).toEqual([join(runs, 'oak-1', VERDICT_FILE)]);
		const copies = join(root, 'copies');
		mkdirSync(copies);
		writeFileSync(
			join(copies, 'olive.json'),
			JSON.stringify(verdictOf('olive', 'olive-4', 'P'.repeat(12))),
		);
		const faults = ledgerOf([copies]).faults;
		expect(faults.length).toBe(1);
		expect(faults[0]).toContain('a verdict is read only as verdict.json in its run folder');
		expect(() => verdictPaths(join(root, 'nowhere'))).toThrow('does not exist');
	});
});

describe('a verdict written by hand to read twelve of twelve', () => {
	const pass = (over: Partial<Verdict>, name: string): string => {
		const folder = join(root, name);
		runFolder(folder, verdictOf('pedunculate-oak', `${name}-run`, 'P'.repeat(12), over));
		return folder;
	};

	test('is refused for a run that does not exist beside it', () => {
		const folder = join(root, 'no-run', 'no-such-run');
		mkdirSync(folder, { recursive: true });
		writeFileSync(
			join(folder, VERDICT_FILE),
			JSON.stringify(verdictOf('pedunculate-oak', 'no-such-run', 'P'.repeat(12))),
		);
		const faults = faultsOf(join(root, 'no-run'));
		expect(faults).toContain('its run folder holds no manifest');
		expect(faults).toContain(
			'it names the picture stills/01-whole-distant.png, which its run folder lacks',
		);
		expect(faults).toContain('row 1 names the review file review.md, which does not exist');
	});

	test('is refused for a commit that is no commit, a tree with changes and a short coverage', () => {
		expect(faultsOf(pass({ commit: '0'.repeat(40) }, 'zero'))).toContain(
			`its commit ${'0'.repeat(40)} is no commit's full name`,
		);
		expect(faultsOf(pass({ dirty: true }, 'dirty'))).toContain(
			'row 1 passes on a run drawn from a tree with changes',
		);
		expect(
			faultsOf(pass({ coverage: { complete: false, compared: 0, inUse: 30 } }, 'short')),
		).toContain('row 12 passes though the run compared 0 of 30 reference files');
	});

	test('is refused for a pass with no reason, no reviewer, no day or no review file that names the row', () => {
		const verdict = verdictOf('pedunculate-oak', 'bare-run', 'P'.repeat(12));
		const bare = {
			...verdict,
			rows: verdict.rows.map((row) => ({ ...row, reason: undefined, review: undefined })),
		};
		runFolder(join(root, 'bare'), bare as Verdict);
		const faults = faultsOf(join(root, 'bare'));
		expect(faults).toContain('row 1 passes and gives no reason');
		expect(faults).toContain('row 1 passes and names no reviewer');
		expect(faults).toContain('row 1 passes with no day of review, as year, month and day');
		expect(faults).toContain('row 1 passes and names no review file');
		// A review file that says nothing of the row does not carry its pass.
		const folder = pass({}, 'silent');
		writeFileSync(join(folder, 'silent-run', 'review.md'), 'Row 1: read.\n');
		expect(faultsOf(folder)).toContain(
			'row 2 names the review file review.md, which does not name it',
		);
	});

	test('counts when every part of the entry is there', () => {
		expect(ledgerOf([pass({}, 'whole')]).totals.pass).toBe(12);
	});
});

describe('what else stops the count', () => {
	test('a verdict with a row missing', () => {
		const folder = join(root, 'short-rows');
		const verdict = verdictOf('olive', 'olive-5', '-'.repeat(12));
		runFolder(folder, { ...verdict, rows: verdict.rows.slice(0, 11) });
		const ledger = ledgerOf([folder]);
		expect(ledger.faults.map((fault) => fault.replace(/^.*verdict\.json: /, ''))).toEqual([
			'row 12 is missing',
		]);
		expect(ledgerText(ledger)).toContain('The ledger cannot be counted: 1 fault.');
		expect(ledgerText(ledger)).not.toContain('Total:');
	});

	test('a verdict whose manifest is another run', () => {
		const folder = join(root, 'moved');
		const verdict = verdictOf('olive', 'olive-6', '-'.repeat(12));
		runFolder(folder, verdict, { ...verdict, run: 'olive-9' });
		expect(faultsOf(folder)).toEqual([
			'it names the run olive-6, and the manifest beside it names olive-9',
		]);
	});

	test('a species with two verdict files, or one outside the twenty', () => {
		const folder = join(root, 'twice');
		runFolder(folder, verdictOf('olive', 'olive-7', '-'.repeat(12)));
		runFolder(folder, verdictOf('olive', 'olive-8', 'F'.repeat(12)));
		runFolder(folder, verdictOf('monkey-puzzle', 'puzzle-1', '-'.repeat(12)));
		const faults = ledgerOf([folder]).faults;
		expect(faults.length).toBe(2);
		expect(faults[0]).toContain('olive has 2 verdict files');
		expect(faults[1]).toBe("monkey-puzzle is not one of the standard's twenty species");
		expect(REVIEW_SPECIES.length).toBe(20);
	});
});
