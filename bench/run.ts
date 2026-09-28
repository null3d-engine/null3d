// Runs the benchmark protocol in a visible Chrome or Brave window on this Mac: each scene's null3d
// page, three.js pages and scene-code page, several fresh runs each, then prints and saves a
// summary. The scene-code page times the scene code both engines run, so the summary also compares
// each engine's own work. With --sweep it runs S1 at growing instance counts and draws CPU time per
// frame against the count. From the repository root:
//   bun run bench:run                                (S1: 5 runs of 5 s warm-up and 30 s measured)
//   bun run bench:run -- --scenes s1,s1-static,s2 --runs 3 --seconds 10
//   bun run bench:run -- --sweep --seconds 5
//   bun run bench:run -- --browser brave
// Options:
//   --scenes <list>   s1, s1-static, s2; the default is s1
//   --pages <list>    page kinds; the default is null3d-webgpu, threejs-webgpu, threejs-webgl,
//                     scene-code
//   --runs <n>        fresh runs of each page; the default is 5
//   --seconds <n>     warm-up and measured time of each run; the default is the protocol's 5 and 30
//   --sweep           S1 at 1,000 to 100,000 instances, with a chart, instead of the runs above
//   --browser <name>  chrome (the default) or brave
// Chrome and Brave start with WebGPU's developer features on, so GPU timestamps are not rounded.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { type Browser, chromium } from '@playwright/test';
import { pageResult } from '../tests/lib/page-result.ts';
import { runName } from '../tests/lib/runs.ts';
import { REPO_ROOT, startServer } from '../tests/lib/server.ts';
import {
	BENCH_PAGE_KINDS,
	type BenchPageKind,
	PARITY_SCENES,
	type ParityScene,
	pagePath,
	SCENE_CODE,
} from './lib/parity';
import {
	type BenchResult,
	type ChartSeries,
	comparisonLines,
	lineChartSvg,
	ms,
	ownShareOfThree,
	type RunSummary,
	type SummaryRow,
	summarizeRuns,
	summaryTable,
} from './lib/report';
import { MEASURE_SECONDS, WARMUP_SECONDS } from './scenes/spec';

const BRAVE = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
const SWEEP_COUNTS = [1_000, 3_000, 10_000, 30_000, 100_000];
const DEFAULT_PAGES: BenchPageKind[] = [
	'null3d-webgpu',
	'threejs-webgpu',
	'threejs-webgl',
	SCENE_CODE,
];
/** Time for a page to start, beyond its warm-up and measured seconds. */
const START_MARGIN_MS = 60_000;

export interface BenchOptions {
	scenes: ParityScene[];
	pages: BenchPageKind[];
	runs: number;
	seconds: number | null;
	sweep: boolean;
	browser: 'chrome' | 'brave';
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
		scenes: ['s1'],
		pages: DEFAULT_PAGES,
		runs: 5,
		seconds: null,
		sweep: false,
		browser: 'chrome',
	};
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		const value = () => args[++i];
		if (arg === '--scenes') options.scenes = list(value(), PARITY_SCENES, '--scenes');
		else if (arg === '--pages') options.pages = list(value(), BENCH_PAGE_KINDS, '--pages');
		else if (arg === '--runs') options.runs = Number(value());
		else if (arg === '--seconds') options.seconds = Number(value());
		else if (arg === '--sweep') options.sweep = true;
		else if (arg === '--browser')
			options.browser = list(value(), ['chrome', 'brave'], '--browser')[0] as 'chrome';
		else throw new Error(`unknown option ${arg}`);
	}
	if (!(Number.isInteger(options.runs) && options.runs > 0))
		throw new Error('--runs: use a whole number above 0');
	if (options.seconds !== null && !(options.seconds > 0))
		throw new Error('--seconds: use a number above 0');
	return options;
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
	const switches = seconds === null ? '' : `seconds=${seconds}`;
	const timeoutMs =
		((seconds ?? MEASURE_SECONDS) + (seconds ?? WARMUP_SECONDS)) * 1000 + START_MARGIN_MS;
	const rows: SummaryRow[] = [];
	const failures: string[] = [];
	for (const scene of options.scenes) {
		for (const kind of options.pages) {
			const results: BenchResult[] = [];
			for (let run = 1; run <= options.runs; run++) {
				const result = await runPage(
					browser,
					`${baseUrl}${pagePath(scene, kind, switches)}`,
					timeoutMs,
				);
				writeFileSync(
					join(dir, `${scene}-${kind}-${run}.json`),
					JSON.stringify(result, null, '\t'),
				);
				if (result.ok) results.push(result);
				else failures.push(`${scene} ${kind} run ${run}: ${result.error}`);
				console.log(
					`${scene} ${kind} run ${run}: ${result.ok ? `${ms(result.cpuMs.median)} ms` : `failed: ${result.error}`}`,
				);
			}
			if (results.length > 0) rows.push({ scene, kind, summary: summarizeRuns(results) });
		}
	}
	const lines = [summaryTable(rows), '', ...comparisonLines(rows)];
	for (const failure of failures) lines.push(`Failed: ${failure}`);
	writeFileSync(join(dir, 'summary.json'), JSON.stringify(rows, null, '\t'));
	return lines.join('\n');
}

