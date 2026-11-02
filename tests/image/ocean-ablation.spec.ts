// The ocean's simulation cost on each GPU path, as an on/off ablation in separate page loads: one
// load draws the sea with the wave transform running, the next with it off, and the difference of
// the frame's own GPU time is the simulation's cost. The transform's fifteen passes record as one
// compute step, so a per-pass split is not available; the whole simulation is what the plan's
// 0.5 ms estimate for three bands at 128 squared gives.
//
// It runs only with NULL3D_OCEAN_COST set, in a quiet window on a computer with a GPU of its own:
// NULL3D_OCEAN_COST=1 bun run test:browser -- ocean-ablation.spec.ts.
// NULL3D_OCEAN_ABLATION_GPUS names the paths, NULL3D_OCEAN_ABLATION_PRESET the preset (the ocean's
// cost does not change with it; Low draws the lightest frame around it), and
// NULL3D_OCEAN_ABLATION_BATCHES the loads of each side.
import { expect, test } from '@playwright/test';
import { costTimeout, loadNow, waitForQuiet } from '../lib/effect-cost.ts';
import { pageResult } from '../lib/page-result.ts';
import { TIMING_BROWSER } from '../lib/timing-browser.ts';

test.use(TIMING_BROWSER);

/** What the page reports of one side of its measurement. */
interface Side {
	gpuMs: number | null;
	intervalMs: number | null;
	refreshHz?: number | null;
}

/** What the page reports once its side has measured. */
interface AblationResult {
	error?: string;
	tier: string;
	off: Side;
	on: Side;
	failures: string[];
}

/** The GPU paths, the preset and the batches, from the environment. */
const PATHS = (process.env.NULL3D_OCEAN_ABLATION_GPUS ?? 'webgpu,compat,webgl2').split(',');
const PRESET = process.env.NULL3D_OCEAN_ABLATION_PRESET ?? 'low';
const BATCHES = Math.max(1, Number(process.env.NULL3D_OCEAN_ABLATION_BATCHES ?? 3));

for (const gpu of PATHS)
	test(`the ocean's simulation on ${gpu} at ${PRESET}, as an on/off ablation`, async ({ page }) => {
		test.skip(!process.env.NULL3D_OCEAN_COST, 'set NULL3D_OCEAN_COST to time the ocean');
		test.setTimeout(costTimeout(300_000 + BATCHES * 150_000));
		const loadBefore = await waitForQuiet();
		await page.setViewportSize({ width: 1920, height: 1080 });
		/** The frame's own GPU time with the simulation `which`, in a page load of its own. */
		const frame = async (which: 'off' | 'on'): Promise<number> => {
			await page.goto(
				`effect-cost.html?effect=ocean&gpu=${gpu}&preset=${PRESET}&scale=1&fixed` +
					`&sides=${which}&rounds=1&seconds=6&warm-up=20&reflection=off`,
			);
			const result = await pageResult<AblationResult>(page, 200_000);
			expect(result.error).toBeUndefined();
			expect(result.failures).toEqual([]);
			const figure = which === 'on' ? result.on.gpuMs : result.off.gpuMs;
			expect(figure).not.toBeNull();
			return figure as number;
		};
		const differences: string[] = [];
		for (let batch = 0; batch < BATCHES; batch++) {
			const off = await frame('off');
			const on = await frame('on');
			differences.push(`${off.toFixed(3)} / ${on.toFixed(3)} = ${(on - off).toFixed(3)}`);
		}
		const values = differences.map((row) => Number(row.slice(row.lastIndexOf('=') + 1)));
		const least = Math.min(...values);
		console.log(
			`ABLATION ${gpu} at ${PRESET}: off/on = difference per batch, ${differences.join('; ')} ms; least ${least.toFixed(3)} ms; load ${loadBefore} before and ${loadNow()} after`,
		);
		expect(Number.isFinite(least)).toBe(true);
	});
