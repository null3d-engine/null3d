import { expect, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

interface RewritesResult {
	error?: string;
	tier: string;
	width: number;
	height: number;
	pixels: string;
}

// The WebGL2 path writes its data textures again through pixel unpack buffers. After the boxes
// stop moving, every box must rest where its last move put it: the frame is the same, pixel for
// pixel, as that of a scene made with each box already there.
test('writes into WebGL2 data textures again draw the moved boxes where they rest', async ({
	page,
}) => {
	test.setTimeout(120_000);
	const frames: RewritesResult[] = [];
	for (const query of ['', '&settled']) {
		await page.goto(`rewrites.html?gpu=webgl2${query}`);
		const result = await pageResult<RewritesResult>(page, 60_000);
		expect(result.error).toBeUndefined();
		expect(result.tier).toBe('webgl2');
		frames.push(result);
	}
	const [moved, settled] = frames;
	expect(moved?.width).toBe(settled?.width);
	expect(moved?.pixels === settled?.pixels, 'the moved boxes draw as the settled ones').toBe(true);
});
