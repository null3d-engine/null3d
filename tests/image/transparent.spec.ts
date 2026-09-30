// A transparent canvas keeps premultiplied alpha. The image test manifest's transparent test draws
// the bright scene without a background; here its captured pixels must be clear where no tile
// draws, opaque inside the tiles, and premultiplied everywhere, with partly clear pixels at the
// tiles' antialiased edges. Core WebGPU draws it on the HDR path and compatibility mode on the
// 8-bit path, so both paths' alpha is checked.
import { expect, test } from '@playwright/test';
import { TIERS } from '../lib/images.ts';
import { loadResult } from '../lib/page-result.ts';
import { SIZE, tileCenters } from '../pages/lib/bright-scene.ts';
import { manifestRun } from './manifest.ts';

for (const tier of TIERS)
	test(`a transparent canvas keeps premultiplied alpha on ${tier}`, async ({ page }) => {
		const run = manifestRun('transparent', tier, 'pipelined');
		const result = await loadResult(page, run.path, run.timeoutSeconds * 1000);
		expect(result.error).toBeUndefined();
		if (tier === 'webgpu') expect(result.hdr).toBe(true);
		if (tier === 'compat') expect(result.hdr).toBe(false);
		const pixels = new Uint8Array(Buffer.from(String(result.pixels), 'base64'));
		const [width, height] = SIZE;
		const pixel = (x: number, y: number) => [
			...pixels.subarray((y * width + x) * 4, (y * width + x) * 4 + 4),
		];

		for (const [x, y] of [
			[0, 0],
			[width - 1, 0],
			[0, height - 1],
			[width - 1, height - 1],
		] as const)
			expect(pixel(x, y), `the corner at ${x}, ${y}`).toEqual([0, 0, 0, 0]);
		for (const [x, y] of tileCenters()) expect(pixel(x, y)[3], `the tile at ${x}, ${y}`).toBe(255);

		let partlyClear = 0;
		let overAlpha = 0;
		for (let at = 0; at < pixels.length; at += 4) {
			const alpha = pixels[at + 3] as number;
			if (alpha > 0 && alpha < 255) partlyClear++;
			if (Math.max(pixels[at] ?? 0, pixels[at + 1] ?? 0, pixels[at + 2] ?? 0) > alpha) overAlpha++;
		}
		expect(overAlpha, 'pixels with a color channel above their alpha').toBe(0);
		expect(partlyClear, 'partly clear pixels at the edges').toBeGreaterThan(0);
	});
