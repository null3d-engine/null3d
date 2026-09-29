// Plans for the runner page, how each page's result is judged, and how a runner's results add up
// to a report. A plan item says which page to open with which switches, and what to check in the
// page's result.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	BASELINE_PAIR,
	type BenchPageKind,
	compareFrames,
	comparisonName,
	decodeHoldResult,
	differenceText,
	gpuApiOf,
	gpuApiOfPage,
	type HoldFrame,
	holdPagePath,
	JOBS_PAGES,
	PARITY_SCENES,
	TIERS as PARITY_TIERS,
	type PagePair,
	type ParityScene,
	pagePath,
	parityFiles,
	passesWithBaseline,
	SCENE_CODE,
	type StoredBaselines,
	TIER_PAIRS,
} from '../../bench/lib/parity.ts';
import {
	type BenchResult,
	benchReport,
	type SummaryRow,
	summarizeRuns,
} from '../../bench/lib/report.ts';
import {
	groupSamples,
	judgeLoad,
	STARTUP_LEGEND,
	type StartupResult,
	startupProblems,
	startupTable,
} from '../../bench/lib/startup.ts';
import { MEASURE_SECONDS, WARMUP_SECONDS } from '../../bench/scenes/spec.ts';
import { IMAGE_RUNS } from '../image/manifest.ts';
import {
	ENGINE_MODES,
	type EngineMode,
	type EngineResult,
	engineProblems,
	jobWorkersProblem,
} from './engine-checks.ts';
import { type HarnessDirs, type ImageRun, imageProblems } from './images.ts';
import { type Load, type LoadKind, loadPath, runnerKey } from './load-routes.ts';
import { failureText, type ItemResult, lastSteps, type PlanItem, slug } from './runs.ts';

/** The GPU interface that a page draws with. */
export type Tier = 'webgpu' | 'webgl2';

export type Check =
	| { kind: 'capabilities' }
	| { kind: 'capabilities-reload'; first: string }
	| { kind: 'isolation' }
	| { kind: 'image'; run: ImageRun }
	| { kind: 'shaders' }
	| { kind: 'engine'; tier: Tier; mode: EngineMode }
	| { kind: 'restarts'; mode: EngineMode }
	| { kind: 'memory'; maximumMiB: number }
	| { kind: 'room'; maximumMiB: number }
	| { kind: 'uploads'; tier: Tier }
	| { kind: 'hold'; tier: Tier }
	| { kind: 'parity'; tier: Tier; scene: ParityScene; pair: PagePair }
	| { kind: 'bench'; tier: Tier; scene: ParityScene; page: BenchPageKind; jobs?: number }
	/** A load of the startup build; `first` marks the first warm load, which fills the cache. */
	| { kind: 'startup'; mode: EngineMode; load: LoadKind; first?: true };

/** What judging can reach besides the result itself. */
export interface JudgeContext {
	/** Another item's result from the same runner in the same run. */
	resultOf(id: string): ItemResult | undefined;
	/** The folder for images that judging saves, such as parity diffs. */
	imageDir: string;
	/** Baselines measured on a device that draws with both of three.js's renderers. */
	storedBaselines?: StoredBaselines;
	/** Records a finding that neither passes nor fails the result, such as a changed list order. */
	note?(text: string): void;
	/** The runner whose results these are, and its device, where image tests find their references. */
	runner?: { name: string; device: string };
	/** Where image tests find references and save candidates, when not in the repository's folders. */
	harnessDirs?: HarnessDirs;
}

const TEST_PAGES = '/tests/pages/';
const TIERS: readonly Tier[] = ['webgpu', 'webgl2'];
/** How long a benchmark page may take to publish its hold frame on a slow device. */
const HOLD_TIMEOUT_SECONDS = 60;
/** How long the restart page may take: up to ten starts and stops, and two counts of the room. */
const RESTARTS_TIMEOUT_SECONDS = 120;

/** The result text of an item that the runner page never reached. */
export const NO_RESULT = 'no result; the runner stopped before this page';

/**
 * The runner page's item for a test page with these switches, of which empty ones are left out. With
 * a load, the page comes from the production build, under that load's address prefix.
 */
