// The inspection channel that the in-page inspector and the MCP server use: the scene's listing,
// one object's read and change, its material, the selection outline, the frame figures, the render
// graph, the errors, a capture and a quality change. The channel is a development build's, so the
// test skips on a production page.
import { expect, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

interface InspectResult {
	ok?: boolean;
	error?: string;
	skipped?: string;
	count?: number;
	filtered?: number;
	slot?: number;
	changed?: number[];
	read?: number[];
	color?: string;
	roughness?: number;
	selected?: number | null;
	cleared?: number | null;
	frames?: number;
	fps?: number;
	graph?: boolean;
	errors?: string[];
	preset?: string;
	pngBytes?: number;
}

for (const gpu of ['webgpu', 'webgl2'] as const)
	test(`the inspection channel lists and changes a live scene on ${gpu}`, async ({ page }) => {
		await page.goto(`inspect.html?gpu=${gpu}`);
		const result = await pageResult<InspectResult>(page, 60_000);
		console.log(`inspect ${gpu}: ${JSON.stringify(result)}`);
		test.skip(result.skipped !== undefined, result.skipped ?? '');
		expect(result.ok).toBe(true);
		expect(result.error).toBeUndefined();
		expect(result.count ?? 0).toBeGreaterThan(3);
		expect(result.filtered ?? 0).toBeGreaterThan(0);
		expect(result.changed).toEqual([1, 2, 3]);
		expect(result.read).toEqual([1, 2, 3]);
		expect(result.color).toBe('#ff0000');
		expect(result.roughness).toBe(0.5);
		expect(result.selected).toBe(result.slot);
		expect(result.cleared).toBeNull();
		expect(result.frames ?? 0).toBeGreaterThan(0);
		expect(result.fps ?? 0).toBeGreaterThan(0);
		expect(result.graph).toBe(true);
		expect(result.errors).toEqual([]);
		expect(result.preset).toBe('low');
		expect(result.pngBytes ?? 0).toBeGreaterThan(0);
	});
