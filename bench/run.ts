// Runs the benchmark protocol in a visible Chrome or Brave window on this Mac: each scene's null3d
// page, three.js pages and scene-code page, several fresh runs each, then prints and saves a
// summary. The scene-code page times the scene code both engines run, so the summary also compares
// each engine's own work. With --sweep it runs each scene from one object up to far more than the
// protocol's count, on the null3d paths and both three.js renderers, and reports and charts each
// path against three.js's faster renderer and against three.js on the same API at every count.
// With --jobs it runs the null3d pages at each job worker count instead, and reports each count.
// With --compare it runs the null3d pages of two built checkouts in turns and judges the second
// against the first, as the benchmark job in CI does.
// From the repository root:
//   bun run bench:run                                (S1: 5 runs of 5 s warm-up and 30 s measured)
//   bun run bench:run -- --scenes s1,s1-static,s2 --runs 3 --seconds 10
//   bun run bench:run -- --pages null3d-webgpu,null3d-webgpu-low
//   bun run bench:run -- --jobs 1,2,4,8,16
//   bun run bench:run -- --sweep --seconds 5
//   bun run bench:run -- --browser brave
//   bun run bench:run -- --compare ../baseline,. --runs 3 --seconds 10
// Options:
//   --scenes <list>   s1, s1-static, s2; the default is s1, and every scene with --sweep or
//                     --compare
//   --pages <list>    page kinds; the default is null3d-webgpu, threejs-webgpu, threejs-webgl and
//                     scene-code. With --jobs or --compare it is null3d-webgpu and null3d-webgl2,
//                     and with --sweep every kind but null3d-compat. The kinds that end in -low run
//                     null3d in low-latency mode
//   --runs <n>        fresh runs of each page, of each build with --compare; the default is 5
//   --seconds <n>     warm-up and measured time of each run; the default is the protocol's 5 and 30
//   --jobs <list>     job worker counts, such as 1,2,4,8: runs each null3d page at each count
//   --sweep           each scene at the object counts in SWEEP_COUNTS, one run each, instead of
//                     the runs above
//   --compare <a>,<b> two checkouts, each built with bun run build: the baseline a and the new
//                     build b. Each serves its pages on its own port, NULL3D_PORT's and the next.
//                     The command fails when b is slower than the rule in bench/lib/compare.ts
//                     allows and no Bench-Expected trailer in the commits from a to b names it
//   --browser <name>  chrome (the default), brave, or chromium: Playwright's Chromium without a
//                     window, drawing with SwiftShader as CI's Linux machines do
// Every browser starts with WebGPU's developer features on, so GPU timestamps are not rounded.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { cpus, platform } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { type Browser, chromium } from '@playwright/test';
import { jobWorkersProblem } from '../tests/lib/engine-checks.ts';
import { pageResult } from '../tests/lib/page-result.ts';
import { runName } from '../tests/lib/runs.ts';
import {
	type DevServer,
	HTTP_PORT,
	REPO_ROOT,
	SWIFTSHADER_ARGS,
	startServer,
	startServerAt,
} from '../tests/lib/server.ts';
import {
	BUILDS,
	type Build,
	type BuildRun,
	compareBuilds,
	compareReport,
	judge,
	readExpectedChanges,
	roundOrder,
	selectRuns,
} from './lib/compare';
import {
	BENCH_PAGE_KINDS,
	type BenchPageKind,
	isNull3dPage,
	JOBS_PAGES,
	PARITY_SCENES,
	type ParityScene,
	pagePath,
	readJobCounts,
	SCENE_CODE,
} from './lib/parity';
import {
	type BenchResult,
	benchReport,
	type ChartSeries,
	lineChartSvg,
	ms,
	type SummaryRow,
	type SweepPoint,
	summarizeRuns,
	sweepReport,
} from './lib/report';
import { MEASURE_SECONDS, S2_NODES_PER_TREE, S2_ROOTS, WARMUP_SECONDS } from './scenes/spec';

const BRAVE = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
/**
 * Object counts of a sweep, per scene: from one object, where each engine's fixed cost per frame
 * shows, to far more than the protocol's count. S2's counts are whole trees: 1, 3, 14 and 42.
 */
