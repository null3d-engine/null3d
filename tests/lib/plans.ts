// Plans for the runner page, how each page's result is judged, and how a runner's results add up
// to a report. A plan item says which page to open with which switches, and what to check in the
// page's result.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	BASELINE_PAIR,
	type BenchPageKind,
	type BenchScene,
	compareFrames,
	comparisonName,
	decodeHoldResult,
	differenceText,
	gpuApiOf,
	gpuApiOfPage,
	type HoldFrame,
	holdPagePath,
	isNull3dPage,
	JOBS_PAGES,
	PARITY_SCENES,
	TIERS as PARITY_TIERS,
	type PagePair,
	pagePath,
	parityFiles,
	passesWithBaseline,
	REFERENCE_PRESET_SWITCH,
	SCENE_CODE,
	type StoredBaselines,
	TIER_PAIRS,
} from '../../bench/lib/parity.ts';
import {
	type BenchResult,
	benchReport,
	type SummaryRow,
	summaryRow,
	type VisualFigures,
} from '../../bench/lib/report.ts';
import {
	groupSamples,
	judgeLoad,
	STARTUP_LEGEND,
	type StartupResult,
	startupProblems,
	startupTable,
} from '../../bench/lib/startup.ts';
import { SCENE_COUNTS, visualPagePath } from '../../bench/lib/visual.ts';
import {
	SOAK_SAMPLE_SECONDS,
	SOAK_TABLE_HEAD,
	type SoakMode,
	type SoakReport,
	soakProblems,
	soakRow,
} from '../../bench/pages/lib/device-soak.ts';
import { MEASURE_SECONDS, WARMUP_SECONDS } from '../../bench/scenes/spec.ts';
import { DEMOS } from '../../examples/demos.ts';
import { everyShader } from '../../packages/engine/src/generated/shaders.ts';
import { STOP_TIMEOUT_MS } from '../../packages/engine/src/page/stop-jobs.ts';
import {
	choosePreset,
	type DeviceHints,
	deviceKind,
} from '../../packages/engine/src/quality/chooser.ts';
import type { Tier as EngineTier } from '../../packages/engine/src/shared/tier.ts';
import { sampleUrl } from '../../tools/lib/sample-url.ts';
import { IMAGE_RUNS, manifestRun } from '../image/manifest.ts';
import { type AnimationResult, animationProblems } from '../pages/lib/animation.ts';
import { distanceLabel, PRECISION, type PrecisionFacts } from '../pages/lib/depth-precision.ts';
import {
	GOVERNOR_STAGES,
	type GovernorResult,
	type GovernorStage,
	governorSummary as governorLine,
	governorProblems,
} from '../pages/lib/governor.ts';
import { type JitterResult, jitterProblems } from '../pages/lib/jitter.ts';
import { type OcclusionTurnsResult, occlusionTurnsProblems } from '../pages/lib/occlusion.ts';
import {
	framesInFlight,
	type OverloadResult,
	type OverloadStep,
	ratesParted,
} from '../pages/lib/overload.ts';
import { ROOM_KEPT, ROOM_LOST_ONCE } from '../pages/lib/room.ts';
import { glslProgramsOf } from '../pages/lib/shader-list.ts';
import {
	frameSaving,
	pathTiming,
	SKINNING_CASCADES,
	SKINNING_CHARACTERS,
	type SkinningGpu,
	type SkinningPath,
	type SkinningResult,
	skinningPaths,
	skinningProblems,
} from '../pages/lib/skinning.ts';
import {
	GROWTH_TABLE_HEAD,
	type GrowthKind,
	growthProblems,
	growthRow,
} from '../pages/lib/tab-memory.ts';
import { type CaptureResult, captureProblems } from './capture-checks.ts';
import {
	ENGINE_MODES,
	type EngineMode,
	type EngineResult,
	engineProblems,
	jobWorkersProblem,
	type SameCanvasResult,
	sameCanvasProblems,
	THREADED_MODES,
} from './engine-checks.ts';
import { type GeneratorResult, generatorReport } from './environment-generator-checks.ts';
import { type GpuPath, type MissingAllowed, NONE_MISSING, skippedPath } from './gpu-paths.ts';
import { borrowedRun, type HarnessDirs, type ImageRun, imageProblems } from './images.ts';
import { JITTER_TABLE_HEAD, jitterRows, saveJitterResult } from './jitter-checks.ts';
import { type Ktx2Result, ktx2FormatsNote, ktx2Problems } from './ktx2-checks.ts';
import { BENCH_BUILD, type Load, type LoadKind, loadPath, runnerKey } from './load-routes.ts';
import { type MipLevelsResult, mipLevelsNote, mipLevelsProblems } from './mip-levels-checks.ts';
import {
	type ObjectGrowthCheck,
	type ObjectGrowthResult,
	objectGrowthPlan,
	objectGrowthProblems,
} from './object-growth.ts';
import { type OcclusionS6Check, occlusionS6Plan, saveOcclusionS6Images } from './occlusion-s6.ts';
import {
	HEAVY_SPHERES,
	heavyCheckProblems,
	PRESET_CHANGE,
	PRESET_CHANGE_SWITCHES,
	type PresetChangeResult,
	type PresetMode,
	presetChangeProblems,
	roundText,
} from './preset-checks.ts';
import {
	failureText,
	type ItemResult,
	lastSteps,
	type PlanFlags,
	type PlanItem,
	slug,
} from './runs.ts';
import { type SkinPassResult, skinPassNote, skinPassProblems } from './skin-pass-checks.ts';
import { type StatsResult, statsProblems } from './stats-checks.ts';
import { progressName, REST_AFTER_TAB_END_SECONDS } from './tab-end.ts';
import {
	type TextureCacheCheck,
	type TextureCacheResult,
	textureCacheNeeds,
	textureCachePlan,
	textureCacheProblems,
} from './texture-cache.ts';
import {
	saveVisualResult,
	VISUAL_LIMITS,
	type VisualResult,
	visualProblems,
} from './visual-checks.ts';
import { type WarmUpResult, warmUpProblems } from './warm-up-checks.ts';
import {
	WARM_UP_TABLE_HEAD,
	type WarmUpLoads,
	type WarmUpTimeResult,
	warmUpTimeProblems,
	warmUpTimeRow,
} from './warm-up-time.ts';

/** The GPU interface that a page draws with. */
export type Tier = 'webgpu' | 'webgl2';

export type Check =
	| { kind: 'capabilities' }
	| { kind: 'capabilities-reload'; first: string }
	| { kind: 'isolation' }
	| { kind: 'image'; run: ImageRun }
	| { kind: 'shaders' }
	| { kind: 'shader-library'; tier: Tier }
	| { kind: 'engine'; tier: Tier; mode: EngineMode }
	| { kind: 'capture'; tier: Tier; mode: EngineMode }
	/** The KTX2 page: each file becomes the compressed format that the device supports. */
	| { kind: 'ktx2'; tier: Tier }
	/**
	 * The shared memory page: engines that start and stop on the page, or that start in frames
	 * that the page removes while they run, more of them than the browser has room for at once.
	 */
	| { kind: 'restarts'; mode: EngineMode; start: RestartStart }
	/**
	 * The failures page: engines that follow one another on one canvas, as React's StrictMode starts
	 * them, with the first start destroyed once it resolves (`then`) or cancelled (`abort`).
	 */
	| { kind: 'same-canvas'; tier: Tier; mode: EngineMode; pattern: SameCanvasPattern }
	| { kind: 'memory'; maximumMiB: number }
	| { kind: 'room'; maximumMiB: number }
	| { kind: 'uploads'; tier: Tier }
	/** The mip levels page: each way of making mip levels on WebGL2, read back level by level. */
	| { kind: 'mip-levels' }
	/** The environment generator page: the built-in room made on the GPU, read back level by level. */
	| { kind: 'environment-generator'; tier: Tier }
	/** The skinning pass page: the WebGPU skinning shader on fixed meshes, read back and drawn. */
	| { kind: 'skin-pass'; tier: Tier }
	| { kind: 'quality' }
	/** The quality page with a scene too heavy for the GPU: the preset check lowers the preset. */
	| { kind: 'preset-check' }
	/** A change of preset that needs a new pipeline draws no frame without it. */
	| { kind: 'preset-change'; tier: Tier }
	/** The warm-up page: pipelines build before the first frame, and a warm-up during play. */
	| { kind: 'warm-up'; tier: Tier }
	| { kind: 'stats'; tier: Tier }
	| { kind: 'hold'; tier: Tier }
	| { kind: 'parity'; tier: Tier; scene: BenchScene; pair: PagePair }
	| {
			kind: 'bench';
			tier: Tier;
			scene: BenchScene;
			page: BenchPageKind;
			jobs?: number;
			reflection?: ReflectionSize;
	  }
	/** The visual page of a benchmark scene: its shadow figures and frames, on one GPU path. */
	| { kind: 'visual'; tier: Tier; scene: BenchScene }
	/** The GPU-bound page, with the ?queue= setting it ran with, if any. */
	| { kind: 'overload'; tier: Tier; queue?: string }
	/** The quality governor's stress test: one stage on one GPU path. */
	| { kind: 'governor'; tier: Tier; stage: GovernorStage }
	/** A skinning page, on WebGL2 or on WebGPU's core path, with its crowd and its cascades. */
	| { kind: 'skinning'; tier: SkinningGpu; characters: number; cascades: number }
	/** The effect cost page: an effect off and on in turns, at one render scale. */
	| { kind: 'effect'; effect: CostedEffect; tier: Tier; scale: number }
	/** The environment cost page: the built-in room off and on in turns, over layers of planes. */
	| { kind: 'environment'; tier: Tier }
	/** The grass cost page: a field of blades still and swaying by their row values, in turns. */
	| { kind: 'grass'; tier: Tier }
	/** The sky map cost page: each stage of a sky map's refresh, timed on one GPU path. */
	| { kind: 'sky-map'; tier: Tier }
	/** The sky refresh page: the frames from a sun move until the sky's light follows it. */
	| { kind: 'sky-refresh'; tier: Tier }
	/**
	 * The room light page: an environment asked for during play, the built-in room or an HDR file,
	 * whose every frame must show its light; it times the load.
	 */
	| { kind: 'environment-load'; tier: Tier }
	/** The occlusion cost page: the city with software occlusion culling off and on in turns. */
	| { kind: 'occlusion' }
	/** The GPU occlusion page: frames culled against unculled, then the culling off and on in turns. */
	| { kind: 'gpu-occlusion' }
	/** The large-world jitter page: flights at the origin and far from it, on one GPU path. */
	| { kind: 'jitter'; tier: Tier }
	/** The specular shimmer page: highlight flicker against a supersampled row of the same frames. */
	| { kind: 'shimmer'; tier: Tier }
	/** The animation page, which times the core's animation step on the job workers for a crowd. */
	| { kind: 'animation'; characters: number }
	/** A load of the startup build; `first` marks the first warm load, which fills the cache. */
	| { kind: 'startup'; mode: EngineMode; load: LoadKind; first?: true }
	/** The tab memory page, which grows one kind of memory until something gives. */
	| { kind: 'tab-memory'; growth: GrowthKind; tier?: Tier; round: number }
	/** A benchmark scene played for many minutes and measured once a minute. */
	| { kind: 'soak'; tier: Tier; minutes: number }
	/** The scene page after a simulated GPU loss: the engine must draw the whole scene again. */
	| { kind: 'recovery'; tier: Tier; run: ImageRun }
	/** The warm-up time page with a scene's sketch, with fresh shaders or with those compiled before. */
	| { kind: 'warm-up-time'; tier: Tier; scene: string; fresh: boolean }
	/** A load of the texture cache page with the city's textures, with the cache off or on. */
	| TextureCacheCheck
	/** The object growth page's timing mode: the create calls that grow the scene's object tables. */
	| ObjectGrowthCheck
	/** S6's occlusion turns at one preset and one occlusion buffer size, for T-36. */
	| OcclusionS6Check;

/** What judging can reach besides the result itself. */
export interface JudgeContext {
	/** Another item's result from the same runner in the same run. */
	resultOf(id: string): ItemResult | undefined;
	/** The last progress that the judged page posted, for a page that may end its tab. */
	progress?: ItemResult;
	/** The folder for images that judging saves, such as parity diffs. */
	imageDir: string;
	/** Baselines measured on a device that draws with both of three.js's renderers. */
	storedBaselines?: StoredBaselines;
	/** Records a finding that neither passes nor fails the result, such as a changed list order. */
	note?(text: string): void;
	/** The runner whose results these are, and its device, where image tests find their references. */
	runner?: { name: string; device: string };
	/** Brave only: the state of its Shields, or null when the run did not record it. */
	braveShields?: 'on' | 'off' | null;
	/** Where image tests find references and save candidates, when not in the repository's folders. */
	harnessDirs?: HarnessDirs;
}

