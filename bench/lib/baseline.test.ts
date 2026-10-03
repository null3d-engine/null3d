import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	chooseBaseline,
	finishedComparison,
	type MainRun,
	MERGE_STEP,
	REPORT_JOB,
	type RunJob,
} from './baseline';

/** A history of main, oldest first; a commit's ancestors are the commits before it. */
const MAIN = ['a1', 'b2', 'c3', 'd4', 'e5'];
const before = (commit: string) => (other: string) =>
	MAIN.indexOf(other) >= 0 && MAIN.indexOf(other) < MAIN.indexOf(commit);
const runs = (...shas: string[]): MainRun[] => shas.map((headSha, id) => ({ id, headSha }));
const all = () => true;

describe('the baseline of a push to main', () => {
	test('is the newest commit that a run measured', () => {
		expect(chooseBaseline('e5', runs('c3', 'b2', 'a1'), before('e5'), all)).toBe('c3');
	});

	test('covers the commits that got no run of their own', () => {
		// d4 waited while c3's run ran, and e5 replaced it, so e5's run measures d4's change too.
		expect(chooseBaseline('e5', runs('c3'), before('e5'), all)).toBe('c3');
	});

	test('moves past a run that failed its verdict, so one slowdown fails one run', () => {
		// d4's run judged d4 slower and failed. It still measured d4, so e5 is judged on its own change.
		const measured = new Set(['d4', 'c3']);
		const finished = (run: MainRun) => measured.has(run.headSha);
		expect(chooseBaseline('e5', runs('d4', 'c3'), before('e5'), finished)).toBe('d4');
	});

	test('skips a run that stopped before its comparison ended', () => {
		const finished = (run: MainRun) => run.headSha !== 'd4';
		expect(chooseBaseline('e5', runs('d4', 'c3'), before('e5'), finished)).toBe('c3');
	});

	test('asks whether a run finished only for the runs it could choose, newest first', () => {
		const asked: string[] = [];
		const finished = (run: MainRun) => {
			asked.push(run.headSha);
			return run.headSha === 'c3';
		};
		expect(chooseBaseline('d4', runs('e5', 'd4', 'c3', 'b2'), before('d4'), finished)).toBe('c3');
		expect(asked).toEqual(['c3']);
	});

	test('skips the new commit, so a run started again still compares it with an older commit', () => {
		expect(chooseBaseline('e5', runs('e5', 'c3'), before('e5'), all)).toBe('c3');
	});

	test('skips a commit that is not in the new commit history', () => {
		expect(chooseBaseline('c3', runs('x9', 'e5', 'b2'), before('c3'), all)).toBe('b2');
	});

	test('is null when no run measured an earlier commit', () => {
		expect(chooseBaseline('b2', [], before('b2'), all)).toBeNull();
		expect(chooseBaseline('b2', runs('b2', 'e5'), before('b2'), all)).toBeNull();
		expect(chooseBaseline('e5', runs('c3'), before('e5'), () => false)).toBeNull();
	});
});

describe('a run that finished its comparison', () => {
	const report = (conclusion: string | null): RunJob => ({
		name: REPORT_JOB,
		steps: [
			{ name: 'Set up job', conclusion: 'success' },
			{ name: MERGE_STEP, conclusion },
		],
	});

	test('merged its shards, whatever the verdict', () => {
		expect(finishedComparison([{ name: 'build (new)' }, report('success')])).toBe(true);
	});

	test('is not one whose merge failed, was skipped or was cancelled', () => {
		expect(finishedComparison([report('failure')])).toBe(false);
		expect(finishedComparison([report('skipped')])).toBe(false);
		expect(finishedComparison([report('cancelled')])).toBe(false);
		expect(finishedComparison([report(null)])).toBe(false);
	});

	test('is not one that never reached the report', () => {
		expect(finishedComparison([{ name: 'build (new)', steps: [] }])).toBe(false);
		expect(finishedComparison([])).toBe(false);
	});

	test('reads the job and step names that the workflow gives', () => {
		const workflow = readFileSync(
			join(import.meta.dir, '../../.github/workflows/bench.yml'),
			'utf8',
		);
		expect(workflow).toContain(`name: ${REPORT_JOB}\n`);
		expect(workflow).toContain(`- name: ${MERGE_STEP}\n`);
	});
});
