// A draw that makes its own vertices from a vertex count: the frame's uploads with 1,000 copies and
// with 50,000 must match, and one draw call must carry them. A mesh or per-instance data would add
// bytes for every copy; this draw adds none, on WebGPU and on WebGL2.
import { expect, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

interface Figures {
	uploadBytes: number;
	uploadP99: number;
	drawCalls: number;
	frames: number;
}

interface VertexDrawResult {
	ok: boolean;
	error?: string;
	tier: string;
	mode: { build: string };
	few: number;
	many: number;
	accepted: { vertices: number; instances: number };
	before: Figures;
	after: Figures;
}

for (const gpu of ['webgpu', 'webgl2'] as const)
	test(`a draw of 50,000 copies uploads no per-copy data on ${gpu}`, async ({ page }) => {
		test.setTimeout(3 * 60_000);
		await page.goto(`vertex-draw.html?gpu=${gpu}`);
		const result = await pageResult<VertexDrawResult>(page, 120_000);
		console.log(`vertex-draw ${gpu}: ${JSON.stringify(result)}`);
		expect(result.error).toBeUndefined();
		// `?gpu=webgpu` gives the core path, or the compatibility path where the device lacks it.
		expect(result.tier.startsWith(gpu)).toBe(true);
		// The sketch took the new counts, so the second measurement drew 50,000 copies.
		expect(result.accepted).toEqual({ vertices: 6, instances: result.many });
		// A measurement with no frame reports zero everywhere, which is not a draw fault.
		expect(result.before.frames, 'the first measurement holds no frame').toBeGreaterThanOrEqual(1);
		expect(result.after.frames, 'the second measurement holds no frame').toBeGreaterThanOrEqual(1);
		// One draw carries them all, and the frame uploads the same bytes as with 1,000.
		expect(result.after.drawCalls).toBeGreaterThanOrEqual(1);
		expect(result.after.uploadBytes).toBeLessThanOrEqual(result.before.uploadBytes + 4_096);
		expect(result.after.uploadP99).toBeLessThanOrEqual(result.before.uploadP99 + 16_384);
		// A frame of this scene is a few kilobytes of records and uniforms, not 50,000 copies.
		expect(result.after.uploadBytes).toBeLessThan(256 * 1_024);
	});
