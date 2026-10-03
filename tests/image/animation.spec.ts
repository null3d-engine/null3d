// The animation page, which times the engine core's animation step on the job workers. Phones and
// tablets run its timings through the runner's animation plan. Here a small crowd checks that the
// page runs the step on the job workers and that the characters get finite, different poses.
import { expect, test } from '@playwright/test';
import { loadResult } from '../lib/page-result.ts';
import { failureText } from '../lib/runs.ts';
import { type AnimationResult, animationProblems } from '../pages/lib/animation.ts';

test('the animation step poses a crowd on the job workers', async ({ page }) => {
	const result = await loadResult(
		page,
		'animation.html?characters=40&jobs=2&frames=20&warmup=5',
		60_000,
	);
	expect(result.ok ? [] : [failureText(result)]).toEqual([]);
	const animation = result as typeof result & AnimationResult;
	expect(animationProblems(animation)).toEqual([]);
	expect(animation.frames).toBe(20);
	expect(animation.jobWorkers).toBe(2);
	expect(animation.jobMsPerFrame).toBeGreaterThan(0);
});
