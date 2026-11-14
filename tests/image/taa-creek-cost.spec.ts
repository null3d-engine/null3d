// The temporal resolve's cost in the Creek showcase, which draws the opaque, blended, subsurface and
// reflection passes that a busy scene has. tests/pages/taa-creek-cost.ts plays the scene at
// 1920 x 1080 with the resolve off and on in turns and reports the medians of GPU time per frame.
// It runs only with NULL3D_TAA_COST set, on a computer with a GPU of its own:
// NULL3D_TAA_COST=1 bun run test:browser -- taa-creek-cost.spec.ts --workers=1.
import { expect, test } from '@playwright/test';
import { costTimeout, loadNow, sideLine, waitForQuiet } from '../lib/effect-cost.ts';
import { pageResult } from '../lib/page-result.ts';

interface CostSide {
	gpuMs: number | null;
	intervalMs: number | null;
	cpuMs: number | null;
	threads: Record<string, number | null>;
}

interface CreekCostResult {
	ok: boolean;
	error?: string;
	gpu: string;
	phone: boolean;
	tier: string;
	preset: string;
	off: CostSide;
	on: CostSide;
	failures: string[];
}

const paths = (process.env.NULL3D_TAA_PATHS ?? 'webgpu,webgl2').split(',');
const presets = (process.env.NULL3D_TAA_PRESETS ?? 'low,medium,high').split(',');
const phoneRuns = process.env.NULL3D_TAA_PHONE === '1' ? [false, true] : [false];

for (const gpu of paths)
	for (const preset of presets)
		for (const phone of phoneRuns)
			test(`the Creek's cost on ${gpu} at ${preset}${phone ? ' on the phone path' : ''}`, async ({
				page,
			}) => {
				test.skip(!process.env.NULL3D_TAA_COST, 'set NULL3D_TAA_COST to time the resolve');
				test.setTimeout(costTimeout(600_000));
				const loadBefore = await waitForQuiet();
				await page.goto(
					`taa-creek-cost.html?gpu=${gpu}&preset=${preset}&size=1920x1080${phone ? '&phone=1' : ''}`,
				);
				const result = await pageResult<CreekCostResult>(page, 700_000);
				expect(result.error).toBeUndefined();
				expect(result.failures).toEqual([]);
				const delta =
					result.off.gpuMs === null || result.on.gpuMs === null
						? 'none'
						: (result.on.gpuMs - result.off.gpuMs).toFixed(3);
				console.log(
					[
						`TAADCREEK ${result.tier} at ${preset} (drawn at ${result.preset})${result.phone ? ' on the phone path' : ''}, load ${loadBefore} before and ${loadNow()} after, resolve adds ${delta} ms`,
						sideLine('off', result.off, 3),
						sideLine('on', result.on, 3),
					].join('\n'),
				);
			});
