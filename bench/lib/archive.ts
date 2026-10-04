// The archive of benchmark runs. A run folder holds every page's full result, with captured frames
// and images, and stays on the machine that ran it. Its archive record keeps what the figures need,
// small enough to track in git: the plan's pages, each runner's device and browser, each page's
// medians, each run's figures and the commit that ran them. The results page in the maintainer
// guides takes its rows from these records.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import {
	browserText,
	type DeviceFacts,
	detectBrowser,
	deviceText,
	type GpuFacts,
	osText,
} from '../../tests/lib/device-record.ts';
import { type HeatSample, type HeatSummary, summarizeHeat } from '../../tests/lib/heat.ts';
import {
	benchRows,
	type Check,
	governorSummary,
	soakSummary,
	startupSummary,
} from '../../tests/lib/plans.ts';
import type { ItemResult, Plan, PlanItem } from '../../tests/lib/runs.ts';
import { summarizeTrace, type TraceSummary } from '../pages/lib/trace.ts';
import type { ComparisonRecord } from './compare.ts';
import {
	type BenchResult,
	busiestThread,
	ownWorkMs,
	type RunSummary,
	type SummaryRow,
	summarizeRuns,
	summaryRow,
	type VisualFigures,
} from './report.ts';
import { loadSample, type StartupResult } from './startup.ts';

/** The version of the record's layout. A change that moves or renames a field raises it. */
export const ARCHIVE_FORMAT = 1;

/** The tracked folder of archive records, one file per run. */
export const ARCHIVE_DIR = resolve(import.meta.dirname, '../results');

/** The kinds of run that the archive keeps, by the last word of the run's name. */
export const ARCHIVED_KINDS = [
	'bench',
	'jobs',
	'compare',
	'sweep',
	'scale',
	'governor',
	'soak',
	'startup',
	'gate',
] as const;
export type ArchiveKind = (typeof ARCHIVED_KINDS)[number];

/** The tool that wrote a run folder. */
export type ArchiveTool = 'device runner' | 'bench:run' | 'gate';

/** Significant digits that the archive keeps of a fraction: finer than any timer's step. */
const SIGNIFICANT_DIGITS = 4;

/** A number with the archive's precision: a whole number as it is, a fraction to four digits. */
export function round(value: number): number {
	if (!Number.isFinite(value) || Number.isInteger(value)) return value;
	return Number(value.toPrecision(SIGNIFICANT_DIGITS));
}

/** A copy of a value with every number rounded and every undefined field left out. */
export function compact<T>(value: T): T {
	if (typeof value === 'number') return round(value) as T;
	if (Array.isArray(value)) return value.map(compact) as T;
	if (value === null || typeof value !== 'object') return value;
	const out: Record<string, unknown> = {};
	for (const [key, entry] of Object.entries(value))
		if (entry !== undefined) out[key] = compact(entry);
	return out as T;
}

const RUN_NAME = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-(.+)$/;

/** A run name's start time in UTC, its date and its kind, or undefined for another name. */
export function parseRunName(
	name: string,
): { startMs: number; date: string; kind: string } | undefined {
	const match = RUN_NAME.exec(name);
	if (!match) return undefined;
	type Stamp = [string, string, string, string, string, string];
	const [year, month, day, hour, minute, second] = match.slice(1, 7) as Stamp;
	return {
		startMs: Date.UTC(+year, +month - 1, +day, +hour, +minute, +second),
		date: `${year}-${month}-${day}`,
		kind: match[7] as string,
	};
}

/** The kind of run that a run's name gives, when the archive keeps that kind. */
export function archivedKind(name: string): ArchiveKind | undefined {
	const kind = parseRunName(name)?.kind;
	return (ARCHIVED_KINDS as readonly string[]).includes(kind ?? '')
		? (kind as ArchiveKind)
		: undefined;
}

const REFLOG_LINE = /^[0-9a-f]{40} ([0-9a-f]{40}) .* (\d+) [+-]\d{4}\t/;

/**
 * The commit that a checkout had checked out at a time, from the text of its HEAD reflog: the
 * newest entry at or before the time. Null when the reflog starts later. Edits that were not
 * committed leave no trace there.
 */
export function commitAt(reflog: string, atMs: number): string | null {
	let found: string | null = null;
	for (const line of reflog.split('\n')) {
		const match = REFLOG_LINE.exec(line);
		if (match && Number(match[2]) * 1000 <= atMs) found = match[1] as string;
	}
	return found;
}

/** The HEAD reflog of the checkout that holds a run folder, under its `target` folder. */
function reflogOf(runFolder: string): string | undefined {
	const checkout = resolve(runFolder, '../../..');
	const dotGit = join(checkout, '.git');
	if (!existsSync(dotGit)) return undefined;
	const gitDir = statSync(dotGit).isDirectory()
		? dotGit
		: readFileSync(dotGit, 'utf8')
				.replace(/^gitdir:\s*/, '')
				.trim();
	const log = join(resolve(checkout, gitDir), 'logs/HEAD');
	return existsSync(log) ? readFileSync(log, 'utf8') : undefined;
}

/** A page kind by the engine's present name: runs from before the rename named its pages otherwise. */
export const pageKind = (kind: string) => kind.replace(/^sokko3d-/, 'null3d-');

const isNull3d = (kind: string) => kind.startsWith('null3d-');
const isThree = (kind: string) => kind.startsWith('threejs-');
const SCENE_CODE = 'scene-code';

