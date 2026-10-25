// M3-E9's first user: the night town's pines are drawn from the count word that its compute pass
// writes. The page's own count stays at the pines' capacity on this path, so a page that ignored the
// hook would draw every pine. Two held frames of the same demo at two presets therefore differ in
// the ring of pines, and a hook that drew the page's count would draw the whole ring in both.
//
// The software GPU cannot draw this demo inside its hold limit, as D-229 records, so the
// measurement runs on the real GPU alone.
import { expect, test } from '@playwright/test';

/** What hold mode publishes on the page, as the engine's hold page describes it. */
interface HeldPage {
	__null3dHold?: {
		ok: boolean;
		error?: string;
		width?: number;
		height?: number;
		pixels?: Uint8Array;
	};
}

/** The frame that the demo holds at `preset`, and its pixels. */
async function heldFrame(
	page: import('@playwright/test').Page,
	preset: 'low' | 'ultra',
): Promise<Uint8Array> {
	await page.goto(`/examples/index.html?demo=night-town&preset=${preset}&hold=0.5`);
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

test('the night town draws the pines that the compute pass counts', async ({ page }, testInfo) => {
	test.skip(
		testInfo.project.name !== 'chrome-real-gpu',
		'the software GPU cannot draw the night town inside its hold limit (D-229)',
	);
	test.setTimeout(600_000);
	const low = await heldFrame(page, 'low');
	const lowAgain = await heldFrame(page, 'low');
	// The same preset draws the same frame, so the two pictures differ only by what the preset does.
	const still = differing(low, lowAgain) * 100;
	expect(still).toBeLessThan(1);
	const ultra = await heldFrame(page, 'ultra');
	// Ultra draws 400 pines where Low draws 90, and the page's own count is the capacity in both, so
	// only the compute pass's count can thin the ring at Low.
	const moved = differing(low, ultra) * 100;
	console.log(
		`pine count: ${still.toFixed(2)}% moved between two Low frames, ${moved.toFixed(2)}% between Low and Ultra`,
	);
	expect(
		moved,
		`${moved.toFixed(1)} per cent of the frame moved between the presets`,
	).toBeGreaterThan(2);
});
