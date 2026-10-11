// Runs the benchmark protocol in a visible Chrome or Brave window on this Mac: each scene's null3d
// page, three.js pages and scene-code page, several fresh runs each, then prints and saves a
// summary. The scene-code page times the scene code both engines run, so the summary also compares
// each engine's own work. With --sweep it runs each scene from one object up to far more than the
// protocol's count, on the null3d paths and both three.js renderers, and reports and charts each
// path against three.js's faster renderer and against three.js on the same API at every count.
// With --jobs it runs the null3d pages at each job worker count instead, and reports each count.
// With --compare it runs the null3d pages of two built checkouts in turns and judges the second
// against the first, as the benchmark job in CI does; with --shard it runs one share of those pages,
// and --merge joins the shares' runs into one report. Every run measures the production build of the
// benchmark pages, as a developer ships the engine: without development checks. --dev measures the
// dev server's pages instead.
// From the repository root:
//   bun run bench:run                                (S1: 5 runs of 5 s warm-up and 30 s measured)
//   bun run bench:run -- --scenes s1,s1-static,s2 --runs 3 --seconds 10
//   bun run bench:run -- --pages null3d-webgpu,null3d-webgpu-low
//   bun run bench:run -- --jobs 1,2,4,8,16
//   bun run bench:run -- --sweep --seconds 5
//   bun run bench:run -- --browser brave
//   bun run bench:run -- --compare ../baseline,. --runs 3 --seconds 10
//   bun run bench:run -- --compare ../baseline,. --runs 3 --seconds 10 --shard 1/3
//   bun run bench:run -- --merge target/bench/shards
//   bun run bench:run -- --dev --scenes s2 --pages null3d-webgpu
//   bun run bench:run -- --scenes s2 --pages null3d-webgpu,threejs-webgpu --switches shadows=3
// Options:
//   --scenes <list>   s1, s1-static, s1-cells, s2, s3, s4, s5, s6; the default is s1, and every
//                     scene with --sweep or --compare
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
//                     build b. Each checkout's pages get a production build of their own, served
//                     on its own port, NULL3D_PORT's and the next. Every page runs at the High
//                     preset, within each GPU path's ceiling, with the quality governor off,
//                     unless --switches names them. The command fails when b is slower than
//                     the rules in bench/lib/compare.ts allow and no Bench-Expected trailer in
//                     the commits from a to b names it. When those commits change the benchmark
//                     pages or the comparison's switches, the measurement changed: the command
//                     reports every page and fails none. The run also writes its record,
//                     runs.json, from which --merge can judge it again
//   --shard <i>/<n>   with --compare, the i-th of n shares of the pages: every n-th page of the
//                     scenes and pages above, from the i-th. CI runs each share on a machine of
//                     its own. The command fails when b is slower on a page of the share
//   --merge <folder>  judges the records of every share under the folder as one comparison, with
//                     no browser. Each page of the plan must be in exactly one share. It fails
//                     only when the records do not make a whole comparison: summary.json holds
//                     the verdict, which CI's next step reads
//   --dev             the dev server's pages, where the engine runs its development checks,
//                     instead of the production build; with --compare, each checkout's dev server
//                     serves its own pages
//   --browser <name>  chrome (the default), brave, or chromium: Playwright's Chromium without a
//                     window, drawing with SwiftShader as CI's Linux machines do
//   --switches <q>    page switches that every page gets, such as shadows=3: S2 with the sun's
//                     shadows in 3 cascades on null3d, and in one map on three.js
// Every browser starts with WebGPU's developer features on, so GPU timestamps are not rounded.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, platform } from 'node:os';
import { basename, join, relative, resolve } from 'node:path';
import { type Browser, chromium } from '@playwright/test';
import { SWIFTSHADER_ARGS, WEBGPU_DEVELOPER_FEATURES } from '../packages/cli/src/browser.js';
import { RUNS } from '../packages/cli/src/protocol.js';
import { launchInWindow, newParkedPage } from '../tests/lib/app-window.ts';
import { jobWorkersProblem } from '../tests/lib/engine-checks.ts';
import { pageResult } from '../tests/lib/page-result.ts';
import { readShard, runName, SHARD_FORMAT, type Shard } from '../tests/lib/runs.ts';
import { type DevServer, HTTP_PORT, REPO_ROOT } from '../tests/lib/server.ts';
import {
	BUILDS,
	type Build,
	type BuildRun,
	type ComparisonRecord,
	comparisonSwitches,
	judgeRecord,
	measurementChanges,
	mergeRecords,
	PAGE_SOURCES,
	roundOrder,
	shardPages,
} from './lib/compare';
import {
	BENCH_PAGE_KINDS,
	BENCH_SCENES,
	type BenchPageKind,
	type BenchScene,
	isNull3dPage,
	JOBS_PAGES,
	pagePath,
	readJobCounts,
	readSwitches,
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
	summaryRow,
	sweepReport,
} from './lib/report';
import { DEV_OPTION, pagesText, serveBenchPages } from './lib/serve';
import { S5_DEFAULT_COUNT } from './scenes/s5';
import { S6_FULL_COUNT } from './scenes/s6';
import {
	createS4,
	MEASURE_SECONDS,
	S2_NODES_PER_TREE,
	S2_ROOTS,
	S3_DEFAULT_COUNT,
	WARMUP_SECONDS,
} from './scenes/spec';