/** A browser and device as the archive keeps them. */
export interface ArchivedDevice {
	/** The device's kind or model, its screen and cores, as the record of tested devices names it. */
	name: string;
	browser: string;
	os?: string;
	gpu?: GpuFacts;
	cores?: number;
	memoryGB?: number | null;
	refreshHz?: number;
	userAgent?: string;
}

type RecordedDevice = DeviceFacts & { deviceMemory?: number | null; refreshRateHz?: number };

/** The facts of a runner's `device.json` that the archive keeps. */
export function archiveDevice(facts: RecordedDevice): ArchivedDevice {
	return {
		name: deviceText(facts),
		browser: browserText(facts.browser ?? detectBrowser(facts)),
		os: osText(facts) || undefined,
		gpu: facts.gpu,
		cores: facts.hardwareConcurrency,
		memoryGB: facts.deviceMemory,
		refreshHz: facts.refreshRateHz,
		userAgent: facts.userAgent,
	};
}

/** The median, 95th and 99th percentiles of a measure. */
interface Spread {
	median: number;
	p95?: number;
	p99?: number;
}

/** null3D's figure against three.js's renderer with the lowest one, and null3D's share of it. */
export interface ThreeShare {
	page: string;
	threeMs: number;
	share: number;
}

/** The figures of one page's runs, summed up. */
export interface PageFigures {
	runs: number;
	cpuMs: { median: number; min: number; max: number };
	cpuP95Ms: number;
	busiest: { thread: string; ms: number };
	/** CPU time per frame on the busiest thread, apart from the scene code that both engines run. */
	ownWorkMs: number | null;
	updateMs?: number;
	allThreadsMs?: number;
	gpuMs?: number | null;
	presentedFps?: number;
	completedFps?: number | null;
	intervalP95Ms: number;
	intervalP99Ms: number;
	gpuLatencyMs?: number | null;
	refreshHz?: number | null;
	uploadBytes?: number;
	drawCalls?: number;
	visibleEntries?: number | null;
}

/** A page of a benchmark run, with its runs summed up. */
export interface ArchivedPage extends PageFigures {
	scene: string;
	page: string;
	jobs?: number;
	/** The objects the page drew. */
	n?: number;
	/** The quality presets that the null3D page's runs drew with. */
	presets?: string[];
	trace?: TraceSummary;
	visual?: VisualFigures;
	/** A null3D page against three.js's renderer that does the least, by each measure. */
	againstThree?: { wholeFrame: ThreeShare | null; ownWork: ThreeShare | null };
}

/** One timed run of one page. */
export interface ArchivedRun {
	id: string;
	scene: string;
	page: string;
	jobs?: number;
	build?: string;
	ok: boolean;
	error?: string;
	n?: number;
	frames?: number;
	preset?: string;
	jobWorkers?: number;
	cpuMs?: Spread;
	busiest?: string;
	ownWorkMs?: number | null;
	intervalMs?: Spread;
	presentedFps?: number;
	completedFps?: number | null;
	gpuMs?: number | null;
	gpuLatencyMs?: number | null;
	refreshHz?: number | null;
	trace?: TraceSummary;
	heat?: HeatSummary;
}

/** A page's figures from the summary of its runs. `sceneCodeMs` gives three.js's own work. */
export function pageFigures(summary: RunSummary, sceneCodeMs: number | undefined): PageFigures {
	const null3d = summary.threadsMs !== undefined;
	return {
		runs: summary.runs,
		cpuMs: summary.cpuMs,
		cpuP95Ms: summary.cpuP95Ms,
		busiest: busiestThread(summary),
		ownWorkMs: null3d || sceneCodeMs !== undefined ? ownWorkMs(summary, sceneCodeMs ?? 0) : null,
		updateMs: summary.updateMs,
		allThreadsMs: summary.allThreadsMs,
		gpuMs: summary.gpuMs,
		presentedFps: summary.presentedFps,
		completedFps: summary.completedFps,
		intervalP95Ms: summary.intervalP95Ms,
		intervalP99Ms: summary.intervalP99Ms,
		gpuLatencyMs: summary.gpuLatencyMs,
		refreshHz: summary.refreshHz,
		uploadBytes: summary.uploadBytes,
		drawCalls: summary.drawCalls,
		visibleEntries: summary.visibleEntries,
	};
}

/** The three.js page with the lowest value of a measure, and null3D's share of it. */
function againstLowest(
	null3dMs: number | null,
	threes: readonly ArchivedPage[],
	measure: (page: ArchivedPage) => number | null,
): ThreeShare | null {
	let best: ThreeShare | null = null;
	for (const three of threes) {
		const threeMs = measure(three);
		if (threeMs !== null && threeMs > 0 && (best === null || threeMs < best.threeMs))
			best = { page: three.page, threeMs, share: 0 };
	}
	if (best === null || null3dMs === null) return null;
	return { ...best, share: null3dMs / best.threeMs };
}

/** Facts of a page that the runs' summary leaves out: its object count and presets. */
interface PageDetails {
	n?: number;
	presets?: string[];
}

/** The details of a page from its successful runs. */
export function pageDetails(results: readonly BenchResult[]): PageDetails {
	const presets = [
		...new Set(results.flatMap((result) => (result.mode?.preset ? [result.mode.preset] : []))),
	];
	return { n: results[0]?.n, ...(presets.length > 0 && { presets }) };
}

