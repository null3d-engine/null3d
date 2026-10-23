// Staged levels of detail: a model whose file holds its coarsest level and whose finer levels
// download from files of their own (tests/pages/staged-levels.ts). The spec holds each stage file
// back until the page says that it captured the picture that the file itself draws. So the first
// picture is the coarse level that arrives with the model, and the second is the same copies drawn
// with every level that the stages brought. The two pictures must differ over a real share of the
// image, and both must draw the ground, on every GPU path.
//
// The second test loads the same model with the loader's level limit at 1, which downloads no
// stage: its picture shows what a page that never shows the finest level draws, and the stages do
// not change it.
import { expect, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

interface StagedResult {
	tier: string;
	loaded: { levels: number; staged: boolean };
	/** The stages that the model names. */
	expected: number;
	levels: number;
	size: [number, number];
	/** The share of the pixels that the picture with the stages differs in. */
	changed: number;
	/** The share of the coarse picture that draws over its background. */
	drawn: number;
	failures: string[];
}

for (const gpu of ['webgpu', 'compat', 'webgl2'] as const)
	test(`staged levels draw the coarse level first and the fine one after, on ${gpu}`, async ({
		page,
	}) => {
		test.setTimeout(180_000);
		/** The stage files' answers, which wait for the coarse picture. */
		let release: (() => void) | undefined;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let held = 0;
		await page.route(/\.m\d+\.lod\d+\.bin$/, async (route) => {
			held += 1;
			await gate;
			await route.continue();
		});
		await page.goto(`staged-levels.html?gpu=${gpu}`);
		await page.waitForFunction(() => (globalThis as { __stagedCoarse?: boolean }).__stagedCoarse);
		expect(held).toBeGreaterThan(0);
		release?.();
		const result = await pageResult<StagedResult>(page, 120_000);
		expect(result.failures).toEqual([]);
		expect(result.loaded).toEqual({ levels: 0, staged: true });
		// Every stage arrived and became a level of the mesh.
		expect(result.levels).toBe(result.expected);
		expect(result.expected).toBeGreaterThan(0);
		// Both pictures draw the ground, and the stages changed a real share of the pixels.
		expect(result.drawn).toBeGreaterThan(0.4);
		expect(result.changed).toBeGreaterThan(0.01);
	});

test('a level limit of 1 downloads no stage, so the picture stays the coarse one', async ({
	page,
}) => {
	test.setTimeout(180_000);
	const stages: string[] = [];
	page.on('request', (request) => {
		if (/\.m\d+\.lod\d+\.bin$/.test(request.url())) stages.push(request.url());
	});
	await page.goto('staged-levels.html?gpu=webgpu&max=1');
	const result = await pageResult<StagedResult>(page, 120_000);
	expect(result.failures).toEqual([]);
	expect(result.loaded).toEqual({ levels: 0, staged: true });
	expect(result.expected).toBeGreaterThan(0);
	expect(result.levels).toBe(0);
	expect(stages).toEqual([]);
	expect(result.drawn).toBeGreaterThan(0.4);
	expect(result.changed).toBeLessThan(0.001);
});
