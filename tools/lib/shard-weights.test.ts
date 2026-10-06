import { describe, expect, it } from 'bun:test';
import {
	bestWeights,
	groupTests,
	type ListedTest,
	medianTimes,
	parseTestList,
	parseTestTimes,
	runsInParallel,
	shardSeconds,
	splitByWeights,
	type TestGroup,
} from './shard-weights';

const key = (project: string, file: string, title: string) => `${project}\t${file}\t${title}`;
const test = (project: string, file: string, title: string): ListedTest => ({
	project,
	file,
	title,
});
const group = (file: string, ...seconds: number[]): TestGroup => ({ project: 'p', file, seconds });

describe('parseTestTimes', () => {
	it('reads the list reporter lines of a job log, in every unit', () => {
		const times = parseTestTimes(
			[
				'2026-10-05T22:50:21.4Z   ✓    1 [chromium-swiftshader] › image/a.spec.ts:9:1 › one (1.7s)',
				'2026-10-05T22:50:22.4Z   ✓    2 [chromium-swiftshader] › image/a.spec.ts:12:1 › two (850ms)',
				'2026-10-05T22:50:23.4Z   ✓    3 [production build] › image/b.spec.ts:4:3 › three, on webgpu (2.4m)',
				'2026-10-05T22:50:24.4Z   -    4 [chromium-swiftshader] › image/b.spec.ts:20:1 › skipped',
				'Total: 4 tests',
			].join('\n'),
		);
		expect(times.get(key('chromium-swiftshader', 'a.spec.ts', 'one'))).toBe(1.7);
		expect(times.get(key('chromium-swiftshader', 'a.spec.ts', 'two'))).toBeCloseTo(0.85);
		expect(times.get(key('production build', 'b.spec.ts', 'three, on webgpu'))).toBe(144);
		expect(times.get(key('chromium-swiftshader', 'b.spec.ts', 'skipped'))).toBe(0);
		expect(times.size).toBe(4);
	});

	it("keeps a retried test's passing time, and reads lines with terminal colors", () => {
		const times = parseTestTimes(
			[
				'  ✘   5 [p] › image/a.spec.ts:9:1 › flaky (30.0s)',
				'  \u001b[32m✓\u001b[39m   6 [p] › image/a.spec.ts:9:1 › flaky (retry #1) (2.0s)',
				'  ✘   7 [p] › image/a.spec.ts:9:1 › flaky (retry #2) (9.0s)',
			].join('\n'),
		);
		expect(times.get(key('p', 'a.spec.ts', 'flaky'))).toBe(2);
	});

	it('gives a test of an alone project the key of its main project', () => {
		const times = parseTestTimes('  ✓   1 [p, alone] › image/a.spec.ts:9:1 › pace (3.0s)');
		expect(times.get(key('p', 'a.spec.ts', 'pace'))).toBe(3);
	});
});

describe('medianTimes', () => {
	it("takes each test's median over the runs that have it", () => {
		const medians = medianTimes([
			new Map([
				['a', 1],
				['b', 4],
			]),
			new Map([['a', 3]]),
			new Map([
				['a', 10],
				['b', 6],
			]),
		]);
		expect(medians.get('a')).toBe(3);
		expect(medians.get('b')).toBe(5);
	});
});

describe('parseTestList', () => {
	it("reads the tests of Playwright's list in order", () => {
		const tests = parseTestList(
			[
				'Listing tests:',
				'  [chromium-swiftshader] › a.spec.ts:9:1 › one',
				'  [production build, alone] › engine.spec.ts:319:3 › the engine runs pipelined on webgpu',
				'Total: 2 tests in 2 files',
			].join('\n'),
		);
		expect(tests).toEqual([
			test('chromium-swiftshader', 'a.spec.ts', 'one'),
			test('production build, alone', 'engine.spec.ts', 'the engine runs pipelined on webgpu'),
		]);
	});
});

describe('runsInParallel', () => {
	it("finds the file's own parallel mode, not a describe block's", () => {
		expect(runsInParallel("import x;\ntest.describe.configure({ mode: 'parallel' });\n")).toBe(
			true,
		);
		expect(
			runsInParallel(
				"test.describe('a', () => {\n\ttest.describe.configure({ mode: 'parallel' });\n});",
			),
		).toBe(false);
	});
});