function pageItem(
	id: string,
	page: string,
	check: Check,
	{
		switches = [],
		timeoutSeconds = 30,
		load,
	}: { switches?: readonly string[]; timeoutSeconds?: number; load?: Load } = {},
): PlanItem<Check> {
	const query = switches.filter(Boolean).join('&');
	const file = `${TEST_PAGES}${page}.html${query ? `?${query}` : ''}`;
	return {
		id,
		path: load ? loadPath(load, file.slice(1)) : file,
		timeoutSeconds,
		check,
	};
}

/**
 * The runner page's item for the engine test page with these switches, measured for 2 seconds: the
 * development page, or with a load, the production build.
 */
function engineItem(
	id: string,
	switches: readonly string[],
	check: Check,
	load?: Load,
): PlanItem<Check> {
	return pageItem(id, 'engine', check, {
		switches: [...switches, 'seconds=2'],
		timeoutSeconds: 45,
		load,
	});
}

/** Switches of a timed run of a benchmark page, each left out when undefined. */
export interface BenchSwitches {
	/** The warm-up and the measured seconds, or undefined for the protocol's times. */
	seconds?: number;
	/** The instance count, or undefined for the scene's default. */
	n?: number;
	/** The job workers a null3D page starts, or undefined for the engine's own count. */
	jobs?: number;
}

/**
 * The runner page's item for a timed run of one benchmark page, S1 unless `scene` names another.
 * The item needs the GPU interface the page draws with, so a device that lacks it skips the page.
 */
export function benchItem(
	id: string,
	page: BenchPageKind,
	{ seconds, n, jobs }: BenchSwitches = {},
	scene: ParityScene = 's1',
): PlanItem<Check> {
	const switches = Object.entries({ seconds, n, jobs }).flatMap(([name, value]) =>
		value === undefined ? [] : [`${name}=${value}`],
	);
	const tier = gpuApiOfPage(page);
	return {
		id,
		path: pagePath(scene, page, switches.join('&')),
		timeoutSeconds: (seconds === undefined ? WARMUP_SECONDS + MEASURE_SECONDS : 2 * seconds) + 60,
		check: { kind: 'bench', tier, scene, page, ...(jobs !== undefined && { jobs }) },
	};
}

/** The checks plan's first load of the capabilities page, which its last load is compared with. */
const CAPABILITIES = 'capabilities';

/** The name of the checks plan's item for one run of the image test manifest. */
const imageItemId = (runId: string) => `image-${runId}`;

/** The runner page's item for one run of the image test manifest. */
function imageItem(run: ImageRun): PlanItem<Check> {
	return {
		id: imageItemId(run.id),
		path: run.path,
		timeoutSeconds: run.timeoutSeconds,
		check: { kind: 'image', run },
	};
}

/**
 * The production build of the engine test page, which the checks plan runs in every mode, under one
 * address prefix of the runner's own. A production build bundles the engine into shared files, so
 * some faults show only there. On WebGL2, which every device has.
 */
const PRODUCTION_BUILD: Load = { kind: 'warm', key: runnerKey('production') };

/**
 * The browser checks: the capability report, isolation, every run of the image test manifest, the
 * engine in every mode on both GPU paths, and again on the production build, and the engine
 * started and stopped again and again in every mode. The capabilities page loads again last, so its
 * extension answers can be compared across loads.
 */
export function checksPlan(): PlanItem<Check>[] {
	return [
		pageItem(CAPABILITIES, 'capabilities', { kind: 'capabilities' }),
		pageItem('isolation', 'isolation', { kind: 'isolation' }),
		pageItem('shaders', 'shaders', { kind: 'shaders' }),
		pageItem('uploads', 'uploads', { kind: 'uploads', tier: 'webgpu' }, { timeoutSeconds: 90 }),
		...IMAGE_RUNS.map(imageItem),
		...TIERS.flatMap((tier) =>
			ENGINE_MODES.map((mode) =>
				engineItem(`engine-${tier}-${slug(mode.name)}`, [`gpu=${tier}`, mode.query], {
					kind: 'engine',
					tier,
					mode,
				}),
			),
		),
		...ENGINE_MODES.map((mode) =>
			engineItem(
				`engine-production-${slug(mode.name)}`,
				['gpu=webgl2', mode.query],
				{ kind: 'engine', tier: 'webgl2', mode },
				PRODUCTION_BUILD,
			),
		),
		...ENGINE_MODES.map((mode) =>
			pageItem(
				`restarts-${slug(mode.name)}`,
				'shared-memory',
				{ kind: 'restarts', mode },
				{ switches: [mode.query], timeoutSeconds: RESTARTS_TIMEOUT_SECONDS },
			),
		),
		pageItem(`${CAPABILITIES}-reload`, 'capabilities', {
			kind: 'capabilities-reload',
			first: CAPABILITIES,
		}),
	];
}

