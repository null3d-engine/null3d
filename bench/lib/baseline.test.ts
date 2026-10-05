import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	finishedComparison,
	lastMeasured,
	type MainRun,
	MERGE_STEP,
	REPORT_JOB,
	type RunJob,
} from './baseline';

/** A history of main, oldest first; a commit's history is the commit and the commits before it. */
const MAIN = ['a1', 'b2', 'c3', 'd4', 'e5'];
const upTo = (commit: string) => (other: string) =>
	MAIN.indexOf(other) >= 0 && MAIN.indexOf(other) <= MAIN.indexOf(commit);
const runs = (...shas: string[]): MainRun[] => shas.map((headSha, id) => ({ id, headSha }));
const all = () => true;

describe('the last commit on main that a run measured', () => {
	test('is the newest commit that a run measured', () => {
		expect(lastMeasured(runs('c3', 'b2', 'a1'), upTo('e5'), all)).toBe('c3');
	});

	test('covers the commits that got no run of their own', () => {
		// d4 and e5 merged within the same hour, so the next run measures d4's change with e5's.
		expect(lastMeasured(runs('c3'), upTo('e5'), all)).toBe('c3');
	});

	test('moves past a run that failed its verdict, so one slowdown fails one run', () => {
		// d4's run judged d4 slower and failed. It still measured d4, so e5 is judged on its own change.
		const measured = new Set(['d4', 'c3']);
		const finished = (run: MainRun) => measured.has(run.headSha);
		expect(lastMeasured(runs('d4', 'c3'), upTo('e5'), finished)).toBe('d4');
	});

	test('skips a run that stopped before its comparison ended', () => {
		const finished = (run: MainRun) => run.headSha !== 'd4';
		expect(lastMeasured(runs('d4', 'c3'), upTo('e5'), finished)).toBe('c3');
	});

	test('asks whether a run finished only for the runs it could choose, newest first', () => {
		const asked: string[] = [];
		const finished = (run: MainRun) => {
			asked.push(run.headSha);
			return run.headSha === 'c3';
		};
		expect(lastMeasured(runs('e5', 'd4', 'c3', 'b2'), upTo('d4'), finished)).toBe('c3');
		expect(asked).toEqual(['d4', 'c3']);
	});

	test('is the new commit when main has not moved since a run measured it', () => {
		expect(lastMeasured(runs('e5', 'c3'), upTo('e5'), all)).toBe('e5');
	});

	test('passes over the hourly runs that found nothing to measure', () => {
		// The two newest runs on e5 skipped the benchmarks, and the run before them measured c3.
		const finished = (run: MainRun) => run.id === 2;
		expect(lastMeasured(runs('e5', 'e5', 'c3'), upTo('e5'), finished)).toBe('c3');
	});

	test('skips a commit that is not in the new commit history', () => {
		expect(lastMeasured(runs('x9', 'e5', 'b2'), upTo('c3'), all)).toBe('b2');
	});

	test('is null when no run measured the new commit or an earlier one', () => {
		expect(lastMeasured([], upTo('b2'), all)).toBeNull();
		expect(lastMeasured(runs('e5'), upTo('b2'), all)).toBeNull();
		expect(lastMeasured(runs('c3'), upTo('e5'), () => false)).toBeNull();
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
