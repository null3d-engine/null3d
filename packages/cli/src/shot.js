// null3d shot: draws one frame of the project's page in the engine's hold mode, in a headless
// browser, and saves it as a PNG file. Beside the image it saves a JSON file with the frame's facts
// and what the page and the dev server logged. It prints a short summary for agents, and fails when
// the engine drew no frame.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { parseSize, readOptions, readSeconds, sizeRule, UsageError } from './args.js';
import { heldImage, TIERS } from './page.js';
import { writePng } from './png.js';
import { holdPage, startRunner } from './runner.js';
import { counted, listed, shownPath } from './text.js';

/** @import { Environment } from './browser.js' */
/** @import { HeldStats, Tier } from './page.js' */
/** @import { RgbaImage } from './png.js' */
/** @import { HeldPage } from './runner.js' */

const OPTIONS = /** @type {const} */ ({
	out: { type: 'string', default: 'shot.png' },
	time: { type: 'string' },
	size: { type: 'string', default: '1280x720' },
	gpu: { type: 'string' },
	page: { type: 'string', default: '/' },
	timeout: { type: 'string', default: '60' },
	help: { type: 'boolean', short: 'h', default: false },
});

export const HELP = `Usage: bunx @null3d/cli shot [options]

Draws one frame of the project's page in the engine's hold mode, in a headless browser, and saves
it as a PNG file. It starts the project's own Vite dev server in the current folder. Beside the
image, it saves a JSON file with the frame's facts and the errors and warnings that the page and
the dev server logged.

Options:
  --out <file.png>          The image to write (shot.png). The JSON file gets its name: shot.json
  --time <seconds>          The sketch time of the frame, from 0 to 600 (the page's own hold
                            time, or 0)
  --size <width>x<height>   The browser window in CSS pixels, one image pixel each (1280x720)
  --gpu <tier>              webgpu, compat or webgl2 (the engine's own choice)
  --page <path>             The page to open, from the server's root (/)
  --timeout <seconds>       How long the page may take to draw the frame (60)

It draws with Google Chrome on this computer's GPU. When the CI variable is set, it draws with
Playwright's Chromium on SwiftShader, the software GPU of machines without a GPU.`;

/**
 * @typedef {object} ShotOptions
 * @property {string} out The PNG file to write, from the current folder.
 * @property {number} [time] The sketch time of the frame, in seconds.
 * @property {readonly [number, number]} size The browser window's size in CSS pixels.
 * @property {Tier} [gpu] The GPU tier to force.
 * @property {string} page The page to open, from the server's root.
 * @property {number} timeoutMs How long the page may take to draw the frame.
 * @property {boolean} help True to print the help instead.
 */

/**
 * The size that `--size` gives, such as `1280x720`.
 *
 * @param {string} text
 */
export function readSize(text) {
	const size = parseSize(text);
	if (size) return size;
	throw new UsageError(sizeRule('--size', text));
}

/**
 * Checks that `--page` gives a path on the project's server, not a full address.
 *
 * @param {string} page
 */
export function readPage(page) {
	if (/^[a-z][a-z0-9+.-]*:/i.test(page))
		throw new UsageError(`--page takes a path on the project's server, such as /, not "${page}"`);
}

/**
 * The options that `args` gives the shot command.
 *
 * @param {readonly string[]} args
 * @returns {ShotOptions}
 */
export function parseShotArgs(args) {
	const values = readOptions(args, OPTIONS);
	const { out, size, page, timeout, help } = values;
	if (!/\.png$/i.test(out)) throw new UsageError(`--out must name a .png file, not "${out}"`);
	const gpu = /** @type {Tier | undefined} */ (values.gpu);
	if (gpu !== undefined && !TIERS.includes(gpu))
		throw new UsageError(`--gpu takes ${TIERS.join(', ')}, not "${gpu}"`);
	readPage(page);
	return {
		out,
		...(values.time !== undefined && { time: readSeconds('--time', values.time) }),
		size: readSize(size),
		...(gpu !== undefined && { gpu }),
		page,
		timeoutMs: readSeconds('--timeout', timeout, { above: true }) * 1000,
		help,
	};
}

/**
 * @typedef {object} ShotReport What the JSON file beside the image holds.
 * @property {boolean} ok True when the engine drew the frame and the image was saved.
 * @property {string} page The page, with hold mode's switches.
 * @property {Environment} [environment] Where the frame was drawn: `chrome-real-gpu`, Chrome on
 *   the computer's GPU, or `chromium-swiftshader`, Chromium on the software GPU.
 * @property {string} [browser] The browser's version.
 * @property {number} [time] The sketch time of the frame, in seconds.
 * @property {number} [frame] The frame's number: the steps to the time, plus one.
 * @property {string} [tier] The GPU path that drew the frame.
 * @property {number} [width] The frame's width in pixels.
 * @property {number} [height] The frame's height in pixels.
 * @property {string} [image] The image file, in the JSON file's folder.
 * @property {string | null} [code] For a failure, the error's code, or null without one.
 * @property {string} [error] For a failure, what went wrong.
 * @property {HeldStats} [stats] The frame's figures: CPU time by thread and phase, draw calls,
 *   uploads and pipelines, as the engine summarizes frames. The held frame is the first that the
 *   engine draws, so it builds every pipeline and uploads the whole scene.
 * @property {number} [ms] Time from the page's navigation to the engine's result, in milliseconds.
 * @property {string[]} errors What the page and the dev server logged as errors.
 * @property {string[]} warnings What the page logged as warnings.
 */

