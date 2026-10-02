// The warm-up time test: what the warm-up time page reports, what is wrong with a result, and the
// run's table. Each scene loads with fresh shaders, which the browser must compile, and then once
// with the shaders it compiled before.
import { median } from '../../packages/cli/src/protocol.js';

/** What the warm-up time page publishes. */
export interface WarmUpTimeResult {
	tier: string;
	mode: { preset?: string };
	/** WebGL2: whether the browser builds programs in the background; null on WebGPU. */
	backgroundCompile: boolean | null;
	freshShaders: boolean;
	/** Time createEngine took. */
	engineStartMs: number;
	/** Time from the call of createEngine until the first frame was on screen. */
	firstFrameShownMs: number;
	/** Time from the first frame's first pipeline build until none was building. */
	warmUpMs: number | null;
	/** Time the first frame's draw took, which holds the compiles it waited for. */
	firstDrawMs: number | null;
	/** Pipelines that the first frame built. */
	pipelines: number | null;
	failures: string[];
}

/** What is wrong with a warm-up time page's result; empty when nothing is. */
export function warmUpTimeProblems(result: WarmUpTimeResult): string[] {
	const problems = result.failures.map((failure) => `the engine failed: ${failure}`);
	if (typeof result.warmUpMs !== 'number' || typeof result.firstDrawMs !== 'number')
		problems.push('the engine recorded no warm-up');
	if (!(Number(result.pipelines) > 0)) problems.push('the first frame built no pipelines');
	return problems;
}

/** The pipelines' share of the start: the warm-up, then the first draw, which waits for compiles. */
export const pipelineWaitMs = (result: WarmUpTimeResult) =>
	(result.warmUpMs ?? 0) + (result.firstDrawMs ?? 0);

const ms = (value: number) => String(Math.round(value));

/** The loads of one scene on one GPU path: those with fresh shaders, and those without. */
export interface WarmUpLoads {
	scene: string;
	tier: string;
	fresh: WarmUpTimeResult[];
	cached: WarmUpTimeResult[];
}

/** A row of the table: the scene, the path, the preset, and the medians of each kind of load. */
export function warmUpTimeRow({ scene, tier, fresh, cached }: WarmUpLoads): string {
	const any = fresh[0] ?? cached[0];
	const background =
		any?.backgroundCompile === null || any === undefined
			? '-'
			: any.backgroundCompile
				? 'yes'
				: 'no';
	const figures = (loads: readonly WarmUpTimeResult[]) =>
		loads.length === 0
			? ['-', '-']
			: [
					ms(median(loads.map(pipelineWaitMs))),
					ms(median(loads.map((load) => load.firstFrameShownMs))),
				];
	const cells = [
		scene,
		tier,
		any?.mode.preset ?? '-',
		background,
		any?.pipelines ?? '-',
		...figures(fresh),
		...figures(cached),
	];
	return `| ${cells.join(' | ')} |`;
}

/** The header and legend of the table. */
export const WARM_UP_TABLE_HEAD = [
	'Pipeline wait: the warm-up plus the first draw, which waits for compiles a browser cannot do in the background. Shown: from createEngine until the first frame was on screen. Medians in ms; fresh loads compile every shader again.',
	'',
	'| Scene | Path | Preset | Background compile | Pipelines | Fresh: pipeline wait | Fresh: shown | Cached: pipeline wait | Cached: shown |',
	'| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
];
