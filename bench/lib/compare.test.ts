import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
	allowedMs,
	type Build,
	type BuildRun,
	COMPARISON_SWITCHES,
	type ComparisonRecord,
	compareBuilds,
	compareReport,
	comparisonSwitches,
	type ExpectedChange,
	judge,
	judgeRecord,
	type Measure,
	MIN_ROUNDS,
	measurementChanges,
	mergeRecords,
	NOISE_TIMES,
	PAGE_SOURCES,
	type PlanPage,
	pageName,
	qualityLines,
	RULES,
	type Rule,
	readExpectedChanges,
	roundNoise,
	roundOrder,
	runQualities,
	selectRuns,
	shardPages,
} from './compare';
import identicalBuilds from './fixtures/identical-builds.json';
import type { BenchResult } from './report';

interface RunFacts {
	/** The sketch worker's update phase, which own work leaves out. */
	update?: number;
	refreshHz?: number | null;
	frames?: number;
	gpuMs?: number | null;
	/** The quality preset that the engine reports, if any. */
	preset?: string;
	/** Quality steps in each measured second, for a page that records a trace. */
	steps?: readonly number[];
}

/** A null3D page's result whose busiest thread, the sketch worker, takes `cpu` ms per frame. */
function result(
	cpu: number,
	{ update = 0, refreshHz = 60, frames = 600, gpuMs = null, preset, steps }: RunFacts = {},
) {
	return {
		...(preset !== undefined && { mode: { jobWorkers: 1, preset } }),
		...(steps !== undefined && {
			trace: steps.map((count) => ({
				presentedFps: 60,
				completedFps: 60,
				renderScale: 1,
				steps: count,
			})),
		}),
		ok: true,
		scene: 's1',
		renderer: 'null3d',
		n: 1000,
		frames,
		cpuMs: { median: cpu, p95: cpu, p99: cpu, mean: cpu },
		intervalMs: { median: 16.7, p95: 16.7, p99: 16.7 },
		stats: {
			cpuMsAllThreads: { median: cpu + 0.05 },
			gpuMs: gpuMs === null ? null : { median: gpuMs },
			refreshHz,
			uploadBytes: { median: 0 },
			drawCalls: { median: 1 },
			threads: {
				'sketch-worker': { busyMs: { median: cpu }, phases: { update: { median: update } } },
				'render-worker': { busyMs: { median: 0.05 }, phases: {} },
			},
		},
	} satisfies BenchResult;
}

const FAILED: BenchResult = { ok: false, error: 'no result within 80 s' } as BenchResult;

function run(
	build: Build,
	round: number,
	outcome: BenchResult,
	scene = 's1',
	kind = 'null3d-webgpu',
): BuildRun {
	return { build, scene, kind, round, result: outcome };
}

/** Runs of one page: one per round and build, with each build's CPU times in round order. */
function page(
	baseline: readonly number[],
	next: readonly number[],
	facts: RunFacts = {},
	scene = 's1',
	kind = 'null3d-webgpu',
): BuildRun[] {
	return [
		...baseline.map((cpu, k) => run('baseline', k + 1, result(cpu, facts), scene, kind)),
		...next.map((cpu, k) => run('new', k + 1, result(cpu, facts), scene, kind)),
	];
}

/** The same runs with the given build's runs failed. */
const failBuild = (runs: readonly BuildRun[], build: Build) =>
	runs.map((r) => (r.build === build ? { ...r, result: FAILED } : r));

const KNOWN = { scenes: ['s1', 's1-static', 's2'], kinds: ['null3d-webgpu', 'null3d-webgl2'] };

/** Compares the runs that the selection keeps. */
const compare = (runs: readonly BuildRun[], expected: readonly ExpectedChange[] = []) =>
	compareBuilds(selectRuns(runs), expected);

/** The one trailer that a message holds, which must parse. */
function trailer(line: string): ExpectedChange {
	const { changes, problems } = readExpectedChanges([`fix: a change\n\n${line}\n`], KNOWN);
	expect(problems).toEqual([]);
	expect(changes).toHaveLength(1);
	return changes[0]!;
}

describe('rounds', () => {
	test('run the baseline first in odd rounds and the new build first in even rounds', () => {
		expect(roundOrder(1)).toEqual(['baseline', 'new']);
		expect(roundOrder(2)).toEqual(['new', 'baseline']);
		expect(roundOrder(3)).toEqual(['baseline', 'new']);
	});
});

