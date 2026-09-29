import { expect, test } from '@playwright/test';
import { compareToReference } from '../lib/images';
import { pageResult } from '../lib/page-result.ts';

interface TexturesResult {
	error?: string;
	/** The GPU errors that the replay raised. */
	errors: string[];
	/** Whether the WebGPU device had core features; absent on WebGL2. */
	core?: boolean;
	width: number;
	height: number;
	pixels: string;
}

/** The GPU paths: core WebGPU, WebGPU forced into compatibility mode, and WebGL2. */
const TIERS = ['webgpu', 'compat', 'webgl2'] as const;
const updating = process.env.UPDATE_REFERENCES === '1';

for (const tier of TIERS) {
	test(`every texture command draws the same image on ${tier}`, async ({ page }) => {
		await page.goto(`replay-textures.html?gpu=${tier}`);
		const result = await pageResult<TexturesResult>(page, 30_000);
		expect(result.error).toBeUndefined();
		expect(result.errors).toEqual([]);
		if (tier !== 'webgl2') expect(result.core).toBe(tier === 'webgpu');
		const pixels = Buffer.from(result.pixels, 'base64');
		compareToReference('replay-textures', tier, pixels, result.width, result.height);
		// Every path must draw what core WebGPU draws.
		if (!updating && tier !== 'webgpu')
			compareToReference('replay-textures', 'webgpu', pixels, result.width, result.height);
	});
}
