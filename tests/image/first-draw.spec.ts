// The first pass of indirect draws on a new device draws right after the engine's first pass.
import { expect, test } from '@playwright/test';
import { type FirstDrawResult, firstDrawProblems } from '../lib/first-draw-checks.ts';
import { pageResult } from '../lib/page-result.ts';

for (const tier of ['webgpu', 'compat'] as const)
	test(`the first indirect draws on a new device are right after the engine's first pass, on ${tier}`, async ({
		page,
	}) => {
		await page.goto(`first-draw.html?gpu=${tier}`);
		const result = await pageResult<FirstDrawResult & { error?: string }>(page, 30_000);
		expect(result.error).toBeUndefined();
		expect(firstDrawProblems(result)).toEqual([]);
		// Chrome's own GPUs lack the fault, so the bare draws must be right here too.
		expect(result.bare.right).toBe(result.bare.expected);
	});
