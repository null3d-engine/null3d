import { expect, test } from '@playwright/test';
import { type MipLevelsResult, mipLevelsProblems } from '../lib/mip-levels-checks.ts';
import { pageResult } from '../lib/page-result.ts';

test("the WebGL2 path makes every mip level of a texture array's layer from the level before", async ({
	page,
}) => {
	await page.goto('mip-levels.html');
	const result = await pageResult<MipLevelsResult & { error?: string }>(page, 60_000);
	expect(result.error).toBeUndefined();
	expect(mipLevelsProblems(result)).toEqual([]);
	// The other ways are facts for devices; each must still run in Chrome without a GL error.
	expect(result.ways.flatMap(({ errors }) => errors)).toEqual([]);
});
