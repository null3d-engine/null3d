// A video element on the page shown on a surface in the sketch, through `engine.registerVideo` and
// `textures.fromVideo`, on each GPU path: the video's frames arrive while it plays, stay within the
// preset's upload budget, take the size that the options allow and stand the right way up, and a
// paused video uploads nothing.
import { expect, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';
import { type VideoTextureResult, videoTextureProblems } from '../lib/video-texture-checks.ts';

/** The page's result as it arrives: its own figures, the page's error when it failed, and its tier. */
type Result = VideoTextureResult & { error?: string; tier: string };

for (const gpu of ['webgpu', 'webgl2'] as const)
	test(`a video on a surface on ${gpu}`, async ({ page }) => {
		test.setTimeout(180_000);
		await page.goto(`video-texture.html?gpu=${gpu}&preset=low`);
		const result = await pageResult<Result>(page, 120_000);
		expect(result.error).toBeUndefined();
		const { playing, paused, budget, frame, copy } = result;
		console.log(
			`video texture on ${result.tier}: ${(playing.mean / 1024).toFixed(1)} KiB a frame on average, ${(playing.p99 / 1024).toFixed(1)} KiB at p99 of ${(budget / 1024).toFixed(0)} KiB; paused ${paused.p99} bytes at p99; the page's copy: ${copy.medianMs.toFixed(2)} ms at the median, ${copy.p95Ms.toFixed(2)} ms at p95 of ${copy.count}; a ${frame.width} x ${frame.height} frame of a ${result.width} x ${result.height} video`,
		);
		expect(videoTextureProblems(result)).toEqual([]);
	});
