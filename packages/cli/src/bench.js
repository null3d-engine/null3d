// null3d bench: runs the benchmark protocol on a project's page. It builds the project for
// production, as it ships, and opens the page in a headless browser with the engine's bench switch,
// in fresh runs on each GPU path. Each run lets the page warm up, then measures the engine. The
// command prints the median of the runs and their spread: CPU time per frame by thread, GPU time
// and the frame rates. It saves every run's figures in a JSON file.
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readOptions, readSeconds, readTiers, UsageError } from './args.js';
import { WEBGPU_DEVELOPER_FEATURES } from './browser.js';
import { ENGINE_GLOBAL, switchedPath, TIERS } from './page.js';
import { MEASURE_SECONDS, ms, RUNS, summarizeRuns, timedRun, WARMUP_SECONDS } from './protocol.js';
import { failure, pollPage, startRunner, visitPage } from './runner.js';
import { readPage, readSize, writeJson } from './shot.js';
import { listed, shownPath } from './text.js';

/** @import { JSHandle, Page } from 'playwright-core' */
/** @import { Environment } from './browser.js' */
/** @import { HoldFailure, Tier } from './page.js' */
/** @import { MeasuredEngine, RunSummary, TimedRun } from './protocol.js' */
/** @import { Runner } from './runner.js' */

const OPTIONS = /** @type {const} */ ({
	page: { type: 'string', default: '/' },
	gpu: { type: 'string' },
	runs: { type: 'string', default: String(RUNS) },
	seconds: { type: 'string', default: String(MEASURE_SECONDS) },
	warmup: { type: 'string', default: String(WARMUP_SECONDS) },
	size: { type: 'string', default: '1280x720' },
	out: { type: 'string', default: 'bench.json' },
	timeout: { type: 'string', default: '60' },
	help: { type: 'boolean', short: 'h', default: false },
});

export const HELP = `Usage: bunx @null3d/cli bench [options]

Measures the engine on the project's page. It builds the project for production with its own Vite
config, serves the build, and opens the page in a headless browser. Each run opens the page fresh,
lets it run for the warm-up, then measures it. The command prints the median of the runs and the
lowest and highest run: CPU time per frame by thread, GPU time, and the frame rates. It saves every
run's figures, and what the page logged, in a JSON file.

Options:
  --page <path>             The page to open, from the server's root (/)
  --gpu <tiers>             The GPU paths to measure, joined by commas, such as webgpu,webgl2.
                            Each is one of ${TIERS.join(', ')} (the engine's own choice)
  --runs <count>            Fresh runs on each GPU path (${RUNS})
  --seconds <seconds>       How long each run measures (${MEASURE_SECONDS})
  --warmup <seconds>        How long each run lets the page run before it measures (${WARMUP_SECONDS})
  --size <width>x<height>   The browser window in CSS pixels (1280x720)
  --out <file.json>         The JSON file to write (bench.json)
  --timeout <seconds>       How long the page may take to start the engine (60)

It measures in Google Chrome on this computer's GPU. When the CI variable is set, it measures in
Playwright's Chromium on SwiftShader, the software GPU of machines without a GPU.`;

/**
 * @typedef {object} BenchOptions
 * @property {string} page The page to open, from the server's root.
 * @property {readonly Tier[]} [gpu] The GPU tiers to force, one after another. Without them, the
 *   engine picks its path.
 * @property {number} runs Fresh runs on each GPU path.
 * @property {number} warmupSeconds
 * @property {number} measureSeconds
 * @property {readonly [number, number]} size The browser window's size in CSS pixels.
 * @property {string} out The JSON file to write, from the current folder.
 * @property {number} timeoutMs How long the page may take to start the engine.
 * @property {boolean} help True to print the help instead.
 */

/**
 * A whole number of runs from 1.
 *
 * @param {string} text
 */
function readRuns(text) {
	const runs = text.trim() === '' ? Number.NaN : Number(text);
	if (Number.isSafeInteger(runs) && runs >= 1) return runs;
	throw new UsageError(`--runs takes a whole number from 1, such as 5, not "${text}"`);
}

/**
 * The options that `args` gives the bench command.
 *
 * @param {readonly string[]} args
 * @returns {BenchOptions}
 */
