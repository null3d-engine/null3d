// The governor's trap (tests/pages/lib/governor-trap.ts), in every thread mode and on both GPU
// paths of a software renderer. A page draws a few frames a second at the whole render scale, the
// governor steps below it, and the two-step upscale makes the frames slower. The governor must
// judge those slow frames, take the step back, and keep the whole scale afterwards: the step below
// it is never repeated (D-237).
//
// The trap needs a software renderer. On a real GPU the upscale is cheap, so the step pays and the
// page keeps it, which is what the governor should do.
import { expect, test } from '@playwright/test';
import { ALONE } from '../lib/alone.ts';
import { ENGINE_MODES } from '../lib/engine-checks.ts';
import { pageResult } from '../lib/page-result.ts';
import { TRAP, type TrapResult, trapProblems, trapSummary } from '../pages/lib/governor-trap.ts';

/** The GPU paths that a page can force with ?gpu=. */
const TIERS = ['webgpu', 'webgl2'] as const;

/**
 * How long a run may take: the start on a software renderer, the canvas tuning, the step and its
 * return, and the watch that follows.
 */
const TRAP_MS = 240_000;

const softwareGpu = () => test.info().project.name.includes('swiftshader');

for (const tier of TIERS)
	for (const mode of ENGINE_MODES)
		test(
			`the governor comes back from the two-step path on ${tier}, ${mode.name}`,
			ALONE,
			async ({ page }) => {
				test.skip(!softwareGpu(), 'the trap needs a software renderer');
				test.setTimeout(TRAP_MS + 30_000);
				await page.goto(`governor-trap.html?gpu=${tier}&${mode.query}`);
				const result = await pageResult<TrapResult & { error?: string }>(page, TRAP_MS);
				expect(result.error).toBeUndefined();
				expect(result.tier).toBe(tier);
				test.info().annotations.push({ type: 'result', description: trapSummary(result) });
				expect(trapProblems(result)).toEqual([]);
			},
		);
