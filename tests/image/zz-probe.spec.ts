import { test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

for (const gpu of ['webgl2', 'webgpu'])
	test(`probe ${gpu}`, async ({ page }) => {
		await page.goto(`engine.html?gpu=${gpu}&seconds=1`);
		const result = await pageResult<Record<string, unknown>>(page, 30_000);
		const stats = result.stats as Record<string, unknown>;
		console.log(
			gpu,
			JSON.stringify({
				frames: stats.frames,
				intervalMs: stats.intervalMs,
				threads: stats.threads,
				gpuMs: stats.gpuMs,
				hdr: (result.capabilities as Record<string, unknown>).hdr,
				preset: (result.mode as Record<string, unknown>).preset,
			}),
		);
	});
