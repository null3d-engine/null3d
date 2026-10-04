// The runner page's skips of GPU paths that a device lacks. The reports are the capabilities
// page's, cut to the facts that decide the paths, from runs on these devices: the Redmi Note 13
// (Chrome 138 on TestingBot), which offers WebGPU's compatibility mode only; the Galaxy S24
// (Chrome), which gives no WebGPU adapter; and an iPad (Safari), which offers every path.
import { describe, expect, it } from 'bun:test';
import { parseArgs, planItems, summaryLine } from '../real-browsers.ts';
import { testedDeviceRow } from './device-record.ts';
import {
	type GpuPath,
	type MissingAllowed,
	NONE_MISSING,
	pathsToSkip,
	skippedPath,
	skippedPathsText,
	skippedResult,
} from './gpu-paths.ts';
import { type Check, gpuPathOf, judge, withGpuPaths } from './plans.ts';
import type { ItemResult, PlanItem } from './runs.ts';

const capabilities = (
	compatibilityAdapter: boolean,
	coreFeaturesAndLimits: boolean,
	webgl2 = true,
): ItemResult => ({
	ok: true,
	report: {
		webgpu: { available: true, compatibilityAdapter, coreFeaturesAndLimits },
		webgl2: { available: webgl2 },
	},
});
const REDMI = capabilities(true, false);
const GALAXY = capabilities(false, false);
const IPAD = capabilities(true, true);
const NO_WEBGL2 = capabilities(true, true, false);
const ALLOW_NO_WEBGPU: MissingAllowed = { webgpu: true, webgl2: false };
const ALLOW_NO_WEBGL2: MissingAllowed = { webgpu: false, webgl2: true };

describe('the GPU paths that a runner page skips', () => {
	it('skips the core WebGPU pages where only compatibility mode exists', () => {
		expect(pathsToSkip(REDMI, ALLOW_NO_WEBGPU)).toEqual(['webgpu']);
	});

	it('skips both WebGPU paths where the browser gives no adapter', () => {
		expect(pathsToSkip(GALAXY, ALLOW_NO_WEBGPU)).toEqual(['webgpu', 'compat']);
	});

	it('skips the WebGL2 pages where the browser gives no WebGL2 context', () => {
		expect(pathsToSkip(NO_WEBGL2, ALLOW_NO_WEBGL2)).toEqual(['webgl2']);
		expect(pathsToSkip(NO_WEBGL2, ALLOW_NO_WEBGPU)).toEqual([]);
	});

	it('skips nothing on a device with every path', () => {
		expect(pathsToSkip(IPAD, { webgpu: true, webgl2: true })).toEqual([]);
	});

	it('skips nothing that the run does not let the device lack', () => {
		expect(pathsToSkip(REDMI, NONE_MISSING)).toEqual([]);
		expect(pathsToSkip(GALAXY, ALLOW_NO_WEBGL2)).toEqual([]);
	});

	it('skips nothing without a report from the capabilities page', () => {
		expect(pathsToSkip(undefined, ALLOW_NO_WEBGPU)).toEqual([]);
		expect(pathsToSkip({ ok: false, error: 'no result within 30 s' }, ALLOW_NO_WEBGPU)).toEqual([]);
	});

	it("marks a skipped page's result, which judging counts as a skip", () => {
		const result = skippedResult('webgpu');
		expect(skippedPath(result)).toBe('webgpu');
		expect(result.error).toBe('the device lacks WebGPU');
		expect(skippedPath({ ok: false, error: 'E1301: no usable GPU path' })).toBeUndefined();
		const image = checksPlan().find((item) => gpuPathOf(item) === 'webgpu') as PlanItem<Check>;
		expect(judge(image.check, result, NONE_MISSING)).toBe('skip');
	});
});

/** The checks plan's items, as the runner tool builds them. */
const checksPlan = () => planItems(parseArgs(['--plan', 'checks', 'Safari'])) as PlanItem<Check>[];

