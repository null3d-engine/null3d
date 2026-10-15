// Losing the GPU. When it comes back, the engine starts a new device and carries on drawing without
// a failure, in every thread mode and on both GPU paths. When it never comes back, the engine gives
// up, stops drawing and tells the page with E1302.
import { expect, test } from '@playwright/test';
import { ENGINE_MODES } from '../lib/engine-checks.ts';
import { pageResult } from '../lib/page-result.ts';

interface LossResult {
	tier: string;
	code: string | null;
	framesAfter?: number;
	lostMidFrame?: boolean;
	error?: string;
}

interface MapResult {
	tier: string;
	code: string | null;
	copies: string | null;
	/** The middle pixel before and after the loss, as four bytes. */
	before: number[];
	after: number[];
	error?: string;
}

for (const gpu of ['webgpu', 'webgl2'] as const) {
	for (const mode of ENGINE_MODES) {
		test(`the engine draws on after a GPU loss on ${gpu}, ${mode.name}`, async ({ page }) => {
			await page.goto(`gpu-loss.html?gpu=${gpu}&simulate&${mode.query}`);
			const result = await pageResult<LossResult>(page, 30_000);
			expect(result.error).toBeUndefined();
			expect(result.code).toBeNull();
			expect(result.framesAfter ?? 0).toBeGreaterThan(0);
		});
	}
}

for (const query of ['threads=off', 'render=main']) {
	test(`a WebGL2 context that never comes back reaches onFailure, ${query}`, async ({ page }) => {
		await page.goto(`gpu-loss.html?gpu=webgl2&${query}`);
		const result = await pageResult<LossResult>(page, 30_000);
		expect(result.error).toBeUndefined();
		expect(result.tier).toBe('webgl2');
		expect(result.code).toBe('E1302');
	});
}

// A map after a loss. The page's whole canvas is one image texture, magenta, and its material's
// color is white, so a middle pixel whose green channel sits well below its red and blue shows the
// map, and three equal channels show the color alone.
const showsMap = (pixel: readonly number[]) =>
	(pixel[1] as number) + 40 < (pixel[0] as number) &&
	(pixel[1] as number) + 40 < (pixel[2] as number);

// With keepTextureCopies the engine keeps the image's copy and the map comes back. Without it the
// image is freed after its upload, and the texture draws with its color alone.
for (const gpu of ['webgpu', 'webgl2'] as const) {
	test(`a kept copy brings a map back after a GPU loss on ${gpu}`, async ({ page }) => {
		await page.goto(`map-loss.html?gpu=${gpu}&copies=on`);
		const result = await pageResult<MapResult>(page, 60_000);
		expect(result.error).toBeUndefined();
		expect(result.code).toBeNull();
		expect(showsMap(result.before), `before ${result.before.join(', ')}`).toBe(true);
		expect(showsMap(result.after), `after ${result.after.join(', ')}`).toBe(true);
	});

	test(`a freed copy leaves a texture without its map after a GPU loss on ${gpu}`, async ({
		page,
	}) => {
		await page.goto(`map-loss.html?gpu=${gpu}&copies=off`);
		const result = await pageResult<MapResult>(page, 60_000);
		expect(result.error).toBeUndefined();
		expect(result.code).toBeNull();
		expect(showsMap(result.before), `before ${result.before.join(', ')}`).toBe(true);
		expect(showsMap(result.after), `after ${result.after.join(', ')}`).toBe(false);
	});
}

test('the engine draws on after a WebGL2 context loss in the middle of a frame', async ({
	page,
}) => {
	await page.goto('gpu-loss.html?gpu=webgl2&render=main&mid-frame');
	const result = await pageResult<LossResult>(page, 30_000);
	expect(result.error).toBeUndefined();
	expect(result.tier).toBe('webgl2');
	expect(result.lostMidFrame).toBe(true);
	expect(result.code).toBeNull();
	expect(result.framesAfter ?? 0).toBeGreaterThan(0);
});
