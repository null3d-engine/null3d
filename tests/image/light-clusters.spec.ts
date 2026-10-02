import { expect, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

interface LightClustersResult {
	ok: boolean;
	error?: string;
	cases: { lights: number; words: number; differing: number; first: number[] | null }[];
}

// The fixture's cases: S3's 256 small lights, an orthographic camera, and every cap at work. The
// render crate's tests/light_grid.rs writes them from the job workers' light grids.
test('light clustering on the GPU lists the same lights as the job workers', async ({ page }) => {
	await page.goto('light-clusters.html');
	const result = await pageResult<LightClustersResult>(page, 30_000);
	expect(result.error).toBeUndefined();
	expect(result.cases.map((c) => c.lights)).toEqual([256, 100, 200]);
	for (const c of result.cases) expect(c, `${c.lights} lights`).toMatchObject({ differing: 0 });
});
