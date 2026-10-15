// What the volumetric fog costs, on each GPU path, at each slice count, in the sun scene and the
// night scene: the effect cost page's fog scene, timed with the lit fog off and on, in turns
// (tests/pages/effect-cost.ts). It prints each side's medians for D-133. It runs only with
// NULL3D_FOG_COST set, in a quiet window on a computer with a GPU of its own:
// NULL3D_FOG_COST=1 bun run test:browser -- fog-cost.spec.ts. Each test waits until the computer's
// 1-minute load is under 8, and prints the load beside its figures, as other work on the computer
// would spoil them. A load that stays high fails the test after a time limit, so a quiet window is
// never held by a wait.
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

const ms = (value: number | null) => (value === null ? 'none' : value.toFixed(3));

/** The 1-minute load under which a test measures, how often it checks it, and how long it waits. */
const QUIET_LOAD = 8;
const LOAD_CHECK_MS = 15_000;
const LOAD_WAIT_MS = 600_000;

for (const gpu of ['webgpu', 'compat', 'webgl2'] as const)
	for (const slices of [32, 64, 96])
		for (const night of [false, true])
			test(`volumetric fog on ${gpu}, ${slices} slices${night ? ' at night' : ''}, timed on and off`, async ({
				page,
			}) => {
				test.skip(!process.env.NULL3D_FOG_COST, 'set NULL3D_FOG_COST to time the volumetric fog');
				test.setTimeout(LOAD_WAIT_MS + 300_000);
				const waitUntil = Date.now() + LOAD_WAIT_MS;
				while ((loadavg()[0] as number) >= QUIET_LOAD) {
					if (Date.now() > waitUntil)
						throw new Error(
							`the load stayed at ${QUIET_LOAD} or above for ${LOAD_WAIT_MS / 60_000} minutes`,
						);
					await new Promise((resolve) => setTimeout(resolve, LOAD_CHECK_MS));
				}
				const loadBefore = (loadavg()[0] as number).toFixed(1);
				await page.setViewportSize({ width: 1920, height: 1080 });
				await page.goto(
					`effect-cost.html?effect=fog&gpu=${gpu}&slices=${slices}&scale=1${night ? '&night' : ''}`,
				);
				const result = await pageResult<CostResult>(page, 200_000);
				expect(result.error).toBeUndefined();
				const line = (name: string, side: Side) =>
					`${name}: GPU ${ms(side.gpuMs)} ms, interval ${ms(side.intervalMs)} ms, CPU ${ms(side.cpuMs)} ms`;
				console.log(
					[
						`FOGCOST ${result.tier} ${slices} slices${night ? ' night' : ' sun'}, load ${loadBefore} before and ${(loadavg()[0] as number).toFixed(1)} after`,
						line('off', result.off),
						line('on', result.on),
					].join('\n'),
				);
				expect(result.failures).toEqual([]);
			});