const SWEEP_COUNTS: Record<ParityScene, readonly number[]> = {
	s1: [1, 10, 100, 1_000, 10_000, 100_000],
	's1-static': [1, 10, 100, 1_000, 10_000, 100_000],
	s2: [1, 3, S2_ROOTS, 3 * S2_ROOTS].map((trees) => trees * S2_NODES_PER_TREE),
};
const DEFAULT_PAGES: BenchPageKind[] = [
	'null3d-webgpu',
	'threejs-webgpu',
	'threejs-webgl',
	SCENE_CODE,
];
/** Time for a page to start, beyond its warm-up and measured seconds. */
const START_MARGIN_MS = 60_000;
/** The browsers the command can drive. */
const BROWSERS = ['chrome', 'brave', 'chromium'] as const;
/** WebGPU's developer features, without which the browser rounds GPU timestamps. */
const WEBGPU_DEVELOPER_FEATURES = '--enable-webgpu-developer-features';
/** A comparison of two builds needs this many runs of each page per build, or more. */
const MIN_COMPARE_RUNS = 3;

export interface BenchOptions {
	/** The scenes and page kinds to run; null takes the default of the run's kind. */
	scenes: ParityScene[] | null;
	pages: BenchPageKind[] | null;
	runs: number;
	seconds: number | null;
	/** Job worker counts, at each of which the null3d pages run; null for the engine's own count. */
	jobs: number[] | null;
	sweep: boolean;
	/** The checkouts of the baseline and the new build to compare, or null for another kind of run. */
	compare: [string, string] | null;
	browser: (typeof BROWSERS)[number];
}

/** A run's warm-up and measured seconds: `--seconds` for both, or the protocol's. */
const runSeconds = (seconds: number | null) => ({
	warmup: seconds ?? WARMUP_SECONDS,
	measure: seconds ?? MEASURE_SECONDS,
});

/** How long a page may take to publish its result. */
function pageTimeoutMs(seconds: number | null): number {
	const { warmup, measure } = runSeconds(seconds);
	return (warmup + measure) * 1000 + START_MARGIN_MS;
}

function list<T extends string>(
	value: string | undefined,
	allowed: readonly T[],
	what: string,
): T[] {
	const items = (value ?? '').split(',').filter(Boolean);
	const unknown = items.filter((item) => !allowed.includes(item as T));
	if (items.length === 0 || unknown.length > 0)
		throw new Error(`${what}: use a comma-separated list of ${allowed.join(', ')}`);
	return items as T[];
}

export function parseBenchArgs(args: readonly string[]): BenchOptions {
	const options: BenchOptions = {
		scenes: null,
		pages: null,
		runs: 5,
		seconds: null,
		jobs: null,
		sweep: false,
		compare: null,
		browser: 'chrome',
	};
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		const value = () => args[++i];
		if (arg === '--scenes') options.scenes = list(value(), PARITY_SCENES, '--scenes');
		else if (arg === '--pages') options.pages = list(value(), BENCH_PAGE_KINDS, '--pages');
		else if (arg === '--runs') options.runs = Number(value());
		else if (arg === '--seconds') options.seconds = Number(value());
		else if (arg === '--jobs') options.jobs = readJobCounts(value());
		else if (arg === '--sweep') options.sweep = true;
		else if (arg === '--compare') {
			const dirs = (value() ?? '').split(',');
			const [baseline, next] = dirs;
			if (dirs.length !== 2 || !baseline || !next)
				throw new Error('--compare: name two checkouts, the baseline first, such as ../main,.');
			options.compare = [baseline, next];
		} else if (arg === '--browser')
			options.browser = list(value(), BROWSERS, '--browser')[0] as BenchOptions['browser'];
		else throw new Error(`unknown option ${arg}`);
	}
	if (!(Number.isInteger(options.runs) && options.runs > 0))
		throw new Error('--runs: use a whole number above 0');
	if (options.seconds !== null && !(options.seconds > 0))
		throw new Error('--seconds: use a number above 0');
	if ([options.jobs, options.sweep || null, options.compare].filter(Boolean).length > 1)
		throw new Error('use one of --jobs, --sweep and --compare');
	if (options.compare && options.runs < MIN_COMPARE_RUNS)
		throw new Error(
			`--compare: use --runs ${MIN_COMPARE_RUNS} or more, so that a median still rests on two runs when one is dropped`,
		);
	const mode = options.jobs ? '--jobs' : options.compare ? '--compare' : null;
	const other = mode && options.pages?.filter((kind) => !isNull3dPage(kind));
	if (other && other.length > 0)
		throw new Error(`${mode}: runs null3d pages only; leave out ${other.join(', ')}`);
	return options;
}