describe('bad runs', () => {
	test('are dropped when the page failed or measured no frames', () => {
		const good = run('baseline', 1, result(1));
		const failed = run('new', 1, FAILED);
		const empty = run('new', 2, result(1, { frames: 0 }));
		const { kept, dropped } = selectRuns([good, failed, empty]);
		expect(kept).toEqual([good]);
		expect(dropped).toEqual([
			{ run: failed, reason: 'the page failed: no result within 80 s' },
			{ run: empty, reason: 'it measured no frames' },
		]);
	});

	test('are dropped when they measured another refresh rate than most runs of their page', () => {
		const at60 = [1, 2, 3].map((round) => run('baseline', round, result(1)));
		const at120 = run('new', 1, result(1, { refreshHz: 120 }));
		const unknown = run('new', 2, result(1, { refreshHz: null }));
		const { kept, dropped, refreshHz } = selectRuns([...at60, at120, unknown]);
		expect(refreshHz).toEqual({ 's1 null3d-webgpu': 60 });
		expect(kept).toEqual([...at60, unknown]);
		expect(dropped).toEqual([
			{ run: at120, reason: 'it measured a refresh rate of 120 Hz, not 60 Hz' },
		]);
	});

	test('find the rate per page, since a software GPU slows the frame callbacks of some pages', () => {
		const fast = page([1, 1, 1], [1, 1, 1]);
		const slow = page([1, 1], [1, 1], { refreshHz: 20 }, 's2');
		const odd = run('new', 3, result(1, { refreshHz: 30 }), 's2');
		const { kept, dropped, refreshHz } = selectRuns([...fast, ...slow, odd]);
		expect(refreshHz).toEqual({ 's1 null3d-webgpu': 60, 's2 null3d-webgpu': 20 });
		expect(kept).toEqual([...fast, ...slow]);
		expect(dropped.map((d) => d.run)).toEqual([odd]);
	});

	test('leave the higher rate when two rates are as common, and none without a rate', () => {
		const tie = [run('baseline', 1, result(1)), run('new', 1, result(1, { refreshHz: 120 }))];
		expect(selectRuns(tie).refreshHz).toEqual({ 's1 null3d-webgpu': 120 });
		const unknown = [run('new', 1, result(1, { refreshHz: null }))];
		expect(selectRuns(unknown).refreshHz).toEqual({ 's1 null3d-webgpu': null });
		expect(selectRuns([run('new', 1, FAILED)]).refreshHz).toEqual({ 's1 null3d-webgpu': null });
	});
});

describe('the rules', () => {
	test('allow the busiest thread 8%, and at least 0.05 ms on pages whose frames are short', () => {
		const rule = RULES['busiest-thread'];
		expect(rule).toEqual({ share: 0.08, floorMs: 0.05 });
		expect(allowedMs(2, rule)).toBeCloseTo(0.16);
		expect(allowedMs(0.4, rule)).toBe(0.05);
		expect(allowedMs(0, rule)).toBe(0.05);
	});

	test('allow own work, a small difference of two larger times, a wider share', () => {
		const rule = RULES['own-work'];
		expect(rule).toEqual({ share: 0.15, floorMs: 0.05 });
		expect(allowedMs(1, rule)).toBeCloseTo(0.15);
		expect(allowedMs(0.1, rule)).toBe(0.05);
	});

	test("measure the noise of a change as the standard error of the rounds' median", () => {
		expect(NOISE_TIMES).toBe(2);
		expect(roundNoise([])).toBe(0);
		expect(roundNoise([1.1])).toBe(0);
		expect(roundNoise([1.05, 1.05, 1.05])).toBe(0);
		// Four ratios that lie 0.1 from their median of 1: the deviation is 0.1, over a root of 2.
		expect(roundNoise([0.9, 0.9, 1.1, 1.1])).toBeCloseTo((1.4826 * 1.2533 * 0.1) / 2);
		// One far round moves the noise no more than a near one does.
		expect(roundNoise([1, 1.02, 0.98, 1.01, 3])).toBeCloseTo(
			roundNoise([1, 1.02, 0.98, 1.01, 1.03]),
		);
	});
});