/**
 * The report of a page's hold, and the image to save when the engine drew a frame.
 *
 * @param {HeldPage} held
 * @param {{ environment: Environment, browser: string, image: string }} facts
 * @returns {{ report: ShotReport, image?: RgbaImage }}
 */
export function shotReport(
	{ path, result, errors, warnings, ms },
	{ environment, browser, image },
) {
	const common = { page: path, environment, browser };
	if (!result.ok)
		return {
			report: {
				ok: false,
				...common,
				code: result.code,
				error: result.error,
				ms,
				errors,
				warnings,
			},
		};
	const { time, frame, tier, width, height, stats } = result;
	return {
		report: {
			ok: true,
			...common,
			time,
			frame,
			tier,
			width,
			height,
			image,
			...(stats && { stats }),
			ms,
			errors,
			warnings,
		},
		image: heldImage(result),
	};
}

/**
 * A number of bytes in the unit that suits it, such as `512 bytes`, `45.2 KB` or `1.2 MB`.
 *
 * @param {number} bytes
 */
export function byteSize(bytes) {
	if (bytes < 1024) return `${bytes} bytes`;
	const kb = bytes / 1024;
	return kb < 1024 ? `${kb.toFixed(1)} KB` : `${(kb / 1024).toFixed(1)} MB`;
}

/**
 * The summary that the command prints: what it drew or why it drew nothing, where it saved the
 * files, and what the page logged.
 *
 * @param {ShotReport} report
 * @param {{ page: string, size: readonly [number, number], png: string, json: string }} shot
 *   The page as asked for, the window's size, and the files as the summary names them.
 */
export function shotSummary(report, { page, size, png, json }) {
	const lines = [];
	if (report.ok) {
		lines.push(
			`Drew ${page} at ${report.time} s, frame ${report.frame}, on ${report.tier}: ${report.width} x ${report.height} pixels.`,
		);
		if (report.width !== size[0] || report.height !== size[1])
			lines.push(
				`The canvas is ${report.width} x ${report.height} pixels in a ${size[0]} x ${size[1]} window, as the page's own CSS sets it.`,
			);
		const { stats } = report;
		if (stats)
			lines.push(
				`It made ${counted(stats.drawCalls.median, 'draw call')}, uploaded ${byteSize(stats.uploadBytes.median)} and built ${counted(stats.pipelines, 'pipeline')}.`,
			);
		lines.push(`Saved ${png}, and the frame's facts and what the page logged in ${json}.`);
	} else {
		lines.push(`Drew no frame of ${page}: ${report.error}`);
		lines.push(`Saved what went wrong and what the page logged in ${json}.`);
	}
	const logged = [...listed(report.errors, 'error'), ...listed(report.warnings, 'warning')];
	lines.push(...(logged.length > 0 ? logged : ['The page logged no errors or warnings.']));
	return lines.join('\n');
}

/**
 * Writes a JSON file, and makes its folder when it is missing.
 *
 * @param {string} path
 * @param {unknown} value
 */
export function writeJson(path, value) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, '\t')}\n`);
}

/**
 * Runs the shot command with its arguments, prints its summary, and returns the exit code: 0 when
 * the engine drew the frame, 1 when it did not.
 *
 * @param {readonly string[]} args
 * @returns {Promise<number>}
 */
export async function run(args) {
	const options = parseShotArgs(args);
	if (options.help) {
		console.log(HELP);
		return 0;
	}
	const png = resolve(options.out);
	const json = png.replace(/\.png$/i, '.json');
	// An image from an earlier run must never pass for this run's.
	rmSync(png, { force: true });
	/** @type {ShotReport} */
	let report;
	let runner;
	try {
		runner = await startRunner();
		const held = await holdPage(runner, { ...options, path: options.page });
		const facts = {
			environment: runner.environment,
			browser: runner.browserName,
			image: basename(png),
		};
		const made = shotReport(held, facts);
		report = made.report;
		if (made.image) writePng(png, made.image);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		report = {
			ok: false,
			page: options.page,
			code: null,
			error: message,
			errors: [],
			warnings: [],
		};
	} finally {
		await runner?.close();
	}
	writeJson(json, report);
	console.log(shotSummary(report, { ...options, png: shownPath(png), json: shownPath(json) }));
	return report.ok ? 0 : 1;
}