/**
 * A run's pages as the archive keeps them. Each page of a scene and job worker count gets its own
 * work from the scene-code page of the same scene, and each null3D page its share of three.js's.
 */
export function archivePages(
	rows: readonly SummaryRow[],
	details: (row: SummaryRow) => PageDetails,
): ArchivedPage[] {
	const group = (row: SummaryRow) => `${row.scene} ${row.jobs ?? ''}`;
	const sceneCode = new Map(
		rows
			.filter((row) => pageKind(row.kind) === SCENE_CODE)
			.map((row) => [group(row), row.summary.cpuMs.median]),
	);
	const pages: ArchivedPage[] = rows.map((row) => {
		const page = pageKind(row.kind);
		return {
			scene: row.scene,
			page,
			jobs: row.jobs,
			...details(row),
			...pageFigures(row.summary, page === SCENE_CODE ? undefined : sceneCode.get(group(row))),
			trace: row.trace,
			visual: row.visual,
		};
	});
	for (const page of pages) {
		if (!isNull3d(page.page)) continue;
		const threes = pages.filter(
			(other) => isThree(other.page) && other.scene === page.scene && other.jobs === page.jobs,
		);
		if (threes.length === 0) continue;
		page.againstThree = {
			wholeFrame: againstLowest(page.cpuMs.median, threes, (three) => three.cpuMs.median),
			ownWork: againstLowest(page.ownWorkMs, threes, (three) => three.ownWorkMs),
		};
	}
	return pages;
}

const spread = (value: { median: number; p95?: number; p99?: number } | undefined) =>
	value && { median: value.median, p95: value.p95, p99: value.p99 };

/** Longest error text that a record keeps of a failed run. */
const ERROR_CHARS = 300;

/** One run's figures. `sceneCodeMs` gives a three.js page its own work. */
export function archiveRun(
	run: Pick<ArchivedRun, 'id' | 'scene' | 'page' | 'jobs' | 'build'>,
	result: ItemResult,
	sceneCodeMs: number | undefined,
): ArchivedRun {
	const bench = result as unknown as BenchResult & {
		runnerRefreshHz?: number;
		heat?: HeatSummary;
		stats?: { refreshHz?: number | null };
	};
	if (!result.ok || !bench.cpuMs)
		return {
			...run,
			ok: false,
			error: String(result.error ?? 'no figures').slice(0, ERROR_CHARS),
		};
	const summary = summarizeRuns([bench]);
	const figures = pageFigures(summary, sceneCodeMs);
	const refreshHz = bench.stats?.refreshHz ?? bench.runnerRefreshHz ?? null;
	return {
		...run,
		ok: true,
		n: bench.n,
		frames: bench.frames,
		preset: bench.mode?.preset,
		jobWorkers: bench.mode?.jobWorkers,
		cpuMs: spread(bench.cpuMs),
		busiest: figures.busiest.thread,
		ownWorkMs: figures.ownWorkMs,
		intervalMs: spread(bench.intervalMs),
		presentedFps: figures.presentedFps,
		completedFps: figures.completedFps,
		gpuMs: figures.gpuMs,
		gpuLatencyMs: figures.gpuLatencyMs,
		refreshHz,
		...(bench.trace && { trace: summarizeTrace(bench.trace, refreshHz) }),
		heat: bench.heat,
	};
}

/** Keys of a page's result that hold pictures, browser facts or long lists, which records leave out. */
const LEFT_OUT = new Set([
	'userAgent',
	'url',
	'receivedAt',
	'capabilities',
	'report',
	'trail',
	'images',
	'frame',
	'pixels',
	'files',
]);
/** Longest text and longest list that a slim result keeps. */
const SLIM_TEXT = 300;
const SLIM_LIST = 120;

/**
 * A result of a plan other than the bench plan, without its pictures, browser facts, long texts
 * and long lists, and with each measure's figures cut to its median and upper percentiles.
 */
export function slimResult(value: unknown): unknown {
	if (typeof value === 'string') return value.length > SLIM_TEXT ? undefined : value;
	if (Array.isArray(value)) return value.length > SLIM_LIST ? undefined : value.map(slimResult);
	if (value === null || typeof value !== 'object') return value;
	const entries = value as Record<string, unknown>;
	if (typeof entries.median === 'number' && 'count' in entries) return spread(entries as never);
	const out: Record<string, unknown> = {};
	for (const [key, entry] of Object.entries(entries))
		if (!LEFT_OUT.has(key)) out[key] = slimResult(entry);
	return out;
}

/** One runner's part of a run. */
export interface ArchivedRunner {
	device: ArchivedDevice | null;
	/** The runner's counts of pages that passed, were skipped and failed. */
	counts?: Record<string, unknown>;
	heat?: HeatSummary;
	pages?: ArchivedPage[];
	runs?: ArchivedRun[];
	/** The runner's report, as the device runner prints it, for plans other than the bench plan. */
	report?: string;
	/** Each page's result without pictures and long lists, by the page's name in the plan. */
	results?: Record<string, unknown>;
	/** The scale plan: the largest counts that held the frame rate, and each step of the search. */
	scale?: { answers?: unknown; steps: unknown[] };
}