/** Starts the browser: Chrome or Brave in a window, or Chromium without one on SwiftShader. */
function launchBrowser(name: BenchOptions['browser']): Promise<Browser> {
	if (name === 'chromium')
		return chromium.launch({
			headless: true,
			args: [...SWIFTSHADER_ARGS, WEBGPU_DEVELOPER_FEATURES],
		});
	return chromium.launch({
		headless: false,
		...(name === 'brave' ? { executablePath: BRAVE } : { channel: 'chrome' }),
		args: [WEBGPU_DEVELOPER_FEATURES],
	});
}

/** Opens one benchmark page in a fresh tab and waits for its result. */
async function runPage(browser: Browser, url: string, timeoutMs: number): Promise<BenchResult> {
	const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
	try {
		await page.goto(url);
		return await pageResult<BenchResult>(page, timeoutMs);
	} catch (e) {
		return { ok: false, error: (e as Error).message } as BenchResult;
	} finally {
		await page.close();
	}
}

async function runProtocol(
	browser: Browser,
	baseUrl: string,
	options: BenchOptions,
	dir: string,
): Promise<string> {
	const seconds = options.seconds;
	const timeoutMs = pageTimeoutMs(seconds);
	const rows: SummaryRow[] = [];
	const failures: string[] = [];
	const pages = options.pages ?? (options.jobs ? JOBS_PAGES : DEFAULT_PAGES);
	for (const scene of options.scenes ?? ['s1']) {
		for (const jobs of options.jobs ?? [undefined]) {
			const switches = [
				...(seconds === null ? [] : [`seconds=${seconds}`]),
				...(jobs === undefined ? [] : [`jobs=${jobs}`]),
			].join('&');
			for (const kind of pages) {
				const name = jobs === undefined ? `${scene}-${kind}` : `${scene}-${kind}-jobs${jobs}`;
				const results: BenchResult[] = [];
				for (let run = 1; run <= options.runs; run++) {
					const result = await runPage(
						browser,
						`${baseUrl}${pagePath(scene, kind, switches)}`,
						timeoutMs,
					);
					writeFileSync(join(dir, `${name}-${run}.json`), JSON.stringify(result, null, '\t'));
					// A page that ran with another job worker count would put its times under the wrong count.
					const problem = result.ok
						? jobWorkersProblem(result.mode?.jobWorkers, jobs)
						: (result.error ?? 'the page failed without a message');
					if (problem === undefined) results.push(result);
					else failures.push(`${name} run ${run}: ${problem}`);
					console.log(
						`${name} run ${run}: ${problem === undefined ? `${ms(result.cpuMs.median)} ms` : `failed: ${problem}`}`,
					);
				}
				if (results.length > 0) rows.push({ scene, kind, jobs, summary: summarizeRuns(results) });
			}
		}
	}
	const lines = benchReport(rows);
	for (const failure of failures) lines.push(`Failed: ${failure}`);
	writeFileSync(join(dir, 'summary.json'), JSON.stringify(rows, null, '\t'));
	return lines.join('\n');
}

/**
 * The page kinds a sweep runs: both null3d paths in both latency modes, both three.js renderers
 * and the scene code.
 */
const SWEEP_PAGES: BenchPageKind[] = [
	'null3d-webgpu',
	'null3d-webgl2',
	'null3d-webgpu-low',
	'null3d-webgl2-low',
	'threejs-webgpu',
	'threejs-webgl',
	SCENE_CODE,
];

/** Chart lines of a sweep, by page kind: low-latency mode dashed, in its path's color. */
const SWEEP_LINES: Record<string, Omit<ChartSeries, 'points'>> = {
	'null3d-webgpu': { name: 'null3d WebGPU, whole frame', color: '#2a6fdb' },
	'null3d-webgl2': { name: 'null3d WebGL2, whole frame', color: '#18a058' },
	'null3d-webgpu-low': {
		name: 'null3d WebGPU, low latency, whole frame',
		color: '#2a6fdb',
		dashed: true,
	},
	'null3d-webgl2-low': {
		name: 'null3d WebGL2, low latency, whole frame',
		color: '#18a058',
		dashed: true,
	},
	'threejs-webgpu': { name: 'three.js WebGPU, whole frame', color: '#e8554e' },
	'threejs-webgl': { name: 'three.js WebGL, whole frame', color: '#f2a13e' },
	[SCENE_CODE]: { name: 'scene code both engines run', color: '#9a9a9a' },
};