describe('comparing two builds', () => {
	test('compares the busiest thread and own work, with each build median and spread', () => {
		const runs = page([2, 2.1, 1.9], [2, 2.1, 1.9], { update: 1.8 });
		const { comparisons, missing } = compare(runs);
		expect(missing).toEqual([]);
		expect(comparisons.map((c) => [c.measure, c.baseline.median, c.new.median, c.result])).toEqual([
			['busiest-thread', 2, 2, 'same'],
			// Own work is the busiest thread's time less the update phase on it.
			['own-work', expect.closeTo(0.2), expect.closeTo(0.2), 'same'],
		]);
		expect(comparisons[0]).toMatchObject({
			baseline: { runs: 3, median: 2, min: 1.9, max: 2.1 },
			rounds: 3,
			change: 0,
			deltaMs: 0,
		});
	});

	test('takes the median of the rounds, so a machine that changes speed between rounds does not decide', () => {
		// The machine is twice as slow in the last two rounds, and the new build 1% slower throughout.
		const baseline = [1, 1, 2, 2, 2];
		const runs = page(
			baseline,
			baseline.map((ms) => ms * 1.01),
		);
		const [busiest] = compare(runs).comparisons;
		expect(busiest?.change).toBeCloseTo(0.01);
		expect(busiest?.result).toBe('same');
		// The medians alone would have been 2 ms and 2.02 ms, and the step to the slow machine
		// inside round 3 would move them further apart.
		const stepInsideRound = page([1, 1, 1.5, 2, 2], [1.01, 1.01, 2, 2.02, 2.02]);
		expect(compare(stepInsideRound).comparisons[0]?.change).toBeCloseTo(0.01);
	});

	test('calls a page slower or faster only beyond the rule of each measure', () => {
		// The busiest thread goes from 2 ms to 2.2 ms, 10% slower. The scene's update takes 1.5 ms of
		// it, so own work goes from 0.5 ms to 0.7 ms, 40% slower.
		const [busiest, own] = compare(page([2, 2, 2], [2.2, 2.2, 2.2], { update: 1.5 })).comparisons;
		expect(busiest).toMatchObject({ result: 'slower', allowedMs: expect.closeTo(0.16) });
		expect(busiest?.change).toBeCloseTo(0.1);
		expect(busiest?.deltaMs).toBeCloseTo(0.2);
		expect(own).toMatchObject({ result: 'slower', allowedMs: expect.closeTo(0.075) });
		expect(own?.change).toBeCloseTo(0.4);
		const within = compare(page([2, 2, 2], [2.06, 2.06, 2.06], { update: 1.5 })).comparisons;
		expect(within.map((c) => c.result)).toEqual(['same', 'same']);
		const faster = compare(page([2, 2, 2], [1.8, 1.8, 1.8], { update: 1.5 })).comparisons;
		expect(faster.map((c) => c.result)).toEqual(['faster', 'faster']);
	});

	test('judges own work with its wider margin', () => {
		// Own work from 0.5 ms to 0.57 ms is 14% slower, within its rule; the busiest thread moves 3.5%.
		const within = compare(page([2, 2, 2], [2.07, 2.07, 2.07], { update: 1.5 })).comparisons;
		expect(within.map((c) => c.result)).toEqual(['same', 'same']);
		// Own work from 0.5 ms to 0.58 ms is 16% slower, beyond its rule.
		const beyond = compare(page([2, 2, 2], [2.08, 2.08, 2.08], { update: 1.5 })).comparisons;
		expect(beyond.map((c) => c.result)).toEqual(['same', 'slower']);
	});

	test('judges a page whose frames are short on the time that the rules allow', () => {
		// 0.15 ms to 0.195 ms is 30% slower, but 0.045 ms, within the floor of both measures.
		const { comparisons } = compare(page([0.15, 0.15, 0.15], [0.195, 0.195, 0.195]));
		expect(comparisons.map((c) => c.result)).toEqual(['same', 'same']);
		// 0.21 ms is 0.06 ms slower, beyond the floor.
		const beyond = compare(page([0.15, 0.15, 0.15], [0.21, 0.21, 0.21]));
		expect(beyond.comparisons.map((c) => c.result)).toEqual(['slower', 'slower']);
	});

	test("calls a change slower or faster only beyond twice its rounds' noise", () => {
		// The median round is 10% slower, but the rounds spread from 10% faster to 30% slower: the
		// noise is about 8.3%, so a change of 10% is within twice it.
		const baseline = [2, 2, 2, 2, 2];
		const noisy = compare(page(baseline, [1.8, 2, 2.2, 2.4, 2.6])).comparisons[0];
		expect(noisy?.change).toBeCloseTo(0.1);
		expect(noisy?.noise).toBeCloseTo(0.0831, 3);
		expect(noisy?.result).toBe('same');
		// The same change from quiet rounds is slower, and as quiet a gain is faster.
		const quiet = compare(page(baseline, [2.16, 2.18, 2.2, 2.22, 2.24])).comparisons[0];
		expect(quiet?.result).toBe('slower');
		const gain = compare(page(baseline, [1.76, 1.78, 1.8, 1.82, 1.84])).comparisons[0];
		expect(gain?.result).toBe('faster');
	});

	test('takes medians, so one slow run does not decide', () => {
		const { comparisons } = compare(page([2, 2, 2], [2, 2, 5]));
		expect(comparisons[0]?.result).toBe('same');
		expect(comparisons[0]?.new).toMatchObject({ median: 2, max: 5 });
	});

	test('pairs only rounds in which both builds kept a run', () => {
		const runs = page([1, 1, 1], [1.5, 1, 1]).map((r) =>
			r.build === 'baseline' && r.round === 1 ? { ...r, result: FAILED } : r,
		);
		const [busiest] = compare(runs).comparisons;
		expect(busiest).toMatchObject({ rounds: 2, change: 0, result: 'same' });
		expect(busiest?.new).toMatchObject({ runs: 3, max: 1.5 });
	});

	test('names a page with too few rounds in which both builds kept a run', () => {
		expect(MIN_ROUNDS).toBe(2);
		const runs = [...page([1, 1, 1], [1, 1, 1]), ...page([1, 1, 1], [1, 1, 1], {}, 's2')].map(
			(r) => (r.scene === 's2' && r.build === 'new' && r.round > 1 ? { ...r, result: FAILED } : r),
		);
		const { comparisons, missing } = compare(runs);
		expect(missing).toEqual([
			{
				scene: 's2',
				kind: 'null3d-webgpu',
				kept: { baseline: 3, new: 1 },
				runs: { baseline: 3, new: 3 },
				rounds: 1,
			},
		]);
		expect(comparisons.every((c) => c.scene === 's1')).toBe(true);
	});

	/** Runs of one page whose CPU time stays at 1 ms, with each build's GPU times in round order. */
	const gpuPage = (baseline: readonly (number | null)[], next: readonly (number | null)[]) => [
		...baseline.map((gpuMs, k) => run('baseline', k + 1, result(1, { gpuMs }))),
		...next.map((gpuMs, k) => run('new', k + 1, result(1, { gpuMs }))),
	];
	const gpuTime = (runs: readonly BuildRun[]) =>
		compare(runs).comparisons.find((c) => c.measure === 'gpu-time');

	test('judges GPU time where the runs of both builds timed the GPU', () => {
		// A slowdown of the GPU's work alone, as a shader that the GPU's compiler handles badly.
		const slower = gpuTime(gpuPage([1.9, 1.9, 2], [30, 28, 40]));
		expect(slower).toMatchObject({ result: 'slower', rounds: 3, allowedMs: 0.475 });
		expect(compare(gpuPage([1.9, 1.9, 2], [30, 28, 40])).comparisons.map((c) => c.result)).toEqual([
			'same',
			'same',
			'slower',
		]);
		expect(gpuTime(gpuPage([4, 4, 4], [1.9, 2, 2]))?.result).toBe('faster');
	});

	test('allows GPU time a wide rule, since the GPU changes its clock with its load', () => {
		expect(RULES['gpu-time']).toEqual({ share: 0.25, floorMs: 0.3 });
		// 20% slower stays within the share, and 0.25 ms more within the floor of a short frame.
		expect(gpuTime(gpuPage([4, 4, 4], [4.8, 4.8, 4.8]))?.result).toBe('same');
		expect(gpuTime(gpuPage([1, 1, 1], [1.25, 1.25, 1.25]))?.result).toBe('same');
		expect(gpuTime(gpuPage([4, 4, 4], [5.2, 5.2, 5.2]))?.result).toBe('slower');
	});

	test('leaves GPU time out where too few rounds have it from both builds', () => {
		// CI's Mac machine has no GPU timer, so no run times the GPU there.
		expect(gpuTime(gpuPage([null, null, null], [null, null, null]))).toBeUndefined();
		expect(gpuTime(gpuPage([2, 2, 2], [null, null, null]))).toBeUndefined();
		// Only the rounds in which both builds timed the GPU compare.
		expect(gpuTime(gpuPage([2, null, 2], [3, 3, null]))).toBeUndefined();
		expect(gpuTime(gpuPage([2, 2, null], [3, 3, 3]))).toMatchObject({
			rounds: 2,
			baseline: { runs: 2 },
			new: { runs: 3 },
			result: 'slower',
		});
	});

	test('gives a slower page the trailer that names it', () => {
		const runs = [
			...page([2, 2, 2], [2.5, 2.5, 2.5]),
			...page([2, 2, 2], [2.5, 2.5, 2.5], {}, 's2', 'null3d-webgl2'),
		];
		const expected = trailer('Bench-Expected: s2/null3d-webgl2: the batch pass now writes normals');
		const { comparisons } = compare(runs, [expected]);
		const slower = comparisons.filter((c) => c.result === 'slower');
		expect(slower.map((c) => [c.scene, c.kind, c.expected])).toEqual([
			['s1', 'null3d-webgpu', null],
			['s1', 'null3d-webgpu', null],
			['s2', 'null3d-webgl2', expected],
			['s2', 'null3d-webgl2', expected],
		]);
	});
});

