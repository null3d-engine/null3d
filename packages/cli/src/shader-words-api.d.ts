// The types of `@null3d/cli/shaders`, which `shader-words.js` implements: the list of the shader
// permutation words that a project's pages draw with, and the words that a page reached while it
// recorded. A project's browser tests import it to add the words of the states they drive.

/** The parts of a Playwright page that reading its words takes. A Playwright `Page` has them. */
export interface RecordingPage {
	evaluate(fn: () => unknown): Promise<unknown>;
	waitForFunction(
		fn: () => unknown,
		arg: undefined,
		options: { timeout: number; polling: number },
	): Promise<unknown>;
}

/** The command that writes a list, as the header of a list that it writes names it. */
export const WRITER: string;

/**
 * The words of a list's text: one word on each line, as hexadecimal with `0x` or as a decimal
 * number, with `#` starting a comment. Throws with the line of a word that it cannot read.
 */
export function parseWordList(text: string, file: string): number[];

/** The words of the list at `file`, or none when the file does not exist. */
export function readWordList(file: string): number[];

/** The text of a list: a header that names `writer`, then each word once, in order. */
export function listText(words: Iterable<number>, writer?: string): string;

/**
 * Writes `words` to the list at `file`, joined to those that it holds already unless `replace` is
 * set. Gives the list's words and how many of them are new.
 */
export function writeWordList(
	file: string,
	words: Iterable<number>,
	options?: { replace?: boolean; writer?: string },
): { words: number[]; added: number };

/** The address with the engine's recording switch, `?permutations=record`, beside its own query. */
export function withRecordingSwitch(address: string): string;

/**
 * Ends the recording of a page that runs with the recording switch, and gives the words that it
 * reached. A page in hold mode publishes its words once its held frame has drawn.
 */
export function recordedWords(
	page: RecordingPage,
	options?: { timeoutMs?: number },
): Promise<number[]>;

/**
 * Ends the recording of `page` and adds its words to the list at `file`, or writes them alone with
 * `replace`. Gives the list's words and how many of them are new.
 */
export function saveRecordedWords(
	page: RecordingPage,
	file: string,
	options?: { replace?: boolean; timeoutMs?: number },
): Promise<{ words: number[]; added: number }>;
