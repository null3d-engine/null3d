// null3d shaders record: records the permutation words that the project's pages draw with, and
// adds them to a list. The Vite plugin's `shaders.list` option names the list, and a production
// build then copies only the shader builds of those words, rather than every build of the engine's
// shader set. The pages load in a headless browser with the engine's recording switch: each held
// page at the low and high presets on both GPU paths, and each live page on both GPU paths. With
// `--manual`, one page opens in a browser window for a person to play through, and its words are
// saved when they say so.
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { readArguments, readMilliseconds, UsageError } from './args.js';
import { defaultEnvironment, launchBrowser } from './browser.js';
import { switchedPath } from './page.js';
import { startDevServer } from './server.js';
import {
	LIVE_MS,
	loadSteps,
	RECORD_GPUS,
	readExtraWords,
	recordingUrl,
	recordTargets,
	recordWords,
} from './shader-record.js';
import { parseVerifyArgs, runVerify, HELP as VERIFY_HELP } from './shader-verify.js';
import { recordedWords, writeWordList } from './shader-words.js';
import { shownPath } from './text.js';

/** @import { Readable, Writable } from 'node:stream' */

/** The quality presets that `--preset` takes. */
const PRESETS = ['low', 'medium', 'high', 'ultra'];

const OPTIONS = /** @type {const} */ ({
	base: { type: 'string' },
	page: { type: 'string', multiple: true },
	live: { type: 'string', multiple: true },
	'live-ms': { type: 'string' },
	scroll: { type: 'boolean', default: false },
	click: { type: 'string' },
	'settle-ms': { type: 'string' },
	'max-ms': { type: 'string' },
	'scroll-dwell': { type: 'string' },
	steps: { type: 'string' },
	out: { type: 'string', default: 'shader-permutations.txt' },
	extra: { type: 'string' },
	replace: { type: 'boolean', default: false },
	manual: { type: 'boolean', default: false },
	gpu: { type: 'string' },
	preset: { type: 'string' },
	help: { type: 'boolean', short: 'h', default: false },
});

export const HELP = `Usage: bunx @null3d/cli shaders record [options]

Its subcommands are record and verify. This page shows record; run
bunx @null3d/cli shaders verify --help for the production check.

Records the permutation words that the project's pages draw with, and adds them to a list, one
hexadecimal word on each line. Name the list in the Vite plugin's options, as
null3d({ shaders: { list: 'shader-permutations.txt' } }). A production build then copies only the
shader builds of those words. Without a list, it copies the engine's whole shader set, which is
thousands of files and gigabytes.

Each page loads with the engine's recording switch. A held page loads in hold mode at the low and
high quality presets, on WebGPU and on WebGL2. A live page loads on both GPU paths and draws until
its word set stops growing: at least 15 seconds, and until 5 seconds pass with no new word, within
60 seconds. The recorder presses every button of its controls HUD, when it has one. Without --page
or --live, it records / both ways. The words join those that the list holds already, so each level
or mode can be recorded in a run of its own.

A project with action-gated or time-based states gives its own steps with --steps, so those states
need no --extra word by hand. Record again after the project gains a feature that draws with a new
word, or after a state that arrives with time, and check the production build with
bunx @null3d/cli shaders verify.

Options:
  --base <url>              The address of a server that serves the pages with a development
                            build of the engine, such as https://localhost:5173. A production build
                            ignores the recording switch. Without it, the command starts the
                            project's own Vite dev server in the current folder
  --page <path>             A page to record in hold mode, from the server's root. Repeat it for
                            each page. A path that names its own hold= time keeps it
  --live <path>             A page to record live, which the recorder drives through its states.
                            Repeat it for each page
  --live-ms <ms>            The least time that a live page draws (15000). A state that arrives
                            with time, such as an idle camera that turns a mesh into a level of
                            detail's fading band, needs a longer time
  --scroll                  Scroll each live page down to its end, one window's height at a time.
                            After each step the recorder waits until the page asks for nothing for
                            half a second, so a page that builds its later scenes as a visitor
                            scrolls records their words too
  --scroll-dwell <ms>       Rest after each scroll step, so a state that arrives with time reaches
                            its word (0)
  --click <selector>        An element to press after each page loads, for a page whose engine
                            starts on a click, such as "#play"
  --steps <file>            A module whose default export, or steps export, is a function of
                            { page, log, path } that drives the page through its states. Use it
                            for action-gated and time-based states, instead of the HUD sweep
  --settle-ms <ms>          How long the word set must stay unchanged before the recorder stops the
                            page (5000)
  --max-ms <ms>             The longest time that a live page draws (60000)
  --extra <words>           Words to add by hand, as hexadecimal numbers joined by commas, such as
                            0x10,0x14, for a state that no page reaches while it records
  --out <file>              The list to write (shader-permutations.txt)
  --replace                 Write the recorded words alone, rather than adding them to the list
  --manual                  Open the --live page, or /, in a browser window, for you to play
                            through its menus, settings and levels by hand. Press Enter here to
                            save its words. Ctrl-C asks before it discards them. Record by hand on
                            both GPU paths at the low and high presets, as the automatic run does
  --gpu <path>              With --manual: webgpu or webgl2 (the engine's own choice)
  --preset <name>           With --manual: low, medium, high or ultra (the engine's own choice)

Record again after the project gains a feature that draws with a new word, or after a state that
arrives with time. A production build that lacks a word skips the draws of a mesh pipeline and
reports the word, and a full-screen pass stops with the word in its error. Check the build with
bunx @null3d/cli shaders verify. It draws with Chrome for Testing on this computer's GPU, and
downloads it on first use. When the CI variable is set, it draws with Playwright's Chromium on
SwiftShader, the software GPU of machines without a GPU.`;

