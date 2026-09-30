// null3d test: checks the project in the current folder, for an agent's test loop. It runs the
// type check and the project's lint script, then draws each image test that null3d.json lists in
// the engine's hold mode, in a headless browser, and compares each image with its reference for
// the GPU tier. It prints one line per check: whether it passed, the reason, and the image files.
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { readOptions, UsageError } from './args.js';
import { defaultEnvironment } from './browser.js';
import { compareImages, percent, TOLERANCE } from './compare.js';
import { heldImage, REPORTED_TIERS, TIERS } from './page.js';
import { readPng, writePng } from './png.js';
import { lint, typeCheck } from './project-checks.js';
import { holdPage, startRunner } from './runner.js';
import { sketchPagePath, sketchPagePlugin } from './sketch-page.js';
import { CONFIG_FILE, DEFAULT_SIZE, EXAMPLE, readTestConfig } from './test-config.js';
import { counted, listed, shownPath } from './text.js';

/** @import { Environment } from './browser.js' */
/** @import { Tier } from './page.js' */
/** @import { RgbaImage } from './png.js' */
/** @import { Outcome } from './project-checks.js' */
/** @import { Runner } from './runner.js' */
/** @import { ImageTest } from './test-config.js' */

/** The folder of reference images, in the project's folder. */
export const REFERENCES_DIR = 'tests/references';
/** The folder of each run's images and diffs, in the project's folder. */
export const RESULTS_DIR = 'test-results/null3d';
/** How long a page may take to draw a test's frame. */
const TIMEOUT_MS = 60_000;
/** The indent of the lines under a result, past its status. */
const DETAIL_INDENT = ' '.repeat(6);

const OPTIONS = /** @type {const} */ ({
	gpu: { type: 'string' },
	'update-references': { type: 'boolean', default: false },
	help: { type: 'boolean', short: 'h', default: false },
});

export const HELP = `Usage: bunx @null3d/cli test [options]

Checks the project in the current folder. It runs the type check with the project's TypeScript,
and the lint script of its package.json. Then it draws each image test that ${CONFIG_FILE} lists in
the engine's hold mode, in a headless browser, and compares each image with its reference for the
GPU tier. It prints one line per check, and fails when a check fails.

Options:
  --gpu <tiers>             The GPU tiers to draw on, joined by commas, such as webgpu,webgl2
                            (the tiers that each test lists)
  --update-references       Keep each image that has no reference, or that differs from it, as
                            the new reference

${CONFIG_FILE} lists the tests:
  ${EXAMPLE}
A test takes a name, a sketch module or a page, and the sketch time to hold at in seconds. It can
also give a size (${DEFAULT_SIZE}) and its tiers (${TIERS.join(', ')}).

The references are in ${REFERENCES_DIR}/<environment>/<tier>/<name>.png, and each run's images in
${RESULTS_DIR}/. It draws with Google Chrome on this computer's GPU. When the CI variable is
set, it draws with Playwright's Chromium on SwiftShader, the software GPU of machines without a GPU.`;

/**
 * @typedef {object} TestOptions
 * @property {readonly Tier[]} [gpu] The only tiers to draw on.
 * @property {boolean} updateReferences True to keep new and changed images as references.
 * @property {boolean} help True to print the help instead.
 */

/**
 * The options that `args` gives the test command.
 *
 * @param {readonly string[]} args
 * @returns {TestOptions}
 */
export function parseTestArgs(args) {
	const values = readOptions(args, OPTIONS);
	const gpu = values.gpu?.split(',');
	if (
		gpu &&
		(gpu.some((tier) => !TIERS.includes(/** @type {Tier} */ (tier))) ||
			new Set(gpu).size !== gpu.length)
	)
		throw new UsageError(
			`--gpu takes tiers from ${TIERS.join(', ')}, joined by commas, such as webgpu,webgl2, not "${values.gpu}"`,
		);
	return {
		...(gpu && { gpu: /** @type {Tier[]} */ (gpu) }),
		updateReferences: values['update-references'],
		help: values.help,
	};
}

/**
 * @typedef {object} ImageFiles The files of one test on one tier.
 * @property {string} reference The reference image, which the project keeps.
 * @property {string} image This run's image.
 * @property {string} diff This run's diff against the reference, when the two differ.
 */

/**
 * The files of a test on a tier, in the project in `root`.
 *
 * @param {string} root
 * @param {Environment} environment
 * @param {Tier} tier
 * @param {string} name
 * @returns {ImageFiles}
 */