async function runSweep(
	browser: Browser,
	baseUrl: string,
	options: BenchOptions,
	dir: string,
): Promise<string> {
	const seconds = options.seconds ?? 5;
	const timeoutMs = 2 * seconds * 1000 + START_MARGIN_MS;
	const report: string[] = [];
	// A window larger than the charts; each picture is of its chart alone.
	const chartPage = await browser.newPage({ viewport: { width: 1200, height: 800 } });
	for (const scene of options.scenes ?? PARITY_SCENES) {
		const points: SweepPoint[] = [];
		const series: Record<string, { x: number; y: number }[]> = {};
		for (const n of SWEEP_COUNTS[scene]) {
			const summaries: SweepPoint['summaries'] = {};
			for (const kind of options.pages ?? SWEEP_PAGES) {
				const result = await runPage(
					browser,
					`${baseUrl}${pagePath(scene, kind, `seconds=${seconds}&n=${n}`)}`,
					timeoutMs,
				);
				writeFileSync(
					join(dir, `sweep-${scene}-${kind}-${n}.json`),
					JSON.stringify(result, null, '\t'),
				);
				if (!result.ok) {
					console.log(`sweep ${scene} ${kind} n=${n}: failed: ${result.error}`);
					report.push(`Failed: ${scene} ${kind} at ${n}: ${result.error}`);
					continue;
				}
				// The count the page drew, which a scene of whole parts rounds up.
				const drawn = result.n;
				console.log(`sweep ${scene} ${kind} n=${drawn}: ${ms(result.cpuMs.median)} ms`);
				summaries[kind] = summarizeRuns([result]);
				series[kind] = [...(series[kind] ?? []), { x: drawn, y: result.cpuMs.median }];
			}
			points.push({ n, summaries });
		}
		const svg = lineChartSvg(
			`${scene}: CPU time per frame`,
			'objects (log scale)',
			'milliseconds per frame',
			Object.entries(series).map(([key, points]) => ({
				...(SWEEP_LINES[key] ?? { name: key, color: '#000000' }),
				points,
			})),
		);
		const svgFile = join(dir, `sweep-${scene}.svg`);
		writeFileSync(svgFile, svg);
		await chartPage.setContent(svg);
		await chartPage.locator('svg').screenshot({ path: join(dir, `sweep-${scene}.png`) });
		report.push(...sweepReport(scene, points), `Chart: ${relative(REPO_ROOT, svgFile)}`, '');
	}
	await chartPage.close();
	return report.join('\n');
}

/** A file that only a built checkout holds: the threaded core. */
const BUILT_CORE = 'packages/engine/dist/wasm/threaded/null3d_bg.wasm';

function git(dir: string, ...args: string[]): string {
	return execFileSync('git', ['-C', dir, ...args], {
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'ignore'],
	}).trim();
}

/**
 * Each checkout's commit as its short hash and subject, and the messages of the commits that the
 * new build adds to the baseline, where expected-change trailers are. A checkout outside git goes
 * by its folder, with no messages.
 */
function commitsOf(roots: Record<Build, string>): {
	labels: Record<Build, string>;
	messages: string[];
} {
	const shas: Partial<Record<Build, string>> = {};
	const labels = { ...roots };
	for (const build of BUILDS)
		try {
			const sha = git(roots[build], 'rev-parse', 'HEAD');
			shas[build] = sha;
			labels[build] = `${sha.slice(0, 7)} "${git(roots[build], 'log', '-1', '--format=%s', sha)}"`;
		} catch {}
	if (!shas.baseline || !shas.new) return { labels, messages: [] };
	try {
		const log = git(roots.new, 'log', '--format=%B%x00', `${shas.baseline}..${shas.new}`);
		return { labels, messages: log.split('\0').filter((message) => message.trim() !== '') };
	} catch {
		return { labels, messages: [] };
	}
}

/** The browser and the machine, in a few words for the report. */
function machineText(browser: Browser, name: BenchOptions['browser']): string {
	const cores = cpus();
	const engine = { chrome: 'Chrome', brave: 'Brave', chromium: 'Chromium on SwiftShader' }[name];
	return `${engine} ${browser.version()} on ${platform()}, ${cores.length} cores of ${cores[0]?.model.trim() ?? 'an unknown processor'}`;
}

/**
 * Runs the null3d pages of two built checkouts in turns, each served by its own checkout's dev
 * server, and judges the new build against the baseline. Every run's result, the summary of each
 * build's runs and the comparison go to `dir`.
 */