/** The name of the parity plan's item for one scene's hold page of one kind. */
const parityItemId = (scene: ParityScene, kind: string) => `parity-${scene}-${kind}`;

/**
 * The benchmark scenes' hold frames from null3D and three.js on every GPU tier. Each three.js
 * page must publish a frame. Each null3D page must match the three.js page of its tier from the
 * same run, which judging compares. Compatibility mode needs WebGPU, and it shares core WebGPU's
 * three.js page, which the plan opens once.
 */
export function parityPlan(): PlanItem<Check>[] {
	const items = PARITY_SCENES.flatMap((scene) =>
		PARITY_TIERS.flatMap((parityTier) => {
			const pair = TIER_PAIRS[parityTier];
			const tier = gpuApiOf(parityTier);
			return [
				{
					id: parityItemId(scene, pair.reference),
					path: holdPagePath(scene, pair.reference),
					timeoutSeconds: HOLD_TIMEOUT_SECONDS,
					check: { kind: 'hold' as const, tier },
				},
				{
					id: parityItemId(scene, pair.candidate),
					path: holdPagePath(scene, pair.candidate),
					timeoutSeconds: HOLD_TIMEOUT_SECONDS,
					check: { kind: 'parity' as const, tier, scene, pair },
				},
			];
		}),
	);
	return items.filter((item, index) => items.findIndex(({ id }) => id === item.id) === index);
}

/** Fresh runs of each benchmark page in the bench plan, as the benchmark protocol asks. */
export const BENCH_RUNS = 5;
/** The pages the bench plan compares, unless the plan names others. */
const BENCH_PAGES: readonly BenchPageKind[] = [
	'null3d-webgpu',
	'null3d-webgl2',
	'null3d-webgpu-low',
	'null3d-webgl2-low',
	'threejs-webgpu',
	'threejs-webgl',
	SCENE_CODE,
];

/** Settings a plan may take from the command line. */
export interface PlanSettings {
	/** The instance count of the benchmark pages, or undefined for the scene's default. */
	count?: number;
	/** Fresh runs of each benchmark page, or loads at each memory maximum; undefined for the plan's own number. */
	runs?: number;
	/** Job worker counts, at each of which the bench plan runs the null3D pages instead. */
	jobs?: readonly number[];
	/** The bench plan's pages, or undefined for its usual pages, or null3D's two GPU paths with jobs. */
	pages?: readonly BenchPageKind[];
	/** The bench plan's scenes, or undefined for S1. */
	scenes?: readonly ParityScene[];
	/** The bench plan's warm-up and measured seconds, each, or undefined for the protocol's. */
	seconds?: number;
}

/**
 * The benchmark protocol in browsers that Playwright cannot drive: `runs` fresh runs of each page
 * of each scene, each a 5-second warm-up and 30 measured seconds, or `seconds` of each, with
 * `count` instances when given. With job worker counts, each run times the pages once at each count, and the pages are
 * null3D's two GPU paths unless the settings name others. The pages take turns run by run, so a
 * device that slows as it warms up slows every page alike.
 */
export function benchPlan({
	count,
	runs = BENCH_RUNS,
	jobs,
	pages,
	scenes = ['s1'],
	seconds,
}: PlanSettings = {}): PlanItem<Check>[] {
	const kinds = pages ?? (jobs ? JOBS_PAGES : BENCH_PAGES);
	const runsOfPages = jobs
		? jobs.flatMap((workers) => kinds.map((page) => ({ page, jobs: workers })))
		: kinds.map((page) => ({ page, jobs: undefined }));
	return Array.from({ length: runs }, (_, run) =>
		scenes.flatMap((scene) =>
			runsOfPages.map(({ page, jobs: workers }) =>
				benchItem(
					`bench-${scene}-${page}${workers === undefined ? '' : `-jobs${workers}`}-${run + 1}`,
					page,
					{ n: count, jobs: workers, seconds },
					scene,
				),
			),
		),
	).flat();
}

