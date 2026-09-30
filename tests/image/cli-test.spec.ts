// The test command, run as a developer runs it: in a project's folder, where it type checks and
// lints the project, then draws the image tests that the project lists in a headless browser in
// the environment of this Playwright project. Each test runs in its own copy of the fixture
// project, with its own list of tests and references: a pass, a failure with a diff image, a
// missing reference, an update, and failures of the type check and the lint script.
import {
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, test } from '@playwright/test';
import { readPng } from '../../packages/cli/src/png.js';
import { REFERENCES_DIR, RESULTS_DIR } from '../../packages/cli/src/test.js';
import { runCli } from '../lib/cli.ts';
import { type Environment, environmentNamed, TIERS, type Tier } from '../lib/images.ts';
import { REPO_ROOT } from '../lib/server.ts';

const FIXTURE = join(REPO_ROOT, 'tests/fixtures/project');
/** The references of the manifest's test of the fixture's sketch, held at 1.5 seconds. */
const MANIFEST_REFERENCES = join(REPO_ROOT, 'tests/image/references');
/** The line that says where the images were drawn, whose browser version changes. */
const DRAWN_IN = /^The images are drawn in .+\.$/m;

/** A copy of the fixture project for one test. */
interface ProjectCopy {
	root: string;
	environment: Environment;
	/** The file of a reference or of a run's image, from the project's folder. */
	file(kind: 'reference' | 'image' | 'diff', tier: Tier, name: string): string;
}

/**
 * Copies the fixture project into the test's output folder, with a list of tests and, for each
 * named test and tier, the manifest's reference of the fixture's sketch. The copy installs what the
 * fixture installs. Without `typeCheck`, it has no tsconfig.json, so the type check is skipped.
 */
function projectCopy({
	tests,
	references = [],
	typeCheck = false,
}: {
	tests?: readonly Record<string, unknown>[];
	references?: readonly [string, Tier][];
	typeCheck?: boolean;
}): ProjectCopy {
	const root = test.info().outputPath('project');
	const environment = environmentNamed(test.info().project.name);
	cpSync(FIXTURE, root, { recursive: true });
	symlinkSync(join(REPO_ROOT, 'tests/node_modules'), join(root, 'node_modules'), 'dir');
	const tsconfig = JSON.parse(readFileSync(join(FIXTURE, 'tsconfig.json'), 'utf8'));
	// The fixture's config extends the repository's base config by a path from the fixture.
	tsconfig.extends = join(FIXTURE, tsconfig.extends);
	if (typeCheck) writeFileSync(join(root, 'tsconfig.json'), JSON.stringify(tsconfig));
	else rmSync(join(root, 'tsconfig.json'));
	if (tests) writeFileSync(join(root, 'null3d.json'), JSON.stringify({ tests }));
	const file: ProjectCopy['file'] = (kind, tier, name) =>
		kind === 'reference'
			? join(REFERENCES_DIR, environment, tier, `${name}.png`)
			: join(RESULTS_DIR, environment, tier, `${name}${kind === 'diff' ? '-diff' : ''}.png`);
	for (const [name, tier] of references) {
		const reference = join(root, file('reference', tier, name));
		mkdirSync(dirname(reference), { recursive: true });
		cpSync(join(MANIFEST_REFERENCES, environment, tier, 'project.png'), reference);
	}
	return { root, environment, file };
}

/** The lines that the command printed, without the one that names the browser's version. */
const printed = (stdout: string) => stdout.replace(DRAWN_IN, '').split('\n').filter(Boolean);

test('null3d test passes a project whose images match their references, on each tier', async () => {
	const project = projectCopy({
		tests: [
			{ name: 'start', sketch: 'sketch.ts', hold: 1.5 },
			{ name: 'home', page: '/', hold: 1.5, tiers: ['webgl2'] },
		],
		references: [...TIERS.map((tier) => ['start', tier] as [string, Tier]), ['home', 'webgl2']],
		typeCheck: true,
	});
	const { code, stdout, output } = await runCli(project.root, ['test']);
	expect(code, output).toBe(0);
	expect(stdout).toMatch(DRAWN_IN);
	expect(stdout).toContain(
		`compared with the references in ${REFERENCES_DIR}/${project.environment}.`,
	);
	const passed = (tier: Tier, name: string) =>
		`PASS  ${name} on ${tier}: it matches the reference (image ${project.file('image', tier, name)})`;
	expect(printed(stdout)).toEqual([
		'PASS  type check (tsc --noEmit)',
		"SKIP  lint: the project's package.json has no lint script",
		...TIERS.map((tier) => passed(tier, 'start')),
		passed('webgl2', 'home'),
		'5 passed, 1 skipped.',
	]);
});

