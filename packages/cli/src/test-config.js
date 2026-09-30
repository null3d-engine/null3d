// The project's image tests, which null3d.json in the project's folder lists. Each test draws a
// sketch module or a page in the engine's hold mode, at a set sketch time and size, on its GPU
// tiers. Reading the file checks every setting, and says what is wrong in plain words.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSize, sizeRule } from './args.js';
import { TIERS } from './page.js';

/** @import { Tier } from './page.js' */

/** The file that lists the tests, in the project's folder. */
export const CONFIG_FILE = 'null3d.json';

/** The size of a test's image when its entry gives none. */
export const DEFAULT_SIZE = '320x180';

/** The longest sketch time that the engine holds at, in seconds. */
const MAX_HOLD = 600;

/** Names that become file names: lowercase words joined by dashes. */
const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** The settings of a test. */
const SETTINGS = ['name', 'sketch', 'page', 'hold', 'size', 'tiers'];

/**
 * @typedef {object} ImageTest One image test of the project.
 * @property {string} name The test's name, which names its image files.
 * @property {string} [sketch] The sketch module to draw, from the project's folder, with any query
 *   of its own.
 * @property {string} [page] The page to open instead, from the dev server's root.
 * @property {number} hold The sketch time to hold at, in seconds.
 * @property {readonly [number, number]} size The image's width and height in pixels.
 * @property {readonly Tier[]} tiers The GPU tiers to draw on.
 */

/**
 * @typedef {object} TestConfig The file's tests, or what is wrong with it.
 * @property {ImageTest[]} tests
 * @property {string[]} problems
 */

/** An example test, which messages about the file show. */
const TEST_EXAMPLE = '{ "name": "start", "sketch": "sketch.ts", "hold": 1.5 }';

/** An example of the whole file, which messages about the file show. */
export const EXAMPLE = `{ "tests": [${TEST_EXAMPLE}] }`;

/**
 * What is wrong with the value of a test's `tiers`, or nothing.
 *
 * @param {unknown} tiers
 */
function tierProblem(tiers) {
	if (
		Array.isArray(tiers) &&
		tiers.length > 0 &&
		tiers.every((tier) => TIERS.includes(tier)) &&
		new Set(tiers).size === tiers.length
	)
		return undefined;
	return `"tiers" lists each of ${TIERS.join(', ')} at most once, and at least one, not ${JSON.stringify(tiers)}`;
}

/**
 * The test that an entry of the file describes, or what is wrong with it. `exists` says whether a
 * file exists, from the project's folder.
 *
 * @param {unknown} entry
 * @param {(file: string) => boolean} exists
 * @returns {ImageTest | string[]}
 */
function readTest(entry, exists) {
	if (typeof entry !== 'object' || entry === null || Array.isArray(entry))
		return [`each test is an object, such as ${TEST_EXAMPLE}`];
	const test = /** @type {Record<string, unknown>} */ (entry);
	const problems = Object.keys(test)
		.filter((key) => !SETTINGS.includes(key))
		.map((key) => `"${key}" is not a setting of a test. A test takes ${SETTINGS.join(', ')}`);
	const { name, sketch, page, hold, size = DEFAULT_SIZE, tiers = TIERS } = test;
	if (typeof name !== 'string' || !NAME.test(name))
		problems.push(
			`"name" takes lowercase words joined by dashes, such as "harbor-at-night", not ${JSON.stringify(name)}`,
		);
	if ((sketch === undefined) === (page === undefined))
		problems.push('give either "sketch", a sketch module to draw, or "page", a page to open');
	else if (sketch !== undefined) {
		const file = typeof sketch === 'string' ? sketch.split('?')[0] : '';
		if (!file || /^([a-z][a-z0-9+.-]*:|\/)/i.test(file))
			problems.push(
				`"sketch" takes a path from the project's folder, such as "sketch.ts", not ${JSON.stringify(sketch)}`,
			);
		else if (!exists(file)) problems.push(`the sketch ${file} does not exist`);
	} else if (typeof page !== 'string' || !page.startsWith('/'))
		problems.push(
			`"page" takes a path on the dev server that starts with /, such as "/", not ${JSON.stringify(page)}`,
		);
	if (typeof hold !== 'number' || !(hold >= 0 && hold <= MAX_HOLD))
		problems.push(
			`"hold" takes the sketch time in seconds, from 0 to ${MAX_HOLD}, not ${JSON.stringify(hold)}`,
		);
	const parsedSize = typeof size === 'string' ? parseSize(size) : undefined;
	if (!parsedSize) problems.push(sizeRule('"size"', String(size)));
	const tierText = tierProblem(tiers);
	if (tierText) problems.push(tierText);
	if (problems.length > 0) return problems;
	return {
		name: /** @type {string} */ (name),
		...(sketch !== undefined ? { sketch: /** @type {string} */ (sketch) } : {}),
		...(page !== undefined ? { page: /** @type {string} */ (page) } : {}),
		hold: /** @type {number} */ (hold),
		size: /** @type {readonly [number, number]} */ (parsedSize),
		tiers: /** @type {readonly Tier[]} */ (tiers),
	};
}

/**
 * The tests that the text of the file lists, and what is wrong with them. `exists` says whether a
 * file exists, from the project's folder.
 *
 * @param {string} text
 * @param {(file: string) => boolean} exists
 * @returns {TestConfig}
 */
export function parseTestConfig(text, exists) {
	let value;
	try {
		value = JSON.parse(text);
	} catch (error) {
		return {
			tests: [],
			problems: [`it is not valid JSON: ${error instanceof Error ? error.message : error}`],
		};
	}
	const list = value?.tests;
	if (!Array.isArray(list) || Object.keys(value).length !== 1)
		return {
			tests: [],
			problems: [`it holds one object with a "tests" list and nothing else, such as ${EXAMPLE}`],
		};
	/** @type {TestConfig} */
	const config = { tests: [], problems: [] };
	const names = new Set();
	list.forEach((entry, index) => {
		const test = readTest(entry, exists);
		const label = typeof entry?.name === 'string' ? `the test ${entry.name}` : `test ${index + 1}`;
		if (Array.isArray(test)) {
			config.problems.push(...test.map((problem) => `${label}: ${problem}`));
			return;
		}
		if (names.has(test.name)) config.problems.push(`two tests are named ${test.name}`);
		names.add(test.name);
		config.tests.push(test);
	});
	return config;
}

/**
 * The tests that the project in `root` lists, or null when it has no file of tests.
 *
 * @param {string} root
 * @returns {TestConfig | null}
 */
export function readTestConfig(root) {
	const path = join(root, CONFIG_FILE);
	if (!existsSync(path)) return null;
	return parseTestConfig(readFileSync(path, 'utf8'), (file) => existsSync(join(root, file)));
}
