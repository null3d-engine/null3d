import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	benchFolder,
	budgetLines,
	checkFigure,
	commandText,
	comparisonFigure,
	desktopTarget,
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
			event: 'merge_group',
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
		// Main's own CI run, newer than the queue's, runs only the jobs that keep caches.
		const mainRun = { ...ci, event: 'push', conclusion: 'failure' };
		expect(workflowResult(runs([mainRun, ci, bench])).verdict).toBe('pass');
		expect(workflowResult(runs([{ ...mainRun, conclusion: 'success' }, bench]))).toEqual({
			figure: 'CI: no run, Benchmarks: success',
			verdict: 'fail',
		});
		// A full run started by hand counts for a commit that reached main without the queue.
		const byHand = { ...ci, event: 'workflow_dispatch' };
		expect(workflowResult(runs([mainRun, byHand, bench])).verdict).toBe('pass');
		expect(workflowResult(runs([{ ...byHand, conclusion: 'failure' }, ci, bench])).verdict).toBe(
			'fail',
		);
		expect(workflowResult('not json').verdict).toBe('fail');
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
		expect(commandText(step('images-swiftshader'))).toBe('CI=1 bun run test:images');
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
