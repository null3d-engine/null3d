// What a tree of cluster patches costs, on each GPU path and preset: the heightfield of the
// cluster-cost page, timed at three camera distances (tests/pages/cluster-cost.ts). Near the ground
// a view draws most patches at full detail, and far from it the walk stops at coarse patches, so
// the figures show both the saving and the cost of the pass that picks them. It prints the medians
// for D-213. It runs only with NULL3D_CLUSTER_COST set, in a quiet window on a computer with a GPU
// of its own: NULL3D_CLUSTER_COST=1 bun run test:browser -- cluster-cost.spec.ts.
// NULL3D_CLUSTER_PRESETS sets the presets, as a list.
import { expect, test } from '@playwright/test';
import { costTimeout, loadNow, waitForQuiet } from '../lib/effect-cost.ts';
import { pageResult } from '../lib/page-result.ts';
import { TIMING_BROWSER } from '../lib/timing-browser.ts';

test.use(TIMING_BROWSER);

const presets = (process.env.NULL3D_CLUSTER_PRESETS ?? 'low,medium,high,ultra').split(',');

/** One distance's figures, as the page reports them. */
interface DistanceCost {
	distance: number;
	gpuMs: number | null;
	intervalMs: number | null;
	cpuMs: number | null;
	threads: Record<string, number | null>;
}

/** One page's result. */
interface ClusterCostResult {
	/** A message from the page or the runner, for a page that stopped early. */
	error?: string;
	tier: string;
	window: [number, number];
	devicePixelRatio: number;
	sides: DistanceCost[];
	failures: string[];
}

/** A figure with one decimal place, or a dash where the device has no GPU timer. */
const ms = (value: number | null | undefined) => (value == null ? '-' : value.toFixed(1));

for (const gpu of ['webgpu', 'webgl2'] as const)
	for (const preset of presets)
		test(`cluster levels on ${gpu} at ${preset}, timed at three distances`, async ({ page }) => {
			test.skip(!process.env.NULL3D_CLUSTER_COST, 'set NULL3D_CLUSTER_COST to time the tree');
			test.setTimeout(costTimeout(600_000));
			const loadBefore = await waitForQuiet();
			await page.setViewportSize({ width: 1600, height: 900 });
			// The patch pass runs on the indirect path, which the switch forces: the start-up probe
			// may pick the direct path, which draws the whole mesh, and the figures would tell of
			// another drawing.
			await page.goto(`cluster-cost.html?gpu=${gpu}&preset=${preset}&direct=off`);
			const result = await pageResult<ClusterCostResult>(page, 200_000);
			expect(result.error).toBeUndefined();
			console.log(
				[
					`${result.tier} ${gpu} ${preset}, ${result.window.join('x')} at ${result.devicePixelRatio}x, load ${loadBefore} before and ${loadNow()} after`,
					...result.sides.map(
						(side) =>
							`  ${String(side.distance).padStart(3)} m: ${ms(side.gpuMs)} ms GPU, ${ms(side.intervalMs)} ms a frame, ${ms(side.cpuMs)} ms CPU`,
					),
				].join('\n'),
			);
			expect(result.failures).toEqual([]);
		});