/** A gate run: each step's figure and verdict, and the benchmark runs that its timing steps made. */
export interface ArchivedGate {
	onMain?: boolean;
	dirty?: boolean;
	quick?: boolean;
	steps: Record<string, unknown>[];
	benchRuns: Record<string, string>;
}

/** A comparison of two builds: its verdict and the medians and changes of each page. */
export interface ArchivedComparison {
	commits: Record<string, string>;
	browser: string;
	shard: unknown;
	runs: number;
	warmupSeconds?: number;
	measureSeconds?: number;
	measurementChanges: string[];
	[key: string]: unknown;
}

/** What the archive keeps of one run folder. */
export interface ArchiveRecord {
	format: number;
	run: string;
	kind: ArchiveKind;
	tool: ArchiveTool;
	startedAt: string;
	/** The commit the run measured: from the run's own record, or else from the checkout's reflog. */
	commit: string | null;
	commitFrom: 'record' | 'reflog' | null;
	/** The pages of the plan, each once, without the run's own address prefix. */
	plan?: string[];
	runners?: Record<string, ArchivedRunner>;
	gate?: ArchivedGate;
	comparison?: ArchivedComparison;
}

/** A run folder that holds nothing that the archive keeps. */
export class NoResultsError extends Error {}

function readJson<T>(path: string): T | undefined {
	return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : undefined;
}

/**
 * A page's result as the archive reads it. Its WebGL call times stay in the run folder: the
 * records keep no call tables, and early runs wrote them in another layout.
 */
function readResult(path: string): ItemResult | undefined {
	const result = readJson<ItemResult>(path);
	if (result) delete result.glTiming;
	return result;
}

const jsonFiles = (folder: string) =>
	readdirSync(folder)
		.filter((name) => name.endsWith('.json'))
		.sort();

/** The runner folders of a device runner's run: every folder but the captured frames. */
const runnerFolders = (folder: string) =>
	readdirSync(folder)
		.filter((name) => statSync(join(folder, name)).isDirectory())
		.sort();

/** The address prefix that gives each run and runner its own loads, which the plan's pages drop. */
const LOAD_PREFIX = /^\/__null3d\/load\/[a-z]+\/[^/]+\//;

/** The plan's pages, each once. */
const planPages = (items: readonly PlanItem[]) => [
	...new Set(items.map((item) => item.path.replace(LOAD_PREFIX, '/'))),
];

/** Files of a runner's folder that are not page results. */
const RUNNER_FILES = new Set(['device.json', 'done.json', 'heat.json', 'scale.json']);

/** The runner's name in the records of runs that a tool ran on this machine in Playwright. */
export const PLAYWRIGHT = 'playwright';

/** What the machine that archives a run says of itself, for runs that it ran in Playwright. */
export interface Host {
	name: string;
}

/**
 * The device of a run that a tool ran on this machine in Playwright: the machine, and the browser
 * that the results' user agent names.
 */
function hostDevice(host: Host, results: readonly ItemResult[]): ArchivedDevice {
	const userAgent = results.find((result) => typeof result.userAgent === 'string')?.userAgent as
		| string
		| undefined;
	const browser = detectBrowser({ userAgent });
	return {
		name: host.name,
		browser: browserText({ ...browser, version: browser.version?.replace(/(\.0)+$/, '') ?? null }),
		userAgent,
	};
}

/** The parts of a device runner's run folder that every plan reads. */
interface RunnerRun {
	plan: Plan<Check> | undefined;
	items: PlanItem<Check>[];
	runners: string[];
	resultOf: (runner: string) => (id: string) => ItemResult | undefined;
	baseRunner: (runner: string) => Omit<ArchivedRunner, 'pages' | 'runs'>;
}

/** A plan item with its benchmark page by the engine's present name. */
function withPageKind(item: PlanItem<Check>): PlanItem<Check> {
	const check = item.check as Check & { page?: string };
	return check.kind === 'bench' && check.page
		? ({ ...item, check: { ...check, page: pageKind(check.page) } } as PlanItem<Check>)
		: item;
}

function readRunnerRun(folder: string): RunnerRun {
	const plan = readJson<Plan<Check>>(join(folder, 'plan.json'));
	const summary = readJson<Record<string, Record<string, unknown>>>(join(folder, 'summary.json'));
	const runners = runnerFolders(folder).filter(
		(runner) => jsonFiles(join(folder, runner)).filter((n) => !RUNNER_FILES.has(n)).length > 0,
	);
	return {
		plan,
		items: (plan?.items ?? []).map(withPageKind),
		runners,
		resultOf: (runner) => (id) => readResult(join(folder, runner, `${id}.json`)),
		baseRunner: (runner) => {
			const device = readJson<RecordedDevice>(join(folder, runner, 'device.json'));
			const heat = readJson<HeatSample[]>(join(folder, runner, 'heat.json'));
			const counts = summary?.[runner];
			return {
				device: device ? archiveDevice(device) : null,
				...(counts && {
					counts: Object.fromEntries(Object.entries(counts).filter(([key]) => key !== 'browser')),
				}),
				...(heat &&
					heat.length > 0 && { heat: summarizeHeat(heat, -Infinity, Number.POSITIVE_INFINITY) }),
			};
		},
	};
}

