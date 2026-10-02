// The quality governor's stress test (tests/pages/lib/governor.ts) on both GPU paths. The walk
// takes every live step down under a load that no setting lightens, then every step back up once
// the load stops: the steps come in their order, the frame captured after each shows the scene,
// and no frame sticks. The hold overloads the GPU with work that follows the pixels, and the
// governor brings the frame rate back by lowering the render scale. CI's software GPU cannot hold
// a frame rate under load, so the hold runs on real GPUs alone, and the walk aims for 30 frames
// per second there: the software GPU draws the scene at about 40 on WebGL2.
import { expect, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';
import { type GovernorResult, governorProblems, governorSummary } from '../pages/lib/governor.ts';

const TIERS = ['webgpu', 'webgl2'] as const;

/** The walk's target rate on CI's software GPU, through the engine's ?fps= switch. */
const WALK_SWITCHES = process.env.CI ? '&fps=30' : '';

/** The longest a stage may take: its waits, plus the start and the measurements. */
const STAGE_MS = 150_000;

for (const tier of TIERS) {
	test(`the governor takes every live step down and back up on ${tier}`, async ({ page }) => {
		test.setTimeout(STAGE_MS + 30_000);
		await page.goto(`governor.html?gpu=${tier}&stage=walk${WALK_SWITCHES}`);
		const result = await pageResult<GovernorResult & { error?: string }>(page, STAGE_MS);
		expect(result.error).toBeUndefined();
		expect(result.tier).toBe(tier);
		test.info().annotations.push({ type: 'result', description: governorSummary(result) });
		expect(governorProblems(result)).toEqual([]);
	});

	test(`the governor holds the frame rate of a scene too heavy for the GPU on ${tier}`, async ({
		page,
	}) => {
		test.skip(!!process.env.CI, "CI's software GPU cannot hold a frame rate under load");
		test.setTimeout(STAGE_MS + 30_000);
		await page.goto(`governor.html?gpu=${tier}&stage=hold`);
		const result = await pageResult<GovernorResult & { error?: string }>(page, STAGE_MS);
		expect(result.error).toBeUndefined();
		expect(result.tier).toBe(tier);
		test.info().annotations.push({ type: 'result', description: governorSummary(result) });
		expect(governorProblems(result)).toEqual([]);
	});
}