describe("each page's GPU path", () => {
	const item = (path: string, check: Check): PlanItem<Check> => ({
		id: 'page',
		path,
		timeoutSeconds: 30,
		check,
	});

	it("is the one that the page's ?gpu= switch forces", () => {
		const engine = { kind: 'stats', tier: 'webgpu' } as const;
		expect(gpuPathOf(item('/tests/pages/stats.html?gpu=webgpu', engine))).toBe('webgpu');
		expect(gpuPathOf(item('/tests/pages/image.html?preset=high&gpu=compat', engine))).toBe(
			'compat',
		);
	});

	it("is the check's otherwise, where any WebGPU adapter serves a WebGPU page", () => {
		expect(gpuPathOf(item('/tests/pages/uploads.html', { kind: 'uploads', tier: 'webgpu' }))).toBe(
			'compat',
		);
		expect(gpuPathOf(item('/tests/pages/shaders.html', { kind: 'shaders' }))).toBe('webgl2');
		expect(gpuPathOf(item('/tests/pages/mip-levels.html', { kind: 'mip-levels' }))).toBe('webgl2');
		expect(gpuPathOf(item('/tests/pages/capabilities.html', { kind: 'capabilities' }))).toBe(
			undefined,
		);
	});
});

describe("the plan's GPU paths", () => {
	it('lets the runner page skip by the report of the capabilities page', () => {
		const { items, flags } = withGpuPaths(checksPlan(), ALLOW_NO_WEBGPU);
		expect(flags).toEqual({ skipMissing: { report: 'capabilities', allowed: ALLOW_NO_WEBGPU } });
		expect(items.find((item) => item.id === 'shaders')?.gpu).toBe('webgl2');
		expect(items.find((item) => item.id === 'capabilities')?.gpu).toBeUndefined();
	});

	it('lets the runner page skip in every shard of the plan', () => {
		for (const shard of ['1/2', '2/2']) {
			const items = planItems(parseArgs(['--plan', 'checks', '--shard', shard, 'Safari']));
			expect(withGpuPaths(items as PlanItem<Check>[], ALLOW_NO_WEBGPU).flags).toEqual({
				skipMissing: { report: 'capabilities', allowed: ALLOW_NO_WEBGPU },
			});
		}
	});

	it('skips nothing in a run that lets no path be missing, or without a capabilities page', () => {
		expect(withGpuPaths(checksPlan(), NONE_MISSING).flags).toEqual({});
		const withoutReport = checksPlan().filter((item) => item.check.kind !== 'capabilities');
		expect(withGpuPaths(withoutReport, ALLOW_NO_WEBGPU).flags).toEqual({});
	});

	it("skips the Redmi's core WebGPU pages and runs its compatibility mode pages", () => {
		const { items } = withGpuPaths(checksPlan(), ALLOW_NO_WEBGPU);
		const skip = pathsToSkip(REDMI, ALLOW_NO_WEBGPU);
		const skipped = items.filter((item) => item.gpu && skip.includes(item.gpu));
		const count = (path: GpuPath) => items.filter((item) => item.gpu === path).length;
		expect(skipped.length).toBe(count('webgpu'));
		expect(skipped.length).toBeGreaterThan(80);
		expect(count('compat')).toBeGreaterThan(0);
		expect(skipped.every((item) => /[?&]gpu=webgpu\b/.test(item.path))).toBe(true);
	});
});

describe('the skipped paths in the output', () => {
	it("names them in the runner's summary line", () => {
		const counts = { pass: 270, skip: 87, fail: 0, skippedPaths: ['webgpu'] as GpuPath[] };
		expect(summaryLine('tbredmi-chrome', { ...counts, browser: 'Chrome 138' })).toBe(
			'tbredmi-chrome (Chrome 138): 270 passed, 87 skipped, 0 failed; skipped the pages for WebGPU, which the device lacks',
		);
		expect(skippedPathsText(['webgpu', 'compat'])).toBe(
			'skipped the pages for WebGPU and compatibility mode, which the device lacks',
		);
	});

	it("names them in the row's result", () => {
		const row = testedDeviceRow({
			run: '20261003-015519-checks',
			launch: 'lan',
			device: { userAgent: '', origin: 'https://local.testingbot.com:3001' },
			pass: 270,
			skip: 87,
			fail: 0,
			skippedPaths: ['webgpu'],
		});
		expect(row).toContain(
			'| 270 passed, 87 skipped, 0 failed; skipped the pages for WebGPU, which the device lacks |',
		);
	});
});
