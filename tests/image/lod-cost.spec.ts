// What levels of detail save, on each GPU path and preset: the forest of the lod-cost page, timed
// with every tree at its base mesh and with each at its own level, in turns (tests/pages/lod-cost.ts).
// It prints each side's medians for D-137. It runs only with NULL3D_LOD_COST set, in a quiet window
// on a computer with a GPU of its own: NULL3D_LOD_COST=1 bun run test:browser -- lod-cost.spec.ts.
// NULL3D_LOD_COUNT sets the trees, 40,000 by default, and NULL3D_LOD_PRESETS the presets, as a
// list.
import { expect, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

interface Side {
	gpuMs: number | null;
	intervalMs: number | null;
	cpuMs: number | null;
	threads: Record<string, number | null>;
}

interface CostResult {
	error?: string;
	tier: string;
	off: Side;
	on: Side;
	failures: string[];
}

const count = process.env.NULL3D_LOD_COUNT ?? '40000';
const presets = (process.env.NULL3D_LOD_PRESETS ?? 'low,medium,high,ultra').split(',');
const ms = (value: number | null) => (value === null ? 'none' : value.toFixed(2));

for (const gpu of ['webgpu', 'compat', 'webgl2'] as const)
	for (const preset of presets)
		test(`levels of detail on ${gpu} at ${preset}, timed on and off`, async ({ page }) => {
			test.skip(!process.env.NULL3D_LOD_COST, 'set NULL3D_LOD_COST to time the levels');
			test.setTimeout(240_000);
			await page.setViewportSize({ width: 1600, height: 900 });
			await page.goto(`lod-cost.html?gpu=${gpu}&preset=${preset}&count=${count}`);
			const result = await pageResult<CostResult>(page, 200_000);
			expect(result.error).toBeUndefined();
			const line = (name: string, side: Side) =>
				`${name}: GPU ${ms(side.gpuMs)} ms, interval ${ms(side.intervalMs)} ms, CPU ${ms(side.cpuMs)} ms, ${Object.entries(
					side.threads,
				)
					.map(([thread, busy]) => `${thread} ${ms(busy)}`)
					.join(', ')}`;
			console.log(
				[
					`${result.tier} ${preset}, ${count} trees`,
					line('base meshes', result.off),
					line('levels', result.on),
				].join('\n'),
			);
			expect(result.failures).toEqual([]);
		});
