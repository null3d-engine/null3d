// The model behind the browser job's shard weights. Playwright splits the tests between shards by
// count, in its own order of them, and puts each group of tests whole in the shard where the group's
// first test falls. A file that runs its tests in order is one group, and each test of a file that
// runs its tests in parallel is a group of its own. A shard's workers each take the next group as
// they come free. Given each test's time from a CI run, the model finds the cuts that make the
// slowest shard as short as possible.
import { stripVTControlCharacters } from 'node:util';
import { ALONE_PROJECT_SUFFIX } from '../../tests/lib/alone.ts';

/** One test in Playwright's order. */
export interface ListedTest {
	project: string;
	file: string;
	title: string;
}

/** The tests that run one after another on one worker, and their times in seconds. */
export interface TestGroup {
	project: string;
	file: string;
	seconds: number[];
}

/** Seconds in each unit of the list reporter's durations. */
const UNIT_SECONDS: Record<string, number> = { ms: 0.001, s: 1, m: 60, h: 3600 };

/** A test result line of Playwright's list reporter, with or without the log's time stamp before it. */
const RESULT_LINE =
	/([✓✘-])\s+\d+ \[([^\]]+)\] › (?:image\/)?([^:\s]+):\d+:\d+ › (.*?)(?: \(retry #\d+\))?(?: \(([\d.]+)(ms|s|m|h)\))?$/;
/** A line of `playwright test --list`. */
const LIST_LINE = /^\s+\[([^\]]+)\] › ([^:\s]+):\d+:\d+ › (.*)$/;
/** A file's own line that makes all its tests run in parallel. */
const PARALLEL_FILE = /^test\.describe\.configure\(\{ mode: 'parallel' \}\);?$/m;

/**
 * The key of a test's time. It leaves out the alone projects' suffix, so that a test keeps its time
 * when it moves into or out of the tests that run alone.
 */
function timeKey(project: string, file: string, title: string): string {
	const base = project.endsWith(ALONE_PROJECT_SUFFIX)
		? project.slice(0, -ALONE_PROJECT_SUFFIX.length)
		: project;
	return `${base}\t${file}\t${title}`;
}

/**
 * Each test's time in seconds, from the logs of a CI run's browser jobs. A skipped test takes no
 * time. A test that ran more than once keeps the time of its pass, or its last run if none passed.
 */
export function parseTestTimes(log: string): Map<string, number> {
	const times = new Map<string, number>();
	const passed = new Set<string>();
	for (const line of log.split('\n')) {
		const match = RESULT_LINE.exec(stripVTControlCharacters(line).trimEnd());
		if (!match) continue;
		const [, mark, project, file, title, value, unit] = match;
		const key = timeKey(project!, file!, title!);
		if (passed.has(key)) continue;
		times.set(key, value ? Number(value) * UNIT_SECONDS[unit!]! : 0);
		if (mark === '✓') passed.add(key);
	}
	return times;
}

/** Each test's median time over several runs, of the runs that have it. */
export function medianTimes(runs: readonly Map<string, number>[]): Map<string, number> {
	const all = new Map<string, number[]>();
	for (const times of runs) {
		for (const [key, seconds] of times) {
			const list = all.get(key) ?? [];
			list.push(seconds);
			all.set(key, list);
		}
	}
	const medians = new Map<string, number>();
	for (const [key, list] of all) medians.set(key, median(list));
	return medians;
}

/** The middle value, or the mean of the two middle values. */
function median(values: number[]): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const middle = sorted.length >> 1;
	return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** The tests of `playwright test --list`, in its order. */
export function parseTestList(list: string): ListedTest[] {
	const tests: ListedTest[] = [];
	for (const line of list.split('\n')) {
		const match = LIST_LINE.exec(line.trimEnd());
		if (match) tests.push({ project: match[1]!, file: match[2]!, title: match[3]! });
	}
	return tests;
}

/** Whether a test file's source makes all its tests run in parallel. */
export function runsInParallel(source: string): boolean {
	return PARALLEL_FILE.test(source);
}

/**
 * Playwright's groups of the tests, in order, each test with its time. A test with no time in the
 * run takes the mean of its file's tests that have one, or the median of all tests if none has.
 */
export function groupTests(
	tests: ListedTest[],
	times: Map<string, number>,
	parallelFiles: ReadonlySet<string>,
): { groups: TestGroup[]; missing: number } {
	const allMedian = median([...times.values()]);
	const fileTimes = new Map<string, number[]>();
	for (const test of tests) {
		const seconds = times.get(timeKey(test.project, test.file, test.title));
		if (seconds === undefined) continue;
		const list = fileTimes.get(test.file) ?? [];
		list.push(seconds);
		fileTimes.set(test.file, list);
	}
	const groups: TestGroup[] = [];
	let missing = 0;
	for (const test of tests) {
		let seconds = times.get(timeKey(test.project, test.file, test.title));
		if (seconds === undefined) {
			missing++;
			const same = fileTimes.get(test.file);
			seconds = same ? same.reduce((sum, value) => sum + value, 0) / same.length : allMedian;
		}
		const last = groups.at(-1);
		if (
			!last ||
			parallelFiles.has(test.file) ||
			last.project !== test.project ||
			last.file !== test.file
		) {
			groups.push({ project: test.project, file: test.file, seconds: [seconds] });
		} else {
			last.seconds.push(seconds);
		}
	}
	return { groups, missing };
}

const groupSeconds = (group: TestGroup) => group.seconds.reduce((sum, value) => sum + value, 0);

/** A shard's time in seconds: its workers each take the next group as they come free. */
export function shardSeconds(groups: readonly TestGroup[], workers: number): number {
	const free = new Array<number>(workers).fill(0);
	for (const group of groups) {
		const next = free.indexOf(Math.min(...free));
		free[next]! += groupSeconds(group);
	}
	return Math.max(...free);
}

/**
 * The groups of each shard, as Playwright splits them for the given weights: each shard's share of
 * the tests, and each group in the shard where its first test falls.
 */
export function splitByWeights(
	groups: readonly TestGroup[],
	weights: readonly number[],
): TestGroup[][] {
	const total = groups.reduce((sum, group) => sum + group.seconds.length, 0);
	const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
	const sizes = weights.map((weight) => Math.floor((weight * total) / totalWeight));
	const remainder = total - sizes.reduce((sum, size) => sum + size, 0);
	for (let i = 0; i < remainder; i++) sizes[i % sizes.length]!++;
	const shards: TestGroup[][] = sizes.map(() => []);
	let shard = 0;
	let end = sizes[0]!;
	let at = 0;
	for (const group of groups) {
		while (shard < sizes.length - 1 && at >= end) end += sizes[++shard]!;
		shards[shard]!.push(group);
		at += group.seconds.length;
	}
	return shards;
}

/**
 * The count of tests in each shard, if the groups fit in the given shards with each shard taking no
 * more than the limit in every run. Each shard takes groups in order for as long as it stays within
 * the limit.
 */
function cutsWithin(
	runs: readonly (readonly TestGroup[])[],
	shards: number,
	workers: number,
	limit: number,
): number[] | undefined {
	const groups = runs[0]!;
	const counts: number[] = [];
	let index = 0;
	for (let shard = 0; shard < shards; shard++) {
		const free = runs.map(() => new Array<number>(workers).fill(0));
		let count = 0;
		while (index < groups.length) {
			const next = free.map((times) => times.indexOf(Math.min(...times)));
			const after = runs.map((run, i) => free[i]![next[i]!]! + groupSeconds(run[index]!));
			if (after.some((seconds) => seconds > limit)) break;
			for (let i = 0; i < runs.length; i++) free[i]![next[i]!] = after[i]!;
			count += groups[index]!.seconds.length;
			index++;
		}
		counts.push(count);
	}
	return index === groups.length ? counts : undefined;
}

/**
 * The weights that make the slowest shard of the slowest run as short as possible: each shard's
 * count of tests, cut only between groups. Each run holds the same groups, with that run's times.
 */
export function bestWeights(
	runs: readonly (readonly TestGroup[])[],
	shards: number,
	workers: number,
): number[] {
	let low = 0;
	let high = Math.max(
		...runs.map((groups) => groups.reduce((sum, group) => sum + groupSeconds(group), 0)),
	);
	let best = cutsWithin(runs, shards, workers, high)!;
	// Halving the limit until it changes by less than a tenth of a second.
	while (high - low > 0.1) {
		const limit = (low + high) / 2;
		const counts = cutsWithin(runs, shards, workers, limit);
		if (counts) {
			high = limit;
			best = counts;
		} else {
			low = limit;
		}
	}
	return best;
}
