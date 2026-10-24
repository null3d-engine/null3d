// What the sun's hero shadow costs, on each GPU path and at each preset: the hero cost page's
// scene, the hero demo's car and yard, timed with the sun's hero tile off and on in turns
// (tests/pages/hero-cost.ts). The still case shows what a receiver in the hero's box pays while the
// tile rests, and the moving case shows the tile's pass in every frame. It prints each side's
// medians for D-219. It runs only with NULL3D_HERO_COST set, in a quiet window on a computer with a
// GPU of its own: NULL3D_HERO_COST=1 bun run test:browser -- hero-cost.spec.ts --workers=1.
// Compatibility mode and WebGL2 stop at Medium, so each runs Medium alone. Each test waits for a
// quiet computer, within a time limit, and prints the load beside its figures
// (tests/lib/effect-cost.ts).
import { expect, test } from '@playwright/test';
import { browserOptions, WEBGPU_DEVELOPER_FEATURES } from '../../packages/cli/src/browser.js';
import {
	type CostResult,
	costTimeout,
	loadNow,
	type Side,
	sideLine,
	waitForQuiet,
} from '../lib/effect-cost.ts';
import { pageResult } from '../lib/page-result.ts';

// Chrome rounds the GPU timestamps it reports unless its developer features are on, and a rounded
// figure cannot show a cost of a few hundredths of a millisecond.
test.use({
	launchOptions: {
		...browserOptions('chrome-real-gpu'),
		args: [WEBGPU_DEVELOPER_FEATURES],
	},
});

test.skip(!process.env.NULL3D_HERO_COST, 'set NULL3D_HERO_COST to time the hero shadow');

/** Each case: the GPU path, the preset, and whether the hero's tile draws in every frame. */
const CASES = [
	['webgpu', 'medium'],
	['webgpu', 'high'],
	['compat', 'medium'],
	['webgl2', 'medium'],
] as const;

/** The parts of a side's frame, with their GPU time where the device times passes. */
const passesLine = (side: Side) =>
	(side.passes ?? [])
		.map((pass) => `${pass.name} ${pass.ms === null ? 'none' : pass.ms.toFixed(3)} ms`)
		.join(', ') || 'none';

for (const [gpu, preset] of CASES)
	for (const moving of [false, true])
		test(`the hero shadow on ${gpu} at ${preset}, ${moving ? 'moving' : 'still'}, timed off and on`, async ({
			page,
		}) => {
			test.setTimeout(costTimeout(300_000));
			const loadBefore = await waitForQuiet();
			await page.setViewportSize({ width: 1920, height: 1080 });
			await page.goto(
				`hero-cost.html?gpu=${gpu}&preset=${preset}&scale=1${moving ? '&moving' : ''}`,
			);
			const result = await pageResult<CostResult & { preset: string }>(page, 200_000);
			expect(result.error).toBeUndefined();
			console.log(
				[
					`HEROCOST ${result.tier} ${result.preset} ${moving ? 'moving' : 'still'}, draws off ${result.off.draws ?? 'none'} and on ${result.on.draws ?? 'none'}, load ${loadBefore} before and ${loadNow()} after`,
					`hero off passes: ${passesLine(result.off)}`,
					`hero on passes: ${passesLine(result.on)}`,
					sideLine('hero off', result.off, 3),
					sideLine('hero on', result.on, 3),
				].join('\n'),
			);
			expect(result.failures).toEqual([]);
		});
