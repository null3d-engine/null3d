// Plans for the runner page, and how each page's result is judged. A plan item says which page to
// open with which switches, and what to check in the page's result.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	BASELINE_PAIR,
	type BenchPageKind,
	compareFrames,
	comparisonName,
	decodeHoldResult,
	differenceText,
	type HoldFrame,
	holdPagePath,
	PARITY_SCENES,
	type PagePair,
	type ParityScene,
	pagePath,
	parityFiles,
	passesWithBaseline,
	SCENE_CODE,
	type StoredBaselines,
	TIER_PAIRS,
} from '../../bench/lib/parity.ts';
import { MEASURE_SECONDS, WARMUP_SECONDS } from '../../bench/scenes/spec.ts';
import {
	ENGINE_MODES,
	type EngineMode,
	type EngineResult,
	engineProblems,
} from './engine-checks.ts';
import { compareToReference } from './images.ts';
import type { ItemResult, PlanItem } from './runs.ts';

export type Tier = 'webgpu' | 'webgl2';

export type Check =
	| { kind: 'capabilities' }
	| { kind: 'isolation' }
	| { kind: 'clear'; tier: Tier }
	| { kind: 'shaders' }
	| { kind: 'engine'; tier: Tier; mode: EngineMode }
	| { kind: 'uploads'; tier: Tier }
	| { kind: 'hold'; tier: Tier }
	| { kind: 'parity'; tier: Tier; scene: ParityScene; pair: PagePair }
	| { kind: 'bench'; tier: Tier; scene: ParityScene; page: BenchPageKind };

/** What judging can reach besides the result itself. */
export interface JudgeContext {
	/** Another item's result from the same runner in the same run. */
	resultOf(id: string): ItemResult | undefined;
	/** The folder for images that judging saves, such as parity diffs. */
	imageDir: string;
	/** Baselines measured on a device that draws with both of three.js's renderers. */
	storedBaselines?: StoredBaselines;
}

const TEST_PAGES = '/tests/pages/';
const TIERS: readonly Tier[] = ['webgpu', 'webgl2'];
/** How long a benchmark page may take to publish its hold frame on a slow device. */
const HOLD_TIMEOUT_SECONDS = 60;

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-');

/** The browser checks: the capability report, isolation, clear colors, and the engine in every mode on both GPU paths. */
export function checksPlan(): PlanItem<Check>[] {
	return [
		{
			id: 'capabilities',
			path: `${TEST_PAGES}capabilities.html`,
			timeoutSeconds: 30,
			check: { kind: 'capabilities' },
		},
		{
			id: 'isolation',
			path: `${TEST_PAGES}isolation.html`,
			timeoutSeconds: 30,
			check: { kind: 'isolation' },
		},
		{
			id: 'shaders',
			path: `${TEST_PAGES}shaders.html`,
			timeoutSeconds: 30,
			check: { kind: 'shaders' },
		},
		{
			id: 'uploads',
			path: `${TEST_PAGES}uploads.html`,
			timeoutSeconds: 90,
			check: { kind: 'uploads', tier: 'webgpu' },
		},
		...TIERS.map((tier) => ({
			id: `clear-${tier}`,
			path: `${TEST_PAGES}clear.html?gpu=${tier}`,
			timeoutSeconds: 30,
			check: { kind: 'clear' as const, tier },
		})),
		...TIERS.flatMap((tier) =>
			ENGINE_MODES.map((mode) => ({
				id: `engine-${tier}-${slug(mode.name)}`,
				path: `${TEST_PAGES}engine.html?${[`gpu=${tier}`, 'seconds=2', mode.query].filter(Boolean).join('&')}`,
				timeoutSeconds: 45,
				check: { kind: 'engine' as const, tier, mode },
			})),
		),
	];
}

/** The name of the parity plan's item for one scene's hold page of one kind. */
const parityItemId = (scene: ParityScene, kind: string) => `parity-${scene}-${kind}`;