/** The shared memory maximums that the memory plan tries, in MiB, from low to high. */
export const MEMORY_MAXIMUMS_MIB = [256, 512, 1024, 2048, 4096] as const;
/** Loads of the engine page at each maximum in the memory plan. */
export const MEMORY_LOADS = 20;
/** WebAssembly memory comes in pages of 64 KiB, 16 to a MiB. */
const PAGES_PER_MIB = 16;
/** How long the shared memory page may take to count its room twice, a few seconds apart. */
const ROOM_TIMEOUT_SECONDS = 60;
/** The most memories the shared memory page counts; a browser with room for this many has more. */
const MOST_COUNTED = 64;

/**
 * At each shared memory maximum, from low to high, counts how many memories with that maximum the
 * browser holds at once, as engines that fit on one page, on the shared memory test page. Then it
 * loads the engine test page `runs` times, on the GPU path that the browser picks. A load passes
 * when the engine starts with the threaded build, the one whose shared memory has the maximum.
 */
export function memoryPlan({ runs = MEMORY_LOADS }: PlanSettings = {}): PlanItem<Check>[] {
	return MEMORY_MAXIMUMS_MIB.flatMap((maximumMiB) => [
		pageItem(
			`room-${maximumMiB}`,
			'shared-memory',
			{ kind: 'room', maximumMiB },
			{
				switches: ['kinds=dropped', 'cycles=1', `maximum=${maximumMiB * PAGES_PER_MIB}`],
				timeoutSeconds: ROOM_TIMEOUT_SECONDS,
			},
		),
		...Array.from({ length: runs }, (_, load) =>
			engineItem(`memory-${maximumMiB}-${load + 1}`, [`memory=${maximumMiB}`], {
				kind: 'memory',
				maximumMiB,
			}),
		),
	]);
}

/** Cold and warm loads of each thread mode in the startup plan, unless the plan names another number. */
export const STARTUP_RUNS = 5;
/** How long a startup load may take on a slow device. */
const STARTUP_TIMEOUT_SECONDS = 60;
/** The engine page's measured time after its first frame: short, as a load needs only its start. */
const STARTUP_SECONDS = 0.2;

/**
 * The runner page's item for one startup load of the engine test page in `mode`, on the GPU path
 * that the engine picks. The load's key names the run and the runner, which the runner page fills
 * in, so no runner loads under another's addresses or an earlier run's. Cold loads each have their
 * own key; warm loads share their mode's key, so they repeat the first warm load's addresses.
 */
function startupItem(mode: EngineMode, load: LoadKind, run: number | 'first'): PlanItem<Check> {
	const name = `${slug(mode.name)}-${load}`;
	const key = runnerKey(load === 'cold' ? `${name}-${run}` : name);
	return pageItem(
		`startup-${name}-${run}`,
		'engine',
		{ kind: 'startup', mode, load, ...(run === 'first' && { first: true as const }) },
		{
			switches: [`seconds=${STARTUP_SECONDS}`, mode.query],
			timeoutSeconds: STARTUP_TIMEOUT_SECONDS,
			load: { kind: load, key },
		},
	);
}

/**
 * The engine test page's start from navigation to its first frame, on the production build, in
 * each thread mode. The first warm load of each mode fills the browser's cache. Then each run loads
 * every mode cold and warm, so the modes take turns as the device warms up.
 */
export function startupPlan({ runs = STARTUP_RUNS }: PlanSettings = {}): PlanItem<Check>[] {
	return [
		...ENGINE_MODES.map((mode) => startupItem(mode, 'warm', 'first')),
		...Array.from({ length: runs }, (_, run) =>
			ENGINE_MODES.flatMap((mode) => [
				startupItem(mode, 'cold', run + 1),
				startupItem(mode, 'warm', run + 1),
			]),
		).flat(),
	];
}