/** A device runner's bench plan: each runner's pages and runs. */
function benchRunners(run: RunnerRun): Record<string, ArchivedRunner> {
	const runners: Record<string, ArchivedRunner> = {};
	for (const runner of run.runners) {
		const resultOf = run.resultOf(runner);
		const items = run.items.filter((item) => item.check.kind === 'bench');
		const rows = benchRows(run.items, resultOf) ?? [];
		const okResults = (row: SummaryRow) =>
			items
				.filter((item) => {
					const check = item.check as { scene: string; page: string; jobs?: number };
					return check.scene === row.scene && check.page === row.kind && check.jobs === row.jobs;
				})
				.flatMap((item) => {
					const result = resultOf(item.id);
					return result?.ok ? [result as unknown as BenchResult] : [];
				});
		const pages = archivePages(rows, (row) => pageDetails(okResults(row)));
		const sceneCodeMs = (scene: string, jobs: number | undefined) =>
			pages.find((page) => page.page === SCENE_CODE && page.scene === scene && page.jobs === jobs)
				?.cpuMs.median;
		const runs = items.flatMap((item) => {
			const result = resultOf(item.id);
			if (!result) return [];
			const check = item.check as { scene: string; page: string; jobs?: number };
			const page = pageKind(check.page);
			return [
				archiveRun(
					{ id: item.id, scene: check.scene, page, jobs: check.jobs },
					result,
					page === SCENE_CODE ? undefined : sceneCodeMs(check.scene, check.jobs),
				),
			];
		});
		if (runs.length > 0) runners[runner] = { ...run.baseRunner(runner), pages, runs };
	}
	return runners;
}

/** The device runner's other plans: each runner's report and its pages' results, slimmed. */
function reportRunners(
	run: RunnerRun,
	report: (
		items: PlanItem<Check>[],
		resultOf: (id: string) => ItemResult | undefined,
	) => string | undefined,
	slim: (id: string, result: ItemResult) => unknown,
): Record<string, ArchivedRunner> {
	const runners: Record<string, ArchivedRunner> = {};
	for (const runner of run.runners) {
		const resultOf = run.resultOf(runner);
		const results: Record<string, unknown> = {};
		for (const item of run.items) {
			const result = resultOf(item.id);
			if (result) results[item.id] = slim(item.id, result);
		}
		if (Object.keys(results).length === 0) continue;
		runners[runner] = {
			...run.baseRunner(runner),
			report: report(run.items, resultOf),
			results,
		};
	}
	return runners;
}

/** A startup load's points on the page's timeline, or why it failed. */
function startupLoad(_id: string, result: ItemResult): unknown {
	if (!result.ok) return { ok: false, error: String(result.error).slice(0, ERROR_CHARS) };
	const startup = result as unknown as StartupResult & { mode?: { preset?: string } };
	return { ok: true, preset: startup.mode?.preset, ...loadSample(startup) };
}

const SCALE_STEP = /^scale-(threejs-[a-z]+|null3d-[a-z0-9]+)-(\d+)$/;

/** A device runner's scale plan: the search on each runner, from its record or its steps' results. */
function scaleRunners(folder: string, run: RunnerRun): Record<string, ArchivedRunner> {
	const runners: Record<string, ArchivedRunner> = {};
	for (const runner of runnerFolders(folder)) {
		const scale = readJson<{ answers: unknown; steps: Record<string, unknown>[] }>(
			join(folder, runner, 'scale.json'),
		);
		const steps = scale
			? scale.steps.map(({ run: _run, id: _id, ...step }) => step)
			: jsonFiles(join(folder, runner)).flatMap((name) => {
					const match = SCALE_STEP.exec(name.replace(/\.json$/, ''));
					if (!match) return [];
					const result = run.resultOf(runner)(name.replace(/\.json$/, '')) ?? { ok: false };
					const fps = (result as { presentedFps?: number }).presentedFps;
					return [
						{
							page: match[1],
							count: Number(match[2]),
							...(result.ok ? { fps } : { error: String(result.error).slice(0, ERROR_CHARS) }),
						},
					];
				});
		if (steps.length === 0) continue;
		runners[runner] = {
			...run.baseRunner(runner),
			scale: { ...(scale && { answers: scale.answers }), steps },
		};
	}
	return runners;
}

/** A device runner's run of any kind that the archive keeps. */
function runnerRecord(folder: string, kind: ArchiveKind): Pick<ArchiveRecord, 'plan' | 'runners'> {
	const run = readRunnerRun(folder);
	const runners =
		kind === 'scale'
			? scaleRunners(folder, run)
			: kind === 'startup'
				? reportRunners(run, startupSummary, startupLoad)
				: kind === 'governor'
					? reportRunners(run, governorSummary, (_id, result) => slimResult(result))
					: kind === 'soak'
						? reportRunners(run, soakSummary, (_id, result) => slimResult(result))
						: benchRunners(run);
	return { ...(run.plan && { plan: planPages(run.items) }), runners };
}

/** Page kinds that a file name of a benchmark command's run can end with, before the run number. */
const PAGE_IN_NAME =
	/^(?<scene>.+?)-(?<page>(?:null3d|sokko3d)-[a-z0-9-]+?|threejs-webgl|threejs-webgpu|scene-code)(?:-jobs(?<jobs>\d+))?-(?<run>\d+)\.json$/;

/** The scene, page, job worker count and run of a result file that the benchmark command wrote. */
export function parseResultName(
	name: string,
): { scene: string; page: string; jobs?: number; run: number } | undefined {
	const groups = PAGE_IN_NAME.exec(name)?.groups;
	if (!groups) return undefined;
	return {
		scene: groups.scene as string,
		page: pageKind(groups.page as string),
		...(groups.jobs && { jobs: Number(groups.jobs) }),
		run: Number(groups.run),
	};
}

