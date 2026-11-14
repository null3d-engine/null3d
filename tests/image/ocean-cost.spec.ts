// What the ocean's wave transform costs, on each GPU path and quality preset: the effect cost page's
// ocean scene, whose surface reads a texture that a chain of compute passes writes in the same
// frame. The page times the scene with the transform off and on in turns, so the difference is the
// transform's own cost.
// It runs only with NULL3D_OCEAN_COST set, in a quiet window on a computer with a GPU of its own:
// NULL3D_OCEAN_COST=1 bun run test:browser -- ocean-cost.spec.ts.
import { expect, test } from '@playwright/test';
import {
	type CostResult,
	costTimeout,
	loadNow,
	sideLine,
	waitForQuiet,
} from '../lib/effect-cost.ts';
import { pageResult } from '../lib/page-result.ts';
import { TIMING_BROWSER } from '../lib/timing-browser.ts';

test.use(TIMING_BROWSER);

/** The presets that the test measures, and the switch that names each. */
const PRESETS = ['low', 'medium', 'high', 'ultra'] as const;

/**
 * A quiet run's own settings: more rounds and longer sides resolve a cost under a millisecond,
 * and the reflection at the longest cadence keeps its cost out of the transform's. Each is the
 * page's own switch, so a run without them measures as before.
 */
const EXTRA = [
	process.env.NULL3D_OCEAN_COST_ROUNDS && `rounds=${process.env.NULL3D_OCEAN_COST_ROUNDS}`,
	process.env.NULL3D_OCEAN_COST_SECONDS && `seconds=${process.env.NULL3D_OCEAN_COST_SECONDS}`,
	process.env.NULL3D_OCEAN_COST_WARM_UP && `warm-up=${process.env.NULL3D_OCEAN_COST_WARM_UP}`,
	process.env.NULL3D_OCEAN_COST_REFLECTION &&
		`reflection=${process.env.NULL3D_OCEAN_COST_REFLECTION}`,
]
	.filter(Boolean)
	.join('&');

/** The middle of some numbers, or null without any. */
function median(values: number[]): number | null {
	const sorted = [...values].sort((a, b) => a - b);
	if (sorted.length === 0) return null;
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2
		? (sorted[middle] as number)
		: ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

for (const gpu of ['webgpu', 'compat', 'webgl2'] as const)
	for (const preset of PRESETS)
		test(`the ocean's transform on ${gpu} at ${preset}, timed on and off`, async ({ page }) => {
			test.skip(!process.env.NULL3D_OCEAN_COST, 'set NULL3D_OCEAN_COST to time the ocean');
			test.setTimeout(costTimeout(300_000));
			const loadBefore = await waitForQuiet();
			await page.setViewportSize({ width: 1920, height: 1080 });
			await page.goto(
				`effect-cost.html?effect=ocean&gpu=${gpu}&preset=${preset}&scale=1&fixed${EXTRA === '' ? '' : `&${EXTRA}`}`,
			);
			const result = await pageResult<CostResult>(page, 200_000);
			expect(result.error).toBeUndefined();
			const transform = (result.on.gpuMs ?? 0) - (result.off.gpuMs ?? 0);
			const offRounds = result.off.gpuRoundsMs ?? [];
			const onRounds = result.on.gpuRoundsMs ?? [];
			// Each round's sides alternate, so each round's difference pairs one off side with the on
			// side beside it. Their spread says whether the difference stands above the run's noise.
			const rounds = onRounds.map((on, at) => on - (offRounds[at] ?? Number.NaN));
			const middle = median(rounds);
			const spread = rounds.length > 1 ? Math.max(...rounds) - Math.min(...rounds) : Number.NaN;
			console.log(
				[
					`OCEANCOST ${result.tier} at ${preset}, load ${loadBefore} before and ${loadNow()} after`,
					sideLine('off', result.off, 3),
					sideLine('on', result.on, 3),
					`transform ${transform.toFixed(3)} ms of GPU time per frame, rounds median ${middle === null ? 'none' : middle.toFixed(3)} ms and spread ${spread.toFixed(3)} ms`,
					`  off rounds: ${offRounds.map((ms) => ms.toFixed(3)).join(', ')}`,
					`  on rounds: ${onRounds.map((ms) => ms.toFixed(3)).join(', ')}`,
					`  each round's difference: ${rounds.map((ms) => ms.toFixed(3)).join(', ')}`,
				].join('\n'),
			);
			for (const [side, values] of [
				['on', result.on.passes ?? []],
				['off', result.off.passes ?? []],
			] as const)
				console.log(
					`  ${side} passes: ${values.map((pass) => `${pass.name} ${pass.ms === null ? 'none' : pass.ms.toFixed(3)}`).join(', ')}`,
				);
			expect(result.failures).toEqual([]);
			expect(result.off.gpuMs).not.toBeNull();
			expect(result.on.gpuMs).not.toBeNull();
		});