export const PLANS: Readonly<Record<string, (settings?: PlanSettings) => PlanItem<Check>[]>> = {
	checks: checksPlan,
	parity: parityPlan,
	bench: benchPlan,
	memory: memoryPlan,
	startup: startupPlan,
};

/**
 * The starts of the errors that mean the browser offers no WebGPU at all: the engine's, and those
 * of the three.js pages.
 */
const NO_WEBGPU_ERRORS = [
	'no WebGPU adapter',
	'E1301',
	'This browser has no WebGPU',
	'three.js could not start WebGPU',
];

/** The starts of the errors that mean the browser offers no WebGL2: the test pages' and the engine's. */
const NO_WEBGL2_ERRORS = ['no WebGL2 context', 'E1301'];

/** The GPU paths a device may lack: a page that needs one it lacks is a skip, not a failure. */
export type MissingAllowed = Readonly<Record<Tier, boolean>>;

/** Nothing may be missing: every page must run. */
export const NONE_MISSING: MissingAllowed = { webgpu: false, webgl2: false };

/**
 * The GPU path a check needs, which a device may lack: its tier, or WebGL2 for the shaders page,
 * which compiles the GLSL programs there.
 */
export function neededPath(check: Check): Tier | undefined {
	if (check.kind === 'image') return gpuApiOf(check.run.tier);
	if ('tier' in check) return check.tier;
	return check.kind === 'shaders' ? 'webgl2' : undefined;
}

/** True when a page failed because the browser lacks the GPU path `path` altogether. */
function missingPath(path: Tier, error: string | undefined): boolean {
	const starts = path === 'webgpu' ? NO_WEBGPU_ERRORS : NO_WEBGL2_ERRORS;
	return error !== undefined && starts.some((start) => error.startsWith(start));
}

/**
 * How much three.js's two renderers differ on a scene's hold frame: in the same run when both drew
 * it, or else as stored from a device that draws with both.
 */
function baselineShare(
	scene: ParityScene,
	context: JudgeContext,
): { share: number; stored: boolean } | null {
	try {
		const webgl = context.resultOf(parityItemId(scene, BASELINE_PAIR.candidate));
		const webgpu = context.resultOf(parityItemId(scene, BASELINE_PAIR.reference));
		if (webgl?.ok && webgpu?.ok)
			return {
				share: compareFrames(decodeHoldResult(webgl), decodeHoldResult(webgpu)).share,
				stored: false,
			};
	} catch {
		// A frame that cannot be read gives no baseline from this run.
	}
	const stored = context.storedBaselines?.[scene];
	return stored === undefined ? null : { share: stored, stored: true };
}

/**
 * Compares a null3d page's hold frame with the frame of its three.js page from the same run, and
 * saves both frames and the diff image in the context's image folder.
 */
function parityProblems(
	check: Extract<Check, { kind: 'parity' }>,
	result: ItemResult,
	context: JudgeContext | undefined,
): string[] {
	const referenceId = parityItemId(check.scene, check.pair.reference);
	const referenceResult = context?.resultOf(referenceId);
	if (!context || !referenceResult) return [`no result from ${referenceId} to compare with`];
	let reference: HoldFrame;
	try {
		reference = decodeHoldResult(referenceResult);
	} catch (e) {
		return [`${referenceId} has no frame to compare with: ${(e as Error).message}`];
	}
	try {
		const candidate = decodeHoldResult(result);
		const comparison = compareFrames(candidate, reference);
		const name = comparisonName(check.scene, check.pair);
		const files = parityFiles(name, candidate, reference, comparison.diff);
		mkdirSync(context.imageDir, { recursive: true });
		for (const { file, png } of files) writeFileSync(join(context.imageDir, file), png);
		const baseline = baselineShare(check.scene, context);
		if (passesWithBaseline(comparison.share, baseline?.share ?? null)) return [];
		const images = files.map(({ file }) => join(context.imageDir, file)).join(', ');
		const text = differenceText(comparison, baseline?.share ?? null, baseline?.stored);
		return [`against ${referenceId}, ${text}. Images: ${images}`];
	} catch (e) {
		return [(e as Error).message];
	}
}

