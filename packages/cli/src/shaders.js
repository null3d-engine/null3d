// null3d shaders record: records the permutation words that the project's pages draw with, and
// adds them to a list. The Vite plugin's `shaders.list` option names the list, and a production
// build then copies only the shader builds of those words, rather than every build of the engine's
// shader set. The pages load in a headless browser with the engine's recording switch: each held
// page at the low and high presets on both GPU paths, and each live page on both GPU paths.
import { resolve } from 'node:path';
import { readArguments, UsageError } from './args.js';
import { defaultEnvironment, launchBrowser } from './browser.js';
import { startDevServer } from './server.js';
import { readExtraWords, recordTargets, recordWords } from './shader-record.js';
import { writeWordList } from './shader-words.js';
import { shownPath } from './text.js';

const OPTIONS = /** @type {const} */ ({
	base: { type: 'string' },
	page: { type: 'string', multiple: true },
	live: { type: 'string', multiple: true },
	scroll: { type: 'boolean', default: false },
	click: { type: 'string' },
	out: { type: 'string', default: 'shader-permutations.txt' },
	extra: { type: 'string' },
	replace: { type: 'boolean', default: false },
	help: { type: 'boolean', short: 'h', default: false },
});

export const HELP = `Usage: bunx @null3d/cli shaders record [options]

Records the permutation words that the project's pages draw with, and adds them to a list, one
hexadecimal word on each line. Name the list in the Vite plugin's options, as
null3d({ shaders: { list: 'shader-permutations.txt' } }). A production build then copies only the
shader builds of those words. Without a list, it copies the engine's whole shader set, which is
thousands of files and gigabytes.

Each page loads with the engine's recording switch. A held page loads in hold mode at the low and
high quality presets, on WebGPU and on WebGL2. A live page loads on both GPU paths, draws for five
seconds, and the recorder presses every button of its controls HUD, when it has one. Without
--page or --live, it records / both ways. The words join those that the list holds already, so
each level or mode can be recorded in a run of its own.

Options:
  --base <url>              The address of a server that serves the pages with a development
                            build of the engine, such as https://localhost:5173. A production build
                            ignores the recording switch. Without it, the command starts the
                            project's own Vite dev server in the current folder
  --page <path>             A page to record in hold mode, from the server's root. Repeat it for
                            each page. A path that names its own hold= time keeps it
  --live <path>             A page to record live, which the recorder drives through its states.
                            Repeat it for each page
  --scroll                  Scroll each live page down to its end, one window's height at a time.
                            After each step the recorder waits until the page asks for nothing for
                            half a second, so a page that builds its later scenes as a visitor
                            scrolls records their words too
  --click <selector>        An element to press after each page loads, for a page whose engine
                            starts on a click, such as "#play"
  --extra <words>           Words to add by hand, as hexadecimal numbers joined by commas, such as
                            0x10,0x14, for a state that no page reaches while it records
  --out <file>              The list to write (shader-permutations.txt)
  --replace                 Write the recorded words alone, rather than adding them to the list

Record again after the project gains a feature that draws with a new word. A production build that
lacks a word fails its pipeline with a message that names the word. It draws with Chrome for
Testing on this computer's GPU, and downloads it on first use. When the CI variable is set, it draws
with Playwright's Chromium on SwiftShader, the software GPU of machines without a GPU.`;

/**
 * @typedef {object} RecordOptions
 * @property {string | undefined} base The address of the server of the pages, or undefined to start
 *   the project's own dev server.
 * @property {string[]} held The pages to record in hold mode.
 * @property {string[]} live The pages to record live.
 * @property {boolean} scroll True to scroll each live page to its end.
 * @property {string | undefined} click The element to press after each page loads.
 * @property {number[]} extra The words to add by hand.
 * @property {string} out The list to write, from the current folder.
 * @property {boolean} replace True to write the recorded words alone.
 * @property {boolean} help True to print the help instead.
 */

/**
 * Checks that a page option gives a path on the server, not a full address.
 *
 * @param {string} option
 * @param {string} path
 */
function readPath(option, path) {
	if (/^[a-z][a-z0-9+.-]*:/i.test(path) || !path.startsWith('/'))
		throw new UsageError(`${option} takes a path from the server's root, such as /, not "${path}"`);
	return path;
}

/**
 * The options that `args` gives the record subcommand.
 *
 * @param {readonly string[]} args The arguments after `record`.
 * @returns {RecordOptions}
 */
export function parseRecordArgs(args) {
	const { values } = readArguments(args, OPTIONS, false);
	const { base, click, out, help, scroll, replace } = values;
	if (base !== undefined && !/^https?:\/\//.test(base))
		throw new UsageError(`--base takes an address such as https://localhost:5173, not "${base}"`);
	const held = (values.page ?? []).map((path) => readPath('--page', path));
	const live = (values.live ?? []).map((path) => readPath('--live', path));
	if (scroll && live.length === 0 && held.length > 0)
		throw new UsageError('--scroll scrolls the live pages, and no --live page is named');
	let extra = /** @type {number[]} */ ([]);
	try {
		extra = readExtraWords(values.extra ?? '');
	} catch (error) {
		throw new UsageError(`--extra: ${error instanceof Error ? error.message : error}`);
	}
	const none = held.length === 0 && live.length === 0;
	return {
		base,
		held: none ? ['/'] : held,
		live: none ? ['/'] : live,
		scroll,
		click,
		extra,
		out,
		replace,
		help,
	};
}

/**
 * Runs the shaders command with its arguments, and returns the exit code: 0 once the list is
 * written.
 *
 * @param {readonly string[]} args
 * @returns {Promise<number>}
 */
export async function run(args) {
	const [subcommand, ...rest] = args;
	if (subcommand === undefined || subcommand === '--help' || subcommand === '-h') {
		console.log(HELP);
		return 0;
	}
	if (subcommand !== 'record')
		throw new UsageError(`its one subcommand is record, not "${subcommand}"`);
	const options = parseRecordArgs(rest);
	if (options.help) {
		console.log(HELP);
		return 0;
	}
	const server = options.base === undefined ? await startDevServer() : undefined;
	try {
		const base = options.base ?? /** @type {{ url: string }} */ (server).url;
		const targets = recordTargets(options);
		console.log(`Recording ${targets.length} pages from ${base}`);
		const browser = await launchBrowser(defaultEnvironment());
		let words;
		try {
			words = await recordWords({ browser, base, targets, click: options.click });
		} finally {
			await browser.close();
		}
		const out = resolve(options.out);
		const list = writeWordList(out, [...words, ...options.extra], { replace: options.replace });
		console.log(
			`Wrote ${list.words.length} words to ${shownPath(out)}, ${list.added} of them new. Name it in the Vite plugin's options: null3d({ shaders: { list: '${options.out}' } })`,
		);
		return 0;
	} finally {
		await server?.close();
	}
}
