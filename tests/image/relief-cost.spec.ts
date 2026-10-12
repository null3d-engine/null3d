// What each relief feature costs, on each GPU path and preset: the hillside of the relief-cost page,
// timed with one feature off and on, in turns (tests/pages/relief-cost.ts). It prints each side's
// medians for D-136. It runs only with NULL3D_RELIEF_COST set, in a quiet window on a computer
// with a GPU of its own: NULL3D_RELIEF_COST=1 bun run test:browser -- relief-cost.spec.ts.
// NULL3D_RELIEF_FEATURES sets the features, NULL3D_RELIEF_PRESETS the presets, as lists. Each test
// waits until the computer's 1-minute load is under 8, and prints the load beside its figures, as
// other work on the computer would spoil them.
import { loadavg } from 'node:os';
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

const features = (
	process.env.NULL3D_RELIEF_FEATURES ?? 'displacement,parallax,bump,wireframe'
).split(',');
const presets = (process.env.NULL3D_RELIEF_PRESETS ?? 'low,medium,high,ultra').split(',');
const ms = (value: number | null) => (value === null ? 'none' : value.toFixed(2));

/** The 1-minute load under which a test measures, and how often it checks the load. */
const QUIET_LOAD = 8;
const LOAD_CHECK_MS = 15_000;

for (const feature of features)
	for (const gpu of ['webgpu', 'compat', 'webgl2'] as const)
		for (const preset of presets)
			test(`${feature} on ${gpu} at ${preset}, timed on and off`, async ({ page }) => {
				test.skip(!process.env.NULL3D_RELIEF_COST, 'set NULL3D_RELIEF_COST to time relief');
				test.setTimeout(0);
				while ((loadavg()[0] as number) >= QUIET_LOAD)
					await new Promise((resolve) => setTimeout(resolve, LOAD_CHECK_MS));
				const loadBefore = (loadavg()[0] as number).toFixed(1);
				await page.setViewportSize({ width: 1600, height: 900 });
				await page.goto(`relief-cost.html?gpu=${gpu}&preset=${preset}&feature=${feature}`);
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
						`${result.tier} ${preset}, ${feature}, load ${loadBefore} before and ${(loadavg()[0] as number).toFixed(1)} after`,
						line('off', result.off),
						line('on', result.on),
					].join('\n'),
				);
				expect(result.failures).toEqual([]);
			});