/**
 * @typedef {object} RecordOptions
 * @property {string | undefined} base The address of the server of the pages, or undefined to start
 *   the project's own dev server.
 * @property {string[]} held The pages to record in hold mode.
 * @property {string[]} live The pages to record live.
 * @property {boolean} scroll True to scroll each live page to its end.
 * @property {number} scrollDwell How long each scroll step rests, in ms.
 * @property {string | undefined} click The element to press after each page loads.
 * @property {string | undefined} stepsFile The module that drives a page's states, or undefined.
 * @property {number} liveMs The least time a live page draws, in ms.
 * @property {number} settleMs How long the word set stays unchanged before a live page stops, in ms.
 * @property {number} maxMs The longest time a live page draws, in ms.
 * @property {number[]} extra The words to add by hand.
 * @property {string} out The list to write, from the current folder.
 * @property {boolean} replace True to write the recorded words alone.
 * @property {boolean} manual True to open one live page for a person to play through.
 * @property {string | undefined} gpu The GPU path of a manual run.
 * @property {string | undefined} preset The quality preset of a manual run.
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
	const { base, click, out, help, scroll, replace, manual, gpu, preset } = values;
	if (base !== undefined && !/^https?:\/\//.test(base))
		throw new UsageError(`--base takes an address such as https://localhost:5173, not "${base}"`);
	const held = (values.page ?? []).map((path) => readPath('--page', path));
	const live = (values.live ?? []).map((path) => readPath('--live', path));
	const liveMs =
		values['live-ms'] === undefined ? LIVE_MS : readMilliseconds('--live-ms', values['live-ms']);
	const settleMs =
		values['settle-ms'] === undefined
			? 5_000
			: readMilliseconds('--settle-ms', values['settle-ms']);
	const maxMs = Math.max(
		values['max-ms'] === undefined
			? 60_000
			: readMilliseconds('--max-ms', values['max-ms'], { above: true }),
		liveMs,
	);
	const scrollDwell =
		values['scroll-dwell'] === undefined
			? 0
			: readMilliseconds('--scroll-dwell', values['scroll-dwell']);
	if (scroll && live.length === 0 && held.length > 0)
		throw new UsageError('--scroll scrolls the live pages, and no --live page is named');
	if (manual && (held.length > 0 || live.length > 1 || scroll))
		throw new UsageError(
			'--manual opens one page for you to play through: name it with one --live, without --page or --scroll',
		);
	if (manual && values.steps !== undefined)
		throw new UsageError('--steps drives an automatic run: leave it out with --manual');
	if (manual && values['live-ms'] !== undefined)
		throw new UsageError('--live-ms times the automatic run, so it goes without --manual');
	if (values['live-ms'] !== undefined && live.length === 0 && held.length > 0)
		throw new UsageError('--live-ms times the live pages, and no --live page is named');
	if (!manual && (gpu !== undefined || preset !== undefined))
		throw new UsageError(
			'--gpu and --preset go with --manual: the automatic run records both GPU paths at the low and high presets',
		);
	if (gpu !== undefined && !RECORD_GPUS.includes(/** @type {never} */ (gpu)))
		throw new UsageError(`--gpu takes ${RECORD_GPUS.join(' or ')}, not "${gpu}"`);
	if (preset !== undefined && !PRESETS.includes(preset))
		throw new UsageError(`--preset takes ${PRESETS.join(', ')}, not "${preset}"`);
	let extra = /** @type {number[]} */ ([]);
	try {
		extra = readExtraWords(values.extra ?? '');
	} catch (error) {
		throw new UsageError(`--extra: ${error instanceof Error ? error.message : error}`);
	}
	const none = held.length === 0 && live.length === 0;
	return {
		base,
		held: none && !manual ? ['/'] : held,
		live: none ? ['/'] : live,
		liveMs,
		scroll,
		scrollDwell,
		click,
		stepsFile: values.steps,
		settleMs,
		maxMs,
		extra,
		out,
		replace,
		manual,
		gpu,
		preset,
		help,
	};
}

