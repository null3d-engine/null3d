// The command-line tool, run as a developer runs it: in a project's folder, where it starts the
// project's own Vite dev server and a headless browser in the environment of this Playwright
// project. On each GPU tier, the shot command's image must match the image test manifest's
// references of the project's sketch. A page that fails must say why at once, and leave no image.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, test } from '@playwright/test';
import { TIERS } from '../../packages/cli/src/page.js';
import { readPng } from '../../packages/cli/src/png.js';
import type { ShotReport } from '../../packages/cli/src/shot.js';
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
const COMMAND = join(REPO_ROOT, 'packages/cli/bin/null3d.js');
/** A page that fails must say so long before the command's own 60 seconds run out. */
const FAST_FAILURE_MS = 30_000;

/**
 * Runs the command-line tool in the project with Node, as its bin file asks, and returns its exit
 * code, what it printed, and the report it saved beside the image.
 */
function null3d(
	args: string[],
): Promise<{ code: number | null; output: string; report: ShotReport }> {
	const out = test.info().outputPath('shot.png');
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [COMMAND, 'shot', '--out', out, ...args], {
			cwd: PROJECT,
		});
		let output = '';
		const collect = (chunk: Buffer) => {
			output += chunk.toString();
		};
		child.stdout.on('data', collect);
		child.stderr.on('data', collect);
		child.on('error', reject);
		child.on('close', (code) => {
			const report = JSON.parse(readFileSync(out.replace(/\.png$/, '.json'), 'utf8'));
			resolve({ code, output, report });
		});
	});
}

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
