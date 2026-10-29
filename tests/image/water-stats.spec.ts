import { expect, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

/** What the water-stats page publishes: the overlay's water row on Medium and on High. */
interface WaterStatsResult {
	ok: boolean;
	error?: string;
	tier: string;
	/** True where the GPU path times passes one by one, so the water row can hold a GPU time. */
	stepTimer: boolean;
	/** The overlay's water row on Medium, and on Low. */
	row: string;
	low: string;
}

/** A memory figure in the row, such as `memory 0.5 MiB`. */
const MEMORY = /memory \d+\.\d MiB/;
/** A GPU time in the row, such as `gpu 1.52 ms`. */
const GPU_MS = /gpu \d+\.\d+ ms/;

for (const gpu of ['webgpu', 'webgl2'])
	test(`the stats overlay shows the water add-on's row and follows the preset, on ${gpu}`, async ({
		page,
	}) => {
		await page.goto(`water-stats.html?gpu=${gpu}&preset=medium`);
		const result = await pageResult<WaterStatsResult>(page, 45_000);
		expect(result.error).toBeUndefined();
		// The add-on's own row, on the preset's cadence and budget, with its GPU time where the
		// device times passes and its memory.
		expect(result.row).toContain('water');
		expect(result.row).toContain('reflectionEvery 2');
		expect(result.row).toContain('budget 1.7 of 1.7 ms');
		expect(result.row).toMatch(MEMORY);
		if (result.stepTimer) expect(result.row).toMatch(GPU_MS);
		else expect(result.row).toContain('gpu not measured');
		// Low draws the reflection every third frame, which the row follows.
		expect(result.low).toContain('reflectionEvery 3');
		expect(result.low).toContain('budget 1.7 of 1.7 ms');
		expect(result.low).toMatch(MEMORY);
	});
