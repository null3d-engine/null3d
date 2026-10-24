import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	benchFolder,
	browserPictures,
	budgetLines,
	checkFigure,
	commandText,
	comparisonFigure,
	countedRun,
	desktopTarget,
	GATE_WORKFLOWS,
	type GateRecord,
	gateMarkdown,
	gateSteps,
	parityCount,
	playwrightCounts,
	releaseVersion,
	workflowResult,
} from './gate';
import { type BenchResult, type RunSummary, type SummaryRow, summarizeRuns } from './report';

function result(cpu: number): BenchResult {
	return {
		ok: true,
		scene: 's1',
		renderer: 'null3d',
		n: 1000,
		frames: 100,
		cpuMs: { median: cpu, p95: cpu, p99: cpu, mean: cpu },
		intervalMs: { median: 16.7, p95: 20, p99: 33.4 },
	};
}

/** S1's rows: null3D's sketch worker and its update phase, three.js's two renderers, the scene code. */
function s1Rows(sketchMs: number, updateMs: number): SummaryRow[] {
	const null3d: RunSummary = {
		...summarizeRuns([result(sketchMs)]),
		threadsMs: { 'sketch-worker': sketchMs, 'render-worker': 0.1 },
		phases: { 'sketch-worker.update': updateMs },
	};
	return [
		{ scene: 's1', kind: 'null3d-webgpu', summary: null3d },
		{ scene: 's1', kind: 'threejs-webgpu', summary: summarizeRuns([result(3.6)]) },
		{ scene: 's1', kind: 'threejs-webgl', summary: summarizeRuns([result(3.2)]) },
		{ scene: 's1', kind: 'scene-code', summary: summarizeRuns([result(2.4)]) },
	];
}

const step = (id: string) => {
	const found = gateSteps({ commit: 'abc', quick: false }).find((s) => s.id === id);
	if (!found) throw new Error(`no step ${id}`);
	return found;
};

