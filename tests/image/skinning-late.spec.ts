// Skinned meshes added during play, on every GPU tier. They are the page's first skinned meshes, so
// the engine downloads the skinning shader file then, once. Until the pipelines that skin and draw
// them are built, every pass leaves them out: no frame across the change skips a draw, and the
// frame before it shows the background alone. Once they draw, they stand in the pose that the same
// scene shows when its characters stand from the first frame.
import { expect, type Page, test } from '@playwright/test';
import { differentShare } from '../lib/images.ts';
import { pageResult } from '../lib/page-result.ts';

interface SkinningLateResult {
	error?: string;
	tier: string;
	width: number;
	height: number;
	before: string;
	after: string;
	acrossSkippedDraws: number;
	failures: string[];
}

const TIERS = [
	{ tier: 'webgpu', query: 'gpu=webgpu' },
	{ tier: 'webgpu-compat', query: 'gpu=compat' },
	{ tier: 'webgl2', query: 'gpu=webgl2' },
] as const;

/** The most a channel may differ for two pixels to count as the same. */
const CHANNEL = 8;
/** The share of pixels that may differ between the two frames after the change. */
const MAX_DIFFERENT = 0.002;

/** Loads the page with `query`, and returns its result and the skinning shader files it asked for. */
async function load(page: Page, query: string) {
	const requests: string[] = [];
	page.context().on('request', (request) => requests.push(new URL(request.url()).pathname));
	await page.goto(`skinning-late.html?${query}`);
	const result = await pageResult<SkinningLateResult>(page, 60_000);
	expect(result.error).toBeUndefined();
	expect(result.failures).toEqual([]);
	return {
		result,
		skinningFiles: requests.filter((path) => /\/shaders-skinning-[^/]*$/.test(path)),
	};
}

for (const { tier, query } of TIERS)
	test(`skinned meshes added during play appear whole, in their pose, on ${tier}`, async ({
		page,
	}) => {
		const late = await load(page, `${query}&late`);
		expect(late.result.tier).toBe(tier);
		expect(late.result.acrossSkippedDraws).toBe(0);
		expect(late.skinningFiles).toHaveLength(1);
		const before = Buffer.from(late.result.before, 'base64');
		const background = Uint8Array.from(before.subarray(0, 4));
		const empty = new Uint8Array(before.length);
		for (let i = 0; i < empty.length; i += 4) empty.set(background, i);
		expect(differentShare(before, empty, CHANNEL)).toBe(0);

		const reference = await load(page, query);
		const after = Buffer.from(late.result.after, 'base64');
		const expected = Buffer.from(reference.result.after, 'base64');
		expect(differentShare(after, empty, CHANNEL)).toBeGreaterThan(0.01);
		expect(differentShare(after, expected, CHANNEL)).toBeLessThanOrEqual(MAX_DIFFERENT);
	});