export function imageFiles(root, environment, tier, name) {
	const file = (/** @type {string} */ dir, /** @type {string} */ ending) =>
		join(root, dir, environment, tier, `${name}${ending}`);
	return {
		reference: file(REFERENCES_DIR, '.png'),
		image: file(RESULTS_DIR, '.png'),
		diff: file(RESULTS_DIR, '-diff.png'),
	};
}

/**
 * The files that a result names, in brackets after its reason.
 *
 * @param {Partial<ImageFiles>} files
 */
const named = (files) =>
	` (${Object.entries(files)
		.map(([kind, file]) => `${kind} ${shownPath(/** @type {string} */ (file))}`)
		.join(', ')})`;

/**
 * Compares a test's image with its reference, and keeps the image as the reference when `update`
 * is set and the two differ. Writes the diff when the two differ. Returns the result, whose text
 * follows the test's name.
 *
 * @param {RgbaImage} image
 * @param {ImageFiles} files
 * @param {boolean} update
 * @returns {Outcome}
 */
export function judgeImage(image, files, update) {
	const { reference, diff } = files;
	/**
	 * A failure with its reason, or with `update` the image saved as the reference, with why the
	 * old reference had to go.
	 *
	 * @type {(failure: string, replaced: string, extra?: Partial<ImageFiles>) => Outcome}
	 */
	const differs = (failure, replaced, extra = {}) => {
		if (!update)
			return {
				status: 'FAIL',
				text: `${failure}${named({ image: files.image, ...(existsSync(reference) && { reference }), ...extra })}`,
			};
		writePng(reference, image);
		return {
			status: 'SAVED',
			text: `${replaced}, so the image is the reference now${named({ reference, ...extra })}`,
		};
	};
	if (!existsSync(reference))
		return differs(
			'there is no reference yet. When the image is right, bunx @null3d/cli test --update-references keeps it as the reference',
			'there was no reference',
		);
	const expected = readPng(reference);
	if (expected.width !== image.width || expected.height !== image.height) {
		const sizes = `${image.width} x ${image.height} pixels, and the reference`;
		const old = `${expected.width} x ${expected.height}`;
		return differs(`the image is ${sizes} ${old}`, `the image is ${sizes} was ${old}`);
	}
	const compared = compareImages(expected, image, TOLERANCE.threshold);
	if (compared.share <= TOLERANCE.maxDiffRatio)
		return { status: 'PASS', text: `it matches the reference${named({ image: files.image })}` };
	writePng(diff, compared.diff);
	const share = percent(compared.share);
	return differs(
		`${share} of pixels differ from the reference, and at most ${percent(TOLERANCE.maxDiffRatio)} may`,
		`${share} of pixels differed from the old reference`,
		{ diff },
	);
}

/**
 * Draws a test on a tier, and judges its image.
 *
 * @param {Runner} runner
 * @param {string} root
 * @param {ImageTest} test
 * @param {Tier} tier
 * @param {boolean} update
 * @returns {Promise<Outcome>}
 */
async function imageTest(runner, root, test, tier, update) {
	const files = imageFiles(root, runner.environment, tier, test.name);
	// An image from an earlier run must never pass for this run's.
	rmSync(files.image, { force: true });
	rmSync(files.diff, { force: true });
	const path =
		test.sketch === undefined
			? /** @type {string} */ (test.page)
			: sketchPagePath(test.sketch, test.size);
	const { result, errors } = await holdPage(runner, {
		path,
		time: test.hold,
		gpu: tier,
		size: test.size,
		timeoutMs: TIMEOUT_MS,
	});
	const name = `${test.name} on ${tier}`;
	/** @type {(reason: string) => Outcome} */
	const fail = (reason) => ({
		status: 'FAIL',
		text: `${name}: ${reason}`,
		details: listed(errors, 'error'),
	});
	if (!result.ok) return fail(result.error);
	const image = heldImage(result);
	writePng(files.image, image);
	const shown = named({ image: files.image });
	if (result.tier !== REPORTED_TIERS[tier])
		return fail(`the engine drew on ${result.tier}, not on ${REPORTED_TIERS[tier]}${shown}`);
	if (errors.length > 0) return fail(`the page logged ${counted(errors.length, 'error')}${shown}`);
	const judged = judgeImage(image, files, update);
	return { ...judged, text: `${name}: ${judged.text}` };
}