describe('groupTests', () => {
	it('makes a file one group in each project, and each test of a parallel file its own', () => {
		const tests = [
			test('p', 'a.spec.ts', '1'),
			test('p', 'a.spec.ts', '2'),
			test('q', 'a.spec.ts', '1'),
			test('p', 'images.spec.ts', 'x'),
			test('p', 'images.spec.ts', 'y'),
		];
		const times = new Map([
			[key('p', 'a.spec.ts', '1'), 1],
			[key('p', 'a.spec.ts', '2'), 2],
			[key('q', 'a.spec.ts', '1'), 3],
			[key('p', 'images.spec.ts', 'x'), 4],
			[key('p', 'images.spec.ts', 'y'), 5],
		]);
		const { groups, missing } = groupTests(tests, times, new Set(['images.spec.ts']));
		expect(groups.map((g) => [g.project, g.file, g.seconds])).toEqual([
			['p', 'a.spec.ts', [1, 2]],
			['q', 'a.spec.ts', [3]],
			['p', 'images.spec.ts', [4]],
			['p', 'images.spec.ts', [5]],
		]);
		expect(missing).toBe(0);
	});

	it("gives a test with no time its file's mean, or the median of all", () => {
		const times = new Map([
			[key('p', 'a.spec.ts', '1'), 2],
			[key('p', 'a.spec.ts', '2'), 4],
			[key('p', 'b.spec.ts', '1'), 10],
		]);
		const tests = [
			test('p', 'a.spec.ts', '1'),
			test('p', 'a.spec.ts', '2'),
			test('p', 'a.spec.ts', 'new'),
			test('p', 'c.spec.ts', 'new'),
		];
		const { groups, missing } = groupTests(tests, times, new Set());
		expect(groups.map((g) => g.seconds)).toEqual([[2, 4, 3], [4]]);
		expect(missing).toBe(2);
	});
});

describe('shardSeconds', () => {
	it('gives each group to the worker that comes free first', () => {
		expect(shardSeconds([group('a', 5), group('b', 3), group('c', 1), group('d', 4)], 2)).toBe(8);
		expect(shardSeconds([group('a', 5), group('b', 3)], 1)).toBe(8);
	});
});

describe('splitByWeights', () => {
	it('puts each group in the shard where its first test falls, as Playwright does', () => {
		const groups = [group('a', 1, 1, 1), group('b', 1), group('c', 1, 1), group('d', 1)];
		const shards = splitByWeights(groups, [2, 4, 1]);
		expect(shards.map((part) => part.map((g) => g.file))).toEqual([['a'], ['b', 'c'], ['d']]);
	});

	it("shares out the remainder of Playwright's rounding from the first shard", () => {
		const groups = Array.from({ length: 10 }, (_, i) => group(String(i), 1));
		expect(splitByWeights(groups, [1, 1, 1]).map((part) => part.length)).toEqual([4, 3, 3]);
	});
});

describe('bestWeights', () => {
	it('cuts so that the slowest shard is as short as it can be', () => {
		const groups = [
			group('a', 4),
			group('b', 4),
			group('c', 1),
			group('d', 1),
			group('e', 1),
			group('f', 1),
		];
		const weights = bestWeights([groups], 2, 1);
		expect(weights).toEqual([2, 4]);
		const times = splitByWeights(groups, weights).map((part) => shardSeconds(part, 1));
		expect(Math.max(...times)).toBe(8);
	});

	it('keeps the slowest shard short in every run', () => {
		const first = [group('a', 1), group('b', 1), group('c', 10), group('d', 1)];
		const second = [group('a', 10), group('b', 1), group('c', 1), group('d', 1)];
		const weights = bestWeights([first, second], 2, 1);
		for (const run of [first, second]) {
			const times = splitByWeights(run, weights).map((part) => shardSeconds(part, 1));
			expect(Math.max(...times)).toBe(11);
		}
		expect(weights).toEqual([2, 2]);
	});
});