/** The WebGL2 extensions a capabilities page's result asked for by name, and the browser's list. */
function extensionsOf(result: ItemResult): { byName: Record<string, boolean>; listed: string[] } {
	const report = result.report as
		| { webgl2?: { extensions?: Record<string, boolean>; supportedExtensions?: string[] } }
		| undefined;
	return {
		byName: report?.webgl2?.extensions ?? {},
		listed: report?.webgl2?.supportedExtensions ?? [],
	};
}

/** Whether the browser listed its supported extensions in the same order in two loads, as a note. */
function listOrderNote(first: readonly string[], second: readonly string[]): string {
	const sorted = (list: readonly string[]) => [...list].sort().join();
	if (first.join() === second.join())
		return 'the supported extension list came in the same order in both loads';
	return sorted(first) === sorted(second)
		? 'the supported extension list came in another order in the second load'
		: 'the supported extension list named other extensions in the second load';
}

/**
 * Compares a second load of the capabilities page with the first: every extension the engine asks
 * for by name must get the same answer in both. Brave shuffles the supported list, which the engine
 * never trusts, so a change in its order is noted and does not fail.
 */
function reloadProblems(
	check: Extract<Check, { kind: 'capabilities-reload' }>,
	result: ItemResult,
	context: JudgeContext | undefined,
): string[] {
	const firstResult = context?.resultOf(check.first);
	if (!context || !firstResult) return [`no result from ${check.first} to compare with`];
	if (!firstResult.ok)
		return [`${check.first} has no report to compare with: ${firstResult.error ?? 'it failed'}`];
	const first = extensionsOf(firstResult);
	const second = extensionsOf(result);
	context.note?.(listOrderNote(first.listed, second.listed));
	const answer = (has: boolean | undefined) =>
		has === undefined ? 'not asked for' : has ? 'present' : 'absent';
	const names = [...new Set([...Object.keys(first.byName), ...Object.keys(second.byName)])];
	return names
		.filter((name) => first.byName[name] !== second.byName[name])
		.map(
			(name) =>
				`${name} was ${answer(first.byName[name])} in the first load and ${answer(second.byName[name])} in the second`,
		);
}

/**
 * What is wrong with a runner's image from the image test manifest. Every thread mode after a
 * test's first on a tier must draw the first mode's pixels, which the same run holds.
 */
function imageRunProblems(
	{ run }: Extract<Check, { kind: 'image' }>,
	result: ItemResult,
	context: JudgeContext | undefined,
): string[] {
	if (!context?.runner) return ['no runner to find the references of'];
	const { name, device } = context.runner;
	const first = run.sameAs === undefined ? undefined : context.resultOf(imageItemId(run.sameAs));
	return imageProblems(
		run,
		result,
		{ runner: name, device },
		first?.ok ? first : undefined,
		context.harnessDirs,
	);
}

/** What the restart page reports about the engine's starts and stops. */
export interface RestartResult {
	/** Shared memories the page could hold at once before the starts, where it counted them. */
	room?: number;
	cycles: number;
	kinds: {
		engine?: { cycles: number; error?: string; trail?: string[]; roomLater?: number };
	};
}

/**
 * Room for shared memories that the page may lose over its restarts: the single-threaded build's
 * page keeps one core for the next engine.
 */
const ROOM_KEPT = 1;

/**
 * What is wrong with the restart page's result: a start or a stop that failed, or room for shared
 * memory that the browser did not get back from the stopped engines.
 */
export function restartProblems(result: RestartResult): string[] {
	const engine = result.kinds.engine;
	if (!engine) return ['the page started no engine'];
	const problems: string[] = [];
	if (engine.error)
		problems.push(
			`start and stop ${engine.cycles + 1} of ${result.cycles} failed: ${engine.error}${lastSteps(engine.trail)}`,
		);
	if (
		result.room !== undefined &&
		engine.roomLater !== undefined &&
		engine.roomLater < result.room - ROOM_KEPT
	)
		problems.push(
			`the browser did not get back the memory of stopped engines: it had room for ${result.room} shared memories before ${engine.cycles} starts and stops, and for ${engine.roomLater} after`,
		);
	return problems;
}

/**
 * What is wrong with a page's result; empty when nothing is. A check whose GPU path the browser
 * lacks is a skip when `missing` allows it: some devices have no WebGPU in any browser, and some
 * virtual machines give a browser no WebGL2. A parity check and a second load of the capabilities
 * page need the context, to reach the result that they compare with.
 */