describe('the expected-change trailer', () => {
	test('names benchmarks by scene, page and measure, with * for any', () => {
		expect(
			trailer('Bench-Expected: s1: the scene now moves twice as many boxes').selectors,
		).toEqual([{ scene: 's1', kind: null, measure: null }]);
		expect(trailer('Bench-Expected: *: every frame now runs the HDR final pass')).toEqual({
			selectors: [{ scene: null, kind: null, measure: null }],
			reason: 'every frame now runs the HDR final pass',
			line: 'Bench-Expected: *: every frame now runs the HDR final pass',
		});
		expect(
			trailer('Bench-Expected: */null3d-webgl2/own-work, s2/null3d-webgpu: uploads move to a ring')
				.selectors,
		).toEqual([
			{ scene: null, kind: 'null3d-webgl2', measure: 'own-work' },
			{ scene: 's2', kind: 'null3d-webgpu', measure: null },
		]);
	});

	test('counts anywhere in a message, as a squash merge lists each commit', () => {
		const squash = [
			'feat(render): add the final pass (#60)',
			'',
			'* feat(render): add the final pass',
			'',
			'Bench-Expected: *: the final pass adds a full-screen draw to each frame',
			'Docs-Checked: updated docs/concepts/color.md',
			'',
			'* fix(render): clamp the exposure',
		].join('\n');
		const other =
			'perf: trim uploads\n\nbench-expected: s1/null3d-webgpu: the ring is larger now\n';
		const { changes, problems } = readExpectedChanges([squash, other], KNOWN);
		expect(problems).toEqual([]);
		expect(changes.map((c) => c.reason)).toEqual([
			'the final pass adds a full-screen draw to each frame',
			'the ring is larger now',
		]);
	});

	test('does not count without a reason, or with a name it does not know', () => {
		const lines = [
			'Bench-Expected: the whole engine got slower',
			'Bench-Expected: s1: yes',
			'Bench-Expected: s3: a new scene that does not exist',
			'Bench-Expected: s1/null3d-webgpu/gpu-memory: the GPU holds more now',
			'Bench-Expected: s1/null3d-webgpu/own-work/extra: one part too many here',
			'Bench-Expected: s1//own-work: an empty part in the middle',
			'Bench-Expected: s1/threejs-webgl: a page that the comparison does not run',
		];
		const { changes, problems } = readExpectedChanges([lines.join('\n')], KNOWN);
		expect(changes).toEqual([]);
		expect(problems).toHaveLength(lines.length);
		expect(problems[0]).toContain('it needs the benchmarks, a colon and a reason');
		expect(problems[1]).toContain('it needs the benchmarks, a colon and a reason');
		expect(problems[2]).toContain('"s3" is not a scene');
		expect(problems[3]).toContain(
			'"gpu-memory" is not a measure; use one of busiest-thread, own-work, gpu-time',
		);
		expect(problems[4]).toContain('is not a benchmark');
		expect(problems[5]).toContain('is not a benchmark');
		expect(problems[6]).toContain('"threejs-webgl" is not a page');
	});
});