/**
 * The benchmark scenes' hold frames from null3d and three.js on both GPU tiers. Each three.js
 * page must publish a frame. Each null3d page must match the three.js page of its tier from the
 * same run, which judging compares.
 */
export function parityPlan(): PlanItem<Check>[] {
	return PARITY_SCENES.flatMap((scene) =>
		TIERS.flatMap((tier) => {
			const pair = TIER_PAIRS[tier];
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
}

/** Fresh runs of each benchmark page in the bench plan. */
const BENCH_RUNS = 3;
/**
 * The pages the bench plan compares, and the GPU tier each one draws with. The scene-code page
 * draws nothing, so it runs wherever the WebGL2 pages run.
 */
const BENCH_PAGES: readonly [BenchPageKind, Tier][] = [
	['null3d-webgpu', 'webgpu'],
	['null3d-webgl2', 'webgl2'],
	['threejs-webgpu', 'webgpu'],
	['threejs-webgl', 'webgl2'],
	[SCENE_CODE, 'webgl2'],
];

/** Settings a plan may take from the command line. */
export interface PlanSettings {
	/** The instance count of the benchmark pages, or undefined for the scene's default. */
	count?: number;
}

/**
 * The benchmark protocol for S1 in browsers that Playwright cannot drive: fresh runs of each page,
 * each a 5-second warm-up and 30 measured seconds, with `count` instances when given. The pages
 * take turns run by run, so a device that slows as it warms up slows every engine alike.
 */
export function benchPlan({ count }: PlanSettings = {}): PlanItem<Check>[] {
	return Array.from({ length: BENCH_RUNS }, (_, run) =>
		BENCH_PAGES.map(([page, tier]) => ({
			id: `bench-s1-${page}-${run + 1}`,
			path: pagePath('s1', page, count === undefined ? '' : `n=${count}`),
			timeoutSeconds: WARMUP_SECONDS + MEASURE_SECONDS + 60,
			check: { kind: 'bench' as const, tier, scene: 's1' as const, page },
		})),
	).flat();
}

export const PLANS: Readonly<Record<string, (settings?: PlanSettings) => PlanItem<Check>[]>> = {
	checks: checksPlan,
	parity: parityPlan,
	bench: benchPlan,
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
function neededPath(check: Check): Tier | undefined {
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

/**
 * What is wrong with a page's result; empty when nothing is. A check whose GPU path the browser
 * lacks is a skip when `missing` allows it: some devices have no WebGPU in any browser, and some
 * virtual machines give a browser no WebGL2. A parity check needs the context, to reach the result
 * that it compares with.
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
		return [result.error ?? 'the page failed without a message'];
	}
	switch (check.kind) {
		case 'capabilities':
			return [];
		case 'isolation': {
			const problems: string[] = [];
			if (!result.crossOriginIsolated) problems.push('the page is not cross-origin isolated');
			if (!result.threaded) problems.push('the threaded build did not load');
			return problems;
		}
		case 'clear':
			try {
				compareToReference(
					'clear',
					check.tier,
					Buffer.from(String(result.pixels ?? ''), 'base64'),
					Number(result.width ?? 0),
					Number(result.height ?? 0),
				);
				return [];
			} catch (e) {
				return [(e as Error).message];
			}
		case 'shaders': {
			const failures = (result.failures ?? []) as { shader: string; stage: string; log: string }[];
			const problems = failures.map((f) => `${f.shader} ${f.stage}: ${f.log.split('\n')[0]}`);
			if (!(Number(result.glslPrograms) > 0)) problems.push('no GLSL program was compiled');
			if (!result.webgpu && !missing.webgpu) problems.push('no WebGPU to compile the WGSL');
			return problems;
		}
		case 'engine':
			return engineProblems(result as unknown as EngineResult, check.mode, check.tier);
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
			return frames > 0 && cpu > 0 ? [] : [`the run measured ${frames} frames`];
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
	}
}