export function parseBenchArgs(args) {
	const values = readOptions(args, OPTIONS);
	const { page, out, help } = values;
	readPage(page);
	if (!/\.json$/i.test(out)) throw new UsageError(`--out must name a .json file, not "${out}"`);
	return {
		page,
		...(values.gpu !== undefined && { gpu: readTiers('--gpu', values.gpu) }),
		runs: readRuns(values.runs),
		warmupSeconds: readSeconds('--warmup', values.warmup),
		measureSeconds: readSeconds('--seconds', values.seconds, { above: true }),
		size: readSize(values.size),
		out,
		timeoutMs: readSeconds('--timeout', values.timeout, { above: true }) * 1000,
		help,
	};
}

/**
 * @typedef {TimedRun & { ok: true, tier: string, mode: EngineMode }} MeasuredRun A run that
 *   measured the engine: the GPU path it drew with, how it ran, and its figures.
 * @typedef {{ build: string, latency: string, renderThread: string, jobWorkers: number }} EngineMode
 * @typedef {MeasuredRun | HoldFailure} BenchRun A run's figures, or why it measured nothing.
 */

/**
 * @typedef {object} PathReport The runs on one GPU path.
 * @property {Tier | null} gpu The tier that `--gpu` forced, or null for the engine's own choice.
 * @property {string | null} tier The GPU path that the engine drew with, or null when no run
 *   started it.
 * @property {RunSummary | null} summary The median and spread of the runs that measured, or null
 *   without one.
 * @property {BenchRun[]} runs
 */

/**
 * @typedef {object} BenchReport What the JSON file holds.
 * @property {boolean} ok True when every run measured the engine.
 * @property {string} page The page as asked for.
 * @property {Environment} [environment] Where the runs drew.
 * @property {string} [browser] The browser's name and version.
 * @property {number} warmupSeconds
 * @property {number} measureSeconds
 * @property {PathReport[]} paths
 * @property {string} [error] What stopped the command before its runs, such as a failed build.
 * @property {string[]} errors What the pages and the server logged as errors, each once.
 * @property {string[]} warnings What the pages logged as warnings, each once.
 */

/** About how long a page takes to open and start the engine, for the command's estimate. */
const START_SECONDS = 3;

/** Time for the page to publish its figures beyond its warm-up and measured seconds. */
const MEASURE_MARGIN_MS = 60_000;

/**
 * Resolves with `promise`, or with a failure once `ms` milliseconds have passed.
 *
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {string} error
 * @returns {Promise<T | HoldFailure>}
 */