async function runSweep(
	browser: Browser,
	baseUrl: string,
	options: BenchOptions,
	dir: string,
): Promise<string> {
	const seconds = options.seconds ?? 5;
	const timeoutMs = 2 * seconds * 1000 + START_MARGIN_MS;
	const points: Record<string, { x: number; y: number }[]> = {};
	const add = (name: string, x: number, y: number | undefined) => {
		if (y !== undefined) points[name] = [...(points[name] ?? []), { x, y }];
	};
	for (const n of SWEEP_COUNTS) {
		const summaries: Partial<Record<BenchPageKind, RunSummary>> = {};
		for (const kind of DEFAULT_PAGES) {
			const result = await runPage(
				browser,
				`${baseUrl}${pagePath('s1', kind, `seconds=${seconds}&n=${n}`)}`,
				timeoutMs,
			);
			writeFileSync(join(dir, `sweep-${kind}-${n}.json`), JSON.stringify(result, null, '\t'));
			if (!result.ok) {
				console.log(`sweep ${kind} n=${n}: failed: ${result.error}`);
				continue;
			}
			console.log(`sweep ${kind} n=${n}: ${ms(result.cpuMs.median)} ms`);
			add(kind, n, result.cpuMs.median);
			summaries[kind] = summarizeRuns([result]);
		}
		const null3d = summaries['null3d-webgpu'];
		const sceneCode = summaries[SCENE_CODE];
		const threejs = [summaries['threejs-webgpu'], summaries['threejs-webgl']];
		const own = ownShareOfThree(null3d, threejs, sceneCode);
		add('null3d own work', n, own?.null3dMs);
		add('three.js own work', n, own?.threeMs);
		// Every thread's work, job workers included, less the sketch's update.
		if (null3d?.allThreadsMs !== undefined)
			add('null3d engine', n, null3d.allThreadsMs - (null3d.updateMs ?? 0));
	}
	const lines: Record<string, Omit<ChartSeries, 'points'>> = {
		'null3d-webgpu': { name: 'null3d, whole frame', color: '#2a6fdb' },
		'null3d own work': { name: 'null3d, own work', color: '#2a6fdb', dashed: true },
		'null3d engine': { name: 'null3d engine, all threads', color: '#18a058' },
		'threejs-webgl': { name: 'three.js WebGL, whole frame', color: '#f2a13e' },
		'threejs-webgpu': { name: 'three.js WebGPU, whole frame', color: '#e8554e' },
		'three.js own work': { name: 'three.js, own work', color: '#f2a13e', dashed: true },
		[SCENE_CODE]: { name: 'scene code both engines run', color: '#9a9a9a' },
	};
	const series: ChartSeries[] = Object.entries(points).map(([key, points]) => ({
		...(lines[key] ?? { name: key, color: '#000000' }),
		points,
	}));
	const svg = lineChartSvg(
		'S1: CPU time per frame',
		'instances (log scale)',
		'milliseconds per frame',
		series,
	);
	const svgFile = join(dir, 'sweep.svg');
	writeFileSync(svgFile, svg);
	// A window larger than the chart; the picture is of the chart alone.
	const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
	await page.setContent(svg);
	await page.locator('svg').screenshot({ path: join(dir, 'sweep.png') });
	await page.close();
	return `Sweep chart: ${relative(REPO_ROOT, svgFile)} and sweep.png`;
}

async function main(): Promise<void> {
	const options = parseBenchArgs(process.argv.slice(2));
	const run = runName(options.sweep ? 'sweep' : 'bench');
	const dir = join(REPO_ROOT, 'target/bench', run);
	mkdirSync(dir, { recursive: true });
	const server = await startServer();
	const browser = await chromium.launch({
		headless: false,
		...(options.browser === 'brave' ? { executablePath: BRAVE } : { channel: 'chrome' }),
		args: ['--enable-webgpu-developer-features'],
	});
	try {
		const report = options.sweep
			? await runSweep(browser, server.url, options, dir)
			: await runProtocol(browser, server.url, options, dir);
		writeFileSync(join(dir, 'summary.md'), `${report}\n`);
		console.log(`\n${report}\n\nresults: ${relative(REPO_ROOT, dir)}`);
	} finally {
		await browser.close();
		server.stop();
	}
}

if (import.meta.main) {
	main().catch((e) => {
		console.error(`error: ${(e as Error).message}`);
		process.exit(1);
	});
}
