// A far card must draw the same tree as its mesh. The island's hand-baked cards once measured a
// third to four fifths brighter than their meshes and a third to a half flatter, so the far crowns
// read as another species. This draws one plant as its mesh and as its card, at one pose under one
// sun, and compares the crown's value and shading spread. The limits are set from the island's fixed
// cards: the dome-lit card measures 3 per cent over its mesh's value and 0.84 of its spread, where
// the pinned card measured 9 per cent and 0.69. A card that strays past them reads as another tree.
import { expect, test } from '@playwright/test';

/** The most that a card's crown value may exceed its mesh's, as a share. */
const LEAST_SPREAD = 0.75;
/** The most that a card's crown value may stray from its mesh's, as a share either way. */
const MOST_VALUE = 0.1;

test('a far card reads as its mesh under one sun', async ({ page, browserName }, info) => {
	test.skip(
		browserName !== 'chromium' || info.project.name !== 'chrome-real-gpu',
		'the island models load slowly on a software GPU',
	);
	test.setTimeout(180_000);
	const read = async (mode: 'mesh' | 'card') => {
		await page.goto(`/tests/pages/card-pair.html?mode=${mode}&kind=stone-pine&dist=150&scale=1`);
		await page.waitForFunction(
			() => (globalThis as { __null3dResult?: unknown }).__null3dResult !== undefined,
			undefined,
			{
				timeout: 150_000,
			},
		);
		const result = await page.evaluate(
			() =>
				(
					globalThis as unknown as {
						__null3dResult: { ok: boolean; error?: string; value?: number; spread?: number };
					}
				).__null3dResult,
		);
		if (!result.ok) throw new Error(result.error ?? 'the page failed');
		return result as { value: number; spread: number };
	};
	const mesh = await read('mesh');
	const card = await read('card');
	expect(card.spread / mesh.spread).toBeGreaterThan(LEAST_SPREAD);
	expect(Math.abs(card.value / mesh.value - 1)).toBeLessThanOrEqual(MOST_VALUE);
});