/** A sweep's result file: the scene, page and object count, or the page and count of an early sweep. */
const SWEEP_NAME =
	/^sweep-(?:(?<scene>.+?)-)?(?<page>(?:null3d|sokko3d)-[a-z0-9-]+?|threejs-webgl|threejs-webgpu|scene-code)-(?<n>\d+)\.json$/;

/** The benchmark command's protocol run: its pages and their runs, on this machine. */
function commandBench(folder: string, host: Host): Pick<ArchiveRecord, 'runners'> {
	type Entry = { id: string; scene: string; page: string; jobs?: number; result: ItemResult };
	const entries: Entry[] = jsonFiles(folder).flatMap((name) => {
		const parsed = parseResultName(name);
		if (!parsed) return [];
		const result = readResult(join(folder, name)) as ItemResult;
		const { run: _run, ...page } = parsed;
		return [{ id: name.replace(/\.json$/, ''), ...page, result }];
	});
	if (entries.length === 0) return {};
	const groups = new Map<string, Entry[]>();
	for (const entry of entries) {
		const key = `${entry.scene} ${entry.page} ${entry.jobs ?? ''}`;
		groups.set(key, [...(groups.get(key) ?? []), entry]);
	}
	const rows: SummaryRow[] = [];
	const okOf = new Map<SummaryRow, BenchResult[]>();
	for (const group of groups.values()) {
		const ok = group.filter((e) => e.result.ok).map((e) => e.result as unknown as BenchResult);
		if (ok.length === 0) continue;
		const first = group[0] as Entry;
		const row = summaryRow({ scene: first.scene, kind: first.page, jobs: first.jobs }, ok);
		rows.push(row);
		okOf.set(row, ok);
	}
	const pages = archivePages(rows, (row) => pageDetails(okOf.get(row) ?? []));
	const sceneCodeMs = (scene: string, jobs: number | undefined) =>
		pages.find((page) => page.page === SCENE_CODE && page.scene === scene && page.jobs === jobs)
			?.cpuMs.median;
	const runs = entries.map(({ result, ...run }) =>
		archiveRun(run, result, run.page === SCENE_CODE ? undefined : sceneCodeMs(run.scene, run.jobs)),
	);
	return {
		runners: {
			[PLAYWRIGHT]: {
				device: hostDevice(
					host,
					entries.map((e) => e.result),
				),
				pages,
				runs,
			},
		},
	};
}

/** The benchmark command's sweep: one run of each page at each object count. */
function commandSweep(folder: string, host: Host): Pick<ArchiveRecord, 'runners'> {
	type Point = { id: string; scene: string; page: string; n: number; result: ItemResult };
	const points: Point[] = jsonFiles(folder).flatMap((name) => {
		const groups = SWEEP_NAME.exec(name)?.groups;
		if (!groups) return [];
		const result = readResult(join(folder, name)) as ItemResult;
		const scene = groups.scene ?? (typeof result.scene === 'string' ? result.scene : 's1');
		return [
			{
				id: name.replace(/\.json$/, ''),
				scene,
				page: pageKind(groups.page as string),
				n: Number(groups.n),
				result,
			},
		];
	});
	if (points.length === 0) return {};
	const sceneCodeMs = (scene: string, n: number) => {
		const code = points.find((p) => p.page === SCENE_CODE && p.scene === scene && p.n === n);
		const cpu = code?.result.ok ? (code.result as unknown as BenchResult).cpuMs : undefined;
		return cpu?.median;
	};
	const runs = points.map(({ n, result, ...point }) => ({
		...archiveRun(
			point,
			result,
			point.page === SCENE_CODE ? undefined : sceneCodeMs(point.scene, n),
		),
		n: typeof result.n === 'number' ? result.n : n,
	}));
	return {
		runners: {
			[PLAYWRIGHT]: {
				device: hostDevice(
					host,
					points.map((p) => p.result),
				),
				runs,
			},
		},
	};
}

/** A comparison's summary file, as the benchmark command writes it. */
interface ComparisonSummary {
	commits: Record<string, string>;
	refreshHz?: Record<string, number>;
	dropped?: unknown[];
	quality?: {
		build: string;
		scene: string;
		kind: string;
		preset?: string;
		steps?: number | null;
	}[];
	summaries?: { build: string; scene: string; kind: string; summary: RunSummary }[];
	comparisons?: unknown[];
	missing?: unknown[];
	gpu?: unknown[];
	verdict?: unknown;
}

/** The commit hash at the start of a comparison's label, such as `b05c9e0 "subject"`. */
const labelCommit = (label: string | undefined) =>
	/^[0-9a-f]{7,40}\b/.exec(label ?? '')?.[0] ?? null;

/**
 * A comparison's label as a record keeps it. Early comparisons named a checkout outside git by
 * its path on the machine, which the record cuts to the folder's name.
 */
const commitLabel = (label: string) => (label.startsWith('/') ? basename(label) : label);

/** A result file of an early comparison, which wrote no record of its runs: its build first. */
const BUILD_RUN = /^(baseline|new)-(.+)$/;