export function judge(
	check: Check,
	result: ItemResult,
	missing: MissingAllowed,
	context?: JudgeContext,
): string[] | 'skip' {
	if (!result.ok) {
		const path = neededPath(check);
		if (path && missing[path] && missingPath(path, result.error)) return 'skip';
		return [failureText(result)];
	}
	switch (check.kind) {
		case 'capabilities':
			return [];
		case 'capabilities-reload':
			return reloadProblems(check, result, context);
		case 'isolation': {
			const problems: string[] = [];
			if (!result.crossOriginIsolated) problems.push('the page is not cross-origin isolated');
			if (!result.threaded) problems.push('the threaded build did not load');
			return problems;
		}
		case 'image':
			return imageRunProblems(check, result, context);
		case 'shaders': {
			const failures = (result.failures ?? []) as { shader: string; stage: string; log: string }[];
			const problems = failures.map((f) => `${f.shader} ${f.stage}: ${f.log.split('\n')[0]}`);
			if (!(Number(result.glslPrograms) > 0)) problems.push('no GLSL program was compiled');
			if (!result.webgpu && !missing.webgpu) problems.push('no WebGPU to compile the WGSL');
			return problems;
		}
		case 'engine':
			return engineProblems(result as unknown as EngineResult, check.mode, check.tier);
		case 'restarts':
			return restartProblems(result as unknown as RestartResult);
		case 'memory':
			return (result.mode as { build?: string } | undefined)?.build === 'threaded'
				? []
				: ['the engine started without shared memory, so the load tested no maximum'];
		case 'room':
			return typeof result.room === 'number' ? [] : ['the page did not count its room'];
		case 'uploads': {
			const sizes = (result.sizes ?? []) as number[];
			const frames = (result.frames ?? []) as { wrong: number[]; errors?: string[] }[];
			if (frames.length === 0) return ['the page uploaded nothing'];
			return [
				...frames.flatMap(({ wrong, errors = [] }, frame) => [
					...errors.map((error) => `frame ${frame}: WebGPU error: ${error}`),
					...wrong.flatMap((count, upload) =>
						count > 0
							? [`frame ${frame}: ${count} wrong bytes in the upload of ${sizes[upload]} bytes`]
							: [],
					),
				]),
				...((result.uncaptured ?? []) as string[]).map((error) => `WebGPU error: ${error}`),
			];
		}
		case 'bench': {
			const frames = Number(result.frames ?? 0);
			const cpu = (result.cpuMs as { median?: number } | undefined)?.median ?? 0;
			const workers = (result.mode as { jobWorkers?: number } | undefined)?.jobWorkers;
			const jobs = jobWorkersProblem(workers, check.jobs);
			// The scene-code page's work can take less than one step of the browser's timer, as in S2.
			const timed = cpu > 0 || check.page === SCENE_CODE;
			return [
				...(frames > 0 ? [] : ['the run measured no frames']),
				...(frames > 0 && !timed ? ['the run recorded no CPU time'] : []),
				...(jobs ? [jobs] : []),
			];
		}
		case 'hold':
			try {
				decodeHoldResult(result);
				return [];
			} catch (e) {
				return [(e as Error).message];
			}
		case 'parity':
			return parityProblems(check, result, context);
		case 'startup':
			return startupProblems(result as StartupResult, check.mode);
	}
}

/**
 * The benchmark report of one runner's results: each page's runs summarized, apart for each job
 * worker count. Undefined when the plan has no benchmarks.
 */
export function benchSummary(
	items: readonly PlanItem<Check>[],
	resultOf: (id: string) => ItemResult | undefined,
): string | undefined {
	const groups = new Map<string, Omit<SummaryRow, 'summary'> & { results: BenchResult[] }>();
	for (const item of items) {
		if (item.check.kind !== 'bench') continue;
		const { scene, page, jobs } = item.check;
		const key = `${scene} ${page} ${jobs ?? ''}`;
		const group = groups.get(key) ?? { scene, kind: page, jobs, results: [] };
		const result = resultOf(item.id);
		if (result?.ok) group.results.push(result as unknown as BenchResult);
		groups.set(key, group);
	}
	if (groups.size === 0) return undefined;
	const rows: SummaryRow[] = [...groups.values()]
		.filter((group) => group.results.length > 0)
		.map(({ results, ...row }) => ({ ...row, summary: summarizeRuns(results) }));
	return benchReport(rows).join('\n');
}

