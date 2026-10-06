// The quality governor's stress test (tests/pages/lib/governor.ts) on both GPU paths. The walk
// takes every live step down under a load that no setting lightens, then every step back up once
// the load stops: the steps come in their order, the frame captured after each shows the scene,
// and no frame sticks. The hold overloads the GPU with work that follows the pixels, and the
// governor brings the frame rate back by lowering the render scale. Both stages judge real frame
// rates. CI's software GPU takes hundreds of milliseconds for some frames of the scene even
// without a load, so the stages run on real GPUs alone: in Chrome on the Mac and through the
// runner's governor plan on phones and tablets.
import { expect, test } from '@playwright/test';
import { ALONE } from '../lib/alone.ts';
import { pageResult } from '../lib/page-result.ts';
import {
	GOVERNOR_STAGES,
	type GovernorResult,
	governorProblems,
	governorSummary,
} from '../pages/lib/governor.ts';

const TIERS = ['webgpu', 'webgl2'] as const;

/** What each stage's test checks. */
const STAGE_TITLES = {
	walk: 'takes every live step down and back up',
	hold: 'holds the frame rate of a scene too heavy for the GPU',
} as const;

/** The longest a stage may take: its waits, plus the start and the measurements. */
const STAGE_MS = 150_000;

for (const tier of TIERS)
	for (const stage of GOVERNOR_STAGES)
		test(`the governor ${STAGE_TITLES[stage]} on ${tier}`, ALONE, async ({ page }) => {
			test.skip(!!process.env.CI, "CI's software GPU cannot hold a frame rate");
			test.setTimeout(STAGE_MS + 30_000);
			await page.goto(`governor.html?gpu=${tier}&stage=${stage}`);
			const result = await pageResult<GovernorResult & { error?: string }>(page, STAGE_MS);
			expect(result.error).toBeUndefined();
			expect(result.tier).toBe(tier);
			test.info().annotations.push({ type: 'result', description: governorSummary(result) });
			expect(governorProblems(result)).toEqual([]);
		});