/**
 * Waits for the person who records by hand: it resolves with `save` when they press Enter, or
 * when the input ends. Ctrl-C asks whether to discard the words, and an answer of `y` resolves
 * with `discard`; any other answer saves them. `closed` resolves with `closed` when the page goes
 * before they answer.
 *
 * @param {{ input?: Readable, output?: Writable, closed?: Promise<'closed'> }} [streams]
 * @returns {Promise<'save' | 'discard' | 'closed'>}
 */
export function askToSave({
	input = process.stdin,
	output = process.stdout,
	closed = new Promise(() => {}),
} = {}) {
	const prompt = createInterface({ input, output, terminal: 'isTTY' in input && !!input.isTTY });
	/** @type {Promise<'save' | 'discard'>} */
	const answered = new Promise((done) => {
		let asking = false;
		prompt.on('line', (line) => {
			if (!asking) return done('save');
			done(/^y(es)?$/i.test(line.trim()) ? 'discard' : 'save');
		});
		prompt.on('close', () => done('save'));
		prompt.on('SIGINT', () => {
			asking = true;
			output.write(
				'\nDiscard the words that the page reached? Type y and Enter to discard them, or press Enter to save them: ',
			);
		});
	});
	return Promise.race([answered, closed]).finally(() => prompt.close());
}

/**
 * Opens one page in a browser window, with the recording switch and any GPU path and preset, for
 * a person to play through, and gives its words once they press Enter, or nothing when they
 * discard them or close the page first.
 *
 * @param {RecordOptions} options
 * @param {string} base
 * @returns {Promise<number[] | undefined>}
 */
async function recordByHand(options, base) {
	const path = switchedPath(options.live[0] ?? '/', { gpu: options.gpu, preset: options.preset });
	const browser = await launchBrowser(defaultEnvironment(), [], undefined, undefined, false);
	try {
		// The window keeps its own size, as a person's browser does.
		const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: null });
		let loads = 0;
		page.on('framenavigated', (frame) => {
			if (frame !== page.mainFrame() || ++loads < 2) return;
			console.log(
				'The page loaded again, so the engine started a new recording and the words before it are gone. Record each page or reload in a run of its own: each run adds to the list.',
			);
		});
		/** @type {Promise<'closed'>} */
		const closed = new Promise((done) => page.once('close', () => done('closed')));
		await page.goto(recordingUrl(base, path));
		if (options.click !== undefined)
			await page.locator(options.click).first().click({ timeout: 30_000 });
		console.log(
			`Recording ${path}. Play through every menu, setting, level and mode that the page offers. Then press Enter here to save the words, or Ctrl-C to stop.`,
		);
		const answer = await askToSave({ closed });
		if (answer === 'closed') {
			console.log('The page closed before the words were saved, so the list stays as it was.');
			return undefined;
		}
		if (answer === 'discard') {
			console.log('The words were discarded, and the list stays as it was.');
			return undefined;
		}
		return await recordedWords(page);
	} finally {
		await browser.close();
	}
}

/**
 * Runs the shaders command with its arguments, and returns the exit code: 0 once the list is
 * written, 1 when a manual run saved nothing.
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
	if (subcommand === 'verify') {
		const verify = parseVerifyArgs(rest);
		if (verify.help) {
			console.log(VERIFY_HELP);
			return 0;
		}
		return runVerify(verify);
	}
	if (subcommand !== 'record')
		throw new UsageError(`its subcommands are record and verify, not "${subcommand}"`);
	const options = parseRecordArgs(rest);
	if (options.help) {
		console.log(HELP);
		return 0;
	}
	const server = options.base === undefined ? await startDevServer() : undefined;
	try {
		const base = options.base ?? /** @type {{ url: string }} */ (server).url;
		let words;
		if (options.manual) words = await recordByHand(options, base);
		else {
			const targets = recordTargets(options);
			const steps =
				options.stepsFile === undefined ? undefined : await loadSteps(options.stepsFile);
			console.log(`Recording ${targets.length} pages from ${base}`);
			const browser = await launchBrowser(defaultEnvironment());
			try {
				words = await recordWords({
					browser,
					base,
					targets,
					click: options.click,
					liveMs: options.liveMs,
					settleMs: options.settleMs,
					maxMs: options.maxMs,
					scrollDwell: options.scrollDwell,
					steps,
				});
			} finally {
				await browser.close();
			}
		}
		if (words === undefined) return 1;
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
