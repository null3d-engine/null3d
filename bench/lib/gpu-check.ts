// The GPU check: what it compares, and its result in one line. CI's benchmark job has no
// GPU timer, so a change that slows only the GPU passes it. The GPU check compares two builds' GPU
// time per frame on the pages with the most GPU work, in Chrome on a computer's own GPU. A pull
// request that changes shaders or how the engine draws records its line in a trailer, and the
// nightly comparison of main on the owner's Mac logs it. .dev/decisions/D-109-gpu-time-guard.md
// gives the reasons.
import { GPU_CHECK_TRAILER } from '../../tools/hooks/check-gpu-ack';
import type { Comparison } from './compare';

/** The scenes with the most GPU work: S4's textured materials and S6's city. */
export const GPU_CHECK_SCENES = ['s4', 's6'] as const;
/** The page that the check runs: WebGPU, where MSAA draws at Medium and above. */
export const GPU_CHECK_PAGE = 'null3d-webgpu';
/** The presets that the check runs, each with a comparison of its own. */
export const GPU_CHECK_PRESETS = ['medium', 'high'] as const;

/** One preset's comparison: its GPU time comparisons, and why it measured in two ways, if so. */
export interface PresetComparison {
	preset: string;
	comparisons: readonly Comparison[];
	measurementChanges: readonly string[];
}

export type GpuCheckStatus = 'passed' | 'failed' | 'not measured' | 'not judged';

export interface GpuCheckResult {
	status: GpuCheckStatus;
	/** The trailer line, which names the two commits, the status and each page's GPU times. */
	line: string;
}

const signed = (change: number) => `${change >= 0 ? '+' : ''}${(change * 100).toFixed(1)}%`;

/** A page's GPU times in words, with "slower" when the rule failed it. */
function figureText(preset: string, c: Comparison): string {
	const slower = c.result === 'slower' ? (c.expected ? ', slower, expected' : ', slower') : '';
	return `${c.scene} ${preset} ${c.baseline.median.toFixed(2)} to ${c.new.median.toFixed(2)} ms (${signed(c.change)}${slower})`;
}

/**
 * The check's result. It is not measured when a page of the plan has no GPU times from both builds,
 * as in a browser without a GPU timer. It is not judged when the benchmark pages changed between
 * the two commits, so the builds draw different work. Otherwise it fails when a page's GPU time is
 * slower than the comparison's rule allows and no Bench-Expected trailer names it.
 */
export function gpuCheckResult(
	presets: readonly PresetComparison[],
	commits: string,
): GpuCheckResult {
	const figures: string[] = [];
	const missing: string[] = [];
	let slower = false;
	for (const { preset, comparisons } of presets)
		for (const scene of GPU_CHECK_SCENES) {
			const gpu = comparisons.find(
				(c) => c.scene === scene && c.kind === GPU_CHECK_PAGE && c.measure === 'gpu-time',
			);
			if (!gpu) {
				missing.push(`${scene} ${preset}`);
				continue;
			}
			figures.push(figureText(preset, gpu));
			slower ||= gpu.result === 'slower' && gpu.expected === null;
		}
	const changed = presets.some((p) => p.measurementChanges.length > 0);
	const status: GpuCheckStatus =
		missing.length > 0 ? 'not measured' : changed ? 'not judged' : slower ? 'failed' : 'passed';
	const notes = [
		...(missing.length > 0 ? [`no GPU time from both builds on ${missing.join(', ')}`] : []),
		...(changed ? ['the benchmark pages changed between the commits'] : []),
	];
	return {
		status,
		line: `${GPU_CHECK_TRAILER}: ${commits} ${status}: ${[...figures, ...notes].join('; ')}`,
	};
}

/** True when the result lets a pull request merge: it passed, or the pages changed under it. */
export const gpuCheckPasses = ({ status }: GpuCheckResult) =>
	status === 'passed' || status === 'not judged';
