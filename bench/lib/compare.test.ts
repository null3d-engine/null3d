import { describe, expect, test } from 'bun:test';
import {
	allowedMs,
	type Build,
	type BuildRun,
	compareBuilds,
	compareReport,
	type ExpectedChange,
	judge,
	MIN_ROUNDS,
	RULE,
	readExpectedChanges,
	roundOrder,
	selectRuns,
} from './compare';
import type { BenchResult } from './report';

interface RunFacts {
	/** The sketch worker's update phase, which own work leaves out. */
	update?: number;
	refreshHz?: number | null;
	frames?: number;
	gpuMs?: number | null;
}

/** A null3D page's result whose busiest thread, the sketch worker, takes `cpu` ms per frame. */
function result(
	cpu: number,
	{ update = 0, refreshHz = 60, frames = 600, gpuMs = null }: RunFacts = {},
) {
	return {
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

describe('the rule', () => {
	test('allows 3% of the baseline, and at least two steps of the 5-microsecond timer', () => {
		expect(RULE).toEqual({ share: 0.03, floorMs: 0.01 });
		expect(allowedMs(2)).toBeCloseTo(0.06);
		expect(allowedMs(0.1)).toBe(0.01);
		expect(allowedMs(0)).toBe(0.01);
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

	test('calls a page slower or faster only beyond the rule', () => {
		const slower = compare(page([2, 2, 2], [2.1, 2.1, 2.1])).comparisons[0];
		expect(slower?.result).toBe('slower');
		expect(slower?.change).toBeCloseTo(0.05);
		expect(slower?.deltaMs).toBeCloseTo(0.1);
		expect(slower?.allowedMs).toBeCloseTo(0.06);
		const within = compare(page([2, 2, 2], [2.05, 2.05, 2.05])).comparisons[0];
		expect(within?.result).toBe('same');
		const faster = compare(page([2, 2, 2], [1.9, 1.9, 1.9])).comparisons[0];
		expect(faster?.result).toBe('faster');
	});

	test('lets a small time move by the timer steps that the rule allows', () => {
		// 0.1 ms to 0.11 ms is 10% slower, but only two steps of the browser's timer.
		const { comparisons } = compare(page([0.1, 0.1, 0.1], [0.11, 0.11, 0.11]));
		expect(comparisons.map((c) => c.result)).toEqual(['same', 'same']);
		const beyond = compare(page([0.1, 0.1, 0.1], [0.115, 0.115, 0.115]));
		expect(beyond.comparisons[0]?.result).toBe('slower');
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

	test('reports the GPU time of each build where the runs timed it', () => {
		const webgpu = page([1, 1, 1], [1, 1, 1], { gpuMs: 2 });
		const webgl2 = page([1, 1, 1], [1, 1, 1], {}, 's1', 'null3d-webgl2');
		const { gpu } = compare([...webgpu, ...webgl2]);
		expect(gpu).toEqual([
			{ scene: 's1', kind: 'null3d-webgpu', baselineMs: 2, newMs: 2 },
			{ scene: 's1', kind: 'null3d-webgl2', baselineMs: null, newMs: null },
		]);
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
			'Bench-Expected: s1/null3d-webgpu/gpu-time: the GPU does more work now',
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
			'"gpu-time" is not a measure; use one of busiest-thread, own-work',
		);
		expect(problems[4]).toContain('is not a benchmark');
		expect(problems[5]).toContain('is not a benchmark');
		expect(problems[6]).toContain('"threejs-webgl" is not a page');
	});
});

describe('the verdict', () => {
	test('passes when no page is slower than the rule allows', () => {
		const runs = page([2, 2, 2], [1.9, 2, 2.05]);
		expect(judge(compare(runs))).toEqual({ pass: true, failures: [] });
	});

	test('fails on a slower page that no trailer names, and says which', () => {
		const runs = [
			...page([2, 2, 2], [2.2, 2.2, 2.2]),
			...page([1, 1, 1], [1, 1, 1], {}, 's2', 'null3d-webgl2'),
		];
		const other = trailer('Bench-Expected: s2: the trees now have one more level');
		const verdict = judge(compare(runs, [other]));
		expect(verdict.pass).toBe(false);
		expect(verdict.failures).toEqual([
			's1 null3d-webgpu, busiest thread: +10.0% slower (medians 2.000 ms and 2.200 ms)',
			's1 null3d-webgpu, own work: +10.0% slower (medians 2.000 ms and 2.200 ms)',
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
		});
		expect(judge(compare(failBuild(page([1, 1, 1], [1, 1, 1]), 'baseline'))).pass).toBe(true);
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

	test('gives the verdict, each comparison, GPU time, the runs dropped and the trailers', () => {
		const runs = [
			...page([2, 2, 2], [2.2, 2.2, 2.2], { gpuMs: 3 }),
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
			'- s1 null3d-webgpu, own work: +10.0% slower (medians 2.000 ms and 2.200 ms)',
		);
		expect(text).toContain(
			'| s1 | null3d-webgpu | busiest thread | 2.000 (2.000 to 2.000) | 2.200 (2.200 to 2.200) | +10.0% | slower, expected: culling tests every box |',
		);
		expect(text).toContain(
			'| s1 | null3d-webgpu | own work | 2.000 (2.000 to 2.000) | 2.200 (2.200 to 2.200) | +10.0% | **slower** |',
		);
		expect(text).toContain(
			'| s2 | null3d-webgl2 | busiest thread | 1.000 (1.000 to 1.000) | 1.000 (1.000 to 1.000) | +0.0% | same |',
		);
		expect(text).toContain(
			'GPU time per frame, reported and not judged: s1 null3d-webgpu 3.000 ms to 3.000 ms.',
		);
		expect(text).toContain(
			'Refresh rate: 60 Hz on every page. Dropped runs: new s1 null3d-webgpu round 4 (it measured a refresh rate of 30 Hz, not 60 Hz).',
		);
		expect(text).toContain(
			'- `Bench-Expected: s1/null3d-webgpu/busiest-thread: culling tests every box`',
		);
		expect(text).toContain('"s9" is not a scene');
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
			'**Passed**: no page is more than 3% and 0.01 ms slower without a Bench-Expected trailer that names it.',
		);
		expect(text).toContain(
			'Not compared: s2 null3d-webgpu, as the new build kept 2 runs of 2 and the baseline 0 runs of 2, so 0 rounds have a run of each, and a comparison needs 2.',
		);
		expect(text).toContain('Refresh rate: 60 Hz on every page. Dropped runs: baseline s2');
	});
});