const TEST_PAGES = '/tests/pages/';
const TIERS: readonly Tier[] = ['webgpu', 'webgl2'];
/** How the failures page ends the first of the engines that it starts on one canvas. */
const SAME_CANVAS_PATTERNS = ['then', 'abort'] as const;
type SameCanvasPattern = (typeof SAME_CANVAS_PATTERNS)[number];
/** How long a benchmark page may take to publish its hold frame on a slow device. */
const HOLD_TIMEOUT_SECONDS = 60;
/**
 * How long the restart page may take: two rounds, each of starts and stops past the most room seen,
 * which took up to 4 minutes with their waits in Safari on CI's Mac. A round's starts may wait 30 s
 * in all for the browser to free memory, and its counts of the room 91 s for it to come back. The
 * second round runs only when the room did not come back.
 */
const RESTARTS_TIMEOUT_SECONDS = 600;
/**
 * The thread modes whose engines start in frames that the restart page removes while they run.
 * With the sketch on the main thread, Safari on a Mac still lost 1 or 2 places for shared memory in
 * some runs of 100 such frames, so that mode stays out until the cause is known.
 */
const FRAME_RESTART_MODES = THREADED_MODES.filter((mode) => mode.sketchThread === 'worker');
/**
 * The thread modes where a worker draws. When the engine stops, that worker stays with the canvas
 * for the next engine, so the restart page also stops engines whose canvas stays in the page, or
 * whose frame the page removes only after the stop, as the runner page does with every test page.
 */
const KEPT_WORKER_MODES = THREADED_MODES.filter((mode) => mode.renderThread !== 'main');

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
		ownTab = false,
	}: {
		switches?: readonly string[];
		timeoutSeconds?: number;
		load?: Load;
		ownTab?: boolean;
	} = {},
): PlanItem<Check> {
	const query = switches.filter(Boolean).join('&');
	const file = `${TEST_PAGES}${page}.html${query ? `?${query}` : ''}`;
	return {
		id,
		path: load ? loadPath(load, file.slice(1)) : file,
		timeoutSeconds,
		check,
		...(ownTab && { ownTab: true as const }),
	};
}

/**
 * The runner page's item for the engine test page with these switches, measured for 2 seconds: the
 * development page, or with a load, the production build. The engine check limits the time between
 * frames, so with that check the page's frame stays on top of the runner page's report.
 */
function engineItem(
	id: string,
	switches: readonly string[],
	check: Check,
	load?: Load,
): PlanItem<Check> {
	return {
		...pageItem(id, 'engine', check, {
			switches: [...switches, 'seconds=2'],
			timeoutSeconds: 45,
			load,
		}),
		...(check.kind === 'engine' && { timesFrames: true as const }),
	};
}

/** Switches of a timed run of a benchmark page, each left out when undefined. */
export interface BenchSwitches {
	/** The warm-up and the measured seconds, or undefined for the protocol's times. */
	seconds?: number;
	/** The instance count, or undefined for the scene's default. */
	n?: number;
	/** The job workers a null3D page starts, or undefined for the engine's own count. */
	jobs?: number;
	/** True makes a null3D page capture a PNG file of its frame after the measured seconds. */
	capture?: boolean;
	/** S1's water with a reflection pass of this share of the render size, or undefined for none. */
	reflection?: ReflectionSize;
}

/** The reflection pass's sizes that S1's `reflection` switch takes. */
export type ReflectionSize = 'quarter' | 'half' | 'full';

/**
 * The runner page's item for a timed run of one benchmark page, S1 unless `scene` names another,
 * from the production build. The item needs the GPU interface the page draws with, so a device
 * that lacks it skips the page.
 */
