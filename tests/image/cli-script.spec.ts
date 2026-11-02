// The shot command's timed script, run as a developer runs it. The first part runs it in a copy of
// the fixture project, where a script drives the sketch through three states with a key, the
// pointer and a property write. The second part drives the island showcase through three
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
	SCRIPT_TIMEOUT_SECONDS,
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

test.describe('the island showcase through three states', () => {
	/** The folder that the command writes its images into, removed after the test. */
	let drawn = '';

	test.afterAll(() => {
		if (drawn) rmSync(drawn, { recursive: true, force: true });
	});

	/** The pose that the route holds at its opening, which the script's first step leaves. */
	const OPENING = [-30, 30, -40] as const;

	/** How far apart two positions stand, in meters. */
	const apart = (a: readonly number[], b: readonly number[]): number =>
		Math.hypot(
			(a[0] as number) - (b[0] as number),
			(a[1] as number) - (b[1] as number),
			(a[2] as number) - (b[2] as number),
		);

	/** The camera positions that the script's dumps read, in the order of their times. */
	const dumpedPositions = (text: string): { at: number; position: number[] }[] =>
		[...text.matchAll(/Dump at ([\d.]+) s: "#camera" position is (\[[^\]]*\])\./g)].map(
			(match) => ({ at: Number(match[1]), position: JSON.parse(match[2] as string) as number[] }),
		);

	// The command draws all three states in one run. It runs inside the test, so its minutes count in
	// the test's time: the shard model reads each test's duration, and the command is most of this
	// test. One run also means that a state which fails is not drawn again for the next state.
	test(`${SCRIPT_TEST} on ${SCRIPT_TIER}`, async () => {
		// The first state pays the pipelines' build; the next two wait only for their frames.
		test.setTimeout(SCRIPT_TIMEOUT_SECONDS * 2 * 1000 + 300_000);
		drawn = mkdtempSync(join(REPO_ROOT, 'target/cli-script-showcase-'));
		const environment = environmentNamed(test.info().project.name);
		const result = await runCli(REPO_ROOT, [
			'shot',
			'--script',
			join(REPO_ROOT, 'tests/image/showcase-island.script'),
			'--page',
			scriptPage(environment),
			'--size',
			`${SCRIPT_SIZE[0]}x${SCRIPT_SIZE[1]}`,
			'--gpu',
			SCRIPT_TIER,
			'--timeout',
			String(SCRIPT_TIMEOUT_SECONDS),
			'--out',
			join(drawn, 'island.png'),
		]);
		const dumps = dumpedPositions(result.output);
		const place = { environment };
		/** Everything wrong with this run, so one state's fault still saves the others' pictures. */
		const problems: string[] = [];
		if (result.code !== 0)
			problems.push(
				`the command exited ${result.code}: ${
					result.output
						.split('\n')
						.filter((line) => line.startsWith('Drew no frame') || line.includes('failed:'))
						.join(' ') || 'no line names the fault'
				}`,
			);
		for (const state of SCRIPT_STATES)
			await test.step(`${SCRIPT_TEST}-${state} on ${SCRIPT_TIER}`, async () => {
				const run = SCRIPT_RUNS.find((one) => one.test === `${SCRIPT_TEST}-${state}`);
				if (run === undefined) {
					problems.push(`${state}: no run names its reference`);
					return;
				}
				if (!result.output.includes(`Drew ${state} at `)) {
					problems.push(`${state}: the command drew no frame`);
					return;
				}
				// Each state's camera stands away from the route's opening and from the other states: a
				// state that its steps left unmoved, or that a later step undid, would meet this figure.
				const mine = dumps.find((one) => one.at === run.hold);
				if (mine === undefined) problems.push(`${state}: no camera dump at ${run.hold} s`);
				else {
					if (apart(mine.position, OPENING) <= 1)
						problems.push(`${state}: the camera stayed at the route's opening`);
					for (const other of dumps)
						if (other !== mine && apart(mine.position, other.position) <= 1)
							problems.push(`${state}: the camera met the state at ${other.at} s`);
				}
				clearCandidate(run, place);
				const image = readPng(join(drawn, `island-${state}.png`));
				problems.push(...compareWithReference(run, place, image));
			});
		expect(problems).toEqual([]);
	});
});
