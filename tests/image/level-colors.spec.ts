// A batch's rows keep their own colors on a coarser level of detail: the level's draw reads the rows
// as the base level's does. The test reads the brightest color of each held frame, which is a lit
// square's, and that color must stay green.
import { expect, test } from '@playwright/test';

for (const gpu of ['webgpu', 'compat', 'webgl2'] as const)
	for (const level of ['base', 'coarse'] as const)
		test(`a row's color reaches the ${level} level on ${gpu}`, async ({ page }) => {
			const sketch = `/tests/pages/sketches/level-colors-sketch.ts?level=${level}`;
			await page.goto(
				`/tests/pages/image.html?sketch=${encodeURIComponent(sketch)}&hold=0.2&size=320x180&gpu=${gpu}`,
			);
			await page.waitForFunction(
				() => (globalThis as { __null3dHold?: unknown }).__null3dHold !== undefined,
			);
			const [red = 0, green = 0] = await page.evaluate(() => {
				const { pixels } = (globalThis as unknown as { __null3dHold: { pixels: number[] } })
					.__null3dHold;
				const total = (color: readonly number[]) => color.reduce((sum, part) => sum + part, 0);
				let best = [0, 0, 0];
				for (let at = 0; at < pixels.length; at += 4) {
					const color = [pixels[at] ?? 0, pixels[at + 1] ?? 0, pixels[at + 2] ?? 0];
					if (total(color) > total(best)) best = color;
				}
				return best;
			});
			expect(green).toBeGreaterThan(100);
			expect(red).toBeLessThan(green / 3);
		});