/** The runs of a comparison, from its record, or else from an early comparison's result files. */
function comparisonRuns(folder: string, record: ComparisonRecord | undefined) {
	if (record)
		return record.results.map(({ build, scene, kind, round, result }) => ({
			build: build as string,
			scene,
			kind,
			round,
			result: result as unknown as ItemResult,
		}));
	return jsonFiles(folder).flatMap((name) => {
		const match = BUILD_RUN.exec(name);
		const parsed = match && parseResultName(match[2] as string);
		if (!match || !parsed) return [];
		const result = readResult(join(folder, name)) as ItemResult;
		return [
			{
				build: match[1] as string,
				scene: parsed.scene,
				kind: parsed.page,
				round: parsed.run,
				result,
			},
		];
	});
}

/** The benchmark command's comparison of two builds: its verdict, its pages and its runs. */
function commandComparison(
	folder: string,
	host: Host,
): Pick<ArchiveRecord, 'runners' | 'comparison' | 'commit'> {
	const record = readJson<ComparisonRecord>(join(folder, 'runs.json'));
	const summary = readJson<ComparisonSummary>(join(folder, 'summary.json'));
	if (!summary) return { commit: null };
	const presets: Record<string, string[]> = {};
	let steps = 0;
	for (const run of summary.quality ?? []) {
		const key = `${run.build} ${run.scene} ${run.kind}`;
		const seen = presets[key] ?? [];
		if (run.preset && !seen.includes(run.preset)) presets[key] = [...seen, run.preset];
		steps += run.steps ?? 0;
	}
	const results = comparisonRuns(folder, record);
	const runs = results.map(({ build, scene, kind, round, result }) =>
		archiveRun(
			{ id: `${build}-${scene}-${kind}-${round}`, scene, page: pageKind(kind), build },
			result,
			undefined,
		),
	);
	const commits = Object.fromEntries(
		Object.entries(record?.commits ?? summary.commits).map(([build, label]) => [
			build,
			commitLabel(label),
		]),
	);
	const device = record
		? { name: host.name, browser: record.browser }
		: hostDevice(
				host,
				results.map((run) => run.result),
			);
	return {
		commit: labelCommit(commits.new),
		comparison: {
			commits,
			browser: device.browser,
			shard: record?.shard ?? null,
			runs: record?.runs ?? Math.max(0, ...results.map((run) => run.round)),
			warmupSeconds: record?.warmupSeconds,
			measureSeconds: record?.measureSeconds,
			measurementChanges: record?.measurementChanges ?? [],
			refreshHz: summary.refreshHz,
			dropped: summary.dropped,
			presets,
			qualitySteps: steps,
			pages: summary.summaries?.map(({ build, scene, kind, summary: pageSummary }) => ({
				build,
				scene,
				page: pageKind(kind),
				...pageFigures(pageSummary, undefined),
			})),
			changes: summary.comparisons,
			missing: summary.missing,
			gpu: summary.gpu,
			verdict: summary.verdict,
		},
		runners: { [PLAYWRIGHT]: { device, runs } },
	};
}

/** The gate's record, as `bun run gate` writes it. */
interface GateFile {
	commit: string;
	onMain?: boolean;
	dirty?: boolean;
	quick?: boolean;
	startedAt?: string;
	steps: (Record<string, unknown> & { id: string; log?: string })[];
}

const BENCH_RESULTS_LINE = /results: target\/bench\/(\S+)/;

/** A gate run: its steps, and the runs of the benchmark command that its steps made. */
function gateRecord(folder: string): Pick<ArchiveRecord, 'gate' | 'commit'> {
	const gate = readJson<GateFile>(join(folder, 'gate.json'));
	if (!gate) return { commit: null };
	const benchRuns: Record<string, string> = {};
	const steps = gate.steps.map(({ log, ...step }) => {
		const text =
			log && existsSync(join(folder, log)) ? readFileSync(join(folder, log), 'utf8') : '';
		const run = BENCH_RESULTS_LINE.exec(text)?.[1];
		if (run) benchRuns[step.id] = run;
		return step;
	});
	return {
		commit: gate.commit,
		gate: { onMain: gate.onMain, dirty: gate.dirty, quick: gate.quick, steps, benchRuns },
	};
}

/**
 * The archive record of a run folder: a device runner's run under `target/runs`, a run of the
 * benchmark command under `target/bench`, or a gate run under `target/gate`. `host` names this
 * machine, for the runs that a tool ran here in Playwright. Throws `NoResultsError` for a folder
 * that holds no results.
 */
export function archiveFolder(folder: string, host: Host): ArchiveRecord {
	const run = basename(folder);
	const kind = archivedKind(run);
	const parsed = parseRunName(run);
	if (!kind || !parsed)
		throw new Error(
			`${run}: the archive keeps runs whose names end in ${ARCHIVED_KINDS.join(', ')}`,
		);
	const tool: ArchiveTool = existsSync(join(folder, 'gate.json'))
		? 'gate'
		: existsSync(join(folder, 'plan.json')) || runnerFolders(folder).length > 0
			? 'device runner'
			: 'bench:run';
	const parts: Partial<ArchiveRecord> =
		tool === 'gate'
			? gateRecord(folder)
			: tool === 'device runner'
				? runnerRecord(folder, kind)
				: kind === 'compare'
					? commandComparison(folder, host)
					: kind === 'sweep'
						? commandSweep(folder, host)
						: commandBench(folder, host);
	if (!parts.gate && !parts.comparison && Object.keys(parts.runners ?? {}).length === 0)
		throw new NoResultsError(`${run}: no results`);
	const reflog = parts.commit ? undefined : reflogOf(folder);
	const commit = parts.commit ?? (reflog ? commitAt(reflog, parsed.startMs) : null);
	return compact({
		format: ARCHIVE_FORMAT,
		run,
		kind,
		tool,
		startedAt: new Date(parsed.startMs).toISOString(),
		commit,
		commitFrom: parts.commit ? 'record' : commit ? 'reflog' : null,
		...parts,
	} as ArchiveRecord);
}