describe('the gate steps', () => {
	test("read Playwright's closing counts", () => {
		expect(playwrightCounts('  ✓ 334 [x] › a\n\n  334 passed (1.4m)\n')).toBe('334 passed');
		expect(playwrightCounts('  2 failed\n  1 flaky\n  331 passed (3.0m)')).toBe(
			'2 failed, 1 flaky, 331 passed',
		);
		expect(playwrightCounts('error: no browser')).toBe('no test counts in the output');
	});

	test('read the parity count and the budget lines', () => {
		expect(parityCount('pass  s1 webgpu: ...\n46 of 46 comparisons pass.')).toBe(
			'46 of 46 comparisons pass',
		);
		const sizes = [
			'  threaded/null3d_bg.wasm      raw   422.6 KB   brotli   144.2 KB  24.0% of budget',
			'  threaded/null3d.js           raw    30.1 KB   brotli     6.5 KB',
			'  pipelined                    raw  1078.6 KB   brotli    83.9 KB  83.9% of budget',
		].join('\n');
		expect(budgetLines(sizes)).toBe(
			'threaded/null3d_bg.wasm raw 422.6 KB brotli 144.2 KB 24.0% of budget; pipelined raw 1078.6 KB brotli 83.9 KB 83.9% of budget',
		);
	});

	test("read a check's first problem, past the package manager's closing line", () => {
		const output =
			'docs OK\npackage.json defines "gate", but AGENTS.md does not document bun run gate\nerror: script "docs:check" exited with code 1';
		expect(checkFigure({ output, exitCode: 1 })).toBe(
			'package.json defines "gate", but AGENTS.md does not document bun run gate',
		);
		expect(checkFigure({ output: 'OK', exitCode: 0 })).toBe('no problems');
		expect(checkFigure({ output: 'error: script "x" exited with code 2', exitCode: 2 })).toBe(
			'exit 2, see the log',
		);
	});

	test('judge the release version', () => {
		const release = step('release');
		const out = (output: string, exitCode = 0) => release.read({ output, exitCode, root: '.' });
		expect(releaseVersion('$ bun tools/release.ts\nversion: 0.1.0 (bump: minor)')).toBe('0.1.0');
		expect(out('version: 0.1.0 (bump: minor, previous: none)').verdict).toBe('pass');
		expect(out('version: 0.2.0 (bump: minor)').verdict).toBe('fail');
		expect(out('version: 0.1.0', 1).verdict).toBe('fail');
	});

	test("judge the gate commit's workflows by the newest counted run of each", () => {
		const runs = (list: object[]) => `[${list.map((r) => JSON.stringify(r)).join(',')}]`;
		const ci = {
			workflowName: 'CI',
			event: 'push',
			headBranch: 'main',
			status: 'completed',
			conclusion: 'success',
		};
		const bench = {
			workflowName: 'Benchmarks',
			event: 'schedule',
			status: 'completed',
			conclusion: 'success',
		};
		expect(workflowResult(runs([ci, bench]))).toEqual({
			figure: 'CI: success, Benchmarks: success',
			verdict: 'pass',
		});
		// A newer run that is still going is the one that counts.
		expect(
			workflowResult(runs([{ ...bench, status: 'in_progress', conclusion: '' }, ci, bench])),
		).toEqual({ figure: 'CI: success, Benchmarks: in_progress', verdict: 'fail' });
		expect(workflowResult(runs([ci])).figure).toBe('CI: success, Benchmarks: no run');
		// A pull request's run tested GitHub's merge of it into an older main, not this commit.
		const pullRun = { ...ci, event: 'pull_request', conclusion: 'failure' };
		expect(workflowResult(runs([pullRun, ci, bench])).verdict).toBe('pass');
		expect(workflowResult(runs([{ ...pullRun, conclusion: 'success' }, bench]))).toEqual({
			figure: 'CI: no run, Benchmarks: success',
			verdict: 'fail',
		});
		// A push to a milestone branch runs only the quick checks, which pass with no browser job.
		const quick = { ...ci, headBranch: 'm3-start' };
		expect(workflowResult(runs([quick, bench])).figure).toBe('CI: no run, Benchmarks: success');
		// A full run started by hand counts as main's own run does, and the newer of them decides.
		const byHand = { ...ci, event: 'workflow_dispatch' };
		expect(workflowResult(runs([byHand, { ...ci, conclusion: 'failure' }, bench])).verdict).toBe(
			'pass',
		);
		expect(workflowResult(runs([{ ...byHand, conclusion: 'failure' }, ci, bench])).verdict).toBe(
			'fail',
		);
		expect(workflowResult('not json').verdict).toBe('fail');
	});

	test("judge the commit's software-renderer pictures by its CI browser jobs", () => {
		const run = {
			databaseId: 42,
			workflowName: 'CI',
			event: 'push',
			status: 'completed',
			conclusion: 'success',
		};
		const job = (name: string, status = 'completed', conclusion = 'success') => ({
			name,
			status,
			conclusion,
		});
		const pictures = (jobs: object[], counted: object | null = run) =>
			browserPictures(JSON.stringify({ run: counted, jobs }));
		const shard = (n: number, of = 2, conclusion = 'success') =>
			job(`browser (shard ${n} of ${of})`, 'completed', conclusion);
		const heavy = (conclusion = 'success') =>
			job('browser (heavy tests, 1 of 12)', 'completed', conclusion);

		expect(pictures([shard(1), shard(2), heavy(), job('browser (the city)')])).toEqual({
			figure: 'CI run 42 (push): 2 browser shards, 1 heavy-test shard and the city job passed',
			verdict: 'pass',
		});
		// The heavy-test jobs draw the demos' and the environments' pictures, which the shards leave out.
		expect(pictures([shard(1), shard(2), heavy('failure'), job('browser (the city)')])).toEqual({
			figure:
				'CI run 42 (push): 1 of 4 manifest jobs did not pass: browser (heavy tests, 1 of 12) failure',
			verdict: 'fail',
		});
		expect(pictures([shard(1), shard(2), job('browser (the city)')]).figure).toContain(
			'ran no heavy-test job',
		);
		// The manifest jobs decide the step. CI's own workflow step judges every other job.
		expect(
			pictures([
				shard(1),
				shard(2),
				heavy(),
				job('browser (the city)'),
				job('browser (the production build, engine)', 'completed', 'failure'),
			]).verdict,
		).toBe('pass');
		expect(
			pictures([shard(1, 2, 'failure'), shard(2), heavy(), job('browser (the city)')]),
		).toEqual({
			figure: 'CI run 42 (push): 1 of 4 manifest jobs did not pass: browser (shard 1 of 2) failure',
			verdict: 'fail',
		});
		// A job that has not finished is no evidence.
		expect(
			pictures([
				shard(1),
				job('browser (shard 2 of 2)', 'in_progress', ''),
				heavy(),
				job('browser (the city)'),
			]).verdict,
		).toBe('fail');
		// A docs-only run skips every job that draws the manifest, with the matrix left unread.
		expect(
			pictures([
				job(
					// biome-ignore lint/suspicious/noTemplateCurlyInString: CI reports a skipped job's matrix unread
					'browser (shard ${{ matrix.shard }} of ${{ strategy.job-total }})',
					'completed',
					'skipped',
				),
				job('browser (the city)', 'completed', 'skipped'),
			]).verdict,
		).toBe('fail');
		expect(pictures([], null)).toEqual({
			figure: 'no CI run of the commit from a push or a run started by hand',
			verdict: 'fail',
		});
		expect(pictures([job('browser-caches')])).toEqual({
			figure:
				'CI run 42 (push) ran no browser shard job and no heavy-test job and no city job for the manifest: success',
			verdict: 'fail',
		});
		expect(pictures([shard(1), heavy()]).figure).toContain('ran no city job');
		expect(browserPictures('not json').verdict).toBe('fail');
		// An output with no jobs field is no evidence either.
		expect(browserPictures('null').verdict).toBe('fail');
		expect(browserPictures(JSON.stringify({ run })).figure).toContain(
			'ran no browser shard job and no heavy-test job and no city job',
		);
	});

	test('count a CI run of a push to main or a run started by hand, and no quick run', () => {
		const run = {
			databaseId: 42,
			workflowName: 'CI',
			event: 'push',
			headBranch: 'main',
			status: 'completed',
			conclusion: 'success',
		};
		const ci = GATE_WORKFLOWS.find(({ name }) => name === 'CI');
		if (!ci) throw new Error('the gate lists no CI workflow');
		expect(countedRun([{ ...run, event: 'pull_request' }], ci)).toBeNull();
		expect(countedRun([{ ...run, headBranch: 'm3-start' }], ci)).toBeNull();
		const byHand = { ...run, event: 'workflow_dispatch', headBranch: 'm3-start', databaseId: 43 };
		expect(countedRun([byHand, run], ci)).toEqual(byHand);
		expect(countedRun([{ ...run, headBranch: 'm3-start', databaseId: 41 }, run], ci)).toEqual(run);
	});

	test('judge the desktop target by own work against three.js', () => {
		// Own work 2.54 - 2.38 = 0.16 ms against three.js's faster 3.2 - 2.4 = 0.8 ms: 20%.
		const pass = desktopTarget(s1Rows(2.54, 2.38));
		expect(pass.verdict).toBe('pass');
		expect(pass.figure).toContain('20.0% of three.js');
		// 2.9 - 2.38 = 0.52 ms: 65%.
		expect(desktopTarget(s1Rows(2.9, 2.38)).verdict).toBe('fail');
		expect(desktopTarget(s1Rows(2.54, 2.38).slice(0, 3)).verdict).toBe('fail');
	});

	test('read the desktop target from the run that the output names', () => {
		const root = mkdtempSync(join(tmpdir(), 'gate-'));
		mkdirSync(join(root, 'target/bench/run-bench'), { recursive: true });
		writeFileSync(
			join(root, 'target/bench/run-bench/summary.json'),
			JSON.stringify(s1Rows(2.54, 2.38)),
		);
		const output = 'report\n\nresults: target/bench/run-bench';
		expect(benchFolder(output)).toBe('target/bench/run-bench');
		const target = step('desktop-target');
		expect(target.read({ output, exitCode: 0, root }).verdict).toBe('pass');
		expect(target.read({ output: 'no folder', exitCode: 0, root }).verdict).toBe('fail');
	});

	test("keep a benchmark report's comparison lines", () => {
		const output = [
			'| s3 | null3d-webgpu | ... |',
			"s3: null3d on WebGPU takes 21% of the CPU time per frame of three.js's WebGPU renderer.",
			"s3: null3d's own work on WebGPU, on its busiest thread, is 16% of that of three.js.",
			'Failed: s3-threejs-webgl run 1: the shader failed',
		].join('\n');
		expect(comparisonFigure(output).split('; ')).toHaveLength(2);
	});

	test('shorten only the timing runs in a quick run', () => {
		const full = gateSteps({ commit: 'abc', quick: false });
		const quick = gateSteps({ commit: 'abc', quick: true });
		expect(quick.map((s) => s.id)).toEqual(full.map((s) => s.id));
		const changed = quick
			.filter((s, i) => commandText(s) !== commandText(full[i] as (typeof full)[number]))
			.map((s) => s.id);
		// The allocation check keeps its warm-up, which the browser's optimizer needs.
		expect(changed).toEqual(['desktop-target', 'scenes', 'soak-s4', 'startup']);
		expect(commandText(step('images-swiftshader'))).toBe('bun bench/ci-browser-jobs.ts abc');
	});

	test('write a row for each step, and name the failed ones', () => {
		const record: GateRecord = {
			commit: 'abc',
			onMain: true,
			dirty: false,
			quick: false,
			startedAt: '2026-10-03T05:00:00.000Z',
			steps: [
				{
					id: 'parity',
					item: '2',
					what: 'parity',
					command: 'bun run parity',
					seconds: 90,
					figure: '46 of 46 comparisons pass',
					verdict: 'pass',
					log: 'parity.log',
				},
				{
					id: 'workflows',
					item: '1, 3',
					what: 'workflows',
					command: 'gh run list',
					seconds: 1,
					figure: 'CI: success | Benchmarks: failure',
					verdict: 'fail',
					log: 'workflows.log',
				},
			],
		};
		const markdown = gateMarkdown(record);
		expect(markdown).toContain("Commit abc, main's head.");
		expect(markdown).toContain('1 of 2 steps failed: workflows.');
		expect(markdown).toContain('| parity | 2 | pass | 46 of 46 comparisons pass | 1.5 |');
		expect(markdown).toContain('CI: success \\| Benchmarks: failure');
	});
});