async function within(promise, ms, error) {
	/** @type {ReturnType<typeof setTimeout> | undefined} */
	let timer;
	const late = new Promise((resolve) => {
		timer = setTimeout(() => resolve(failure(error)), ms);
	});
	try {
		return await Promise.race([promise, /** @type {Promise<HoldFailure>} */ (late)]);
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Loads a page with the bench switch, waits until the engine starts, then lets it warm up and
 * measures it. A page that throws before the engine starts fails at once: a page script that
 * throws, a module that fails to load, or an engine that cannot start.
 *
 * @param {Page} page
 * @param {string} url
 * @param {number} timeoutMs
 * @param {{ warmupSeconds: number, measureSeconds: number }} protocol
 * @returns {Promise<BenchRun>}
 */
async function measurePage(page, url, timeoutMs, { warmupSeconds, measureSeconds }) {
	/** @type {string | undefined} */
	let thrown;
	page.on('pageerror', (error) => {
		thrown ??= error.message;
	});
	const seconds = timeoutMs / 1000;
	const started = await pollPage(page, url, timeoutMs, async (overdue) => {
		// A page that reloads has nothing to read for a moment.
		const found = await page
			.evaluate((name) => name in globalThis, ENGINE_GLOBAL)
			.catch(() => false);
		if (found) return true;
		if (thrown !== undefined) return failure(`the page threw before the engine started: ${thrown}`);
		if (overdue)
			return failure(
				`the page did not start the engine within ${seconds} s. bench needs a page that starts the engine as it loads, with no click`,
			);
		return undefined;
	});
	if (started !== true) return started;
	try {
		const engine =
			/** @type {JSHandle<MeasuredEngine & { capabilities: { tier: string }, mode: EngineMode }>} */ (
				await page.evaluateHandle(
					(name) => /** @type {Record<string, unknown>} */ (globalThis)[name],
					ENGINE_GLOBAL,
				)
			);
		const { tier, mode } = await engine.evaluate(({ capabilities, mode }) => ({
			tier: capabilities.tier,
			mode,
		}));
		const timed = await within(
			page.evaluate(timedRun, { engine, warmupSeconds, measureSeconds }),
			(warmupSeconds + measureSeconds) * 1000 + MEASURE_MARGIN_MS,
			'the page published no figures after its measured time',
		);
		if ('ok' in timed) return timed;
		if (timed.frames === 0)
			return failure(`the engine on ${tier} drew no frame while it was measured`);
		return { ok: true, tier, mode, ...timed };
	} catch (error) {
		return failure(`the run stopped: ${error instanceof Error ? error.message : error}`);
	}
}

/**
 * Throws when the project has a page that its production build left out. Vite builds `index.html`
 * alone unless the config lists more pages.
 *
 * @param {string} page
 * @param {(path: string) => boolean} built Whether the build has a file, from its root.
 */
function unbuiltPage(page, built) {
	const file = decodeURIComponent(new URL(page, 'http://localhost').pathname);
	if (file.endsWith('.html') && !built(file) && existsSync(join(process.cwd(), file)))
		throw new Error(
			`the production build has no page ${file}. Vite builds index.html alone, unless build.rolldownOptions.input in the project's Vite config lists more pages`,
		);
}

/** The GPU path that the engine picks when `--gpu` forces none, as the summary names it. */
const ENGINE_CHOICE = "the engine's own GPU path";

/** A GPU path as the summary names it. */
const pathName = (/** @type {PathReport} */ path) => path.tier ?? path.gpu ?? ENGINE_CHOICE;

/**
 * A figure in frames per second, or n/a.
 *
 * @param {number | null | undefined} value
 */
const fps = (value) => (value == null ? 'n/a' : value.toFixed(1));

/**
 * Lines of CPU time per frame by thread: each thread's median over the runs, the sketch's update
 * on the thread that runs it, and the job workers together.
 *
 * @param {RunSummary} summary
 */
function threadLines(summary) {
	const threads = Object.entries(summary.threadsMs ?? {});
	const jobs = threads.filter(([name]) => name.startsWith('job-')).map(([, time]) => time);
	const lines = threads
		.filter(([name]) => !name.startsWith('job-'))
		.map(([name, time]) => {
			const update = summary.phases?.[`${name}.update`];
			const part = update === undefined ? '' : `, of which the sketch's update ${ms(update)} ms`;
			return `  ${name}: ${ms(time)} ms${part}`;
		});
	if (jobs.length > 0)
		lines.push(
			`  ${jobs.length} job workers: ${ms(jobs.reduce((a, b) => a + b, 0))} ms together, at most ${ms(Math.max(...jobs))} ms on one`,
		);
	lines.push(`  all threads: ${ms(summary.allThreadsMs)} ms`);
	return lines;
}

/**
 * The summary of one GPU path: how many runs measured, CPU time per frame by thread, GPU time and
 * the frame rates, then why each failed run failed.
 *
 * @param {PathReport} path
 * @param {{ page: string, warmupSeconds: number, measureSeconds: number }} protocol
 */
function pathLines(path, { page, warmupSeconds, measureSeconds }) {
	const { summary, runs } = path;
	const measured = summary?.runs ?? 0;
	const all = `${runs.length} ${runs.length === 1 ? 'run' : 'runs'}`;
	const count = measured === runs.length ? all : `${measured} of ${all}`;
	const lines = [
		`${page} on ${pathName(path)}: ${count} of ${measureSeconds} s, each after ${warmupSeconds} s of warm-up.`,
	];
	if (summary) {
		const gpu =
			summary.gpuMs != null
				? `${ms(summary.gpuMs)} ms`
				: pathName(path) === 'webgl2'
					? 'n/a, the engine times the GPU only on WebGPU'
					: 'n/a, the browser does not time the GPU here';
		lines.push(
			'CPU time per frame, the median of the runs:',
			`  the busiest thread in each frame: ${ms(summary.cpuMs.median)} ms (runs from ${ms(summary.cpuMs.min)} to ${ms(summary.cpuMs.max)} ms)`,
			...threadLines(summary),
			`GPU time per frame: ${gpu}.`,
			`Frames per second: ${fps(summary.presentedFps)} presented, ${fps(summary.completedFps)} finished by the GPU, on a display of ${fps(summary.refreshHz)} Hz.`,
		);
	}
	runs.forEach((run, index) => {
		if (!run.ok) lines.push(`Run ${index + 1} failed: ${run.error}`);
	});
	return lines;
}

/**
 * The summary that the command prints: each GPU path's figures, where it saved them, and what the
 * pages logged.
 *
 * @param {BenchReport} report
 * @param {string} json The JSON file as the summary names it.
 */
export function benchSummary(report, json) {
	const lines = report.error
		? [`Measured nothing on ${report.page}: ${report.error}`]
		: report.paths.flatMap((path, index) => [
				...(index > 0 ? [''] : []),
				...pathLines(path, report),
			]);
	lines.push('', `Saved every run's figures and what the page logged in ${json}.`);
	const logged = [...listed(report.errors, 'error'), ...listed(report.warnings, 'warning')];
	lines.push(...(logged.length > 0 ? logged : ['The page logged no errors or warnings.']));
	return lines.join('\n');
}

/**
 * The report of each GPU path's runs, summarized.
 *
 * @param {readonly (Tier | undefined)[]} gpus
 * @param {readonly BenchRun[][]} runs Each path's runs, in the order of `gpus`.
 * @returns {PathReport[]}
 */
export function pathReports(gpus, runs) {
	return gpus.map((gpu, index) => {
		const pathRuns = runs[index] ?? [];
		const measured = pathRuns.filter((run) => run.ok);
		return {
			gpu: gpu ?? null,
			tier: measured[0]?.tier ?? null,
			summary: measured.length > 0 ? summarizeRuns(measured) : null,
			runs: pathRuns,
		};
	});
}

/**
 * Runs the protocol on each GPU path in turn, a round of runs at a time, so a machine that slows
 * down during the command slows every path alike. It prints a line after each run.
 *
 * @param {Runner} runner
 * @param {BenchOptions} options
 * @param {readonly (Tier | undefined)[]} gpus
 */
async function runRounds(runner, options, gpus) {
	/** @type {BenchRun[][]} */
	const runs = gpus.map(() => []);
	/** @type {Set<string>} */
	const errors = new Set();
	/** @type {Set<string>} */
	const warnings = new Set();
	for (let round = 1; round <= options.runs; round++)
		for (const [index, gpu] of gpus.entries()) {
			const path = switchedPath(options.page, { bench: '', gpu });
			const visited = await visitPage(
				runner,
				{ ...options, path },
				(page, _errors, url, timeoutMs) => measurePage(page, url, timeoutMs, options),
			);
			for (const error of visited.errors) errors.add(error);
			for (const warning of visited.warnings) warnings.add(warning);
			const run = visited.result;
			runs[index]?.push(run);
			const label = `Run ${round} of ${options.runs} on ${run.ok ? run.tier : (gpu ?? ENGINE_CHOICE)}`;
			console.log(
				run.ok
					? `${label}: ${ms(run.cpuMs.median)} ms per frame on the busiest thread, ${fps(run.stats?.presentedFps)} frames per second.`
					: `${label} failed: ${run.error}`,
			);
		}
	return { runs, errors: [...errors], warnings: [...warnings] };
}

/**
 * Runs the bench command with its arguments, prints its summary, and returns the exit code: 0 when
 * every run measured the engine, 1 when a run or the build failed.
 *
 * @param {readonly string[]} args
 * @returns {Promise<number>}
 */
export async function run(args) {
	const options = parseBenchArgs(args);
	if (options.help) {
		console.log(HELP);
		return 0;
	}
	const gpus = options.gpu ?? [undefined];
	const json = resolve(options.out);
	const { page, warmupSeconds, measureSeconds } = options;
	const seconds = (warmupSeconds + measureSeconds + START_SECONDS) * options.runs * gpus.length;
	console.log(
		`Measuring ${page} in a production build: ${options.runs} runs on each GPU path, about ${Math.ceil(seconds / 60)} min.`,
	);
	/** @type {BenchReport} */
	let report;
	let runner;
	try {
		runner = await startRunner({ production: true, browserArgs: [WEBGPU_DEVELOPER_FEATURES] });
		unbuiltPage(page, runner.server.hasFile);
		const { runs, errors, warnings } = await runRounds(runner, options, gpus);
		const paths = pathReports(gpus, runs);
		report = {
			ok: runs.every((path) => path.every((one) => one.ok)),
			page,
			environment: runner.environment,
			browser: runner.browserName,
			warmupSeconds,
			measureSeconds,
			paths,
			errors,
			warnings,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		report = {
			ok: false,
			page,
			warmupSeconds,
			measureSeconds,
			paths: [],
			error: message,
			errors: [],
			warnings: [],
		};
	} finally {
		await runner?.close();
	}
	writeJson(json, report);
	console.log(`\n${benchSummary(report, shownPath(json))}`);
	return report.ok ? 0 : 1;
}