const BRAVE = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
/**
 * Object counts of a sweep, per scene: from one object, where each engine's fixed cost per frame
 * shows, to far more than the protocol's count. S2's counts are whole trees: 1, 3, 14 and 42.
 */
const SWEEP_COUNTS: Record<BenchScene, readonly number[]> = {
	s1: [1, 10, 100, 1_000, 10_000, 100_000],
	's1-static': [1, 10, 100, 1_000, 10_000, 100_000],
	's1-cells': [1, 10, 100, 1_000, 10_000, 100_000],
	s2: [1, 3, S2_ROOTS, 3 * S2_ROOTS].map((trees) => trees * S2_NODES_PER_TREE),
	// S3's counts are boxes; every count has the same 256 point lights.
	s3: [1, 100, 1_000, 5_000, S3_DEFAULT_COUNT, 4 * S3_DEFAULT_COUNT],
	// S4 is one town, which ignores the count.
	s4: [createS4().count],
	// S5's counts are characters.
	s5: [1, 10, 50, 100, 250, S5_DEFAULT_COUNT, 2 * S5_DEFAULT_COUNT],
	// S6's counts are the objects nearest the route's start, up to the whole city.
	s6: [1, 100, 1_000, 5_000, 10_000, S6_FULL_COUNT],
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
/** A comparison of two builds needs this many runs of each page per build, or more. */
const MIN_COMPARE_RUNS = 3;

export interface BenchOptions {
	/** The scenes and page kinds to run; null takes the default of the run's kind. */
	scenes: BenchScene[] | null;
	pages: BenchPageKind[] | null;
	runs: number;
	seconds: number | null;
	/** Job worker counts, at each of which the null3d pages run; null for the engine's own count. */
	jobs: number[] | null;
	sweep: boolean;
	/** The checkouts of the baseline and the new build to compare, or null for another kind of run. */
	compare: [string, string] | null;
	/** The share of a comparison's pages to run, or null for all of them. */
	shard: Shard | null;
	/** The folder of the shard records to merge, or null for another kind of run. */
	merge: string | null;
	browser: (typeof BROWSERS)[number];
	/** The dev server's pages, with the engine's development checks, instead of the production build. */
	dev: boolean;
	/** Page switches that every page gets, such as `shadows=3`, or an empty string. */
	switches: string;
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

/** A page address's switches: `own`, then those of `--switches`. */
function withSwitches(own: readonly string[], options: BenchOptions): string {
	return [...own, options.switches].filter(Boolean).join('&');
}

export function parseBenchArgs(args: readonly string[]): BenchOptions {
	const options: BenchOptions = {
		scenes: null,
		pages: null,
		runs: RUNS,
		seconds: null,
		jobs: null,
		sweep: false,
		compare: null,
		shard: null,
		merge: null,
		browser: 'chrome',
		dev: false,
		switches: '',
	};
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		const value = () => args[++i];
		if (arg === '--scenes') options.scenes = list(value(), BENCH_SCENES, '--scenes');
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
		} else if (arg === '--shard') {
			options.shard = readShard(value());
			if (!options.shard) throw new Error(`--shard: use ${SHARD_FORMAT}`);
		} else if (arg === '--merge') {
			options.merge = value() ?? '';
			if (!options.merge) throw new Error('--merge: name the folder of the shard records');
		} else if (arg === '--browser')
			options.browser = list(value(), BROWSERS, '--browser')[0] as BenchOptions['browser'];
		else if (arg === DEV_OPTION) options.dev = true;
		else if (arg === '--switches') options.switches = readSwitches(value(), '--switches');
		else throw new Error(`unknown option ${arg}`);
	}
	if (!(Number.isInteger(options.runs) && options.runs > 0))
		throw new Error('--runs: use a whole number above 0');
	if (options.seconds !== null && !(options.seconds > 0))
		throw new Error('--seconds: use a number above 0');
	if (
		[options.jobs, options.sweep || null, options.compare, options.merge].filter(Boolean).length > 1
	)
		throw new Error('use one of --jobs, --sweep, --compare and --merge');
	if (options.shard && !options.compare) throw new Error('--shard: use it with --compare');
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

/**
 * Starts the browser: Chrome or Brave in a window, or Chromium without one on SwiftShader. A browser
 * in a window gives focus back to the app that was in front.
 */
function launchBrowser(name: BenchOptions['browser']): Promise<Browser> {
	if (name === 'chromium')
		return chromium.launch({
			headless: true,
			args: [...SWIFTSHADER_ARGS, WEBGPU_DEVELOPER_FEATURES],
		});
	return launchInWindow({
		...(name === 'brave' ? { executablePath: BRAVE } : { channel: 'chrome' }),
		args: [WEBGPU_DEVELOPER_FEATURES],
	});
}

/** Opens one benchmark page in a fresh parked window and waits for its result. */
async function runPage(browser: Browser, url: string, timeoutMs: number): Promise<BenchResult> {
	const page = await newParkedPage(browser, { viewport: { width: 1400, height: 800 } });
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
			const switches = withSwitches(
				[
					...(seconds === null ? [] : [`seconds=${seconds}`]),
					...(jobs === undefined ? [] : [`jobs=${jobs}`]),
				],
				options,
			);
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
				if (results.length > 0) rows.push(summaryRow({ scene, kind, jobs }, results));
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
	const chartPage = await newParkedPage(browser, { viewport: { width: 1200, height: 800 } });
	for (const scene of options.scenes ?? BENCH_SCENES) {
		const points: SweepPoint[] = [];
		const series: Record<string, { x: number; y: number }[]> = {};
		for (const n of SWEEP_COUNTS[scene]) {
			const summaries: SweepPoint['summaries'] = {};
			for (const kind of options.pages ?? SWEEP_PAGES) {
				const result = await runPage(
					browser,
					`${baseUrl}${pagePath(scene, kind, withSwitches([`seconds=${seconds}`, `n=${n}`], options))}`,
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
 * Each checkout's commit as its short hash and subject, the messages of the commits that the new
 * build adds to the baseline, where expected-change trailers are, and the page sources that those
 * commits change. A checkout outside git goes by its folder, with no messages and no page changes.
 */
function commitsOf(roots: Record<Build, string>): {
	labels: Record<Build, string>;
	messages: string[];
	pageFiles: string[];
} {
	const shas: Partial<Record<Build, string>> = {};
	const labels = { ...roots };
	for (const build of BUILDS)
		try {
			const sha = git(roots[build], 'rev-parse', 'HEAD');
			shas[build] = sha;
			labels[build] = `${sha.slice(0, 7)} "${git(roots[build], 'log', '-1', '--format=%s', sha)}"`;
		} catch {}
	if (!shas.baseline || !shas.new) return { labels, messages: [], pageFiles: [] };
	const range = `${shas.baseline}..${shas.new}`;
	try {
		const log = git(roots.new, 'log', '--format=%B%x00', range);
		const changed = git(roots.new, 'diff', '--name-only', range, '--', ...PAGE_SOURCES);
		return {
			labels,
			messages: log.split('\0').filter((message) => message.trim() !== ''),
			pageFiles: changed.split('\n').filter(Boolean),
		};
	} catch {
		return { labels, messages: [], pageFiles: [] };
	}
}

/**
 * The comparison switches of a checkout's commit, or none when its comparison had none. They come
 * from the checkout's own comparison code.
 */
async function switchesOf(root: string): Promise<readonly string[]> {
	try {
		const code = (await import(join(root, 'bench/lib/compare.ts'))) as {
			COMPARISON_SWITCHES?: readonly string[];
		};
		return code.COMPARISON_SWITCHES ?? [];
	} catch {
		return [];
	}
}

/** The browser and the machine, in a few words for the report. */
function machineText(browser: Browser, name: BenchOptions['browser']): string {
	const cores = cpus();
	const engine = { chrome: 'Chrome', brave: 'Brave', chromium: 'Chromium on SwiftShader' }[name];
	const system = { darwin: 'macOS', linux: 'Linux', win32: 'Windows' }[platform() as string];
	return `${engine} ${browser.version()} on ${system ?? platform()}, ${cores.length} cores of ${cores[0]?.model.trim() ?? 'an unknown processor'}`;
}

/** The file in which a comparison keeps its record, which `--merge` reads. */
const RECORD_FILE = 'runs.json';

/**
 * Runs the null3d pages of two built checkouts in turns, and returns the record of the runs. Each
 * checkout's pages get a production build of their own, which a server of their own serves; with
 * `--dev`, each checkout's dev server serves its pages. Every run's result goes to `dir`. With
 * `--shard`, only the shard's share of the pages runs.
 */
async function runComparison(
	browser: Browser,
	options: BenchOptions,
	[baselineDir, newDir]: [string, string],
	dir: string,
): Promise<ComparisonRecord> {
	const roots: Record<Build, string> = { baseline: resolve(baselineDir), new: resolve(newDir) };
	for (const root of Object.values(roots))
		if (!existsSync(join(root, BUILT_CORE)))
			throw new Error(`${root} holds no built engine: run bun run build there first`);
	const plan = (options.scenes ?? BENCH_SCENES).flatMap((scene) =>
		(options.pages ?? JOBS_PAGES).map((kind) => ({ scene, kind })),
	);
	const share = options.shard ? shardPages(plan, options.shard) : plan;
	// A scene that one checkout lacks, such as a benchmark that the new build adds, has nothing to
	// compare with, so it runs in neither.
	const hasScene = (scene: BenchScene) =>
		Object.values(roots).every((root) =>
			existsSync(join(root, pagePath(scene, 'null3d-webgpu').split('?')[0] as string)),
		);
	for (const scene of new Set(share.map((page) => page.scene)))
		if (!hasScene(scene))
			console.log(`${scene}: skipped, because one of the checkouts has no page for it`);
	const pages = share.filter((page) => hasScene(page.scene));
	const switches = withSwitches(
		[
			...(options.seconds === null ? [] : [`seconds=${options.seconds}`]),
			...comparisonSwitches(options.switches),
		],
		options,
	);
	const timeoutMs = pageTimeoutMs(options.seconds);
	const servers: DevServer[] = [];
	const results: BuildRun[] = [];
	try {
		// The new build takes the port after the dev server's, where the HTTPS server would be.
		const urls = {} as Record<Build, string>;
		for (const [index, build] of BUILDS.entries()) {
			const server = await serveBenchPages({
				dev: options.dev,
				root: roots[build],
				port: HTTP_PORT + index,
				outDir: join(REPO_ROOT, `target/bench-pages-${build}`),
			});
			servers.push(server);
			urls[build] = server.url;
		}
		for (let round = 1; round <= options.runs; round++)
			for (const { scene, kind } of pages)
				for (const build of roundOrder(round)) {
					const result = await runPage(
						browser,
						`${urls[build]}${pagePath(scene, kind, switches)}`,
						timeoutMs,
					);
					const name = `${build}-${scene}-${kind}-${round}`;
					writeFileSync(join(dir, `${name}.json`), JSON.stringify(result, null, '\t'));
					results.push({ build, scene, kind, round, result });
					console.log(
						`${name}: ${result.ok ? `${ms(result.cpuMs.median)} ms` : `failed: ${result.error}`}`,
					);
				}
	} finally {
		for (const server of servers) server.stop();
	}
	const { labels, messages, pageFiles } = commitsOf(roots);
	const { warmup, measure } = runSeconds(options.seconds);
	return {
		shard: options.shard,
		plan,
		pages: share,
		commits: labels,
		messages,
		measurementChanges: measurementChanges(pageFiles, await switchesOf(roots.baseline)),
		browser: `${machineText(browser, options.browser)}, on each commit's ${pagesText(options.dev)}`,
		runs: options.runs,
		warmupSeconds: warmup,
		measureSeconds: measure,
		results,
	};
}

/**
 * Judges a comparison's record, and writes the record and its summary to `dir`. Returns the
 * report, and sets the exit code when the new build fails and `failSlower` is true.
 */
function judgeComparison(record: ComparisonRecord, dir: string, failSlower: boolean): string {
	const { report, verdict, summary } = judgeRecord(record, {
		scenes: BENCH_SCENES,
		kinds: BENCH_PAGE_KINDS,
	});
	writeFileSync(join(dir, RECORD_FILE), JSON.stringify(record, null, '\t'));
	writeFileSync(join(dir, 'summary.json'), JSON.stringify(summary, null, '\t'));
	if (failSlower && !verdict.pass) process.exitCode = 1;
	return report.join('\n');
}

/** The records of every shard under a folder, or none when the folder does not exist. */
function readRecords(folder: string): ComparisonRecord[] {
	if (!existsSync(folder)) return [];
	return readdirSync(folder, { recursive: true, encoding: 'utf8' })
		.filter((path) => basename(path) === RECORD_FILE)
		.map((path) => JSON.parse(readFileSync(join(folder, path), 'utf8')) as ComparisonRecord);
}

/** Runs the pages in the browser, and returns the run's report. */
async function runInBrowser(options: BenchOptions, dir: string): Promise<string> {
	const browser = await launchBrowser(options.browser);
	try {
		if (options.compare)
			return judgeComparison(
				await runComparison(browser, options, options.compare, dir),
				dir,
				true,
			);
		const server = await serveBenchPages({ dev: options.dev });
		try {
			const report = options.sweep
				? await runSweep(browser, server.url, options, dir)
				: await runProtocol(browser, server.url, options, dir);
			return `Benchmark pages: the ${pagesText(options.dev)}.\n\n${report}`;
		} finally {
			server.stop();
		}
	} finally {
		await browser.close();
	}
}

async function main(): Promise<void> {
	const options = parseBenchArgs(process.argv.slice(2));
	const kind =
		options.compare || options.merge
			? 'compare'
			: options.sweep
				? 'sweep'
				: options.jobs
					? 'jobs'
					: 'bench';
	const dir = join(REPO_ROOT, 'target/bench', runName(kind));
	mkdirSync(dir, { recursive: true });
	const report = options.merge
		? judgeComparison(mergeRecords(readRecords(options.merge)), dir, false)
		: await runInBrowser(options, dir);
	writeFileSync(join(dir, 'summary.md'), `${report}\n`);
	console.log(`\n${report}\n\nresults: ${relative(REPO_ROOT, dir)}`);
}

if (import.meta.main) {
	main().catch((e) => {
		console.error(`error: ${(e as Error).message}`);
		process.exit(1);
	});
}
