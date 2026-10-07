// Raycasts against sprite, point and line rows in a live engine, on every GPU path. The row raycast
// page builds sprites, points and lines in null3D and their twins in three.js, and casts the same
// seeded rays through both. Rays from the camera must give the hits of three.js's Sprite, Line2 and
// LineSegments2, and rays from anywhere with three.js's thresholds the hits of its Points, Line,
// LineSegments and LineLoop. A ray through each pixel of a frame must hit the row that the pixel
// shows, or nothing where it shows the background, so rays hit what each GPU path draws. And a
// click on a sprite, a point and a line reaches the handler of its batch with the row under it.
import { expect, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';
import type { RowRaycastResults, RowTarget } from '../pages/lib/raycast-rows.ts';
import { ROW_BATCHES } from '../pages/lib/raycast-rows.ts';

interface RowRaycastPage {
	ok: boolean;
	error?: string;
	tier: string;
	results: RowRaycastResults;
	picture: {
		judged: number;
		edges: number;
		drawn: number;
		missing: number;
		extra: number;
		swapped: number;
		examples: string[];
	};
	failures: string[];
}

/** How long a test waits for the sketch's replies: CI's software GPU can be slow. */
const WAIT_MS = 30_000;

test.describe.configure({ timeout: 180_000 });

for (const tier of ['webgpu', 'compat', 'webgl2'] as const)
	test(`raycasts hit sprites, points and lines as three.js's Raycaster does and as the frame draws them, and clicks reach them, on ${tier}`, async ({
		page,
	}) => {
		await page.goto(`raycast-rows.html?gpu=${tier}`);
		const result = await pageResult<RowRaycastPage>(page, 120_000);
		expect(result.error).toBeUndefined();
		expect(result.failures).toEqual([]);
		const { results, picture } = result;
		expect([results.mismatches, results.examples]).toEqual([0, []]);
		expect(results.cameraRays).toBe(800);
		expect(results.thresholdRays).toBe(800);
		// Every batch was hit often enough to mean something.
		for (const batch of ROW_BATCHES)
			expect(results.hitsByBatch[batch] ?? 0, batch).toBeGreaterThan(20);
		// Every pixel away from a row's edge shows what its ray hits.
		expect([picture.missing, picture.extra, picture.swapped, picture.examples]).toEqual([
			0,
			0,
			0,
			[],
		]);
		expect(picture.judged).toBeGreaterThan(50_000);
		expect(picture.drawn).toBeGreaterThan(2_000);
		// A click on a sprite, a point and a line reaches the handler of its batch.
		const ask = <T>(message: string) =>
			page.evaluate(
				(message) =>
					(globalThis as { rowRaycast?: (message: string) => Promise<unknown> }).rowRaycast?.(
						message,
					) as Promise<T>,
				message,
			);
		const targets = await ask<RowTarget[]>('targets');
		expect(targets.map((t) => t.hit.split('#')[0])).toEqual([
			'world sprites',
			'world points',
			'pixel strip',
		]);
		for (const { x, y } of targets) await page.mouse.click(x, y);
		await expect
			.poll(() => ask<string[]>('clicks'), { timeout: WAIT_MS })
			.toEqual(targets.map((t) => t.hit));
	});
