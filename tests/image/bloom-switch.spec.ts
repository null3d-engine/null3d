// Bloom turned on during play, on every GPU tier. In compatibility mode the engine started on the
// 8-bit path for MSAA, and moves to HDR color with FXAA: the frames after the change make bloom's
// targets and pipelines and raise no error, and the frames after it make no GPU object. The image
// tests check what the frames draw, in hold mode. Each run logs the change's figures, which D-21
// records.
import { expect, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

interface BloomSwitchResult {
	error?: string;
	tier: string;
	startedHdr: boolean;
	settledFrames: number;
	settledMs: number;
	beforeIntervalP99: number;
	acrossIntervalP99: number;
	acrossGpuObjects: number;
	acrossPipelines: number;
	afterGpuObjects: number;
	afterPipelines: number;
	failures: string[];
}

const TIERS = [
	{ tier: 'webgpu', query: 'gpu=webgpu', startedHdr: true },
	{ tier: 'webgpu-compat', query: 'gpu=compat', startedHdr: false },
	{ tier: 'webgl2', query: 'gpu=webgl2', startedHdr: true },
] as const;

for (const { tier, query, startedHdr } of TIERS)
	test(`bloom turned on during play draws on ${tier}`, async ({ page }) => {
		await page.goto(`bloom-switch.html?${query}`);
		const result = await pageResult<BloomSwitchResult>(page, 60_000);
		console.log(`bloom switch on ${tier}: ${JSON.stringify(result)}`);
		expect(result.error).toBeUndefined();
		expect(result.tier).toBe(tier);
		expect(result.failures).toEqual([]);
		expect(result.startedHdr).toBe(startedHdr);
		expect(result.acrossGpuObjects).toBeGreaterThan(0);
		expect(result.acrossPipelines).toBeGreaterThan(0);
		expect(result.afterGpuObjects).toBe(0);
		expect(result.afterPipelines).toBe(0);
	});
