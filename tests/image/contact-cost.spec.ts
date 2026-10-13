// What the sun's contact shadows cost, on each GPU path, at each step count and render scale: the
// effect cost page's contact scene, timed with contact shadows off and on, in turns
// (tests/pages/effect-cost.ts). It prints each side's medians for D-135. It runs only with
// NULL3D_CONTACT_COST set, in a quiet window on a computer with a GPU of its own:
// NULL3D_CONTACT_COST=1 bun run test:browser -- contact-cost.spec.ts.
// On WebGPU the depth prepass follows contact shadows, so the on side pays it too. A second run of
// each WebGPU case keeps the prepass on for both sides, and the difference between the two runs is
// the prepass's own cost. WebGL2 draws the prepass on every preset. Compatibility mode stops at
// Medium, so it runs Medium's 4 steps alone. Each test waits until the computer's 1-minute load is
// under 8, and prints the load beside its figures, as other work on the computer would spoil them.
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

/** The 1-minute load under which a test measures, and how often it checks the load. */
const QUIET_LOAD = 8;
const LOAD_CHECK_MS = 15_000;

/** Each case: the GPU path, the preset, the steps per march and whether the prepass stays on. */
const CASES = [
	...[4, 8, 16].flatMap((steps) => [
		['webgpu', 'high', steps, false],
		['webgpu', 'high', steps, true],
		['webgl2', 'high', steps, false],
	]),
	['compat', 'medium', 4, false],
] as const;

for (const [gpu, preset, steps, prepass] of CASES)
	for (const scale of [1, 0.5])
		test(`contact shadows on ${gpu}, ${steps} steps at scale ${scale}${prepass ? ' with the prepass on' : ''}, timed on and off`, async ({
			page,
		}) => {
			test.skip(
				!process.env.NULL3D_CONTACT_COST,
				'set NULL3D_CONTACT_COST to time contact shadows',
			);
			test.setTimeout(300_000);
			while ((loadavg()[0] as number) >= QUIET_LOAD)
				await new Promise((resolve) => setTimeout(resolve, LOAD_CHECK_MS));
			const loadBefore = (loadavg()[0] as number).toFixed(1);
			await page.setViewportSize({ width: 1920, height: 1080 });
			await page.goto(
				`effect-cost.html?effect=contact&gpu=${gpu}&preset=${preset}&steps=${steps}&scale=${scale}${prepass ? '&prepass=on' : ''}`,
			);
			const result = await pageResult<CostResult>(page, 200_000);
			expect(result.error).toBeUndefined();
			const line = (name: string, side: Side) =>
				`${name}: GPU ${ms(side.gpuMs)} ms, interval ${ms(side.intervalMs)} ms, CPU ${ms(side.cpuMs)} ms`;
			console.log(
				[
					`CONTACTCOST ${result.tier} ${steps} steps, scale ${scale}, prepass ${prepass ? 'on' : 'follows'}, load ${loadBefore} before and ${(loadavg()[0] as number).toFixed(1)} after`,
					line('off', result.off),
					line('on', result.on),
				].join('\n'),
			);
			expect(result.failures).toEqual([]);
		});