/**
 * Runs the image tests of the project in `root`, and reports each result, and the browser that
 * draws them, as it comes.
 *
 * @param {string} root
 * @param {TestOptions} options
 * @param {(item: Outcome | string) => void} report
 */
async function imageTests(root, { gpu, updateReferences }, report) {
	const config = readTestConfig(root);
	if (config === null) {
		report({
			status: 'SKIP',
			text: `image tests: the project has no ${CONFIG_FILE}. List the tests there, such as ${EXAMPLE}`,
		});
		return;
	}
	if (config.problems.length > 0 || config.tests.length === 0) {
		report({
			status: 'FAIL',
			text: `image tests: ${CONFIG_FILE} ${config.problems.length > 0 ? `has ${counted(config.problems.length, 'problem')}` : 'lists no tests'}`,
			details: config.problems,
		});
		return;
	}
	/** @type {{ test: ImageTest, tier: Tier }[]} */
	const runs = [];
	for (const test of config.tests) {
		const tiers = gpu ? test.tiers.filter((tier) => gpu.includes(tier)) : test.tiers;
		if (tiers.length === 0)
			report({
				status: 'SKIP',
				text: `${test.name}: --gpu names none of its tiers (${test.tiers.join(', ')})`,
			});
		for (const tier of tiers) runs.push({ test, tier });
	}
	if (runs.length === 0) return;
	const environment = defaultEnvironment();
	const runner = await startRunner({ environment, plugins: [sketchPagePlugin()] });
	try {
		const where =
			environment === 'chrome-real-gpu' ? "this computer's GPU" : 'SwiftShader, a GPU in software';
		report(
			`The images are drawn in ${runner.browserName} on ${where}, and compared with the references in ${REFERENCES_DIR}/${environment}.`,
		);
		for (const { test, tier } of runs)
			report(await imageTest(runner, root, test, tier, updateReferences));
	} finally {
		await runner.close();
	}
}

/**
 * A result as the command prints it: its status, what was checked, and any lines under it.
 *
 * @param {Outcome} outcome
 */
export function outcomeText({ status, text, details = [] }) {
	return [`${status.padEnd(5)} ${text}`, ...details.map((line) => `${DETAIL_INDENT}${line}`)].join(
		'\n',
	);
}

/**
 * The last line: how many checks passed, failed and were skipped, and how many references were
 * saved.
 *
 * @param {readonly Outcome[]} outcomes
 */
export function summaryLine(outcomes) {
	const count = (/** @type {Outcome['status']} */ status) =>
		outcomes.filter((outcome) => outcome.status === status).length;
	const parts = [
		[count('PASS'), 'passed'],
		[count('FAIL'), 'failed'],
		[count('SKIP'), 'skipped'],
	]
		.filter(([n]) => n)
		.map(([n, word]) => `${n} ${word}`);
	const saved = count('SAVED');
	if (saved > 0) parts.push(`${counted(saved, 'reference')} saved`);
	return `${parts.join(', ')}.`;
}

/**
 * Runs the test command with its arguments, prints each result as it comes and a count at the
 * end, and returns the exit code: 0 when no check failed, 1 when one did.
 *
 * @param {readonly string[]} args
 * @returns {Promise<number>}
 */
export async function run(args) {
	const options = parseTestArgs(args);
	if (options.help) {
		console.log(HELP);
		return 0;
	}
	const root = process.cwd();
	/** @type {Outcome[]} */
	const outcomes = [];
	const print = (/** @type {Outcome | string} */ item) => {
		if (typeof item !== 'string') outcomes.push(item);
		console.log(typeof item === 'string' ? item : outcomeText(item));
	};
	// The type check and the lint script run in child processes while the browser draws. Their
	// results print first, and the image tests that finish before them wait.
	const checks = Promise.all([typeCheck(root), lint(root)]);
	/** @type {(Outcome | string)[] | null} */
	let waiting = [];
	const report = (/** @type {Outcome | string} */ item) =>
		waiting ? waiting.push(item) : print(item);
	const images = imageTests(root, options, report).catch((error) =>
		report({
			status: 'FAIL',
			text: `image tests: ${error instanceof Error ? error.message : error}`,
		}),
	);
	for (const outcome of await checks) print(outcome);
	for (const item of waiting) print(item);
	waiting = null;
	await images;
	console.log(summaryLine(outcomes));
	return outcomes.some((outcome) => outcome.status === 'FAIL') ? 1 : 0;
}