describe('the verdict', () => {
	test('passes when no page is slower than the rule allows', () => {
		const runs = page([2, 2, 2], [1.9, 2, 2.05]);
		expect(judge(compare(runs))).toEqual({ pass: true, failures: [], measurementChanges: [] });
	});

	test('fails on a slower page that no trailer names, and says which', () => {
		const runs = [
			...page([2, 2, 2], [2.5, 2.5, 2.5]),
			...page([1, 1, 1], [1, 1, 1], {}, 's2', 'null3d-webgl2'),
		];
		const other = trailer('Bench-Expected: s2: the trees now have one more level');
		const verdict = judge(compare(runs, [other]));
		expect(verdict.pass).toBe(false);
		expect(verdict.failures).toEqual([
			's1 null3d-webgpu, busiest thread: +25.0% slower, noise 0.0% (medians 2.000 ms and 2.500 ms)',
			's1 null3d-webgpu, own work: +25.0% slower, noise 0.0% (medians 2.000 ms and 2.500 ms)',
		]);
	});

	test('passes a slower page that a trailer names', () => {
		const runs = page([2, 2, 2], [2.2, 2.2, 2.2]);
		const expected = trailer('Bench-Expected: s1/null3d-webgpu: culling now tests every box');
		expect(judge(compare(runs, [expected])).pass).toBe(true);
	});

	test('fails when the new build kept too few runs of a page, but not when the baseline did', () => {
		const verdict = judge(compare(failBuild(page([1, 1, 1], [1, 1, 1]), 'new')));
		expect(verdict).toEqual({
			pass: false,
			failures: [
				's1 null3d-webgpu: the new build kept 0 runs of 3 and the baseline 3 runs of 3, so 0 rounds have a run of each, and a comparison needs 2',
			],
			measurementChanges: [],
		});
		expect(judge(compare(failBuild(page([1, 1, 1], [1, 1, 1]), 'baseline'))).pass).toBe(true);
	});

	test('reports and passes every page when the measurement changed', () => {
		const changes = ['the benchmark pages changed: bench/pages/lib/options.ts'];
		const verdict = judge(compare(page([2, 2, 2], [2.5, 2.5, 2.5])), changes);
		expect(verdict.pass).toBe(true);
		expect(verdict.failures).toHaveLength(2);
		expect(verdict.measurementChanges).toEqual(changes);
	});
});

describe('a change to the measurement', () => {
	test('names the changed page sources, and counts those past the first few', () => {
		expect(measurementChanges([], COMPARISON_SWITCHES)).toEqual([]);
		expect(measurementChanges(['bench/scenes/spec.ts'], COMPARISON_SWITCHES)).toEqual([
			'the benchmark pages changed: bench/scenes/spec.ts',
		]);
		const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((name) => `bench/pages/${name}.ts`);
		expect(measurementChanges(files, COMPARISON_SWITCHES)).toEqual([
			'the benchmark pages changed: bench/pages/a.ts, bench/pages/b.ts, bench/pages/c.ts, bench/pages/d.ts, bench/pages/e.ts and 2 more files',
		]);
	});

	test("notices that the baseline's comparison had other switches, or none", () => {
		expect(measurementChanges([], [], ['preset=high', 'governor=off'])).toEqual([
			"the comparison's switches changed from none to `preset=high&governor=off`",
		]);
		expect(measurementChanges([], ['preset=high'], ['preset=high', 'governor=off'])).toEqual([
			"the comparison's switches changed from `preset=high` to `preset=high&governor=off`",
		]);
	});

	test('reads page sources that the repository holds', () => {
		const root = join(import.meta.dir, '../..');
		for (const path of PAGE_SOURCES.filter((source) => !source.startsWith(':')))
			expect(existsSync(join(root, path))).toBe(true);
	});
});

describe('the switches of a comparison', () => {
	test('fix the preset and turn the governor off on every page', () => {
		expect(COMPARISON_SWITCHES).toEqual(['preset=high', 'governor=off']);
		expect(comparisonSwitches('')).toEqual(['preset=high', 'governor=off']);
		expect(comparisonSwitches('shadows=3')).toEqual(['preset=high', 'governor=off']);
	});

	test('leave out a switch that the command sets itself', () => {
		expect(comparisonSwitches('preset=low&shadows=3')).toEqual(['governor=off']);
		expect(comparisonSwitches('governor=off')).toEqual(['preset=high']);
	});
});