/**
 * The startup report of one runner's results: the medians of each thread mode's cold and warm loads,
 * as a Markdown table with what its columns mean. A load that failed its check stays out, and so
 * does the first warm load of each mode, which fills the cache. Undefined when the plan has no loads.
 */
export function startupSummary(
	items: readonly PlanItem<Check>[],
	resultOf: (id: string) => ItemResult | undefined,
): string | undefined {
	const loads = items.flatMap(({ id, check }) => {
		if (check.kind !== 'startup' || check.first) return [];
		const result = resultOf(id) as StartupResult | undefined;
		const sample = result && judgeLoad(result, check.mode).sample;
		return [{ labels: [check.mode.name, check.load], sample }];
	});
	if (loads.length === 0) return undefined;
	return [
		...startupTable(['Thread mode', 'Load'], groupSamples(loads)),
		'',
		...STARTUP_LEGEND,
	].join('\n');
}

/** What the loads at one shared memory maximum came to. */
interface MemoryTally {
	loads: number;
	started: number;
	/** How many loads failed for each reason. */
	failures: Map<string, number>;
}

/** How many shared memories with a maximum fit at once, as the room item counted them. */
function roomText(result: ItemResult | undefined): string {
	if (typeof result?.room !== 'number') return 'not counted';
	return result.room >= MOST_COUNTED ? `${MOST_COUNTED} or more` : String(result.room);
}

/**
 * How many loads at each shared memory maximum started the engine, and how many engines' memories
 * fit at once at that maximum, as a Markdown table, with the largest maximum at which every load
 * started the engine. A failed allocation fails its load, and so does a load without a result, as
 * after the browser closed the runner's tab. Undefined when the plan has no memory items.
 */
export function memorySummary(
	items: readonly PlanItem<Check>[],
	resultOf: (id: string) => ItemResult | undefined,
): string | undefined {
	const tallies = new Map<number, MemoryTally>();
	const rooms = new Map<number, string>();
	for (const { id, check } of items) {
		if (check.kind !== 'memory' && check.kind !== 'room') continue;
		const tally = tallies.get(check.maximumMiB) ?? { loads: 0, started: 0, failures: new Map() };
		tallies.set(check.maximumMiB, tally);
		const result = resultOf(id);
		if (check.kind === 'room') {
			rooms.set(check.maximumMiB, roomText(result));
			continue;
		}
		tally.loads++;
		const verdict = result ? judge(check, result, NONE_MISSING) : [NO_RESULT];
		const problems = verdict === 'skip' ? ['skipped'] : verdict;
		if (problems.length === 0) tally.started++;
		for (const problem of problems)
			tally.failures.set(problem, (tally.failures.get(problem) ?? 0) + 1);
	}
	if (tallies.size === 0) return undefined;
	const lines = [
		'| Memory maximum | Loads that started the engine | Engines that fit at once | Why the other loads failed |',
		'| --- | --- | --- | --- |',
	];
	let largest: [number, MemoryTally] | undefined;
	for (const [maximumMiB, tally] of [...tallies].sort(([a], [b]) => a - b)) {
		const why = [...tally.failures].map(
			([problem, loads]) => `${loads} ${loads === 1 ? 'load' : 'loads'}: ${problem}`,
		);
		const started = tally.loads > 0 ? `${tally.started} of ${tally.loads}` : 'not loaded';
		const room = rooms.get(maximumMiB) ?? 'not counted';
		lines.push(`| ${maximumMiB} MiB | ${started} | ${room} | ${why.join('; ') || 'none'} |`);
		if (tally.loads > 0 && tally.started === tally.loads) largest = [maximumMiB, tally];
	}
	lines.push(
		'',
		largest
			? `The largest maximum that loaded ${largest[1].loads} of ${largest[1].loads} times: ${largest[0]} MiB.`
			: 'No maximum loaded every time.',
	);
	return lines.join('\n');
}
