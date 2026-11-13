// The ledger: the species by row table and its total, counted from verdict files alone, and what
// stops the count.
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ledgerOf, ledgerText, verdictPaths } from './ledger.ts';
import {
	ROW_NAMES,
	type RowVerdict,
	VERDICT_FILE,
	VERDICT_SCHEMA,
	type Verdict,
} from './verdict.ts';

const root = mkdtempSync(join(tmpdir(), 'null3d-ledger-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** A sound verdict of a species whose rows take the letters of `rows`: P, F, V or a dash. */
function verdictOf(species: string, run: string, rows: string): Verdict {
	const letters: Record<string, RowVerdict> = { P: 'pass', F: 'fail', V: 'void', '-': 'unjudged' };
	return {
		schema: VERDICT_SCHEMA,
		species,
		run,
		commit: 'abc123def4567890',
		dirty: false,
		seed: 11,
		variant: 0,
		preset: 'high',
		coverage: { complete: true, compared: 30, inUse: 30 },
		rows: ROW_NAMES.map((name, index) => {
			const verdict = letters[rows[index] as string] as RowVerdict;
			return {
				row: index + 1,
				name,
				verdict,
				judge: verdict === 'unjudged' ? null : 'reviewer',
				evidence: ['stills/01-whole-distant.png'],
				figures: [],
				...(verdict === 'fail' || verdict === 'void' ? { reason: 'as the picture shows' } : {}),
				...(index === 10 && verdict === 'pass' ? { neighbour: 'holm-oak' } : {}),
			};
		}),
	};
}

/** A run folder under a parent, with its verdict, its manifest and the picture the rows name. */
function runFolder(parent: string, verdict: Verdict, manifest: object = verdict): string {
	const folder = join(parent, verdict.run);
	mkdirSync(join(folder, 'stills'), { recursive: true });
	writeFileSync(join(folder, VERDICT_FILE), JSON.stringify(verdict));
	writeFileSync(join(folder, 'manifest.json'), JSON.stringify(manifest));
	writeFileSync(join(folder, 'stills/01-whole-distant.png'), '');
	return folder;
}

describe('the ledger of a folder of runs', () => {
	const runs = join(root, 'sound');
	runFolder(runs, verdictOf('silver-birch', 'birch-1', 'PPF-PPVFPPPF'));
	runFolder(runs, verdictOf('pedunculate-oak', 'oak-1', 'FPPPVP--PPFF'));

	test('counts each species row by row, and the total over them', () => {
		const ledger = ledgerOf([runs]);
		expect(ledger.faults).toEqual([]);
		expect(ledger.species.map((line) => [line.species, line.passes])).toEqual([
			['pedunculate-oak', 6],
			['silver-birch', 7],
		]);
		expect(ledger.rows).toBe(24);
		expect(ledger.totals).toEqual({ pass: 13, fail: 6, void: 2, unjudged: 3 });
	});

	test('prints the table with the run and commit beside each species, and the total', () => {
		const text = ledgerText(ledgerOf([runs]));
		expect(text).toContain(
			'pedunculate-oak   F  P  P  P  V  P  -  -  P  P  F  F     6  complete  oak-1 at abc123def',
		);
		expect(text).toContain('Total: 13 of 24 rows pass over 2 species; 6 fail, 2 void, 3 unjudged.');
	});

	test('reads a verdict file, a run folder or a folder of either', () => {
		expect(verdictPaths(runs)).toEqual([
			join(runs, 'birch-1', VERDICT_FILE),
			join(runs, 'oak-1', VERDICT_FILE),
		]);
		expect(verdictPaths(join(runs, 'oak-1'))).toEqual([join(runs, 'oak-1', VERDICT_FILE)]);
		// A copy of a verdict kept apart from its run counts too, with no pictures to check.
		const copies = join(root, 'copies');
		mkdirSync(copies);
		writeFileSync(
			join(copies, 'olive.json'),
			JSON.stringify(verdictOf('olive', 'olive-4', `${'P'.repeat(10)}-P`)),
		);
		const ledger = ledgerOf([copies, join(runs, 'oak-1')]);
		expect(ledger.faults).toEqual([]);
		expect(ledger.totals.pass).toBe(11 + 6);
		expect(() => verdictPaths(join(root, 'nowhere'))).toThrow('does not exist');
	});

	test('holds exactly the species asked for', () => {
		const ledger = ledgerOf([runs], ['pedunculate-oak', 'olive']);
		expect(ledger.faults).toEqual([
			'olive has no verdict file',
			'silver-birch is not one of the species asked for',
		]);
		expect(ledgerOf([runs], ['pedunculate-oak', 'silver-birch']).faults).toEqual([]);
	});
});

describe('what stops the count', () => {
	test('a verdict with a row missing', () => {
		const folder = join(root, 'short');
		const verdict = verdictOf('olive', 'olive-1', `${'P'.repeat(10)}-P`);
		runFolder(folder, { ...verdict, rows: verdict.rows.slice(0, 11) });
		const ledger = ledgerOf([folder]);
		expect(ledger.faults).toEqual([`${join(folder, 'olive-1', VERDICT_FILE)}: row 12 is missing`]);
		// A ledger with a fault prints the fault and no total.
		expect(ledgerText(ledger)).toContain('The ledger cannot be counted: 1 fault.');
		expect(ledgerText(ledger)).not.toContain('Total:');
	});

	test('a verdict whose run folder is another run, or lacks a picture it names', () => {
		const folder = join(root, 'moved');
		const verdict = verdictOf('olive', 'olive-2', `${'P'.repeat(10)}-P`);
		const run = runFolder(folder, verdict, { ...verdict, run: 'olive-9', commit: 'fff000' });
		rmSync(join(run, 'stills/01-whole-distant.png'));
		const faults = ledgerOf([folder]).faults;
		expect(faults[0]).toBe(
			`${join(run, VERDICT_FILE)}: it names the run olive-2, and the manifest beside it names olive-9`,
		);
		expect(faults[1]).toContain('it names the commit abc123def4567890');
		expect(faults[2]).toBe(
			`${join(run, VERDICT_FILE)}: row 1 names the picture stills/01-whole-distant.png, which its run folder lacks`,
		);
	});

	test('a species with two verdict files, whose rows would count twice', () => {
		const folder = join(root, 'twice');
		runFolder(folder, verdictOf('olive', 'olive-3', `${'P'.repeat(10)}-P`));
		runFolder(folder, verdictOf('olive', 'olive-4', 'F'.repeat(12)));
		const faults = ledgerOf([folder]).faults;
		expect(faults.length).toBe(1);
		expect(faults[0]).toContain('olive has 2 verdict files');
	});

	test('a file that is no verdict, and a folder that holds none', () => {
		const folder = join(root, 'junk');
		mkdirSync(folder);
		writeFileSync(join(folder, 'notes.json'), '{ not json');
		writeFileSync(join(folder, 'metrics.json'), '{"run":"x"}');
		const faults = ledgerOf([folder]).faults;
		expect(faults[0]).toContain('metrics.json: its format is undefined');
		expect(faults.some((fault) => fault.includes('notes.json: it is not JSON'))).toBe(true);
		const empty = join(root, 'empty');
		mkdirSync(empty);
		expect(ledgerOf([empty]).faults).toEqual(['no verdict file was found']);
	});
});
