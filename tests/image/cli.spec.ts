// The shot command, run as a developer runs it: in a project's folder, where it starts the
// project's own Vite dev server and a headless browser in the environment of this Playwright
// project. On each GPU tier, the shot command's image must match the image test manifest's
// references of the project's sketch. A page that fails must say why at once, and leave no image.
// The bench command must report figures of the project's production build on both GPU paths. The
// test checks the figures' presence, not their values, which depend on the machine and its load.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { BenchReport } from '../../packages/cli/src/bench.js';
import { TIERS } from '../../packages/cli/src/page.js';
import { readPng } from '../../packages/cli/src/png.js';
import type { ShotReport } from '../../packages/cli/src/shot.js';
import { runCli } from '../lib/cli.ts';
import {
	borrowedRun,
	clearCandidate,
	compareWithReference,
	environmentNamed,
	REPORTED_TIERS,
} from '../lib/images.ts';
import { REPO_ROOT } from '../lib/server.ts';
import { manifestRun } from './manifest.ts';

const PROJECT = join(REPO_ROOT, 'tests/fixtures/project');
/** A page that fails must say so long before the command's own 60 seconds run out. */
const FAST_FAILURE_MS = 30_000;

/**
 * Runs a command of the command-line tool in the project, with its output in the test's folder.
 * Returns the exit code, what it printed, and the JSON report it saved.
 */
async function run<T>(
	command: 'shot' | 'bench',
	args: string[],
): Promise<{ code: number | null; output: string; report: T }> {
	const out = test.info().outputPath(command === 'shot' ? 'shot.png' : 'bench.json');
	const { code, output } = await runCli(PROJECT, [command, '--out', out, ...args]);
	const report = JSON.parse(readFileSync(out.replace(/\.png$/, '.json'), 'utf8'));
	return { code, output, report };
}

/** Runs the shot command in the project. */
const null3d = (args: string[]) => run<ShotReport>('shot', args);

for (const tier of TIERS)
	test(`null3d shot draws the project's page on ${tier}`, async () => {
		const { code, output, report } = await null3d([
			'--time',
			'1.5',
			'--size',
			'320x180',
			'--gpu',
			tier,
		]);
		expect(code, output).toBe(0);
		expect(output).toContain(
			`Drew / at 1.5 s, frame 91, on ${REPORTED_TIERS[tier]}: 320 x 180 pixels.`,
		);
		expect(output).toMatch(
			/It made \d+ draw calls?, uploaded [\d.]+ \w+ and built \d+ pipelines?\./,
		);
		const environment = environmentNamed(test.info().project.name);
		expect(report).toMatchObject({
			ok: true,
			page: `/?hold=1.5&gpu=${tier}`,
			environment,
			time: 1.5,
			frame: 91,
			tier: REPORTED_TIERS[tier],
			width: 320,
			height: 180,
			image: 'shot.png',
			stats: { frames: 1 },
			errors: [],
		});
		const place = { environment };
		const run = borrowedRun(manifestRun('project', tier, 'pipelined'), 'cli-shot');
		clearCandidate(run, place);
		const image = readPng(test.info().outputPath('shot.png'));
		expect(compareWithReference(run, place, image)).toEqual([]);
	});

test('null3d shot says at once why a sketch stopped the hold, and leaves no image', async () => {
	const out = test.info().outputPath('shot.png');
	mkdirSync(dirname(out), { recursive: true });
	writeFileSync(out, 'an image from an earlier run');
	const started = Date.now();
	const { code, output, report } = await null3d(['--page', '/throws.html', '--time', '1']);
	expect(Date.now() - started).toBeLessThan(FAST_FAILURE_MS);
	expect(code, output).toBe(1);
	expect(existsSync(out)).toBe(false);
	expect(output).toContain(
		'Drew no frame of /throws.html: E1408: hold mode stopped at 0.5 seconds, in frame 31: the throwing sketch threw on purpose',
	);
	expect(report).toMatchObject({ ok: false, page: '/throws.html?hold=1', code: 'E1408' });
	expect(report.errors).toContainEqual(
		expect.stringContaining('at Object.onUpdate (/throwing-sketch.ts:'),
	);
});

test('null3d shot stops at once when the page throws before it starts the engine', async () => {
	const started = Date.now();
	const { code, output, report } = await null3d(['--page', '/broken.html']);
	expect(Date.now() - started).toBeLessThan(FAST_FAILURE_MS);
	expect(code, output).toBe(1);
	expect(output).toContain(
		'Drew no frame of /broken.html: the page failed before it started the engine in hold mode',
	);
	expect(report).toMatchObject({
		ok: false,
		code: null,
		errors: ['page error: the broken page threw on purpose (at /broken.html:2:10)'],
	});
});

test('null3d shot refuses a page that the project does not have', async () => {
	const { code, output, report } = await null3d(['--page', '/missing.html']);
	expect(code, output).toBe(1);
	expect(report).toMatchObject({ ok: false, error: 'the project has no page /missing.html' });
});

/** A bench run short enough for a test: two runs on each path, for a spread. */
const SHORT_BENCH = ['--runs', '2', '--seconds', '1', '--warmup', '1', '--size', '320x180'];

test("null3d bench reports the figures of the project's production build on both GPU paths", async () => {
	test.setTimeout(180_000);
	const gpus = ['webgpu', 'webgl2'] as const;
	const { code, output, report } = await run<BenchReport>('bench', [
		...SHORT_BENCH,
		'--gpu',
		gpus.join(','),
	]);
	expect(code, output).toBe(0);
	expect(report).toMatchObject({
		ok: true,
		page: '/',
		environment: environmentNamed(test.info().project.name),
		warmupSeconds: 1,
		measureSeconds: 1,
		errors: [],
	});
	expect(report.paths.map(({ gpu, tier }) => [gpu, tier])).toEqual(
		gpus.map((gpu) => [gpu, REPORTED_TIERS[gpu]]),
	);
	for (const { tier, summary, runs } of report.paths) {
		expect(output).toContain(`/ on ${tier}: 2 runs of 1 s, each after 1 s of warm-up.`);
		expect(runs.map((one) => one.ok && one.tier)).toEqual([tier, tier]);
		expect(summary?.runs).toBe(2);
		const { cpuMs, threadsMs = {}, presentedFps = 0 } = summary ?? {};
		expect(cpuMs?.median).toBeGreaterThan(0);
		expect(cpuMs?.min).toBeLessThanOrEqual(cpuMs?.max ?? 0);
		expect(Object.keys(threadsMs).length).toBeGreaterThan(0);
		expect(presentedFps).toBeGreaterThan(0);
	}
	expect(output).toContain('CPU time per frame, the median of the runs:');
	expect(output).toContain('Frames per second: ');
});

test('null3d bench stops a run at once when the page throws before it starts the engine', async () => {
	const started = Date.now();
	const { code, output, report } = await run<BenchReport>('bench', [
		...SHORT_BENCH,
		'--runs',
		'1',
		'--page',
		'/broken.html',
	]);
	expect(Date.now() - started).toBeLessThan(FAST_FAILURE_MS);
	expect(code, output).toBe(1);
	expect(report.paths[0]?.runs).toEqual([
		{
			ok: false,
			code: null,
			error: 'the page threw before the engine started: the broken page threw on purpose',
		},
	]);
	expect(output).toContain(
		'Run 1 failed: the page threw before the engine started: the broken page threw on purpose',
	);
});
