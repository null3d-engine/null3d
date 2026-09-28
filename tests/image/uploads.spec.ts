import { expect, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

interface UploadsResult {
	error?: string;
	sizes: number[];
	/** The sizes the staging ring takes: from the first, up to but not including the second. */
	ring: [number, number];
	frames: { staged: number; uploaded: number; wrong: number[]; errors: string[] }[];
	/** WebGPU errors that no frame's error scope caught. */
	uncaptured: string[];
}

test('uploads of every size reach their buffers, through writeBuffer and the staging ring', async ({
	page,
}) => {
	await page.goto('uploads.html');
	const result = await pageResult<UploadsResult>(page, 90_000);
	expect(result.error).toBeUndefined();
	const total = result.sizes.reduce((sum, size) => sum + size, 0);
	for (const frame of result.frames) {
		expect(frame.errors).toEqual([]);
		expect(frame.wrong).toEqual(result.sizes.map(() => 0));
		expect(frame.uploaded).toBe(total);
	}
	expect(result.uncaptured).toEqual([]);
	// The ring starts with one small buffer and grows while uploads fall back to writeBuffer; by
	// the last frame it takes every upload in its range.
	const [min, max] = result.ring;
	const inRange = result.sizes
		.filter((size) => size >= min && size < max)
		.reduce((sum, size) => sum + size, 0);
	const staged = result.frames.map((frame) => frame.staged);
	expect(staged[0]).toBeGreaterThan(0);
	expect(staged[0]).toBeLessThan(inRange);
	expect(staged.at(-1)).toBe(inRange);
});
