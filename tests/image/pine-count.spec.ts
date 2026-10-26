// M3-E9's first user: the night town's pines are drawn from the count word that its compute pass
// writes. The page's own count stays at the pines' capacity on this path, so a page that ignored the
// hook would draw every pine.
//
// The demo holds one preset, Low, and only the pass's count word changes: capacity against the
// preset's own count. Everything else in the scene is therefore the same in both frames, so the
// difference between them is the pines and nothing else. A page that drew from its own count would
// draw the capacity both times and show no difference at all.
import { expect, test } from '@playwright/test';

/** What hold mode publishes on the page, as the engine's hold page describes it. */
interface HeldPage {
	__null3dHold?: {
		ok: boolean;
		error?: string;
		pixels?: Uint8Array;
	};
}

/** The preset's own pine count at Low, and the capacity that the count word can hold. */
const LOW = 90;
const CAPACITY = 400;

/** The frame that the demo holds at Low with `pines` as the count word's value. */
async function heldFrame(
	page: import('@playwright/test').Page,
	pines: number,
): Promise<Uint8Array> {
	const query = new URLSearchParams({
		sketch: `/examples/showcase/night-town/sketch.ts?pines=${pines}`,
		hold: '0.5',
		size: '320x180',
		preset: 'low',
		gpu: 'webgpu',
	});
	await page.goto(`/tests/pages/image.html?${query}`);
	await page.waitForFunction(
		() => (globalThis as unknown as HeldPage).__null3dHold !== undefined,
		undefined,
		{ timeout: 240_000 },
	);
	const held = await page.evaluate(() => (globalThis as unknown as HeldPage).__null3dHold);
	expect(held?.ok, held?.error ?? 'the demo held its frame').toBe(true);
	if (!held?.pixels) throw new Error('the held frame carried no pixels');
	return held.pixels;
}

/** The share of pixels whose colour differs between two frames by more than a rounding step. */
function differing(a: Uint8Array, b: Uint8Array): number {
	expect(b.length).toBe(a.length);
	let pixels = 0;
	for (let at = 0; at < a.length; at += 4) {
		let moved = 0;
		for (let c = 0; c < 3; c++)
			moved = Math.max(moved, Math.abs((a[at + c] as number) - (b[at + c] as number)));
		if (moved > 8) pixels++;
	}
	return pixels / (a.length / 4);
}

test('the night town draws the pines that the count word names', async ({ page }) => {
	test.setTimeout(600_000);
	const low = await heldFrame(page, LOW);
	const lowAgain = await heldFrame(page, LOW);
	// The same count word draws the same frame, so the harness itself moves nothing.
	const still = differing(low, lowAgain) * 100;
	expect(still).toBeLessThan(1);
	// The capacity draws the whole ring where the preset's count draws a part of it. Only the pass's
	// word changed, so the difference is the pines.
	const full = await heldFrame(page, CAPACITY);
	const moved = differing(low, full) * 100;
	console.log(
		`count word: ${still.toFixed(2)}% moved between two frames of ${LOW}, ${moved.toFixed(2)}% between ${LOW} and ${CAPACITY}`,
	);
	expect(
		moved,
		`${moved.toFixed(1)} per cent of the frame moved with the count word`,
	).toBeGreaterThan(2);
});
