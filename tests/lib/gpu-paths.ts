// The GPU paths that a device offers, as the capabilities page reports them, and the pages that a
// runner page skips on a device that lacks a path. The runner page and the command-line tool both
// use this module, so it imports no Node module.

import type { Tier } from '../../packages/cli/src/page.js';
import type { ItemResult } from './runs.ts';

/** GPU names that mark drawing on the CPU, as on a machine or a virtual machine without a GPU. */
export const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|basic render driver/i;

/** A GPU path that a page can force with `?gpu=`: core WebGPU, WebGPU's compatibility mode, or WebGL2. */
export type GpuPath = Tier;

/** Each GPU path's name in the run's output and in the record of tested devices. */
export const GPU_PATH_NAMES: Readonly<Record<GpuPath, string>> = {
	webgpu: 'WebGPU',
	compat: 'compatibility mode',
	webgl2: 'WebGL2',
};

/** The GPU interfaces that a run lets a device lack. WebGPU covers its compatibility mode. */
export type MissingAllowed = Readonly<Record<'webgpu' | 'webgl2', boolean>>;

/** Nothing may be missing: every page must run. */
export const NONE_MISSING: MissingAllowed = { webgpu: false, webgl2: false };

/** The part of the capabilities page's report that tells which GPU paths the engine can start. */
interface PathReport {
	webgpu?: { compatibilityAdapter?: boolean; coreFeaturesAndLimits?: boolean };
	webgl2?: { available?: boolean };
}

/**
 * The GPU paths whose pages a runner page skips: those that the device lacks, where the run lets it
 * lack them. The tests are those that the engine picks its path with: core WebGPU needs an adapter
 * with core features and limits, compatibility mode needs any adapter, and WebGL2 needs a context.
 * Without a report from the capabilities page, nothing is skipped.
 */
export function pathsToSkip(
	capabilities: ItemResult | undefined,
	allowed: MissingAllowed,
): GpuPath[] {
	const report = capabilities?.ok ? (capabilities.report as PathReport | undefined) : undefined;
	if (!report) return [];
	const adapter = report.webgpu?.compatibilityAdapter === true;
	const offers: Record<GpuPath, boolean> = {
		webgpu: adapter && report.webgpu?.coreFeaturesAndLimits === true,
		compat: adapter,
		webgl2: report.webgl2?.available === true,
	};
	return (Object.keys(offers) as GpuPath[]).filter(
		(path) => !offers[path] && allowed[path === 'webgl2' ? 'webgl2' : 'webgpu'],
	);
}

/** The result that a runner page posts for a page it skipped, because the device lacks its GPU path. */
export const skippedResult = (path: GpuPath): ItemResult => ({
	ok: false,
	skipped: path,
	error: `the device lacks ${GPU_PATH_NAMES[path]}`,
});

/** The GPU path of a page that a runner page skipped, or undefined for a page that ran. */
export function skippedPath(result: ItemResult): GpuPath | undefined {
	const path = result.skipped;
	return typeof path === 'string' && path in GPU_PATH_NAMES ? (path as GpuPath) : undefined;
}

/** Says which GPU paths' pages a runner page skipped, for the run's summary and the record. */
export const skippedPathsText = (paths: readonly GpuPath[]) =>
	`skipped the pages for ${paths.map((path) => GPU_PATH_NAMES[path]).join(' and ')}, which the device lacks`;
