// The shot command's timed script, run as a developer runs it. The first part runs it in a copy of
// the fixture project, where a script drives the sketch through three states with a key, the
// pointer and a property write. The second part drives the night town showcase through three
// states, and each state's image must match its reference.
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
import {
	SCRIPT_RUNS,
	SCRIPT_SIZE,
	SCRIPT_STATES,
	SCRIPT_TEST,
	SCRIPT_TIER,
	scriptPage,
} from './script-runs.ts';

const FIXTURE = join(REPO_ROOT, 'tests/fixtures/project');
/** The fixture's three states, which its script names. */
const FIXTURE_STATES = ['start', 'forward', 'parked'] as const;

// Each part starts a dev server and a browser, and draws three frames, which takes longer than
// Playwright's default minute on a busy machine.
test.describe.configure({ timeout: 240_000 });

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

test.describe('the fixture project through three states', () => {
	/** The copy of the fixture that the command runs in, removed after the test. */
	let project = '';
	/** The folder that the command writes its images into, removed after the test. */
	let drawn = '';
	let code: number | null = null;
	let output = '';

	test.beforeAll(async () => {
		project = projectCopy();
		drawn = mkdtempSync(join(REPO_ROOT, 'target/cli-script-drawn-'));
		const run = await runCli(project, [
			'shot',
			'--script',
			'drive.script',
			'--page',
			'/',
			'--size',
			'320x180',
			'--gpu',
			SCRIPT_TIER,
			'--out',
			join(drawn, 'tour.png'),
		]);
		code = run.code;
		output = run.output;
	});

	test.afterAll(() => {
		rmSync(project, { recursive: true, force: true });
		rmSync(drawn, { recursive: true, force: true });
	});

	test(`project-script on ${SCRIPT_TIER}`, () => {
		expect(code, output).toBe(0);
		// The script writes one image for each of its shot steps.
		expect(readdirSync(drawn).sort()).toEqual([
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
		// The states come from the script: each image differs from every other one. The showcase's
		// images below compare with references instead.
		const images = FIXTURE_STATES.map((state) => readFileSync(join(drawn, `tour-${state}.png`)));
		expect(images[0]?.equals(images[1] as Buffer)).toBe(false);
		expect(images[0]?.equals(images[2] as Buffer)).toBe(false);
		expect(images[1]?.equals(images[2] as Buffer)).toBe(false);
	});
});

test.describe('the night town showcase through three states', () => {
	// Each state builds the whole town again, and the software GPU that CI uses draws it slowly.
	test.describe.configure({ timeout: 900_000 });

	/** The folder that the command writes its images into, removed after the tests. */
	let drawn = '';
	/** What the command printed, which each test checks its own state against. */
	let output = '';
	let code: number | null = null;

	// One run draws all three states, and each test compares one of its images with its reference.
	test.beforeAll(async () => {
		test.setTimeout(900_000);
		drawn = mkdtempSync(join(REPO_ROOT, 'target/cli-script-showcase-'));
		const environment = environmentNamed(test.info().project.name);
		const run = await runCli(REPO_ROOT, [
			'shot',
			'--script',
			join(REPO_ROOT, 'tests/image/showcase-night-town.script'),
			'--page',
			scriptPage(environment),
			'--size',
			`${SCRIPT_SIZE[0]}x${SCRIPT_SIZE[1]}`,
			'--gpu',
			SCRIPT_TIER,
			'--timeout',
			'180',
			'--out',
			join(drawn, 'night-town.png'),
		]);
		code = run.code;
		output = run.output;
	});

	test.afterAll(() => {
		rmSync(drawn, { recursive: true, force: true });
	});

	for (const state of SCRIPT_STATES)
		test(`${SCRIPT_TEST}-${state} on ${SCRIPT_TIER}`, async () => {
			expect(code, output).toBe(0);
			expect(output).toContain(`Drew ${state} at `);
			expect(output).not.toContain('failed:');
			// The script's property step widens the active camera's lens, and its dump reads it back.
			if (state === 'wide') expect(output).toContain('Dump at 2 s: "#camera" fov is [60].');
			const run = SCRIPT_RUNS.find((one) => one.test === `${SCRIPT_TEST}-${state}`);
			expect(run).toBeDefined();
			const place = { environment: environmentNamed(test.info().project.name) };
			clearCandidate(run!, place);
			const image = readPng(join(drawn, `night-town-${state}.png`));
			expect(compareWithReference(run!, place, image)).toEqual([]);
		});
});