describe('the quality of each run', () => {
	test('records the preset and the steps of each run that published a result', () => {
		const runs = [
			run('baseline', 1, result(1, { preset: 'high', steps: [0, 2, 1] }), 's4'),
			run('new', 1, result(1, { preset: 'medium' })),
			run('new', 2, FAILED),
		];
		expect(runQualities(runs)).toEqual([
			{ build: 'baseline', scene: 's4', kind: 'null3d-webgpu', round: 1, preset: 'high', steps: 3 },
			{ build: 'new', scene: 's1', kind: 'null3d-webgpu', round: 1, preset: 'medium', steps: null },
		]);
	});

	test('sums up pages at one preset, and lists the rounds of a page whose presets differ', () => {
		const runs = [
			...page([1, 1], [1, 1], { preset: 'high' }),
			...page([1, 1], [1, 1], { preset: 'medium' }, 's1', 'null3d-webgl2'),
			...page([1, 1], [1, 1], { preset: 'high', steps: [0, 0] }, 's4'),
			run('baseline', 1, result(1, { preset: 'low' }), 's2', 'null3d-webgl2'),
			run('new', 1, result(1, { preset: 'medium' }), 's2', 'null3d-webgl2'),
			run('baseline', 2, result(1, { preset: 'medium' }), 's2', 'null3d-webgl2'),
		];
		expect(qualityLines(runQualities(runs))).toEqual([
			'',
			'Quality preset in every run of both builds: high on s1 null3d-webgpu, s4 null3d-webgpu; medium on s1 null3d-webgl2.',
			'',
			'Pages whose runs drew at different quality presets, round by round:',
			'- s2 null3d-webgl2: round 1 baseline low, new medium; round 2 baseline medium, new no run',
			'',
			'Quality steps in the measured seconds: none in any run of s4 null3d-webgpu.',
		]);
	});

	test('names each run in which the quality changed during the measured seconds', () => {
		const runs = [
			...page([1, 1], [1, 1], { preset: 'high', steps: [0, 0] }, 's4'),
			run('new', 3, result(1, { preset: 'high', steps: [1, 0, 1] }), 's4'),
		];
		expect(qualityLines(runQualities(runs)).at(-1)).toBe(
			'Quality steps in the measured seconds: new s4 null3d-webgpu round 3 took 2.',
		);
	});

	test('says when the pages report no preset', () => {
		expect(qualityLines(runQualities(page([1, 1], [1, 1])))).toEqual([
			'',
			'Quality preset in every run of both builds: not reported on s1 null3d-webgpu.',
		]);
	});
});

describe('the report', () => {
	const context = {
		baseline: 'abc1234 "fix: a"',
		new: 'def5678 "perf: x"',
		runs: 3,
		warmupSeconds: 10,
		measureSeconds: 10,
		browser: 'Chrome 152 on macOS',
	};

	test('gives the verdict, each comparison with GPU time, the runs dropped and the trailers', () => {
		const runs = [
			...page([2, 2, 2], [2.5, 2.5, 2.5], { gpuMs: 3 }),
			run('new', 4, result(2, { refreshHz: 30 })),
			...page([1, 1, 1], [1, 1, 1], {}, 's2', 'null3d-webgl2'),
		];
		const trailers = readExpectedChanges(
			[
				'perf: x\n\nBench-Expected: s1/null3d-webgpu/busiest-thread: culling tests every box\nBench-Expected: s9: nothing here',
			],
			KNOWN,
		);
		const selection = selectRuns(runs);
		const comparison = compareBuilds(selection, trailers.changes);
		const text = compareReport(comparison, judge(comparison), {
			...context,
			selection,
			trailers,
		}).join('\n');
		expect(text).toContain(
			'The new build, def5678 "perf: x", against the baseline, abc1234 "fix: a", in Chrome 152 on macOS.',
		);
		expect(text).toContain('**Failed**: one problem.');
		expect(text).toContain(
			'- s1 null3d-webgpu, own work: +25.0% slower, noise 0.0% (medians 2.000 ms and 2.500 ms)',
		);
		expect(text).toContain(
			'| s1 | null3d-webgpu | busiest thread | 2.000 (2.000 to 2.000) | 2.500 (2.500 to 2.500) | +25.0% | 0.0% | slower, expected: culling tests every box |',
		);
		expect(text).toContain(
			'| s1 | null3d-webgpu | own work | 2.000 (2.000 to 2.000) | 2.500 (2.500 to 2.500) | +25.0% | 0.0% | **slower** |',
		);
		expect(text).toContain(
			'| s2 | null3d-webgl2 | busiest thread | 1.000 (1.000 to 1.000) | 1.000 (1.000 to 1.000) | +0.0% | 0.0% | same |',
		);
		expect(text).toContain(
			'| s1 | null3d-webgpu | GPU time | 3.000 (3.000 to 3.000) | 3.000 (3.000 to 3.000) | +0.0% | 0.0% | same |',
		);
		expect(text).not.toContain('| s2 | null3d-webgl2 | GPU time');
		expect(text).toContain(
			'A run in a browser that times the GPU also gives the median GPU time per frame. The change',
		);
		expect(text).toContain(
			'Refresh rate: 60 Hz on every page. Dropped runs: new s1 null3d-webgpu round 4 (it measured a refresh rate of 30 Hz, not 60 Hz).',
		);
		expect(text).toContain(
			'- `Bench-Expected: s1/null3d-webgpu/busiest-thread: culling tests every box`',
		);
		expect(text).toContain('"s9" is not a scene');
		expect(text).toContain(
			'Quality preset in every run of both builds: not reported on s1 null3d-webgpu, s2 null3d-webgl2.',
		);
	});

	test('says when the comparison passes, and names the pages the baseline kept from it', () => {
		const runs = [
			...page([1, 1, 1], [1, 1, 1]),
			...failBuild(page([1, 1], [1, 1], {}, 's2'), 'baseline'),
		];
		const selection = selectRuns(runs);
		const comparison = compareBuilds(selection);
		const text = compareReport(comparison, judge(comparison), {
			...context,
			selection,
			trailers: { changes: [], problems: [] },
		}).join('\n');
		expect(text).toContain(
			'**Passed**: no page is slower than its rule allows without a Bench-Expected trailer that names it.',
		);
		expect(text).toContain(
			'A page fails when its busiest thread is more than 8% and 0.05 ms slower, or its own work more than 15% and 0.05 ms slower, or its GPU time more than 25% and 0.3 ms slower, and the change is more than 2 times its noise.',
		);
		expect(text).toContain(
			'A run in a browser that times the GPU also gives the median GPU time per frame, and no page here has it from both builds.',
		);
		expect(text).toContain(
			'Not compared: s2 null3d-webgpu, as the new build kept 2 runs of 2 and the baseline 0 runs of 2, so 0 rounds have a run of each, and a comparison needs 2.',
		);
		expect(text).toContain('Refresh rate: 60 Hz on every page. Dropped runs: baseline s2');
	});

	test('says when the measurement changed, and lists the pages it does not judge', () => {
		const selection = selectRuns(page([2, 2, 2], [2.5, 2.5, 2.5]));
		const comparison = compareBuilds(selection);
		const verdict = judge(comparison, ["the comparison's switches changed from none to `x=1`"]);
		const text = compareReport(comparison, verdict, {
			...context,
			selection,
			trailers: { changes: [], problems: [] },
		}).join('\n');
		expect(text).toContain(
			"**Measurement changed**: the run reports every page and judges none, because the two builds measure in different ways. Main's next run compares with this commit.\n- the comparison's switches changed from none to `x=1`",
		);
		expect(text).toContain(
			'Not judged: 2 problems.\n- s1 null3d-webgpu, busiest thread: +25.0% slower, noise 0.0% (medians 2.000 ms and 2.500 ms)',
		);
		expect(text).not.toContain('**Failed**');
	});
});

