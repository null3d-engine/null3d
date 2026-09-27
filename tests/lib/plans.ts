// Plans for the runner page, and how each page's result is judged. A plan item says which page to
// open with which switches, and what to check in the page's result.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	BASELINE_PAIR,
	compareFrames,
	comparisonName,
	decodeHoldResult,
	differenceText,
	type HoldFrame,
	holdPagePath,
	PARITY_SCENES,
	type PagePair,
	type ParityScene,
	parityFiles,
	passesWithBaseline,
	TIER_PAIRS,
} from '../../bench/lib/parity.ts';
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
	| { kind: 'hold'; tier: Tier }
	| { kind: 'parity'; tier: Tier; scene: ParityScene; pair: PagePair };

/** What judging can reach besides the result itself. */
export interface JudgeContext {
	/** Another item's result from the same runner in the same run. */
	resultOf(id: string): ItemResult | undefined;
	/** The folder for images that judging saves, such as parity diffs. */
	imageDir: string;
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
 * The benchmark scenes' hold frames from sokko3d and three.js on both GPU tiers. Each three.js
 * page must publish a frame. Each sokko3d page must match the three.js page of its tier from the
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

export const PLANS: Readonly<Record<string, () => PlanItem<Check>[]>> = {
	checks: checksPlan,
	parity: parityPlan,
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

/** True when a page failed because the browser offers no WebGPU at all. */
function missingWebGPU(error: string | undefined): boolean {
	return error !== undefined && NO_WEBGPU_ERRORS.some((start) => error.startsWith(start));
}

/** How much three.js's two renderers differ on a scene's hold frame in the same run, if both drew it. */
function baselineShare(scene: ParityScene, context: JudgeContext): number | null {
	try {
		const webgl = context.resultOf(parityItemId(scene, BASELINE_PAIR.candidate));
		const webgpu = context.resultOf(parityItemId(scene, BASELINE_PAIR.reference));
		if (!webgl || !webgpu) return null;
		return compareFrames(decodeHoldResult(webgl), decodeHoldResult(webgpu)).share;
	} catch {
		return null;
	}
}

/**
 * Compares a sokko3d page's hold frame with the frame of its three.js page from the same run, and
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
		if (passesWithBaseline(comparison.share, baseline)) return [];
		const images = files.map(({ file }) => join(context.imageDir, file)).join(', ');
		return [`against ${referenceId}, ${differenceText(comparison, baseline)}. Images: ${images}`];
	} catch (e) {
		return [(e as Error).message];
	}
}

/**
 * What is wrong with a page's result; empty when nothing is. A missing WebGPU on a WebGPU check is a
 * skip when allowed, because some devices have no WebGPU in any browser. A parity check needs the
 * context, to reach the result that it compares with.
 */
export function judge(
	check: Check,
	result: ItemResult,
	allowNoWebGPU: boolean,
	context?: JudgeContext,
): string[] | 'skip' {
	if (!result.ok) {
		if (allowNoWebGPU && 'tier' in check && check.tier === 'webgpu' && missingWebGPU(result.error))
			return 'skip';
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
			if (!result.webgpu && !allowNoWebGPU) problems.push('no WebGPU to compile the WGSL');
			return problems;
		}
		case 'engine':
			return engineProblems(result as unknown as EngineResult, check.mode, check.tier);
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
