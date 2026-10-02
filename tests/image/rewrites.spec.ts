import { expect, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

interface RewritesResult {
	error?: string;
	tier: string;
	width: number;
	height: number;
	pixels: string;
}

// Each way the WebGL2 path writes its data textures again must leave every box where its last move
// put it: the frame drawn after the moves stop is the same, pixel for pixel, as with direct writes.
test('each way to write data textures again draws the moved boxes where they rest', async ({
	page,
}) => {
	test.setTimeout(120_000);
	const frames = new Map<string, RewritesResult>();
	for (const mode of ['direct', 'unpack', 'ring']) {
		await page.goto(`rewrites.html?gpu=webgl2&texture-rewrites=${mode}`);
		const result = await pageResult<RewritesResult>(page, 60_000);
		expect(result.error).toBeUndefined();
		expect(result.tier).toBe('webgl2');
		frames.set(mode, result);
	}
	const direct = frames.get('direct');
	for (const mode of ['unpack', 'ring']) {
		const frame = frames.get(mode);
		expect(frame?.width).toBe(direct?.width);
		expect(frame?.pixels === direct?.pixels, `${mode} draws as direct writes do`).toBe(true);
	}
});