test('null3d test fails an image that differs from its reference, and saves the diff', async () => {
	// The reference holds the sketch at 1.5 seconds, and the test at 1, when the box and the ball
	// stand elsewhere.
	const project = projectCopy({
		tests: [{ name: 'start', sketch: 'sketch.ts', hold: 1, tiers: ['webgl2'] }],
		references: [['start', 'webgl2']],
	});
	const { code, stdout, output } = await runCli(project.root, ['test']);
	expect(code, output).toBe(1);
	const image = project.file('image', 'webgl2', 'start');
	const reference = project.file('reference', 'webgl2', 'start');
	const diff = project.file('diff', 'webgl2', 'start');
	const line = printed(stdout).find((text) => text.startsWith('FAIL  start on webgl2: ')) ?? '';
	expect(line).toMatch(
		/^FAIL {2}start on webgl2: \d+\.\d{3}% of pixels differ from the reference, and at most 0\.100% may \(image .+\)$/,
	);
	expect(line.endsWith(`(image ${image}, reference ${reference}, diff ${diff})`), line).toBe(true);
	expect(readPng(join(project.root, diff))).toMatchObject({ width: 320, height: 180 });
	expect(readPng(join(project.root, image))).toMatchObject({ width: 320, height: 180 });
	expect(printed(stdout).at(-1)).toBe('1 failed, 2 skipped.');
});

test('null3d test fails an image without a reference, and a sketch that stops the hold', async () => {
	const project = projectCopy({
		tests: [
			{ name: 'start', sketch: 'sketch.ts', hold: 1.5, tiers: ['webgl2'] },
			{ name: 'crash', sketch: 'throwing-sketch.ts', hold: 1, tiers: ['webgl2'] },
		],
	});
	const { code, stdout, output } = await runCli(project.root, ['test', '--gpu', 'webgl2']);
	expect(code, output).toBe(1);
	const image = project.file('image', 'webgl2', 'start');
	const lines = printed(stdout);
	expect(lines).toContain(
		`FAIL  start on webgl2: there is no reference yet. When the image is right, bunx @null3d/cli test --update-references keeps it as the reference (image ${image})`,
	);
	expect(existsSync(join(project.root, image))).toBe(true);
	expect(existsSync(join(project.root, project.file('reference', 'webgl2', 'start')))).toBe(false);
	const crash = lines.findIndex((line) => line.startsWith('FAIL  crash on webgl2: '));
	expect(lines[crash]).toContain(
		'FAIL  crash on webgl2: E1408: hold mode stopped at 0.5 seconds, in frame 31: the throwing sketch threw on purpose',
	);
	// The sketch's error, with the place in the sketch that threw. The hold's own error is not
	// logged again.
	expect(lines.slice(crash + 1, crash + 4)).toEqual([
		'      1 error:',
		'        console error: Error: the throwing sketch threw on purpose',
		expect.stringMatching(/^ {12}at Object\.onUpdate \(\/throwing-sketch\.ts:\d+:\d+\)$/),
	]);
	expect(lines.at(-1)).toBe('2 failed, 2 skipped.');
});

test('null3d test --update-references keeps new and changed images as references', async () => {
	const project = projectCopy({
		tests: [
			{ name: 'start', sketch: 'sketch.ts', hold: 1.5, tiers: ['webgl2'] },
			{ name: 'early', sketch: 'sketch.ts', hold: 1, tiers: ['webgl2'] },
		],
		references: [['early', 'webgl2']],
	});
	const updated = await runCli(project.root, ['test', '--update-references']);
	expect(updated.code, updated.output).toBe(0);
	const [start, early] = ['start', 'early'].map((name) =>
		project.file('reference', 'webgl2', name),
	);
	const lines = printed(updated.stdout);
	expect(lines).toContain(
		`SAVED start on webgl2: there was no reference, so the image is the reference now (reference ${start})`,
	);
	expect(lines.find((line) => line.startsWith('SAVED early on webgl2: '))).toMatch(
		/^SAVED early on webgl2: \d+\.\d{3}% of pixels differed from the old reference, so the image is the reference now \(reference .+, diff .+\)$/,
	);
	expect(lines.at(-1)).toBe('2 skipped, 2 references saved.');
	for (const [name, reference] of [
		['start', start],
		['early', early],
	] as const)
		expect(readPng(join(project.root, reference as string)).data).toEqual(
			readPng(join(project.root, project.file('image', 'webgl2', name))).data,
		);
	const again = await runCli(project.root, ['test']);
	expect(again.code, again.output).toBe(0);
	expect(printed(again.stdout).at(-1)).toBe('2 passed, 2 skipped.');
});

test('null3d test reports type errors and a failing lint script', async () => {
	const project = projectCopy({ typeCheck: true });
	writeFileSync(join(project.root, 'broken.ts'), "export const count: number = 'three';\n");
	const lint = `node -e "console.log('broken.ts: one problem'); process.exit(3)"`;
	writeFileSync(join(project.root, 'package.json'), JSON.stringify({ scripts: { lint } }));
	const { code, stdout, output } = await runCli(project.root, ['test']);
	expect(code, output).toBe(1);
	expect(printed(stdout)).toEqual([
		'FAIL  type check (tsc --noEmit): 1 error',
		"      broken.ts(1,14): error TS2322: Type 'string' is not assignable to type 'number'.",
		`FAIL  lint (${lint}): it exited with 3`,
		'      broken.ts: one problem',
		'SKIP  image tests: the project has no null3d.json. List the tests there, such as { "tests": [{ "name": "start", "sketch": "sketch.ts", "hold": 1.5 }] }',
		'2 failed, 1 skipped.',
	]);
});