describe('shards of a comparison', () => {
	const plan = ['s1', 's1-static', 's2'].flatMap((scene) =>
		['null3d-webgpu', 'null3d-webgl2'].map((kind) => ({ scene, kind })),
	);
	const names = (pages: readonly PlanPage[]) => pages.map(pageName);

	/** The record of one shard of the plan, with two rounds of each of its pages; S2 doubles. */
	function record(index: number, count: number, fields: Partial<ComparisonRecord> = {}) {
		const pages = shardPages(plan, { index, count });
		return {
			shard: { index, count },
			plan,
			pages,
			commits: { baseline: 'abc1234 "fix: a"', new: 'def5678 "perf: x"' },
			messages: ['perf: x\n\nBench-Expected: s2/null3d-webgl2: the trees now have one more level'],
			measurementChanges: [],
			browser: 'Chrome 152 on macOS',
			runs: 2,
			warmupSeconds: 5,
			measureSeconds: 5,
			results: pages.flatMap(({ scene, kind }) =>
				page([1, 1], scene === 's2' ? [2, 2] : [1, 1], {}, scene, kind),
			),
			...fields,
		} satisfies ComparisonRecord;
	}

	test('split the plan into shares that differ by one page at most', () => {
		expect(names(shardPages(plan, { index: 1, count: 4 }))).toEqual([
			's1 null3d-webgpu',
			's2 null3d-webgpu',
		]);
		expect(names(shardPages(plan, { index: 4, count: 4 }))).toEqual(['s1-static null3d-webgl2']);
		const shares = [1, 2, 3, 4].flatMap((index) => names(shardPages(plan, { index, count: 4 })));
		expect(shares.toSorted()).toEqual(names(plan).toSorted());
	});

	test('merge into the record of the whole plan, in the plan order', () => {
		const merged = mergeRecords([record(2, 2), record(1, 2)]);
		expect(merged.shard).toBeNull();
		expect(merged.pages).toEqual(plan);
		expect([...new Set(merged.results.map(pageName))]).toEqual(names(plan));
		expect(merged.results).toHaveLength(plan.length * 4);
		expect(merged.browser).toBe(
			'Chrome 152 on macOS, in 2 shards of the pages, each on a machine of its own',
		);
	});

	test('judge the merged record as one comparison of the whole plan would', () => {
		const alone = judgeRecord(record(1, 1, { shard: null }), KNOWN);
		const { report, verdict, summary } = judgeRecord(
			mergeRecords([record(1, 3), record(2, 3), record(3, 3)]),
			KNOWN,
		);
		expect(verdict).toEqual(alone.verdict);
		expect(verdict).toEqual({
			pass: false,
			failures: [
				's2 null3d-webgpu, busiest thread: +100.0% slower, noise 0.0% (medians 1.000 ms and 2.000 ms)',
				's2 null3d-webgpu, own work: +100.0% slower, noise 0.0% (medians 1.000 ms and 2.000 ms)',
			],
			measurementChanges: [],
		});
		expect(report.slice(3)).toEqual(alone.report.slice(3));
		expect(report.join('\n')).toContain(
			'| s2 | null3d-webgl2 | busiest thread | 1.000 (1.000 to 1.000) | 2.000 (2.000 to 2.000) | +100.0% | 0.0% | slower, expected: the trees now have one more level |',
		);
		expect(summary).toMatchObject({ shard: null, verdict });
		expect((summary as { quality: unknown[] }).quality).toHaveLength(plan.length * 4);
	});

	test('refuse records that miss a page, hold one twice or disagree', () => {
		expect(() => mergeRecords([])).toThrow('there are no shard records to merge');
		expect(() => mergeRecords([record(1, 3), record(3, 3)])).toThrow(
			'no shard record holds s1 null3d-webgl2, s2 null3d-webgpu: rerun the shards that failed',
		);
		expect(() => mergeRecords([record(1, 2), record(1, 2), record(2, 2)])).toThrow(
			'two shard records hold s1 null3d-webgpu',
		);
		expect(() =>
			mergeRecords([record(1, 2), record(2, 2, { commits: { baseline: 'a', new: 'b' } })]),
		).toThrow('the shard records differ in their commits');
		expect(() => mergeRecords([record(1, 2), record(2, 2, { runs: 3 })])).toThrow(
			'the shard records differ in their number of rounds',
		);
		expect(() =>
			mergeRecords([record(1, 2), record(2, 2, { measurementChanges: ['the pages changed'] })]),
		).toThrow('the shard records differ in their measurement changes');
	});
});

