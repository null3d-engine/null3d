// The shot command's timed script, run as a developer runs it: in a copy of the fixture project,
// where the script drives the project through three states with a key, the pointer and a property
// write. Each state's image must match its reference, the command must print what the script
// dumped, and no step may fail.
import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { readPng } from '../../packages/cli/src/png.js';
import { runCli } from '../lib/cli.ts';
import { clearCandidate, compareWithReference, environmentNamed } from '../lib/images.ts';
import { REPO_ROOT } from '../lib/server.ts';
import { SCRIPT_RUNS, SCRIPT_STATES, SCRIPT_TIER } from './script-runs.ts';

const FIXTURE = join(REPO_ROOT, 'tests/fixtures/project');

// Each test starts the project's dev server and a browser, and draws three frames, which takes
// longer than Playwright's default minute on a busy machine.
test.describe.configure({ timeout: 240_000 });

/** The copy of the fixture that the tests run in, removed after them. */
let project = '';

/**
 * Copies the fixture project into a folder of its own under the repository's build folder. The copy
 * lives there, not under a test's output folder: CI uploads the output folder when a job fails, and
 * it follows the copy's link to the dependencies, which would put the whole installed tree into the
 * artifact.
 */
function projectCopy(): string {
	mkdirSync(join(REPO_ROOT, 'target'), { recursive: true });
	const root = mkdtempSync(join(REPO_ROOT, 'target/cli-script-'));
	cpSync(FIXTURE, root, { recursive: true });
	// A package of its own, as every project has. Without one, Vite takes the repository as the
	// copy's package and keeps its prebundled dependencies in the repository's cache folder.
	writeFileSync(join(root, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
	symlinkSync(join(REPO_ROOT, 'tests/node_modules'), join(root, 'node_modules'), 'dir');
	// The fixture's Vite config imports the plugin's source by paths from the fixture.
	const viteConfig = readFileSync(join(FIXTURE, 'vite.config.ts'), 'utf8');
	writeFileSync(
		join(root, 'vite.config.ts'),
		viteConfig.replaceAll("from '../../../", `from '${REPO_ROOT}/`),
	);
	// The fixture's TypeScript config extends the repository's base config by a path from the
	// fixture, which the copy no longer is. Vite reads it to transform the page's TypeScript.
	const tsconfig = JSON.parse(readFileSync(join(FIXTURE, 'tsconfig.json'), 'utf8'));
	tsconfig.extends = join(FIXTURE, tsconfig.extends);
	writeFileSync(join(root, 'tsconfig.json'), JSON.stringify(tsconfig));
	return root;
}

test.beforeAll(() => {
	project = projectCopy();
});

test.afterAll(() => {
	rmSync(project, { recursive: true, force: true });
});

for (const state of SCRIPT_STATES)
	test(`project-script-${state} on ${SCRIPT_TIER}`, async () => {
		const out = test.info().outputPath('tour.png');
		const { code, output } = await runCli(project, [
			'shot',
			'--script',
			'drive.script',
			'--page',
			'/',
			'--size',
			'320x180',
			'--gpu',
			'webgl2',
			'--out',
			out,
		]);
		expect(code, output).toBe(0);
		// The script writes one image for each of its shot steps.
		expect(readdirSync(test.info().outputPath()).sort()).toEqual([
			'tour-forward.json',
			'tour-forward.png',
			'tour-parked.json',
			'tour-parked.png',
			'tour-start.json',
			'tour-start.png',
		]);
		expect(output).toContain('Drew start at 0 s, frame 1, on webgl2: 320 x 180 pixels.');
		expect(output).toContain('Drew forward at 2 s, frame 121, on webgl2: 320 x 180 pixels.');
		expect(output).toContain('Drew parked at 3 s, frame 181, on webgl2: 320 x 180 pixels.');
		expect(output).toContain('Dump at 2.5 s: "ball" position is');
		expect(output).not.toContain('failed:');
		const run = SCRIPT_RUNS.find((one) => one.test.endsWith(state));
		expect(run).toBeDefined();
		const place = { environment: environmentNamed(test.info().project.name) };
		clearCandidate(run!, place);
		const image = readPng(test.info().outputPath(`tour-${state}.png`));
		expect(compareWithReference(run!, place, image)).toEqual([]);
	});
