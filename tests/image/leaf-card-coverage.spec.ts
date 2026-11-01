// What share of its own box each of three leaf cards covers, at three distances from one camera
// (tests/pages/leaf-card-coverage.ts). A card is the same square of the leaf atlas in every box, so
// the shares agree when the atlas keeps its coverage as the card shrinks. A level that a box filter
// thinned, as one from a cut-out texture does, would show a far share well below the near one.
import { expect, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

/** What the page measured: the share of each card's box that draws, nearest first. */
interface CoverageResult {
	readonly tier: string;
	readonly shares: readonly number[];
	readonly ratio: number;
}

for (const gpu of ['webgpu', 'compat', 'webgl2'])
	test(`a minified leaf card keeps its coverage on ${gpu}`, async ({ page }) => {
		test.setTimeout(240_000);
		await page.setViewportSize({ width: 1280, height: 720 });
		await page.goto(`leaf-card-coverage.html?gpu=${gpu}`);
		const result = await pageResult<CoverageResult>(page, 180_000);
		const [near = 0, middle = 0, far = 0] = result.shares;
		console.log(
			`${result.tier}: near ${near.toFixed(3)} of its box, middle ${middle.toFixed(3)}, far ${far.toFixed(3)}`,
		);
		// A cluster card's leaves cover about half of the card, and the far card stands about five
		// times as far away, so the same leaves cover a twenty-fifth of the pixels.
		expect(near).toBeGreaterThan(0.2);
		expect(middle).toBeGreaterThan(near * 0.9);
		expect(middle).toBeLessThan(near * 1.1);
		expect(far).toBeGreaterThan(near * 0.9);
		expect(far).toBeLessThan(near * 1.1);
	});
