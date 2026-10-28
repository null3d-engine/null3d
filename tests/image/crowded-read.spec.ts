// A frame of twelve passes, each writing a red of its own, and a read of one texel of each. The
// reads land in buffers beside the views' own, so a builder that gives a view's buffers the ids that
// the reads map answers with a view's frame buffer, or with no bytes at all. The test checks what
// the reads answer, not what the ids are.
import { expect, type Page, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

/** What the page reports once its reads have landed. */
interface CrowdedResult {
	ok?: boolean;
	tier: string;
	mode: unknown;
	values: number[];
	counts: number[];
	frames: number[];
	error?: string;
}

/** The GPU paths that the page runs, and the switch that chooses each. */
const TIERS = [
	{ tier: 'webgpu', query: 'gpu=webgpu' },
	{ tier: 'webgpu-compat', query: 'gpu=compat' },
	{ tier: 'webgl2', query: 'gpu=webgl2' },
] as const;

/** The passes that the sketch adds, and the colour that each writes. */
const PASSES = 12;

async function crowded(page: Page, query: string): Promise<CrowdedResult> {
	await page.goto(`crowded-read.html?${query}`);
	const result = await pageResult<CrowdedResult>(page, 120_000);
	expect(result.ok).toBe(true);
	expect(result.error).toBeUndefined();
	return result;
}

for (const { tier, query } of TIERS) {
	test(`the reads of a crowded frame answer with their own passes on ${tier}`, async ({ page }) => {
		const result = await crowded(page, query);
		expect(result.tier).toBe(tier);
		expect(result.values.length).toBe(PASSES);
		for (let k = 0; k < PASSES; k++)
			expect(result.values[k] as number).toBeCloseTo((k + 1) / 16, 2);
		console.log(
			`${tier}: reds ${result.values.map((v) => v.toFixed(2)).join(' ')}, carried ${result.counts.join(' ')}`,
		);
	});
}
