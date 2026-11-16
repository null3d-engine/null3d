// GPU picking in a live engine: which object each pixel of the camera's image shows. The page
// draws a backdrop, a pole a few pixels wide and a card cut by an alpha mask, then asks the engine
// for the object at four probe pixels. The pick must name the object that the image shows at each
// one: the pole by its few pixels, the card by its opaque part, the backdrop through the mask's
// hole, and nothing where no object draws. A raycast at the hole finds the card, because rays test
// triangles and ignore masks, which is the difference between a ray and a pixel.
import { expect, type Page, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

interface PickPage {
	ok: boolean;
	error?: string;
	mode: { build: string; jobWorkers: number };
	picks: {
		answers: { name: string; expect: string | null; got: string | null }[];
		rays: { name: string; got: string | null }[];
		raysCard: string | null;
	};
	/** What a pick did after the GPU was taken away while its read was in flight. */
	loss?: { settled: boolean; outcome?: string; elapsedMs?: number };
	failures: string[];
}

/** Opens the pick page for a GPU path, and returns what it published. */
async function open(page: Page, tier: 'webgpu' | 'webgl2', extra = ''): Promise<PickPage> {
	await page.goto(`pick.html?gpu=${tier}${extra}`);
	const result = await pageResult<PickPage>(page, 90_000);
	expect(result.error).toBeUndefined();
	expect(result.ok).toBe(true);
	return result;
}

/** The picks that the page made, in the order of its probes. */
const EXPECTED = [
	{ name: 'pole', expect: 'pole', got: 'pole' },
	{ name: 'mask', expect: 'card', got: 'card' },
	{ name: 'hole', expect: 'background', got: 'background' },
	{ name: 'empty', expect: null, got: null },
];

for (const tier of ['webgpu', 'webgl2'] as const)
	test(`picks name the object that the image shows at each pixel, on ${tier}`, async ({ page }) => {
		// The first pick loads the picking shader files and builds their pipelines.
		test.setTimeout(120_000);
		const result = await open(page, tier);
		expect(result.failures).toEqual([]);
		expect(result.picks.answers, JSON.stringify(result.picks)).toEqual(EXPECTED);
		// The ray tests the card's triangles, so it finds the card through the hole that the mask
		// cuts: the ray and the pick answer differently, as they should.
		expect(result.picks.raysCard).toBe('card');
	});

for (const tier of ['webgpu', 'webgl2'] as const)
	test(`a pick is rejected when the GPU is lost with it in flight, on ${tier}`, async ({
		page,
	}) => {
		test.setTimeout(120_000);
		const result = await open(page, tier, '&lose-gpu');
		// The engine starts a new device, but it cannot finish the read that the lost one recorded.
		// The pick must settle, and the rule is that it rejects rather than waits or asks again.
		expect(result.failures).toEqual([]);
		expect(result.loss?.settled, JSON.stringify(result.loss)).toBe(true);
		expect(result.loss?.outcome).toMatch(/^error: E1436:/);
		expect(result.loss?.elapsedMs).toBeLessThan(20_000);
	});