describe('recorded comparisons of identical builds', () => {
	/** Each page's paired rounds: the round, then each build's busiest thread and own work in ms. */
	interface Recorded {
		run: number;
		commits: string;
		pages: Record<string, [number, number, number, number, number][]>;
	}
	const { comparisons: recorded } = identicalBuilds as unknown as { comparisons: Recorded[] };

	/** A run whose busiest thread takes `busy` ms per frame, of which the engine's own work is `own`. */
	const measured = (busy: number, own: number) => result(busy, { update: busy - own, frames: 300 });

	/** The recorded runs, with `slow` applied to the new build's times on each page. */
	function runsOf(comparison: Recorded, slow: (ms: number, page: string) => number = (ms) => ms) {
		return Object.entries(comparison.pages).flatMap(([name, rounds]) => {
			const [scene = '', kind = ''] = name.split(' ');
			return rounds.flatMap(([round, baseBusy, baseOwn, newBusy, newOwn]) => [
				run('baseline', round, measured(baseBusy, baseOwn), scene, kind),
				run('new', round, measured(slow(newBusy, name), slow(newOwn, name)), scene, kind),
			]);
		});
	}

	/** The pages and measures that each comparison calls slower. */
	const slowerPages = (slow?: (ms: number, page: string) => number) =>
		recorded.map((comparison) =>
			compare(runsOf(comparison, slow))
				.comparisons.filter((c) => c.result === 'slower')
				.map((c) => `${pageName(c)} ${c.measure}`),
		);

	const isS1 = (page: string) => page.startsWith('s1 ');

	test('hold 18 comparisons, with S1 and S2 on both GPU paths in each', () => {
		expect(recorded).toHaveLength(18);
		for (const comparison of recorded)
			expect(Object.keys(comparison.pages)).toEqual(
				expect.arrayContaining(['s1 null3d-webgpu', 's1 null3d-webgl2', 's2 null3d-webgpu']),
			);
	});

	test('pass, with no page slower', () => {
		expect(slowerPages().filter((pages) => pages.length > 0)).toEqual([]);
		for (const comparison of recorded) expect(judge(compare(runsOf(comparison))).pass).toBe(true);
	});

	test('failed in most cases under the rules without the floor and the noise check', () => {
		const before: Record<Measure, Rule> = {
			'busiest-thread': { share: 0.05, floorMs: 0.01 },
			'own-work': { share: 0.15, floorMs: 0.02 },
			// The recorded runs timed no GPU, so GPU time's rule decides nothing here.
			'gpu-time': RULES['gpu-time'],
		};
		const failed = recorded.filter((comparison) =>
			compareBuilds(selectRuns(runsOf(comparison)), [], before, 0).comparisons.some(
				(c) => c.result === 'slower',
			),
		);
		expect(failed).toHaveLength(11);
	});

	/** Whether a comparison calls the page slower on either measure. */
	const caught = (pages: readonly string[], page: string) =>
		pages.some((entry) => entry.startsWith(`${page} `));

	test('fail on S1, and on no other page, when S1 gets 20% slower, but in the noisiest run', () => {
		const slower = slowerPages((ms, page) => (isS1(page) ? ms * 1.2 : ms));
		expect(slower.every((pages) => pages.every(isS1))).toBe(true);
		// One run's S1 rounds on WebGL2 spread from 0.38 to 1.42 times the baseline, and miss it.
		const both = slower.filter(
			(pages) => caught(pages, 's1 null3d-webgpu') && caught(pages, 's1 null3d-webgl2'),
		);
		expect(both).toHaveLength(recorded.length - 1);
		expect(slower.every((pages) => pages.some(isS1))).toBe(true);
	});

	test('fail on the pages whose frames are short when they get 0.1 ms slower, but in the noisiest', () => {
		const slower = slowerPages((ms, page) => (isS1(page) ? ms : ms + 0.1));
		const pages = recorded.flatMap((comparison, k) =>
			Object.keys(comparison.pages)
				.filter((page) => !isS1(page))
				.map((page) => caught(slower[k] ?? [], page)),
		);
		// One run's S2 rounds on WebGL2 spread from 0.61 to 1.64 times the baseline, so a change of
		// 0.1 ms stays within twice their noise.
		expect(pages.filter((hit) => !hit)).toHaveLength(1);
		expect(pages.length).toBeGreaterThan(150);
	});
});