async function runComparison(
	browser: Browser,
	options: BenchOptions,
	[baselineDir, newDir]: [string, string],
	dir: string,
): Promise<{ report: string; pass: boolean }> {
	const roots: Record<Build, string> = { baseline: resolve(baselineDir), new: resolve(newDir) };
	for (const root of Object.values(roots))
		if (!existsSync(join(root, BUILT_CORE)))
			throw new Error(`${root} holds no built engine: run bun run build there first`);
	const scenes = options.scenes ?? PARITY_SCENES;
	const pages = options.pages ?? JOBS_PAGES;
	const switches = options.seconds === null ? '' : `seconds=${options.seconds}`;
	const timeoutMs = pageTimeoutMs(options.seconds);
	const servers: DevServer[] = [];
	const runs: BuildRun[] = [];
	try {
		// The new build takes the port after the dev server's, where the HTTPS server would be.
		const baseline = await startServerAt(roots.baseline, HTTP_PORT);
		servers.push(baseline);
		const next = await startServerAt(roots.new, HTTP_PORT + 1);
		servers.push(next);
		const urls: Record<Build, string> = { baseline: baseline.url, new: next.url };
		for (let round = 1; round <= options.runs; round++)
			for (const scene of scenes)
				for (const kind of pages)
					for (const build of roundOrder(round)) {
						const result = await runPage(
							browser,
							`${urls[build]}${pagePath(scene, kind, switches)}`,
							timeoutMs,
						);
						const name = `${build}-${scene}-${kind}-${round}`;
						writeFileSync(join(dir, `${name}.json`), JSON.stringify(result, null, '\t'));
						runs.push({ build, scene, kind, round, result });
						console.log(
							`${name}: ${result.ok ? `${ms(result.cpuMs.median)} ms` : `failed: ${result.error}`}`,
						);
					}
	} finally {
		for (const server of servers) server.stop();
	}
	const { labels, messages } = commitsOf(roots);
	const trailers = readExpectedChanges(messages, {
		scenes: PARITY_SCENES,
		kinds: BENCH_PAGE_KINDS,
	});
	const selection = selectRuns(runs);
	const comparison = compareBuilds(selection.kept, runs, trailers.changes);
	const verdict = judge(comparison);
	const { warmup, measure } = runSeconds(options.seconds);
	const report = compareReport(comparison, verdict, {
		baseline: labels.baseline,
		new: labels.new,
		runs: options.runs,
		warmupSeconds: warmup,
		measureSeconds: measure,
		browser: machineText(browser, options.browser),
		selection,
		trailers,
	});
	const summaries = BUILDS.flatMap((build) =>
		scenes.flatMap((scene) =>
			pages.flatMap((kind) => {
				const kept = selection.kept.filter(
					(r) => r.build === build && r.scene === scene && r.kind === kind,
				);
				return kept.length > 0
					? [{ build, scene, kind, summary: summarizeRuns(kept.map((r) => r.result)) }]
					: [];
			}),
		),
	);
	const dropped = selection.dropped.map(({ run: { build, scene, kind, round }, reason }) => ({
		build,
		scene,
		kind,
		round,
		reason,
	}));
	writeFileSync(
		join(dir, 'summary.json'),
		JSON.stringify(
			{
				commits: labels,
				refreshHz: selection.refreshHz,
				dropped,
				summaries,
				...comparison,
				verdict,
			},
			null,
			'\t',
		),
	);
	return { report: report.join('\n'), pass: verdict.pass };
}

async function main(): Promise<void> {
	const options = parseBenchArgs(process.argv.slice(2));
	const kind = options.compare
		? 'compare'
		: options.sweep
			? 'sweep'
			: options.jobs
				? 'jobs'
				: 'bench';
	const dir = join(REPO_ROOT, 'target/bench', runName(kind));
	mkdirSync(dir, { recursive: true });
	const browser = await launchBrowser(options.browser);
	try {
		let report: string;
		if (options.compare) {
			const comparison = await runComparison(browser, options, options.compare, dir);
			report = comparison.report;
			if (!comparison.pass) process.exitCode = 1;
		} else {
			const server = await startServer();
			try {
				report = options.sweep
					? await runSweep(browser, server.url, options, dir)
					: await runProtocol(browser, server.url, options, dir);
			} finally {
				server.stop();
			}
		}
		writeFileSync(join(dir, 'summary.md'), `${report}\n`);
		console.log(`\n${report}\n\nresults: ${relative(REPO_ROOT, dir)}`);
	} finally {
		await browser.close();
	}
}

if (import.meta.main) {
	main().catch((e) => {
		console.error(`error: ${(e as Error).message}`);
		process.exit(1);
	});
}
