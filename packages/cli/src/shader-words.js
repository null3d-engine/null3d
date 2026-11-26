// The list of the shader permutation words that a project's pages draw with, as a file, and the
// words that a page reached while it recorded. A page records with the engine's switch
// `?permutations=record`: the engine collects the word of each pipeline that it builds, and
// publishes them once the recording stops. `bunx @null3d/cli shaders record` writes the list
// through this module.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

/** The command that writes a list, as the header of a list that it writes names it. */
export const WRITER = 'bunx @null3d/cli shaders record';

/** How long a page may take to publish its words once its recording stops, in ms. */
const PUBLISH_MS = 240_000;

/** The largest permutation word: the shader build keeps a word in 32 bits. */
const MAX_WORD = 0xffff_ffff;

/**
 * The page's record of the words that a recording collected, and the stop of a live page.
 *
 * @typedef {{ __null3dPermutations?: number[], __null3dStopRecording?: () => void }} Recorded
 */

/**
 * The parts of a Playwright page that reading its words takes.
 *
 * @typedef {object} RecordingPage
 * @property {(fn: () => unknown) => Promise<unknown>} evaluate
 * @property {(fn: () => unknown, arg: undefined, options: { timeout: number, polling: number }) => Promise<unknown>} waitForFunction
 */

/**
 * The words of a list's text: one word on each line, as hexadecimal with `0x` or as a decimal
 * number, with `#` starting a comment, as the Vite plugin and the shader build read them. Throws
 * with the line of a word that it cannot read.
 *
 * @param {string} text
 * @param {string} file The list's name, for the message.
 * @returns {number[]}
 */
export function parseWordList(text, file) {
	/** @type {number[]} */
	const words = [];
	for (const [index, raw] of text.split('\n').entries()) {
		const word = (raw.split('#')[0] ?? '').trim();
		if (word === '') continue;
		const value = /^0[xX][0-9a-fA-F]+$/.test(word)
			? Number.parseInt(word.slice(2), 16)
			: /^\d+$/.test(word)
				? Number(word)
				: Number.NaN;
		if (!(value <= MAX_WORD))
			throw new Error(
				`${file} line ${index + 1}: "${word}" is not a permutation word. Write one hexadecimal word on each line, such as 0x00000010.`,
			);
		words.push(value);
	}
	return words;
}

/**
 * The words of the list at `file`, or none when the file does not exist.
 *
 * @param {string} file
 * @returns {number[]}
 */
export function readWordList(file) {
	return existsSync(file) ? parseWordList(readFileSync(file, 'utf8'), file) : [];
}

/**
 * The text of a list of words: a header that names the tool that wrote it, then one word on each
 * line, as eight hexadecimal digits after `0x`, in order and once each.
 *
 * @param {Iterable<number>} words
 * @param {string} [writer] The command that wrote the list.
 */
export function listText(words, writer = WRITER) {
	// The word without any bit set is a word like another: the builds of compute passes,
	// pre-passes and full-screen passes carry it, so a list that left it out would leave those
	// passes without a shader.
	const sorted = [...new Set([...words].map((word) => word >>> 0))].sort((a, b) => a - b);
	return `${[
		'# The permutation words that this project draws with, one hexadecimal word on each line.',
		`# Written by ${writer}. A word added by hand keeps the run working`,
		'# where a path cannot be recorded.',
		...sorted.map((word) => `0x${word.toString(16).padStart(8, '0')}`),
	].join('\n')}\n`;
}

/**
 * Writes `words` to the list at `file`. The words join those that the file already holds, so
 * each level or mode of a game can be recorded in a run of its own into one list; `replace`
 * writes `words` alone. Gives the list's words and how many of them are new.
 *
 * @param {string} file
 * @param {Iterable<number>} words
 * @param {{ replace?: boolean, writer?: string }} [options]
 * @returns {{ words: number[], added: number }}
 */
export function writeWordList(file, words, { replace = false, writer = WRITER } = {}) {
	const before = new Set(replace ? [] : readWordList(file).map((word) => word >>> 0));
	const all = new Set(before);
	for (const word of words) all.add(word >>> 0);
	writeFileSync(file, listText(all, writer));
	return { words: [...all].sort((a, b) => a - b), added: all.size - before.size };
}

/**
 * Ends the recording of a page that runs with the recording switch, and gives the words that it
 * reached. A live page stops when this asks it to; a page in hold mode publishes its words once
 * its held frame has drawn.
 *
 * @param {RecordingPage} page
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<number[]>}
 */
export async function recordedWords(page, { timeoutMs = PUBLISH_MS } = {}) {
	await page.evaluate(() => /** @type {Recorded} */ (globalThis).__null3dStopRecording?.());
	await page.waitForFunction(
		() => /** @type {Recorded} */ (globalThis).__null3dPermutations !== undefined,
		undefined,
		{ timeout: timeoutMs, polling: 250 },
	);
	const words = /** @type {number[]} */ (
		await page.evaluate(() => /** @type {Recorded} */ (globalThis).__null3dPermutations)
	);
	return words.map((word) => word >>> 0);
}