/** The results page's table of a page: its scene, with S1 at a phone's count apart. */
export function resultTable(scene: string, n: number | undefined): string {
	const name = scene.replace(/^s/, 'S');
	return scene === 's1' && (n ?? 0) > PHONE_SCALE_FROM ? 'S1 at phone scale' : name;
}

/** S1's count on the desktop; a larger count is S1 at a phone's scale. */
const PHONE_SCALE_FROM = 100_000;

/** The GPU paths of null3D's pages, in words. */
const PATH_NAMES: Readonly<Record<string, string>> = {
	webgpu: 'WebGPU',
	webgl2: 'WebGL2',
	compat: 'compatibility mode',
};

/** The variants of null3D's pages, in words. */
const VARIANT_NAMES: Readonly<Record<string, string>> = {
	low: 'low latency',
	'cells-off': 'no grid cells',
	half: 'half precision',
	prepass: 'depth prepass',
};

/** The GPU path of a null3D page, in words, with its variant. */
export function pathText(page: string): string {
	const [, api = '', ...rest] = page.split('-');
	const variant = rest.join('-');
	const path = PATH_NAMES[api] ?? api;
	return variant ? `${path}, ${VARIANT_NAMES[variant] ?? variant}` : path;
}

/** The three.js renderer of a three.js page, in words. */
const rendererText = (page: string) => (page === 'threejs-webgl' ? 'WebGL' : 'WebGPU');

const ms = (value: number | null | undefined) => (value == null ? 'n/a' : value.toFixed(2));
const percent = (share: number | null | undefined) =>
	share == null ? 'n/a' : `${Math.round(share * 100)}%`;
const fps = (value: number | null | undefined) => (value == null ? 'n/a' : value.toFixed(1));

/** Pages that time each WebGL call, which makes them unfit for comparisons. */
const TIMING_PAGE = /-(timed|synced)$/;

/** A row of the results page: its table, and its cells. */
export interface ResultRow {
	table: string;
	date: string;
	cells: string[];
}

/** The results page's columns, in order. */
export const RESULT_COLUMNS = [
	'Date',
	'Device and browser',
	'GPU path',
	'Objects',
	'Whole frame, ms: null3D / three.js',
	'Share',
	'Own work, ms: null3D / three.js',
	'Share',
	'fps: null3D / three.js',
	'GPU ms, null3D',
	'Commit',
	'Source',
] as const;

/** The device and browser of a runner, in a few words, for the results page. */
function deviceLabel(device: ArchivedDevice | null, runner: string): string {
	if (!device) return runner;
	// A device runner's runner names the device, where early runs' device facts cannot tell an
	// iPad from a Mac. A run in Playwright names this machine.
	const name = runner === PLAYWRIGHT ? (device.name.split(',')[0] ?? runner) : runner;
	return `${name}, ${device.browser}`;
}

/**
 * The rows of the results page that a record gives: one for each null3D page of a runner that ran
 * a three.js page of the same scene. Each compares null3D with three.js's renderer that took the
 * least time in each measure.
 */
export function resultRows(record: ArchiveRecord): ResultRow[] {
	const date = parseRunName(record.run)?.date ?? '';
	const rows: ResultRow[] = [];
	for (const [runner, { device, pages = [] }] of Object.entries(record.runners ?? {})) {
		for (const page of pages) {
			if (!page.againstThree || TIMING_PAGE.test(page.page)) continue;
			const { wholeFrame, ownWork } = page.againstThree;
			const three = pages.find(
				(other) =>
					other.page === wholeFrame?.page && other.scene === page.scene && other.jobs === page.jobs,
			);
			const n = page.n;
			rows.push({
				table: resultTable(page.scene, n),
				date,
				cells: [
					date,
					deviceLabel(device, runner),
					pathText(page.page) + (page.jobs ? `, ${page.jobs} job workers` : ''),
					n === undefined ? 'n/a' : n.toLocaleString('en-US'),
					wholeFrame
						? `${ms(page.cpuMs.median)} / ${ms(wholeFrame.threeMs)} (${rendererText(wholeFrame.page)})`
						: `${ms(page.cpuMs.median)} / n/a`,
					percent(wholeFrame?.share),
					ownWork
						? `${ms(page.ownWorkMs)} / ${ms(ownWork.threeMs)} (${rendererText(ownWork.page)})`
						: `${ms(page.ownWorkMs)} / n/a`,
					percent(ownWork?.share),
					`${fps(page.presentedFps)} / ${fps(three?.presentedFps)}`,
					ms(page.gpuMs),
					record.commit ? record.commit.slice(0, 8) : 'unknown',
					record.run,
				],
			});
		}
	}
	return rows;
}

/** A row as a line of a Markdown table. */
export const rowLine = (cells: readonly string[]) => `| ${cells.join(' | ')} |`;