export function benchItem(
	id: string,
	page: BenchPageKind,
	{ seconds, n, jobs, capture, reflection }: BenchSwitches = {},
	scene: BenchScene = 's1',
): PlanItem<Check> {
	const switches = [
		...Object.entries({ seconds, n, jobs, reflection }).flatMap(([name, value]) =>
			value === undefined ? [] : [`${name}=${value}`],
		),
		...(capture ? ['capture'] : []),
	];
	const tier = gpuApiOfPage(page);
	return {
		id,
		path: loadPath(BENCH_BUILD, pagePath(scene, page, switches.join('&')).slice(1)),
		timeoutSeconds: (seconds === undefined ? WARMUP_SECONDS + MEASURE_SECONDS : 2 * seconds) + 60,
		check: {
			kind: 'bench',
			tier,
			scene,
			page,
			...(jobs !== undefined && { jobs }),
			...(reflection && { reflection }),
		},
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

/** The shaders page's time for its loads and its WGSL modules. */
const SHADERS_BASE_SECONDS = 30;

/**
 * The shaders page's time for each GLSL program it compiles: about twice what CI's Safari took per
 * program when it compiled them one after another.
 */
const SHADERS_SECONDS_PER_PROGRAM = 0.5;

/**
 * The shaders page's time, which grows with the GLSL programs that it compiles, so more shader
 * variants never make it time out. A page that stops still fails, with the last step it noted.
 */
export const SHADERS_PAGE_SECONDS = Math.ceil(
	SHADERS_BASE_SECONDS + SHADERS_SECONDS_PER_PROGRAM * glslProgramsOf(await everyShader()).length,
);

/**
 * The production build of the engine test page, which the checks plan runs in every mode, under one
 * address prefix of the runner's own. A production build bundles the engine into shared files, so
 * some faults show only there. On WebGL2, which every device has.
 */
const PRODUCTION_BUILD: Load = { kind: 'warm', key: runnerKey('production') };

/**
 * The browser checks: the capability report, isolation, the shader library's values on both GPU
 * paths, every run of the image test manifest, the compressed formats of KTX2 files on both GPU
 * paths, the engine in every mode on both GPU paths, and again on the production build, the
 * threaded modes with wake messages in place of Atomics.waitAsync, a frame captured as a PNG file
 * in every mode on both GPU paths, and the engine started and stopped again and again in every
 * mode. The capabilities page loads again last, so its extension answers can be compared across
 * loads.
 */
export function checksPlan(): PlanItem<Check>[] {
	return [
		pageItem(CAPABILITIES, 'capabilities', { kind: 'capabilities' }),
		pageItem('isolation', 'isolation', { kind: 'isolation' }),
		pageItem('shaders', 'shaders', { kind: 'shaders' }, { timeoutSeconds: SHADERS_PAGE_SECONDS }),
		...TIERS.map((tier) =>
			pageItem(
				`shader-library-${tier}`,
				'shader-library',
				{ kind: 'shader-library', tier },
				{ switches: [`gpu=${tier}`] },
			),
		),
		pageItem('uploads', 'uploads', { kind: 'uploads', tier: 'webgpu' }, { timeoutSeconds: 90 }),
		pageItem('mip-levels', 'mip-levels', { kind: 'mip-levels' }),
		...(['webgpu', 'compat', 'webgl2'] as const).map((path) =>
			pageItem(
				`environment-generator-${path}`,
				'environment-generator',
				{ kind: 'environment-generator', tier: path === 'webgl2' ? 'webgl2' : 'webgpu' },
				{ switches: [`gpu=${path}`], timeoutSeconds: 120 },
			),
		),
		...(['webgpu', 'compat'] as const).map((path) =>
			pageItem(
				`skin-pass-${path}`,
				'skin-pass',
				{ kind: 'skin-pass', tier: 'webgpu' },
				{ switches: [`gpu=${path}`] },
			),
		),
		// The device's own check each run, never one that an earlier run stored.
		pageItem('quality', 'quality', { kind: 'quality' }, { switches: ['check=fresh'] }),
		...TIERS.map((tier) =>
			pageItem(
				`preset-change-${tier}`,
				'preset-change',
				{ kind: 'preset-change', tier },
				{ switches: [`gpu=${tier}`, ...PRESET_CHANGE_SWITCHES] },
			),
		),
		...TIERS.map((tier) =>
			pageItem(
				`warm-up-${tier}`,
				'warm-up',
				{ kind: 'warm-up', tier },
				{ switches: [`gpu=${tier}`] },
			),
		),
		pageItem(
			'warm-up-webgl2-compile-wait',
			'warm-up',
			{ kind: 'warm-up', tier: 'webgl2' },
			{ switches: ['gpu=webgl2', 'compile=wait'] },
		),
		...TIERS.map((tier) =>
			pageItem(`stats-${tier}`, 'stats', { kind: 'stats', tier }, { switches: [`gpu=${tier}`] }),
		),
		...IMAGE_RUNS.map(imageItem),
		...TIERS.map((tier) =>
			pageItem(
				`ktx2-${tier}`,
				'ktx2-files',
				{ kind: 'ktx2', tier },
				{ switches: [`gpu=${tier}`], timeoutSeconds: 60 },
			),
		),
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
		...THREADED_MODES.map((mode) =>
			engineItem(
				`engine-wake-message-${slug(mode.name)}`,
				['gpu=webgl2', 'wake=message', mode.query],
				{ kind: 'engine', tier: 'webgl2', mode },
			),
		),
		...TIERS.flatMap((tier) =>
			ENGINE_MODES.map((mode) =>
				pageItem(
					`capture-${tier}-${slug(mode.name)}`,
					'capture',
					{ kind: 'capture', tier, mode },
					{ switches: [`gpu=${tier}`, mode.query] },
				),
			),
		),
		...ENGINE_MODES.map((mode) =>
			pageItem(
				`restarts-${slug(mode.name)}`,
				'shared-memory',
				{ kind: 'restarts', mode, start: 'engine' },
				{ switches: [mode.query], timeoutSeconds: RESTARTS_TIMEOUT_SECONDS },
			),
		),
		...FRAME_RESTART_MODES.map((mode) =>
			pageItem(
				`frame-restarts-${slug(mode.name)}`,
				'shared-memory',
				{ kind: 'restarts', mode, start: 'frame' },
				{
					switches: ['kinds=frame', mode.query],
					timeoutSeconds: RESTARTS_TIMEOUT_SECONDS,
					ownTab: true,
				},
			),
		),
		...TIERS.flatMap((tier) =>
			ENGINE_MODES.flatMap((mode) =>
				SAME_CANVAS_PATTERNS.map((pattern) =>
					pageItem(
						`same-canvas-${tier}-${slug(mode.name)}-${pattern}`,
						'failures',
						{ kind: 'same-canvas', tier, mode, pattern },
						{
							switches: ['case=same-canvas', `pattern=${pattern}`, `gpu=${tier}`, mode.query],
							timeoutSeconds: 60,
						},
					),
				),
			),
		),
		...KEPT_WORKER_MODES.flatMap((mode) =>
			(['canvas-kept', 'frame-destroyed'] as const).map((start) =>
				pageItem(
					`${start}-restarts-${slug(mode.name)}`,
					'shared-memory',
					{ kind: 'restarts', mode, start },
					{
						switches: [`kinds=${start}`, mode.query],
						timeoutSeconds: RESTARTS_TIMEOUT_SECONDS,
						ownTab: start === 'frame-destroyed',
					},
				),
			),
		),
		pageItem(`${CAPABILITIES}-reload`, 'capabilities', {
			kind: 'capabilities-reload',
			first: CAPABILITIES,
		}),
	];
}

/**
 * The image tests of the smoke plan: one for each main feature of the engine's drawing. Each one
 * runs on every GPU tier, in its first thread mode.
 */
export const SMOKE_IMAGE_TESTS: ReadonlySet<string> = new Set([
	's1',
	's4',
	'textures',
	'ktx2',
	'gltf-image-formats',
	'standard-maps',
	'transparency',
	'lights-16',
	'shadows',
	'spot-shadows',
	'point-shadows',
	'tone-aces',
	'custom-surface',
]);

/** The page kinds of the checks plan that the smoke plan keeps on every GPU path. */
const SMOKE_KINDS: ReadonlySet<Check['kind']> = new Set([
	'capabilities',
	'isolation',
	'shaders',
	'shader-library',
	'uploads',
	'mip-levels',
	'preset-change',
	'stats',
]);

/** Whether the smoke plan keeps an item of the checks plan. */
function inSmokePlan({ id, check }: PlanItem<Check>): boolean {
	switch (check.kind) {
		case 'image':
			return SMOKE_IMAGE_TESTS.has(check.run.test) && check.run.sameAs === undefined;
		// The warm-up page as the engine runs it, without the switch that waits for each compile.
		case 'warm-up':
			return id === `warm-up-${check.tier}`;
		// Starts on the page in one thread mode of each build: the threaded build's first mode, and the
		// single-threaded build. Starts and stops in frames in the threaded build's first mode, as the
		// runner page runs every test page.
		case 'restarts':
			return (
				(check.start === 'engine' || check.start === 'frame-destroyed') &&
				ENGINE_MODES.find(({ build }) => build === check.mode.build) === check.mode
			);
		default:
			return SMOKE_KINDS.has(check.kind);
	}
}

/**
 * A short version of the checks plan, about a tenth of its pages, for a device in a cloud session
 * of limited time. It keeps the pages that find a device's faults soonest: the capability report,
 * isolation, every shader's compile, the shader library, uploads, presets, warm-up and stats on
 * each GPU path, the main features' image tests, the restarts of each build, and starts and stops
 * in frames, as the runner page runs every page. New GPU tiers and thread modes join by the same
 * rules.
 */
export const smokePlan = (): PlanItem<Check>[] => checksPlan().filter(inSmokePlan);

/** The name of the parity plan's item for one scene's hold page of one kind. */
const parityItemId = (scene: BenchScene, kind: string) => `parity-${scene}-${kind}`;

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
	/**
	 * Fresh runs of each benchmark page, loads at each memory maximum, rounds of the tab memory
	 * test, or fresh loads of each scene in the warm-up time plan; undefined for the plan's own
	 * number.
	 */
	runs?: number;
	/** Job worker counts, at each of which the bench plan runs the null3D pages instead. */
	jobs?: readonly number[];
	/** The bench plan's pages, or undefined for its usual pages, or null3D's two GPU paths with jobs. */
	pages?: readonly BenchPageKind[];
	/** The bench plan's scenes, or undefined for S1. */
	scenes?: readonly BenchScene[];
	/** The bench plan's warm-up and measured seconds, each, or undefined for the protocol's. */
	seconds?: number;
	/** The soak plan's minutes of each soak, or undefined for its own number. */
	minutes?: number;
}

/** The name of a visual check's folder of frames in a run, and of its figures in the summary. */
const visualName = ({ scene, tier }: { scene: string; tier: Tier }) => `${scene}-${tier}`;

/** A visual page's figures for the bench summary, with the limits of its scene. */
function visualFigures(scene: string, result: VisualResult): VisualFigures {
	const limits = VISUAL_LIMITS[scene];
	return {
		changedPercent: result.stability.changedPercent,
		edgeOffsetPixels: result.edges.offsetPixels,
		...(result.contact && { contactGapPixels: result.contact.meanGapPixels }),
		...(result.acne && { acnePercent: result.acne.meanShadowPercent }),
		...(limits && {
			changedLimit: limits.changedPercent,
			edgeOffsetLimit: limits.edgeOffsetPixels,
			contactGapLimit: limits.contactGapPixels,
			acneLimit: limits.acnePercent,
		}),
	};
}

/** How long a visual page may take on a slow device: twelve starts of a scene in hold mode. */
const VISUAL_TIMEOUT_SECONDS = 600;

/**
 * The visual check of a benchmark scene on one GPU path: the visual page at the scene's count or
 * `count`, with the frames it captures. It draws the desktop's preset, as the image tests do, so
 * every device measures the shadow settings that the figures' limits come from.
 */
function visualItem(scene: BenchScene, tier: Tier, count?: number): PlanItem<Check> {
	return {
		id: `visual-${scene}-${tier}`,
		path: `${visualPagePath(scene, tier, { n: count, images: true })}&${REFERENCE_PRESET_SWITCH}`,
		timeoutSeconds: VISUAL_TIMEOUT_SECONDS,
		check: { kind: 'visual', tier, scene },
	};
}

/**
 * The benchmark protocol in browsers that Playwright cannot drive: `runs` fresh runs of each page
 * of each scene, each a 5-second warm-up and 30 measured seconds, or `seconds` of each, with
 * `count` instances when given. With job worker counts, each run times the pages once at each
 * count, and the pages are null3D's two GPU paths unless the settings name others. The pages take
 * turns run by run, so a device that slows as it warms up slows every page alike. Unless the plan
 * sweeps job worker counts, the first run of each null3D page captures its frame after its measured
 * seconds. After the timed runs, the visual check of each scene on each GPU path of the null3D
 * pages measures its shadows and captures frames from hold mode, which no timed run waits for.
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
	const timed = Array.from({ length: runs }, (_, run) =>
		scenes.flatMap((scene) =>
			runsOfPages.map(({ page, jobs: workers }) =>
				benchItem(
					`bench-${scene}-${page}${workers === undefined ? '' : `-jobs${workers}`}-${run + 1}`,
					page,
					{ n: count, jobs: workers, seconds, capture: !jobs && run === 0 && isNull3dPage(page) },
					scene,
				),
			),
		),
	).flat();
	// A sweep of job worker counts times the pages and nothing else.
	const tiers = jobs
		? []
		: TIERS.filter((tier) =>
				kinds.some((page) => isNull3dPage(page) && gpuApiOfPage(page) === tier),
			);
	return [
		...timed,
		...scenes.flatMap((scene) => tiers.map((tier) => visualItem(scene, tier, count))),
	];
}

/** The image test manifest's depth precision tests, by name. */
const isDepthTest = (test: string) =>
	test === 'depth-precision' || test.startsWith('depth-precision-');

/**
 * The runs of the image test manifest's depth precision tests: the scene on each GPU path in its own
 * depth mode, then on WebGL2 in each mode that ?depth= forces. The run's summary gives each run's
 * fighting pixels by distance.
 */
export function depthPlan(): PlanItem<Check>[] {
	return IMAGE_RUNS.filter((run) => isDepthTest(run.test)).map(imageItem);
}

/** How long the GPU-bound page may take to raise its load step by step and measure the last step. */
const OVERLOAD_TIMEOUT_SECONDS = 120;

/**
 * The ?queue= settings of the GPU-bound page: the engine's own limit on the frames that wait on the
 * GPU, then no limit, which shows what the browser does on its own.
 */
const OVERLOAD_QUEUES = [undefined, 'off'] as const;

/**
 * The GPU-bound page on each GPU path, in the default thread mode, with each ?queue= setting. The
 * run's summary gives, for each, the presented and completed rates at the load that overloaded the
 * GPU, and the frames that waited on the GPU. Then the quality page with the GPU-bound scene, which
 * the preset check must find too heavy for the preset that the engine chose.
 */
export function overloadPlan(): PlanItem<Check>[] {
	return [
		...TIERS.flatMap((tier) =>
			OVERLOAD_QUEUES.map((queue) =>
				pageItem(
					`overload-${tier}${queue === undefined ? '' : `-queue-${queue}`}`,
					'overload',
					{ kind: 'overload', tier, ...(queue !== undefined && { queue }) },
					{
						switches: [`gpu=${tier}`, queue === undefined ? '' : `queue=${queue}`],
						timeoutSeconds: OVERLOAD_TIMEOUT_SECONDS,
					},
				),
			),
		),
		pageItem(
			'preset-check',
			'quality',
			{ kind: 'preset-check' },
			{
				switches: [`spheres=${HEAVY_SPHERES}`, 'check=fresh'],
				timeoutSeconds: OVERLOAD_TIMEOUT_SECONDS,
			},
		),
	];
}

/**
 * How long the skinning page may take: the build, the image check, the warm-up, and the timed
 * batches of both paths, on a phone whose frames take a tenth of a second at the largest crowd.
 */
const SKINNING_TIMEOUT_SECONDS = 120;

/**
 * The skinning page of `gpu` at each crowd size and cascade count, from the lightest load. Each
 * page draws one pose on both skinning paths and compares the images, then times the two paths in
 * turns. The skinning plan runs the WebGL2 page, and the skinning-webgpu plan the WebGPU page.
 */
export function skinningPlan(gpu: SkinningGpu = 'webgl2'): PlanItem<Check>[] {
	const prefix = gpu === 'webgl2' ? 'skinning' : 'skinning-webgpu';
	return SKINNING_CHARACTERS.flatMap((characters) =>
		SKINNING_CASCADES.map((cascades) =>
			pageItem(
				`${prefix}-${characters}-${cascades}`,
				prefix,
				{ kind: 'skinning', tier: gpu, characters, cascades },
				{
					switches: [`characters=${characters}`, `cascades=${cascades}`],
					timeoutSeconds: SKINNING_TIMEOUT_SECONDS,
				},
			),
		),
	);
}

/**
 * The effects that the effect cost page measures: bloom, ambient occlusion, depth of field, or 4
 * custom effects.
 */
export type CostedEffect = 'bloom' | 'ao' | 'dof' | 'effects';

/** How long the effect cost page may take: the warm-up and six measurements, plus the start. */
const EFFECT_TIMEOUT_SECONDS = 60;
/** The render scales at which the effect plans measure an effect. */
export const EFFECT_SCALES = [1, 0.5] as const;

/**
 * What an effect costs on each GPU path at each render scale: the effect's scene fills the window,
 * and the page times its frames with the effect off and on in turns. Ambient occlusion turns the
 * depth prepass on with it, so the ao plan also times each page with the prepass on in both
 * halves: the difference there is the cost of ambient occlusion's own passes, and the rest is the
 * prepass's. The effects plan adds 4 custom effects, so a quarter of its difference is the cost of
 * one effect's pass. The dof plan times depth of field at 16 and 22 taps of its gather, the
 * candidates for Low and Medium, since phones run Low, where the preset's taps draw nothing.
 * D-21 records the results of the bloom plan and the ao plan, D-71 those of the effects plan, and
 * D-119 those of the dof plan.
 */
export function effectPlan(effect: CostedEffect): PlanItem<Check>[] {
	const prepass = effect === 'ao' ? [false, true] : [false];
	const tapCounts = effect === 'dof' ? [16, 22] : [undefined];
	// three.js's GTAOPass on the same scene and canvas, for comparison.
	const twin: PlanItem<Check>[] =
		effect === 'ao'
			? [
					{
						id: 'ao-threejs-100',
						path: '/bench/pages/threejs/ao-cost.html',
						timeoutSeconds: EFFECT_TIMEOUT_SECONDS,
						check: { kind: 'effect', effect, tier: 'webgl2', scale: 1 },
					},
				]
			: [];
	const pages = TIERS.flatMap((tier) =>
		EFFECT_SCALES.flatMap((scale) =>
			prepass.flatMap((on) =>
				tapCounts.map((taps) =>
					pageItem(
						`${effect}-${tier}-${scale * 100}${on ? '-prepass' : ''}${taps ? `-${taps}` : ''}`,
						'effect-cost',
						{ kind: 'effect', effect, tier, scale },
						{
							switches: [
								`gpu=${tier}`,
								`scale=${scale}`,
								`effect=${effect}`,
								...(on ? ['prepass=on'] : []),
								...(taps ? [`taps=${taps}`] : []),
								// One pass for each effect, so a quarter of the difference is one pass.
								...(effect === 'effects' ? ['join=off'] : []),
							],
							timeoutSeconds: EFFECT_TIMEOUT_SECONDS,
						},
					),
				),
			),
		),
	);
	return [...pages, ...twin];
}

/**
 * What joining custom effects saves on each GPU path (D-71): the effect cost page with 4 effects
 * that each read their own pixel, which join and fold into the final pass, and the same with
 * ?join=off, which keeps each in a pass of its own, at render scales of 1 and 0.5. Each page's
 * difference from its own frames without effects is the effects' cost, so a pair's two differences
 * give what joining saves. WebGL2 has no GPU timer on most phones, so a heavy pair there draws 8
 * effects at the display's whole pixel ratio, which makes the GPU the limit, and compares frame
 * intervals. Each joined page also reports how long each joined shader took to build.
 */
export function effectsJoinedPlan(): PlanItem<Check>[] {
	const page = (id: string, tier: Tier, scale: number, switches: string[]) =>
		pageItem(
			id,
			'effect-cost',
			{ kind: 'effect', effect: 'effects', tier, scale },
			{
				switches: [`gpu=${tier}`, `scale=${scale}`, 'effect=effects', ...switches],
				timeoutSeconds: EFFECT_TIMEOUT_SECONDS,
			},
		);
	const pairs = TIERS.flatMap((tier) =>
		EFFECT_SCALES.flatMap((scale) => [
			page(`effects-joined-${tier}-${scale * 100}`, tier, scale, []),
			page(`effects-separate-${tier}-${scale * 100}`, tier, scale, ['join=off']),
		]),
	);
	return [
		...pairs,
		page('effects-joined-webgl2-heavy', 'webgl2', 1, ['heavy']),
		page('effects-separate-webgl2-heavy', 'webgl2', 1, ['heavy', 'join=off']),
	];
}

/** The bases of bloom's chain that the bloom size plan times, in texels on the short side. */
export const BLOOM_SIZES = [512, 256, 128, 64] as const;

/**
 * What bloom costs at each base size of its chain, on WebGPU, whose GPU timer the phones have: the
 * bloom cost page at render scales of 1 and 0.5, with the quality setting `bloomSize` at each size.
 * Each halving of the base drops a level, so the sizes draw 15, 13, 11 and 9 passes, and the
 * results split bloom's cost into a cost per pass and a cost per texel. D-21 records them.
 */
export function bloomSizesPlan(): PlanItem<Check>[] {
	return BLOOM_SIZES.flatMap((size) =>
		EFFECT_SCALES.map((scale) =>
			pageItem(
				`bloom-size-${size}-webgpu-${scale * 100}`,
				'effect-cost',
				{ kind: 'effect', effect: 'bloom', tier: 'webgpu', scale },
				{
					switches: ['gpu=webgpu', `scale=${scale}`, 'effect=bloom', `size=${size}`],
					timeoutSeconds: EFFECT_TIMEOUT_SECONDS,
				},
			),
		),
	);
}

/**
 * What the environment's light costs on each GPU path: layers of planes of the standard material
 * fill the window at a render scale of 1, and the page times its frames without and with the built-in
 * room in turns. D-19 records the results.
 */
export function environmentPlan(): PlanItem<Check>[] {
	return TIERS.map((tier) =>
		pageItem(
			`environment-${tier}`,
			'environment-cost',
			{ kind: 'environment', tier },
			{ switches: [`gpu=${tier}`], timeoutSeconds: EFFECT_TIMEOUT_SECONDS },
		),
	);
}

/**
 * What row values cost on each GPU path: a field of 100,000 grass blades under the sun's shadows,
 * still in the standard material and swaying out of step with a tint each, from their rows'
 * values, in turns. D-127 records the results.
 */
export function grassPlan(): PlanItem<Check>[] {
	return TIERS.map((tier) =>
		pageItem(
			`grass-${tier}`,
			'grass-cost',
			{ kind: 'grass', tier },
			{ switches: [`gpu=${tier}`], timeoutSeconds: EFFECT_TIMEOUT_SECONDS },
		),
	);
}

/** The GPU paths of the sky plan's pages, with the tier each draws on. */
const SKY_PATHS = [
	['webgpu', 'webgpu'],
	['compat', 'webgpu'],
	['webgl2', 'webgl2'],
] as const;

/**
 * What a sky map's refresh costs on each GPU path, for D-118: each of its stages, timed from its
 * call until the GPU has finished it, and the frames from a sun move until the sky's light follows
 * it. The capabilities page comes first, so a device without WebGPU skips those pages.
 */
export function skyPlan(): PlanItem<Check>[] {
	return [
		pageItem(CAPABILITIES, 'capabilities', { kind: 'capabilities' }),
		...SKY_PATHS.map(([path, tier]) =>
			pageItem(
				`sky-map-cost-${path}`,
				'sky-map-cost',
				{ kind: 'sky-map', tier },
				{ switches: [`gpu=${path}`, 'runs=8'], timeoutSeconds: 240 },
			),
		),
		...SKY_PATHS.map(([path, tier]) =>
			pageItem(
				`sky-refresh-${path}`,
				'sky-refresh',
				{ kind: 'sky-refresh', tier },
				{ switches: [`gpu=${path}`, 'fps=20'], timeoutSeconds: 90 },
			),
		),
	];
}

/** The reflection plan's sizes of S1's reflection pass, with none first. */
const REFLECTION_SIZES = [undefined, 'quarter', 'half'] as const;
/** The reflection plan's rounds, and each benchmark page's warm-up and measured seconds. */
const REFLECTION_ROUNDS = 3;
const REFLECTION_SECONDS = 10;

/**
 * What a reflection pass costs, for D-120: S1 with water under the swarm, whose reflection pass
 * draws at a quarter and at half the render size, against S1 with no reflection, on each of
 * null3D's GPU paths. The sizes take turns round by round in one session, so a device that slows
 * as it warms slows each size alike. A device without WebGPU skips those pages.
 */
export function reflectionPlan(): PlanItem<Check>[] {
	return Array.from({ length: REFLECTION_ROUNDS }, (_, round) =>
		(['null3d-webgpu', 'null3d-webgl2'] as const).flatMap((page) =>
			REFLECTION_SIZES.map((reflection) =>
				benchItem(`reflection-${page}-${reflection ?? 'none'}-${round + 1}`, page, {
					seconds: REFLECTION_SECONDS,
					reflection,
				}),
			),
		),
	).flat();
}

/** The environments that the load plan asks for: the built-in room, and HDR files of each kind. */
const LOAD_SOURCES = [
	['room', undefined],
	['hdr', sampleUrl('sources/hdri/polyhaven/venice_sunset/venice_sunset_2k.hdr')],
	['exr', sampleUrl('sources/hdri/polyhaven/studio_small_09/studio_small_09_1k.exr')],
] as const;

/**
 * How long an environment takes to load during play on each GPU path, and that no frame draws the
 * scene without its light: the built-in room, a Radiance file and an OpenEXR file, which the engine
 * reads and filters itself. D-19 records the times.
 */
export function environmentLoadPlan(): PlanItem<Check>[] {
	return TIERS.flatMap((tier) =>
		LOAD_SOURCES.map(([name, url]) =>
			pageItem(
				`environment-load-${name}-${tier}`,
				'room-light',
				{ kind: 'environment-load', tier },
				{
					switches: [`gpu=${tier}`, url ? `source=${encodeURIComponent(url)}` : ''],
					timeoutSeconds: 90,
				},
			),
		),
	);
}

/** How long the occlusion cost page may take: the city's start, the warm-up and six measurements. */
const OCCLUSION_TIMEOUT_SECONDS = 90;

/**
 * What software occlusion culling costs and saves on WebGL2: the occlusion city fills the window,
 * and the page times its frames with the culling off and on in turns. D-41 records the results.
 */
export function occlusionPlan(): PlanItem<Check>[] {
	return [
		pageItem(
			'occlusion-webgl2',
			'occlusion-cost',
			{ kind: 'occlusion' },
			{ switches: ['gpu=webgl2'], timeoutSeconds: OCCLUSION_TIMEOUT_SECONDS },
		),
	];
}

/** How long the GPU occlusion page may take: twelve frames read back, then six engines of 4 s. */
const GPU_OCCLUSION_TIMEOUT_SECONDS = 120;

/**
 * What GPU occlusion culling saves and costs on WebGPU: the room scene's frames with it and
 * without it must match, then the scene fills the window and the page times its frames with the
 * culling off and on in turns. D-22 records the results.
 */
export function gpuOcclusionPlan(): PlanItem<Check>[] {
	return [
		pageItem(
			'gpu-occlusion-webgpu',
			'gpu-occlusion',
			{ kind: 'gpu-occlusion' },
			{
				switches: ['gpu=webgpu', 'seconds=4', 'rounds=3'],
				timeoutSeconds: GPU_OCCLUSION_TIMEOUT_SECONDS,
			},
		),
	];
}

/**
 * How long the jitter page may take on a slow device: five engine starts, each with sixteen steps
 * of the camera.
 */
const JITTER_TIMEOUT_SECONDS = 180;

/**
 * The large-world jitter check on each GPU path: a camera flies past objects at the origin, 1,000
 * km and 6,378 km out in large-world mode, and again far out with every grid cell taken. Each far
 * flight must move as the flight at the origin does, and the flights without cells must jitter.
 * D-80 records the results.
 */
export function jitterPlan(): PlanItem<Check>[] {
	return TIERS.map((tier) =>
		pageItem(
			`jitter-${tier}`,
			'jitter',
			{ kind: 'jitter', tier },
			{ switches: [`gpu=${tier}`, 'images'], timeoutSeconds: JITTER_TIMEOUT_SECONDS },
		),
	);
}

/** The crowds that the animation plan times: a first draft of S5's crowd, then the full crowd. */
export const ANIMATION_CHARACTERS = [100, 500] as const;

/**
 * The animation page at each crowd size. Each page starts the core and its job workers, then times
 * the animation step over a few hundred frames, which takes a few seconds on a phone.
 */
export function animationPlan(): PlanItem<Check>[] {
	return ANIMATION_CHARACTERS.map((characters) =>
		pageItem(
			`animation-${characters}`,
			'animation',
			{ kind: 'animation', characters },
			{ switches: [`characters=${characters}`], timeoutSeconds: 60 },
		),
	);
}

/** How long a stage of the governor's stress test may take: its waits, plus the start. */
const GOVERNOR_TIMEOUT_SECONDS = 150;

/**
 * The quality governor's stress test on each GPU path, in the default thread mode: the walk, which
 * takes every live step down and back up, with a frame captured after each step, then the hold,
 * where the governor brings the frame rate of a scene too heavy for the GPU back to its target.
 */
export function governorPlan(): PlanItem<Check>[] {
	return GOVERNOR_STAGES.flatMap((stage) =>
		TIERS.map((tier) =>
			pageItem(
				`governor-${stage}-${tier}`,
				'governor',
				{ kind: 'governor', tier, stage },
				{ switches: [`gpu=${tier}`, `stage=${stage}`], timeoutSeconds: GOVERNOR_TIMEOUT_SECONDS },
			),
		),
	);
}

/** The shared memory maximums that the memory plan tries, in MiB, from low to high. */
export const MEMORY_MAXIMUMS_MIB = [256, 512, 1024, 2048, 4096] as const;
/** Loads of the engine page at each maximum in the memory plan. */
export const MEMORY_LOADS = 20;
/** WebAssembly memory comes in pages of 64 KiB, 16 to a MiB. */
const PAGES_PER_MIB = 16;
/**
 * How long the shared memory page may take to count its room, and to wait up to 91 s for the room
 * to come back after its one cycle.
 */
const ROOM_TIMEOUT_SECONDS = 150;
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
				switches: [
					'kinds=dropped',
					'cycles=1',
					'room=full',
					`maximum=${maximumMiB * PAGES_PER_MIB}`,
				],
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

/**
 * How long the tab memory page may take: up to its cap in steps, each an upload, a wait for the GPU
 * and a post of its progress.
 */
const TAB_MEMORY_TIMEOUT_SECONDS = 300;
/**
 * How long a runner page may post nothing on a tab memory page before its tab counts as dead. A step
 * that gives no answer for a minute ends the growth, and the page then publishes its result. The
 * page after a dead tab starts only after the runner page's rest, which counts as quiet too.
 */
const TAB_MEMORY_QUIET_SECONDS = REST_AFTER_TAB_END_SECONDS + 60;
/**
 * What the tab memory plan grows, in its order: the GPU path that the browser picks first, then the
 * other, and WebAssembly memory last. A device without WebGPU skips the WebGPU growths.
 */
const TAB_MEMORY_GROWTHS: readonly { growth: GrowthKind; tier?: Tier }[] = [
	{ growth: 'texture', tier: 'webgpu' },
	{ growth: 'buffer', tier: 'webgpu' },
	{ growth: 'texture', tier: 'webgl2' },
	{ growth: 'buffer', tier: 'webgl2' },
	{ growth: 'wasm' },
];

/**
 * The tab memory test, `runs` rounds of it, one by default: on each GPU path, GPU textures and then
 * GPU buffers grow in steps until the browser closes the tab, refuses an allocation or takes the
 * GPU away; then a shared WebAssembly memory does. Each page posts its progress after each step that
 * lived, so the run keeps the last one when the tab dies. A runner page that the browser reloads,
 * or that the runner tool opens again, records the dead tab and goes on with the next page.
 */
export function tabMemoryPlan({ runs = 1 }: PlanSettings = {}): PlanItem<Check>[] {
	return Array.from({ length: runs }, (_, round) =>
		TAB_MEMORY_GROWTHS.map(({ growth, tier }) => {
			const id = `tab-memory-${growth}${tier ? `-${tier}` : ''}-${round + 1}`;
			const item = pageItem(
				id,
				'tab-memory',
				{ kind: 'tab-memory', growth, ...(tier && { tier }), round: round + 1 },
				{
					switches: [
						`kind=${growth}`,
						tier ? `gpu=${tier}` : '',
						`progress=/__null3d/runs/{run}/{runner}/${progressName('{item}')}`,
					],
					timeoutSeconds: TAB_MEMORY_TIMEOUT_SECONDS,
				},
			);
			return { ...item, quietSeconds: TAB_MEMORY_QUIET_SECONDS, endsTab: true as const };
		}),
	).flat();
}

/** Minutes of each soak, unless the plan names another number. */
export const SOAK_MINUTES = 30;
/** The soaked scene: S4, a city that a full-screen app on a phone or a tablet draws. */
const SOAK_SCENE: BenchScene = 's4';
/** Time to start the soaked page and build its scene, on top of its minutes. */
const SOAK_START_SECONDS = 180;

/**
 * The soak and recovery test. First the scene page loses its GPU on purpose in each thread mode on
 * each GPU path, and must draw the whole scene again on a new device. Then S4 plays for `minutes`
 * on each GPU path, from the benchmark pages' production build, measured once a minute: the run's
 * summary gives the GPU losses that the engine recovered from, the frame rates and the memory.
 */
export function soakPlan({ minutes = SOAK_MINUTES }: PlanSettings = {}): PlanItem<Check>[] {
	return [
		...TIERS.flatMap((tier) =>
			ENGINE_MODES.map((mode) =>
				pageItem(
					`recovery-${tier}-${slug(mode.name)}`,
					'scene',
					{
						kind: 'recovery',
						tier,
						run: borrowedRun(manifestRun('scene', tier, mode.name), 'scene-after-gpu-loss'),
					},
					{ switches: [`gpu=${tier}`, mode.query, 'lose-gpu'], timeoutSeconds: 60 },
				),
			),
		),
		...TIERS.map((tier) => ({
			id: `soak-${SOAK_SCENE}-${tier}`,
			path: loadPath(
				BENCH_BUILD,
				pagePath(SOAK_SCENE, `null3d-${tier}`, `soak=${minutes}`).slice(1),
			),
			timeoutSeconds: minutes * SOAK_SAMPLE_SECONDS + SOAK_START_SECONDS,
			check: { kind: 'soak' as const, tier, minutes },
		})),
	];
}

/** Loads of each scene with fresh shaders in the warm-up time plan, unless the plan names another number. */
export const WARM_UP_FRESH_LOADS = 2;
/**
 * Loads of each scene with the shaders as they ship, after the fresh ones. The last one reuses what
 * the browser compiled for the first, as a repeat visit does.
 */
const WARM_UP_PLAIN_LOADS = 2;
/** How long a load may take on a slow device: S1 builds 100,000 objects before its first frame. */
const WARM_UP_TIMEOUT_SECONDS = 90;

/** Each benchmark scene's count on its own page. */
/** The sketches whose warm-up the plan times: each benchmark scene at its own count, then each demo. */
function warmUpSketches(): { scene: string; sketch: string }[] {
	return [
		...(Object.keys(SCENE_COUNTS) as BenchScene[]).map((scene) => ({
			scene,
			sketch: `/bench/pages/null3d/${scene}-sketch.ts?n=${SCENE_COUNTS[scene]}`,
		})),
		...DEMOS.map((demo) => ({
			scene: `demo-${demo.name}`,
			sketch: `/examples/${demo.name}/sketch.ts`,
		})),
	];
}

/**
 * The warm-up time test: each benchmark scene and each demo starts on each GPU path, first as on a
 * first visit, with fresh shaders that the browser must compile and a preset check that measures
 * again. Then it starts with the shaders as they ship and the stored preset check, the last time
 * reusing what the browser compiled. Each load reports how long the pipelines held up the first
 * frame, and how long the first frame took to show.
 */
export function warmUpTimePlan({
	runs = WARM_UP_FRESH_LOADS,
}: PlanSettings = {}): PlanItem<Check>[] {
	return TIERS.flatMap((tier) =>
		warmUpSketches().flatMap(({ scene, sketch }) => {
			const sketchSwitch = `sketch=${encodeURIComponent(sketch).replaceAll('%2F', '/')}`;
			const load = (fresh: boolean, k: number) =>
				pageItem(
					`warm-up-${scene}-${tier}-${fresh ? 'fresh' : 'plain'}-${k}`,
					'warm-up-time',
					{ kind: 'warm-up-time', tier, scene, fresh },
					{
						switches: [
							`gpu=${tier}`,
							...(fresh ? ['shaders=fresh', 'check=fresh'] : []),
							sketchSwitch,
						],
						timeoutSeconds: WARM_UP_TIMEOUT_SECONDS,
					},
				);
			return [
				...Array.from({ length: runs }, (_, k) => load(true, k + 1)),
				...Array.from({ length: WARM_UP_PLAIN_LOADS }, (_, k) => load(false, k + 1)),
			];
		}),
	);
}

/** Cold and warm loads of each thread mode in the startup plan, unless the plan names another number. */
export const STARTUP_RUNS = 5;
/** How long a startup load may take on a slow device. */
const STARTUP_TIMEOUT_SECONDS = 60;
/** The engine page's measured time after its first frame: short, as a load needs only its start. */
const STARTUP_SECONDS = 0.2;

/** The name of the startup plan's item for one load of the engine test page in `mode`. */
const startupItemId = (mode: EngineMode, load: LoadKind, run: number | 'first') =>
	`startup-${slug(mode.name)}-${load}-${run}`;

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
		startupItemId(mode, load, run),
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

/**
 * The plans whose pages check results, so the runner page may draw its report over their frames.
 * Any other plan keeps each page's frame on top, and so does an item of these plans that times its
 * frames.
 */
export const REPORT_ON_TOP_PLANS: ReadonlySet<string> = new Set([
	'checks',
	'smoke',
	'parity',
	'memory',
	'depth',
	'tab-memory',
]);

/**
 * The checks of pages that push the browser to its memory limit on purpose. A refused memory is what
 * they measure, so the device runner's out-of-memory guard does not count their pages.
 */
export const MEMORY_LIMIT_CHECKS: ReadonlySet<Check['kind']> = new Set([
	'memory',
	'room',
	'tab-memory',
]);

/**
 * How long the shimmer page may take: two rows of camera steps, one of them at sixteen times the
 * pixels, which a phone's GPU draws slowly.
 */
const SHIMMER_TIMEOUT_SECONDS = 300;

/**
 * The shimmer page's scenes that a device run measures: small low-poly shapes, smooth spheres, and
 * spheres a few pixels across. The bump-mapped scene is left out, because specular anti-aliasing
 * never sees a normal map's detail.
 */
const SHIMMER_SCENES = ['small', 'smooth', 'tiny'] as const;

/**
 * How much the highlights of shiny shapes flicker in each scene on each GPU path, against a
 * supersampled row of the same frames. D-79 records the results.
 */
export function shimmerPlan(): PlanItem<Check>[] {
	return TIERS.flatMap((tier) =>
		SHIMMER_SCENES.map((scene) =>
			pageItem(
				`shimmer-${scene}-${tier}`,
				'specular-shimmer',
				{ kind: 'shimmer', tier },
				{ switches: [`gpu=${tier}`, `scene=${scene}`], timeoutSeconds: SHIMMER_TIMEOUT_SECONDS },
			),
		),
	);
}

export const PLANS: Readonly<Record<string, (settings?: PlanSettings) => PlanItem<Check>[]>> = {
	checks: checksPlan,
	smoke: smokePlan,
	parity: parityPlan,
	bench: benchPlan,
	memory: memoryPlan,
	depth: depthPlan,
	startup: startupPlan,
	overload: overloadPlan,
	skinning: () => skinningPlan('webgl2'),
	'skinning-webgpu': () => skinningPlan('webgpu'),
	bloom: () => effectPlan('bloom'),
	'bloom-sizes': bloomSizesPlan,
	ao: () => effectPlan('ao'),
	dof: () => effectPlan('dof'),
	effects: () => effectPlan('effects'),
	'effects-joined': effectsJoinedPlan,
	environment: environmentPlan,
	'environment-load': environmentLoadPlan,
	grass: grassPlan,
	sky: skyPlan,
	reflection: reflectionPlan,
	occlusion: occlusionPlan,
	'gpu-occlusion': gpuOcclusionPlan,
	'occlusion-s6': occlusionS6Plan,
	jitter: jitterPlan,
	shimmer: shimmerPlan,
	animation: animationPlan,
	'tab-memory': tabMemoryPlan,
	soak: soakPlan,
	'warm-up-time': warmUpTimePlan,
	governor: governorPlan,
	'texture-cache': textureCachePlan,
	'object-growth': objectGrowthPlan,
};

/**
 * What is wrong with a room light page's result: a failure, an environment that never resolved, or
 * a frame that used it without its light. Each frame that uses it must draw as the steady frame
 * does, within a thousandth of the pixels, and the light must brighten the sphere's middle.
 */
function environmentLoadProblems(result: ItemResult): string[] {
	const page = result as ItemResult & {
		failures?: string[];
		set?: boolean;
		pixels?: number;
		blueChanged?: number[];
		litMiddle?: number;
		unlitMiddle?: number | null;
	};
	const most = Math.ceil(0.001 * (page.pixels ?? 0));
	const unlit = (page.blueChanged ?? []).filter((count) => count > most).length;
	return [
		...(page.failures ?? []).map((code) => `the engine failed with ${code}`),
		...(page.set ? [] : ['the environment never resolved']),
		...(page.blueChanged?.length ? [] : ['no frame that uses the environment was captured']),
		...(unlit ? [`${unlit} frames that use the environment differ from the steady frame`] : []),
		...((page.litMiddle ?? 0) > (page.unlitMiddle ?? 0) + 40
			? []
			: ["the environment's light did not brighten the sphere"]),
	];
}

/** What the sky map cost page reports: each stage's times over the refreshes, by stage. */
interface SkyMapResult {
	fill: number;
	stages: number[][];
	gpuStages: number[][];
	errors: string[];
}

/** The median of some times, or 0 for none. */
const medianOf = (times: readonly number[]) =>
	[...times].sort((a, b) => a - b)[Math.floor(times.length / 2)] ?? 0;

/** The sky map cost page's figures, as lines of the report, and its GPU errors. */
function skyMapReport(result: SkyMapResult): { lines: string[]; problems: string[] } {
	const stages = (times: readonly number[][]) =>
		times.map((t) => medianOf(t).toFixed(2)).join(', ');
	const lines = [
		`the whole map at once ${result.fill.toFixed(2)} ms`,
		`each stage's median ${stages(result.stages)} ms`,
		`each stage's longest ${result.stages.map((t) => Math.max(...t).toFixed(2)).join(', ')} ms`,
		...(result.gpuStages.some((t) => t.length > 0)
			? [`each stage's median by timer queries ${stages(result.gpuStages)} ms`]
			: []),
	];
	return { lines, problems: result.errors.map((error) => `GPU error: ${error}`) };
}

/** What the sky refresh page reports: each capture's frames since the move and its two colors. */
interface SkyRefreshResult {
	frames: { since: number; mirror: number[]; rough: number[] }[];
}

/** How far a color may stray from the new sky's, in levels of 255, to count as the new light. */
const SKY_NEAR = 4;

/**
 * The frames from a sun move until both spheres show the new sky's light: the first capture after
 * the move from which every later capture matches the last one.
 */
function skyRefreshReport(result: SkyRefreshResult): { line: string; problems: string[] } {
	const after = result.frames.filter((frame) => frame.since >= 0);
	const last = after.at(-1);
	if (!last) return { line: '', problems: ['no capture after the sun moved'] };
	const near = (a: number[], b: number[]) =>
		a.every((value, c) => Math.abs(value - (b[c] as number)) <= SKY_NEAR);
	let first = after.length - 1;
	while (first > 0) {
		const frame = after[first - 1] as (typeof after)[number];
		if (!near(frame.mirror, last.mirror) || !near(frame.rough, last.rough)) break;
		first -= 1;
	}
	const since = (after[first] as (typeof after)[number]).since;
	return {
		line: `the new sky's light shows ${since} frames after the move, over ${after.length} captures`,
		problems: last.since === 15 ? [] : [`the last capture shows frame ${last.since}, not 15`],
	};
}

/**
 * The items that an item needs earlier in the same run, by name: the items whose results judging
 * it reads, and for a later warm startup load, the first warm load of its mode, which fills the
 * cache it loads from. A shard of a plan keeps each item with the items it needs.
 */
export function itemsNeeded(check: Check): string[] {
	switch (check.kind) {
		case 'capabilities-reload':
			return [check.first];
		case 'image':
			return check.run.sameAs === undefined ? [] : [imageItemId(check.run.sameAs)];
		case 'parity':
			return [
				...new Set([check.pair.reference, BASELINE_PAIR.reference, BASELINE_PAIR.candidate]),
			].map((kind) => parityItemId(check.scene, kind));
		case 'startup':
			return check.load === 'warm' && !check.first
				? [startupItemId(check.mode, 'warm', 'first')]
				: [];
		case 'texture-cache':
			return textureCacheNeeds(check);
		default:
			return [];
	}
}

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

export { type MissingAllowed, NONE_MISSING };

/**
 * The GPU path a check needs, which a device may lack: its tier, or WebGL2 for the shaders page,
 * which compiles the GLSL programs there.
 */
export function neededPath(check: Check): Tier | undefined {
	if (check.kind === 'image') return gpuApiOf(check.run.tier);
	if ('tier' in check) return check.tier;
	return check.kind === 'shaders' || check.kind === 'mip-levels' ? 'webgl2' : undefined;
}

/**
 * The GPU path a page needs: the one that its `?gpu=` switch forces, or else its check's. A page
 * that does not force WebGPU's core path draws with any WebGPU adapter, as compatibility mode does.
 */
export function gpuPathOf({ path, check }: PlanItem<Check>): GpuPath | undefined {
	const forced = /[?&]gpu=(webgpu|compat|webgl2)\b/.exec(path)?.[1] as GpuPath | undefined;
	if (forced) return forced;
	const needed = neededPath(check);
	return needed === 'webgpu' ? 'compat' : needed;
}

/**
 * A plan's items with the GPU path that each page needs, and the flag that lets the runner page
 * skip the pages for the paths that the device lacks, by the report of the plan's capabilities
 * page. A plan without that page, or a run that lets no path be missing, runs every page.
 */
export function withGpuPaths(
	items: readonly PlanItem<Check>[],
	allowed: MissingAllowed,
): { items: PlanItem<Check>[]; flags: PlanFlags } {
	const report = items.find((item) => item.check.kind === 'capabilities')?.id;
	return {
		items: items.map((item) => {
			const gpu = gpuPathOf(item);
			return gpu ? { ...item, gpu } : item;
		}),
		flags: report && (allowed.webgpu || allowed.webgl2) ? { skipMissing: { report, allowed } } : {},
	};
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
	scene: BenchScene,
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

/**
 * How the shared memory page starts each engine: on the page, which stops it and removes its canvas
 * or keeps it, or in a frame, which the page removes while the engine runs or after it stopped.
 */
export type RestartStart = 'engine' | 'canvas-kept' | 'frame' | 'frame-destroyed';

/** One round of the restart page's starts and stops. */
interface RestartRound {
	cycles: number;
	error?: string;
	trail?: string[];
	/** The room when it came back, or when the page stopped waiting for it. */
	roomLater?: number;
	roomWaitMs?: number;
	/** The shared memories that the starts made, and those that the browser refused. */
	memoriesMade?: number;
	memoriesRefused?: number;
	/** Each start's stop: how long it took, and the job workers that started and that stopped. */
	starts?: { stopMs: number; jobs: number; jobsStopped: number }[];
}

/**
 * The stops of a round after which the engine kept no memory for the next start: a stop that
 * waited out its timeout, or whose job workers did not all report that they stopped.
 */
const uncleanStops = (round: RestartRound) =>
	(round.starts ?? []).filter(
		({ stopMs, jobs, jobsStopped }) => stopMs >= STOP_TIMEOUT_MS || jobsStopped < jobs,
	).length;

/** What the restart page reports about the engine's starts and stops. */
export interface RestartResult {
	/** Shared memories the page could hold at once before the starts, where it counted them. */
	room?: number;
	cycles: number;
	kinds: Partial<
		Record<
			RestartStart,
			RestartRound & {
				/** The second round, from the room the first left, when the room did not come back. */
				again?: RestartRound & { room: number };
			}
		>
	>;
}

/** Each way of starting engines, as the restart problems name it. */
const RESTART_WORDS: Record<RestartStart, { cycle: string; cycles: string; engines: string }> = {
	engine: { cycle: 'start and stop', cycles: 'starts and stops', engines: 'stopped engines' },
	'canvas-kept': {
		cycle: 'start and stop on a kept canvas',
		cycles: 'starts and stops on kept canvases',
		engines: 'stopped engines whose canvases stayed',
	},
	frame: {
		cycle: 'start in a frame',
		cycles: 'starts in frames',
		engines: 'engines in removed frames',
	},
	'frame-destroyed': {
		cycle: 'start and stop in a frame',
		cycles: 'starts and stops in frames',
		engines: 'stopped engines in removed frames',
	},
};

/** How long the restart page waited for the room to come back, as the problem's text gives it. */
const waitedText = (ms: number | undefined) =>
	ms === undefined ? '' : ` within ${Math.round(ms / 1000)} s`;

/** True when a round left less room than it started with, beyond the room the page may lose. */
const roomLost = (room: number | undefined, round: RestartRound) =>
	room !== undefined && round.roomLater !== undefined && round.roomLater < room - ROOM_KEPT;

/**
 * What is wrong with the restart page's result: a start or a stop that failed, or room for shared
 * memory that the browser did not get back from the stopped engines. A little room that the first
 * round lost and the second round kept is lost address space, not memory that the engines hold, so
 * it gets a note through `note` instead; more than that fails where the engines are `threaded`. The
 * single-threaded build takes no shared memory, so any room it loses is address space. Room that
 * engines on kept canvases left held gets a note too: their starts go past the room, so a start
 * fails when that memory stops it. So does room that stopped engines in removed frames left held,
 * which Safari keeps with the frame's page. Room that running engines in removed frames left held in
 * the first round, and that the second round kept, gets a note as well: a leak in the engine loses
 * room in every round.
 */
export function restartProblems(
	result: RestartResult,
	start: RestartStart,
	note?: (text: string) => void,
	threaded = true,
): string[] {
	const engine = result.kinds[start];
	if (!engine) return ['the page started no engine'];
	const words = RESTART_WORDS[start];
	const failed = (round: RestartRound, which: string) =>
		`${words.cycle} ${round.cycles + 1} of ${result.cycles}${which} failed: ${round.error}${lastSteps(round.trail)}`;
	const problems: string[] = [];
	if (engine.error) problems.push(failed(engine, ''));
	// Each start on the page after the first takes the memory that the page kept from the stop
	// before, unless that stop was not clean (D-98). Engines in frames keep theirs in the frame's
	// page, which goes with the frame.
	const made = engine.memoriesMade ?? 0;
	const unclean = uncleanStops(engine);
	if (
		threaded &&
		!engine.error &&
		(start === 'engine' || start === 'canvas-kept') &&
		made > 1 + unclean
	)
		problems.push(
			`the ${engine.cycles} ${words.cycles} made ${made} shared memories, after ${unclean} stops that were not clean: each start after a clean stop should take the memory that the page kept`,
		);
	if (!roomLost(result.room, engine)) return problems;
	const lostText = `it had room for ${result.room} shared memories before ${engine.cycles} ${words.cycles}, and for ${engine.roomLater} after`;
	// The workers that stay with kept canvases may hold memory until a start needs it, which the
	// starts past the room check.
	if (start === 'canvas-kept') {
		note?.(`the workers that stayed with the canvases held memory: ${lostText}`);
		return problems;
	}
	const { again } = engine;
	// Safari can keep a removed frame's whole page, and all that it reaches, for minutes, even a
	// page with no engine (D-92). So room that stopped engines in removed frames left held gets a
	// note. Restarts on the page stop their engines with no frame, and still fail on it.
	if (start === 'frame-destroyed') {
		if (again?.error) problems.push(failed(again, ' in the second round'));
		else
			note?.(
				`Safari kept the memory of ${words.engines}${waitedText(engine.roomWaitMs)}: ${lostText}${again ? `, and for ${again.roomLater} after ${again.cycles} more${waitedText(again.roomWaitMs)}` : ''}`,
			);
		return problems;
	}
	const fell = again ? (result.room ?? 0) - (again.roomLater ?? again.room) : 0;
	if (!again)
		problems.push(
			`the browser did not get back the memory of ${words.engines}${waitedText(engine.roomWaitMs)}: ${lostText}`,
		);
	else if (again.error) problems.push(failed(again, ' in the second round'));
	else if (roomLost(again.room, again))
		problems.push(
			`the browser did not get back the memory of ${words.engines} in two rounds: ${lostText}, then for ${again.roomLater} after ${again.cycles} more${waitedText(again.roomWaitMs)}`,
		);
	else if (start === 'frame' && fell > ROOM_LOST_ONCE)
		// Safari can keep what a removed frame reached (D-92), which costs room once. A leak in the
		// engine would lose room in the second round too, which fails above.
		note?.(
			`Safari kept memory from the first round of ${words.engines}, and the second round held the room: ${lostText}, and for ${again.roomLater} after ${again.cycles} more`,
		);
	else if (threaded && fell > ROOM_LOST_ONCE)
		problems.push(
			`the browser did not get back the memory of ${words.engines}: ${lostText}, and for ${again.roomLater} after ${again.cycles} more, more than the ${ROOM_LOST_ONCE} that lost address space explains`,
		);
	else
		note?.(
			`the room fell once and then held, so the browser lost address space, not memory that ${words.engines} hold: ${lostText}, and for ${again.roomLater} after ${again.cycles} more`,
		);
	return problems;
}

/** The first line of a Metal compile log that names an error at a place in the source, or its first line. */
function metalFaultLine(log: string): string {
	const lines = log.split('\n');
	return (lines.find((line) => /:\d+:\d+: error:/.test(line)) ?? lines[0] ?? '').trim();
}

/**
 * What is wrong with a page's result; empty when nothing is. A page that the runner page skipped,
 * and a check whose GPU path the browser lacks, are skips when `missing` allows it: some devices
 * have no WebGPU in any browser, some offer only its compatibility mode, and some virtual machines
 * give a browser no WebGL2. A parity check and a second load of the capabilities
 * page need the context, to reach the result that they compare with.
 */
export function judge(
	check: Check,
	result: ItemResult,
	missing: MissingAllowed,
	context?: JudgeContext,
): string[] | 'skip' {
	if (skippedPath(result)) return 'skip';
	if (!result.ok) {
		const path = neededPath(check);
		if (path && missing[path] && missingPath(path, result.error)) return 'skip';
		// A tab memory page that gave no result in time still tells how far it got.
		if (check.kind !== 'tab-memory') return [failureText(result)];
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
			const removed = (result.removed ?? []) as { name: string }[];
			if (removed.length > 0)
				context?.note?.(
					`the GPU's driver removed ${removed.length} shader inputs that their programs never read: ${[...new Set(removed.map(({ name }) => name))].join(', ')}`,
				);
			const relinked = (result.relinked ?? []) as { shader: string; log: string }[];
			if (relinked.length > 0)
				context?.note?.(
					`${relinked.length} ${relinked.length === 1 ? 'program' : 'programs'} linked at the second try after Safari's random Metal fault: ${relinked.map(({ shader, log }) => `${shader} (${metalFaultLine(log)})`).join('; ')}`,
				);
			if (!(Number(result.glslPrograms) > 0)) problems.push('no GLSL program was compiled');
			if (!result.webgpu && !missing.webgpu) problems.push('no WebGPU to compile the WGSL');
			return problems;
		}
		case 'shader-library': {
			const mismatches = (result.mismatches ?? []) as {
				function: string;
				expected: number[];
				got: number[];
			}[];
			const failures = (result.failures ?? []) as string[];
			const problems = [
				...failures,
				...mismatches.map(
					(m) => `${m.function}: expected ${m.expected.join(', ')}, got ${m.got.join(', ')}`,
				),
			];
			if (!(Number(result.cases) > 0)) problems.push('the page ran no cases');
			// The engine draws no whole numbers into a target on WebGL2, so a device that cannot hand
			// them back is a fault of the check's readback, which the run records without a failure.
			if (typeof result.deviceFault === 'string')
				context?.note?.(
					`device fault: ${result.deviceFault}. The page could not read the library's results back on this device`,
				);
			// Engine shaders keep whole numbers as the library's shader does, so they lose bits too.
			if (typeof result.shaderFault === 'string')
				problems.push(
					`${result.shaderFault}. The target kept every bit, so the GLSL lost them, and engine shaders keep whole numbers the same way`,
				);
			if (typeof result.precisionFault === 'string')
				context?.note?.(
					`driver fault: ${result.precisionFault}. The GLSL build declares each whole number highp, which avoids it`,
				);
			return problems;
		}
		case 'engine':
			return engineProblems(result as unknown as EngineResult, check.mode, check.tier);
		case 'capture':
			return captureProblems(result as unknown as CaptureResult, check.mode, context?.braveShields);
		case 'ktx2': {
			const ktx2 = result as unknown as Ktx2Result;
			context?.note?.(ktx2FormatsNote(ktx2, check.tier));
			return ktx2Problems(ktx2, {});
		}
		case 'warm-up':
			return warmUpProblems(result as unknown as WarmUpResult, check.tier);
		case 'stats':
			return statsProblems(result as unknown as StatsResult);
		case 'restarts':
			return restartProblems(
				result as unknown as RestartResult,
				check.start,
				context?.note,
				check.mode.build === 'threaded',
			);
		case 'same-canvas':
			return sameCanvasProblems(result as unknown as SameCanvasResult, check.mode);
		case 'memory':
			return (result.mode as { build?: string } | undefined)?.build === 'threaded'
				? []
				: ['the engine started without shared memory, so the load tested no maximum'];
		case 'room':
			return typeof result.room === 'number' ? [] : ['the page did not count its room'];
		case 'mip-levels': {
			const mips = result as unknown as MipLevelsResult;
			context?.note?.(mipLevelsNote(mips));
			return mipLevelsProblems(mips);
		}
		case 'environment-generator': {
			const { lines, problems } = generatorReport(result as unknown as GeneratorResult);
			if (problems.length === 0) context?.note?.(`the built-in room: ${lines.join('; ')}`);
			return problems;
		}
		case 'skin-pass': {
			const skin = result as unknown as SkinPassResult;
			context?.note?.(skinPassNote(skin));
			return skinPassProblems(skin);
		}
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
		case 'quality':
			return qualityProblems(result as unknown as QualityResult, context);
		case 'preset-check': {
			const quality = result as unknown as QualityResult;
			const problems = qualityProblems(quality, context);
			return problems.length > 0
				? problems
				: heavyCheckProblems(quality.mode, chosenPreset(quality));
		}
		case 'preset-change':
			return presetChangeProblems(
				result as unknown as PresetChangeResult,
				PRESET_CHANGE.from,
				PRESET_CHANGE.to,
			);
		case 'visual': {
			const visual = result as unknown as VisualResult;
			if (context) saveVisualResult(join(context.imageDir, 'frames', visualName(check)), visual);
			return visualProblems(check.scene, visual);
		}
		case 'bench': {
			if (context && typeof result.frame === 'string') {
				const folder = join(context.imageDir, 'frames');
				mkdirSync(folder, { recursive: true });
				const name = `${check.scene}-${check.page}-live.png`;
				writeFileSync(join(folder, name), Buffer.from(result.frame, 'base64'));
			}
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
		case 'texture-cache':
			return textureCacheProblems(check, result as ItemResult & TextureCacheResult);
		case 'overload': {
			const { overloaded, steps } = result as ItemResult & OverloadResult;
			if (!overloaded)
				return [
					`the GPU kept up with all ${steps.at(-1)?.count ?? 0} spheres, so no step overloaded it`,
				];
			return overloaded.completedFps ? [] : ['no frame completions were counted'];
		}
		case 'skinning':
			return skinningProblems(result as ItemResult & SkinningResult);
		case 'effect':
		case 'environment':
		case 'grass': {
			const cost = result as ItemResult & { failures?: string[]; on?: { intervalMs?: number } };
			const feature =
				check.kind === 'effect'
					? check.effect
					: check.kind === 'grass'
						? 'the grass swaying'
						: 'the environment';
			return [
				...(cost.failures ?? []).map((code) => `the engine failed with ${code}`),
				...(cost.on?.intervalMs ? [] : [`the page measured no frame with ${feature} on`]),
			];
		}
		case 'gpu-occlusion': {
			const occlusion = result as ItemResult & {
				failures?: string[];
				differingPixels?: number[];
				cost?: { on?: { intervalMs?: number } };
			};
			return [
				...(occlusion.failures ?? []).map((code) => `the engine failed with ${code}`),
				...(occlusion.differingPixels ?? []).flatMap((pixels, view) =>
					pixels > 0 ? [`view ${view} differs from culling off in ${pixels} pixels`] : [],
				),
				...(occlusion.cost?.on?.intervalMs ? [] : ['the page measured no frame with culling on']),
			];
		}
		case 'environment-load':
			return environmentLoadProblems(result);
		case 'sky-map': {
			const { lines, problems } = skyMapReport(result as ItemResult & SkyMapResult);
			if (problems.length === 0) context?.note?.(`the sky map: ${lines.join('; ')}`);
			return problems;
		}
		case 'sky-refresh': {
			const { line, problems } = skyRefreshReport(result as ItemResult & SkyRefreshResult);
			if (problems.length === 0) context?.note?.(line);
			return problems;
		}
		case 'shimmer': {
			const shimmer = result as ItemResult & { shimmer?: number };
			return typeof shimmer.shimmer === 'number' ? [] : ['the page measured no shimmer'];
		}
		case 'occlusion': {
			const occlusion = result as ItemResult & {
				failures?: string[];
				on?: { intervalMs?: number; occludedEntries?: number | null };
			};
			return [
				...(occlusion.failures ?? []).map((code) => `the engine failed with ${code}`),
				...(occlusion.on?.intervalMs ? [] : ['the page measured no frame with occlusion on']),
				...(occlusion.on?.occludedEntries ? [] : ['occlusion culling hid nothing in the city']),
			];
		}
		case 'occlusion-s6': {
			const turns = result as ItemResult & OcclusionTurnsResult;
			if (context)
				saveOcclusionS6Images(
					join(context.imageDir, 'frames', `occlusion-s6-${check.preset}-${check.buffer}`),
					turns,
				);
			return occlusionTurnsProblems(turns);
		}
		case 'jitter': {
			const jitter = result as unknown as JitterResult;
			if (context)
				saveJitterResult(join(context.imageDir, 'frames', `jitter-${check.tier}`), jitter);
			return jitterProblems(jitter);
		}
		case 'animation':
			return animationProblems(result as ItemResult & AnimationResult);
		case 'tab-memory':
			return growthProblems(result, context?.progress);
		case 'soak':
			return soakProblems(result.soak as SoakReport | undefined);
		case 'recovery': {
			const scene = result as ItemResult & {
				failures?: string[];
				stats?: { frames?: number; gpuLosses?: number };
			};
			const losses = scene.stats?.gpuLosses;
			return [
				...(scene.failures ?? []).map((failure) => `the engine failed: ${failure}`),
				...((scene.stats?.frames ?? 0) > 0 ? [] : ['the engine drew no frames after the loss']),
				...(losses === 1 ? [] : [`the engine counted ${losses ?? 'no'} GPU losses, not 1`]),
				...imageRunProblems({ kind: 'image', run: check.run }, result, context),
			];
		}
		case 'warm-up-time': {
			const load = result as unknown as WarmUpTimeResult;
			const problems = warmUpTimeProblems(load);
			if (load.freshShaders !== check.fresh)
				problems.push(`the page loaded ${check.fresh ? 'without' : 'with'} fresh shaders`);
			return problems;
		}
		case 'governor':
			return governorProblems(result as ItemResult & GovernorResult);
		case 'object-growth':
			return objectGrowthProblems(result as ItemResult & ObjectGrowthResult);
	}
}

/** What the quality page reports: the preset, the GPU path and the device hints it chose from. */
interface QualityResult {
	mode: PresetMode & { crashedStarts: number };
	tier: EngineTier;
	hints: DeviceHints;
}

/** The preset that the engine chose from the device, before the preset check could lower it. */
const chosenPreset = ({ mode }: QualityResult) => mode.presetCheck?.from ?? mode.preset;

/**
 * Checks that the engine chose the preset that the chooser gives for the device hints and the GPU
 * path it reported, and notes the preset, the hints and what the preset check measured, so each
 * device's choice is on record.
 */
function qualityProblems(result: QualityResult, context?: JudgeContext): string[] {
	const { mode, tier, hints } = result;
	const chosen = chosenPreset(result);
	const expected = choosePreset({ wanted: 'auto', hints, crashedStarts: mode.crashedStarts }, tier);
	const memory = hints.deviceMemoryGB === null ? 'no memory reading' : `${hints.deviceMemoryGB} GB`;
	const check = mode.presetCheck
		? `the preset check measured ${mode.presetCheck.rounds.map(roundText).join(', then ')}, against a target of ${mode.presetCheck.targetFps}`
		: 'no preset check';
	context?.note?.(
		`quality preset ${chosen} on ${tier} for a ${deviceKind(hints)} (${hints.coarsePointer ? 'coarse' : 'fine'} pointer, smaller screen edge ${hints.screenMinEdge} px, ${memory}, ${mode.crashedStarts} crashed starts); ${check}; ${mode.preset} runs`,
	);
	return chosen === expected
		? []
		: [`the engine chose the ${chosen} preset, where the chooser gives ${expected}`];
}

/**
 * The benchmark report of one runner's results: each page's runs summarized, apart for each job
 * worker count. Undefined when the plan has no benchmarks.
 */
export function benchSummary(
	items: readonly PlanItem<Check>[],
	resultOf: (id: string) => ItemResult | undefined,
): string | undefined {
	const rows = benchRows(items, resultOf);
	return rows && benchReport(rows).join('\n');
}

/**
 * One runner's benchmark pages, each with its successful runs summarized and its visual figures,
 * apart for each job worker count. A page whose runs all failed has no row. Undefined when the
 * plan has no benchmarks.
 */
export function benchRows(
	items: readonly PlanItem<Check>[],
	resultOf: (id: string) => ItemResult | undefined,
): SummaryRow[] | undefined {
	type Group = Omit<SummaryRow, 'summary'> & { results: BenchResult[]; visualKey?: string };
	const groups = new Map<string, Group>();
	const visual = new Map<string, VisualResult>();
	for (const item of items) {
		const { check } = item;
		if (check.kind === 'visual') {
			const result = resultOf(item.id);
			if (result?.ok && result.stability)
				visual.set(visualName(check), result as unknown as VisualResult);
		}
		if (check.kind !== 'bench') continue;
		const { scene, page, jobs, reflection } = check;
		const kind = reflection ? `${page} reflection=${reflection}` : page;
		const key = `${scene} ${kind} ${jobs ?? ''}`;
		const group = groups.get(key) ?? {
			scene,
			kind,
			jobs,
			results: [],
			...(isNull3dPage(page) && { visualKey: visualName(check) }),
		};
		const result = resultOf(item.id);
		if (result?.ok) group.results.push(result as unknown as BenchResult);
		groups.set(key, group);
	}
	if (groups.size === 0) return undefined;
	return [...groups.values()]
		.filter((group) => group.results.length > 0)
		.map(({ results, visualKey, ...row }) => {
			const figures = visualKey === undefined ? undefined : visual.get(visualKey);
			return {
				...summaryRow(row, results),
				...(figures && { visual: visualFigures(row.scene, figures) }),
			};
		});
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

/** A share of a tile's pixels as a percentage, or 0 when none fight. */
const shareText = ({ fighting, pixels }: { fighting: number; pixels: number }) =>
	fighting === 0 ? '0' : `${(100 * Math.min(1, fighting / pixels)).toFixed(1)}%`;

/**
 * The fighting pixels of each depth precision run as a Markdown table: the depth that each run drew,
 * its fighting pixels in all, and the share of each distance's pixels that fight. Undefined when the
 * plan has no depth precision runs.
 */
export function depthSummary(
	items: readonly PlanItem<Check>[],
	resultOf: (id: string) => ItemResult | undefined,
): string | undefined {
	const runs = items.flatMap(({ id, check }) =>
		check.kind === 'image' && isDepthTest(check.run.test) ? [{ id, run: check.run }] : [],
	);
	if (runs.length === 0) return undefined;
	const distances = PRECISION.distances.map(distanceLabel);
	const lines = [
		`| Test | Tier | Depth drawn | Fighting pixels | ${distances.join(' | ')} |`,
		`| --- | --- | --- | --- | ${distances.map(() => '---').join(' | ')} |`,
	];
	const empty = distances.map(() => '').join(' | ');
	for (const { id, run } of runs) {
		const result = resultOf(id);
		const where = `${run.test} | ${run.tier}`;
		if (!result?.ok) {
			lines.push(`| ${where} | ${result ? failureText(result) : NO_RESULT} | | ${empty} |`);
			continue;
		}
		const facts = result as ItemResult & Partial<PrecisionFacts>;
		// A browser without EXT_clip_control draws reversed depth in WebGL2's range instead.
		const asked = /[?&]depth=([^&]+)/.exec(run.path)?.[1] ?? 'reversed';
		const fellBack = asked === 'reversed' && result.depth !== asked;
		const drawn = `${String(result.depth)}${fellBack ? ' (no EXT_clip_control)' : ''}`;
		const shares = (facts.tiles ?? []).map(shareText).join(' | ');
		lines.push(`| ${where} | ${drawn} | ${facts.fighting ?? 'unknown'} | ${shares || empty} |`);
	}
	return lines.join('\n');
}

/** A rate in frames per second, to one decimal place, or a dash when there is none. */
const fpsText = (fps: number | null) => (fps === null ? '-' : fps.toFixed(1));

/**
 * One row of the overload summary: a GPU path's step that overloaded the GPU with a ?queue= setting,
 * or why none did.
 */
function overloadRow(
	{ tier, queue = 'engine' }: { tier: Tier; queue?: string },
	result: ItemResult | undefined,
): string {
	const where = `${tier} | ${queue}`;
	if (!result?.ok)
		return `| ${where} | ${result ? failureText(result) : NO_RESULT} | | | | | | | |`;
	const { displayHz, overloaded } = result as ItemResult & OverloadResult;
	if (!overloaded)
		return `| ${where} | ${displayHz ?? '-'} Hz | no step overloaded the GPU | | | | | | |`;
	const step: OverloadStep = overloaded;
	const latency = step.gpuLatencyMs;
	const inFlight = framesInFlight(step);
	const cells = [
		where,
		`${displayHz ?? '-'} Hz`,
		step.count,
		fpsText(step.presentedFps),
		fpsText(step.completedFps),
		ratesParted(step) ? 'yes' : 'no',
		latency ? `${latency.median.toFixed(1)} / ${latency.p95.toFixed(1)}` : '-',
		inFlight === null ? '-' : inFlight.toFixed(1),
		step.gpuMs === null ? '-' : step.gpuMs.toFixed(1),
	];
	return `| ${cells.join(' | ')} |`;
}

/**
 * The GPU-bound page's results as a Markdown table: for each GPU path and ?queue= setting, the load
 * that overloaded the GPU, the presented and completed rates there, whether they parted, the time
 * from submit to completion, the frames in flight that it makes, and the GPU time. Undefined when
 * the plan has no GPU-bound pages.
 */
export function overloadSummary(
	items: readonly PlanItem<Check>[],
	resultOf: (id: string) => ItemResult | undefined,
): string | undefined {
	const rows = items.flatMap(({ id, check }) =>
		check.kind === 'overload' ? [overloadRow(check, resultOf(id))] : [],
	);
	if (rows.length === 0) return undefined;
	return [
		'| Path | Queue | Display | Spheres | Presented fps | Completed fps | Parted | Submit to completion, median / p95 ms | Frames in flight | GPU ms |',
		'| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
		...rows,
	].join('\n');
}

/**
 * The governor plan's results as a Markdown table: for each stage on each GPU path, what the stage
 * did, as `governorSummary` of the page's module says it. Undefined when the plan has no stress
 * test pages.
 */
export function governorSummary(
	items: readonly PlanItem<Check>[],
	resultOf: (id: string) => ItemResult | undefined,
): string | undefined {
	const rows = items.flatMap(({ id, check }) => {
		if (check.kind !== 'governor') return [];
		const result = resultOf(id);
		const text = !result?.ok
			? result
				? failureText(result)
				: NO_RESULT
			: governorLine(result as ItemResult & GovernorResult);
		return [`| ${check.stage} | ${check.tier} | ${text} |`];
	});
	if (rows.length === 0) return undefined;
	return ['| Stage | Path | Result |', '| --- | --- | --- |', ...rows].join('\n');
}

/** Milliseconds to two decimal places, or a dash when there are none. */
const msText = (ms: number | null) => (ms === null ? '-' : ms.toFixed(2));

/**
 * The animation page's results as a Markdown table: for each crowd, the joints per character, the
 * job workers, the step's median, 90th percentile and mean on the page's thread, and the job
 * workers' busy time per frame. Undefined when the plan has no animation pages.
 */
export function animationSummary(
	items: readonly PlanItem<Check>[],
	resultOf: (id: string) => ItemResult | undefined,
): string | undefined {
	const rows = items.flatMap(({ id, check }) => {
		if (check.kind !== 'animation') return [];
		const result = resultOf(id);
		if (!result?.ok)
			return [`| ${check.characters} | ${result ? failureText(result) : NO_RESULT} | | | | | |`];
		const { joints, jobWorkers, step, jobMsPerFrame } = result as ItemResult & AnimationResult;
		const cells = [
			String(check.characters),
			String(joints),
			String(jobWorkers),
			...[step.medianMs, step.p90Ms, step.meanMs, jobMsPerFrame].map(msText),
		];
		return [`| ${cells.join(' | ')} |`];
	});
	if (rows.length === 0) return undefined;
	return [
		"Each frame, every character blends two clips. Step: ms on the page's thread per frame. Job workers: their busy ms per frame, added up.",
		'',
		'| Characters | Joints | Job workers | Step median | Step p90 | Step mean | Job workers |',
		'| --- | --- | --- | --- | --- | --- | --- |',
		...rows,
	].join('\n');
}

/**
 * The jitter pages' results as a Markdown table: for each GPU path and flight, how far its objects'
 * motions strayed from the flight at the origin, and from their own mean motion. Undefined when the
 * plan has no jitter pages.
 */
export function jitterSummary(
	items: readonly PlanItem<Check>[],
	resultOf: (id: string) => ItemResult | undefined,
): string | undefined {
	const rows = items.flatMap(({ id, check }) => {
		if (check.kind !== 'jitter') return [];
		const result = resultOf(id);
		if (!result?.ok)
			return [`| ${check.tier} | ${result ? failureText(result) : NO_RESULT} | | | |`];
		return jitterRows(check.tier, result as unknown as JitterResult);
	});
	if (rows.length === 0) return undefined;
	return [...JITTER_TABLE_HEAD, ...rows].join('\n');
}

/**
 * The skinning pages' results as Markdown tables, one per GPU interface: for each crowd and cascade
 * count, the characters that the main pass and each cascade drew, then each path's frame time,
 * JavaScript time and GPU time per frame, the share of the frame time that skinning once saves,
 * and the pixels in which the two paths' images differ. Undefined when the plan has no skinning
 * pages.
 */
export function skinningSummary(
	items: readonly PlanItem<Check>[],
	resultOf: (id: string) => ItemResult | undefined,
): string | undefined {
	const tables = (['webgl2', 'webgpu'] as const).flatMap((gpu) => {
		const [each, once] = skinningPaths(gpu);
		const rows = items.flatMap(({ id, check }) => {
			if (check.kind !== 'skinning' || check.tier !== gpu) return [];
			const where = `${check.characters} | ${check.cascades}`;
			const result = resultOf(id);
			if (!result?.ok)
				return [`| ${where} | ${result ? failureText(result) : NO_RESULT} | | | | | |`];
			const skinning = result as ItemResult & SkinningResult;
			const path = (name: SkinningPath) => {
				const { frameMs, cpuMs, gpuMs } = pathTiming(skinning, name);
				return `${msText(frameMs)} / ${msText(cpuMs)} / ${msText(gpuMs)}`;
			};
			const cells = [
				where,
				`${skinning.drawn.join(' / ')} (${skinning.skinned})`,
				path(each),
				path(once),
				`${(100 * frameSaving(skinning)).toFixed(1)}%`,
				`${skinning.image.differing} of ${skinning.image.pixels}`,
				...(gpu === 'webgl2' ? [skinning.multiDraw ? 'yes' : 'no'] : []),
			];
			return [`| ${cells.join(' | ')} |`];
		});
		if (rows.length === 0) return [];
		const heads = [
			'Characters',
			'Cascades',
			'Drawn',
			'Vertex shader',
			gpu === 'webgl2' ? 'Transform feedback' : 'Compute pass',
			'Saved',
			'Pixels that differ',
			...(gpu === 'webgl2' ? ['Multi-draw'] : []),
		];
		return [
			[
				`${gpu === 'webgl2' ? 'WebGL2' : 'WebGPU'}. Each path: frame ms / JavaScript ms / GPU ms per frame, medians. Drawn: the main pass, then each cascade, with the characters skinned once in brackets.`,
				'',
				`| ${heads.join(' | ')} |`,
				`| ${heads.map(() => '---').join(' | ')} |`,
				...rows,
			].join('\n'),
		];
	});
	return tables.length === 0 ? undefined : tables.join('\n\n');
}

/**
 * The tab memory pages' results as a Markdown table: for each growth, the last MiB that lived, the
 * steps, and how the growth ended, from the page's result or, where the tab died, from its last
 * progress. Then the lowest point at which each kind of growth failed. Undefined when the plan has
 * no tab memory pages.
 */
export function tabMemorySummary(
	items: readonly PlanItem<Check>[],
	resultOf: (id: string) => ItemResult | undefined,
): string | undefined {
	const rows: string[] = [];
	const failedAt = new Map<string, number>();
	for (const { id, check } of items) {
		if (check.kind !== 'tab-memory') continue;
		const result = resultOf(id);
		const progress = resultOf(progressName(id));
		rows.push(
			growthRow({ kind: check.growth, gpu: check.tier, round: check.round }, result, progress),
		);
		const facts = result?.ok ? result : progress;
		const lived = facts?.livedMiB;
		const step = facts?.stepMiB;
		if (typeof lived !== 'number' || typeof step !== 'number' || result?.end === 'cap') continue;
		const key = `${check.growth}${check.tier ? ` on ${check.tier}` : ''}`;
		failedAt.set(key, Math.min(failedAt.get(key) ?? Number.POSITIVE_INFINITY, lived + step));
	}
	if (rows.length === 0) return undefined;
	const lowest = [...failedAt].map(([key, mib]) => `- ${key}: failed at ${mib} MiB`);
	return [
		...GROWTH_TABLE_HEAD,
		...rows,
		'',
		lowest.length > 0
			? `The lowest failure point of each growth, the step after the last that lived:\n${lowest.join('\n')}`
			: 'No growth failed below its cap.',
	].join('\n');
}

/**
 * The soaks as a Markdown table: for each GPU path, the preset that ran and what the preset check
 * measured, the minutes measured, the GPU losses that the engine recovered from and when, the
 * median and lowest frame rates of a minute, the growth of the WebAssembly memory, and the
 * engine's failures. Undefined when the plan has no soaks.
 */
export function soakSummary(
	items: readonly PlanItem<Check>[],
	resultOf: (id: string) => ItemResult | undefined,
): string | undefined {
	const rows = items.flatMap(({ id, check }) => {
		if (check.kind !== 'soak') return [];
		const result = resultOf(id);
		const report = result?.soak as SoakReport | undefined;
		if (!report)
			return [`| ${check.tier} | ${result ? failureText(result) : NO_RESULT} | | | | | | |`];
		return [soakRow(check.tier, report, result?.mode as SoakMode | undefined)];
	});
	return rows.length === 0 ? undefined : [...SOAK_TABLE_HEAD, ...rows].join('\n');
}

/**
 * The warm-up times as a Markdown table: for each scene on each GPU path, the medians of the fresh
 * loads, and the last plain load, which reuses what the browser compiled. Loads that failed stay
 * out. Undefined when the plan has no warm-up time pages.
 */
export function warmUpTimeSummary(
	items: readonly PlanItem<Check>[],
	resultOf: (id: string) => ItemResult | undefined,
): string | undefined {
	const groups = new Map<string, WarmUpLoads>();
	for (const { id, check } of items) {
		if (check.kind !== 'warm-up-time') continue;
		const key = `${check.scene} ${check.tier}`;
		const group = groups.get(key) ?? {
			scene: check.scene,
			tier: check.tier,
			fresh: [],
			cached: [],
		};
		groups.set(key, group);
		const result = resultOf(id);
		if (!result?.ok) continue;
		const load = result as unknown as WarmUpTimeResult;
		if (warmUpTimeProblems(load).length > 0) continue;
		if (check.fresh) group.fresh.push(load);
		else group.cached = [load];
	}
	if (groups.size === 0) return undefined;
	return [...WARM_UP_TABLE_HEAD, ...[...groups.values()].map(warmUpTimeRow)].join('\n');
}
