// M3-E9's first user: the night town's pines are drawn from the count word that its compute pass
// writes. The page's own count stays at the pines' capacity on the WebGPU path, so a page that
// ignored the hook would draw every pine.
//
// The demo holds one preset, and only the count changes: capacity against the preset's own count.
// Everything else in the scene is therefore the same in both frames, so the difference between them
// is the pines and nothing else. A page that drew from its own count would draw the capacity both
// times and show no difference at all.
//
// The default case is Low on WebGPU. NULL3D_PINE_PRESETS and NULL3D_PINE_GPUS name other cases, such
// as `high` and `webgl2`, one comma-separated list each. On WebGL2 the page's count is the one that
// changes, since that path has no compute pass.
import { expect, test } from '@playwright/test';

/** What hold mode publishes on the page, as the engine's hold page describes it. */
interface HeldPage {
	__null3dHold?: {
		ok: boolean;
		error?: string;
		pixels?: Uint8Array;
	};
}

/** Each preset's own pine count. The capacity that the count word can hold is the Ultra count. */
const COUNTS: Record<string, number> = { low: 90, medium: 200, high: 320 };
const CAPACITY = 400;

/** The presets and GPU tiers that the run covers, as this machine's environment names them. */
const CASES = (process.env.NULL3D_PINE_PRESETS ?? 'low')
	.split(',')
	.flatMap((preset) =>
		(process.env.NULL3D_PINE_GPUS ?? 'webgpu').split(',').map((gpu) => ({ preset, gpu })),
	);

/** The frame that the demo holds at `preset` on `gpu` with `pines` as the count's value. */
async function heldFrame(
	page: import('@playwright/test').Page,
	preset: string,
	gpu: string,
	pines: number,
): Promise<Uint8Array> {
	const query = new URLSearchParams({
		sketch: `/examples/showcase/night-town/sketch.ts?pines=${pines}`,
		hold: '0.5',
		size: '320x180',
		preset,
		gpu,
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

const NAME = 'the night town draws the pines that the count word names';

for (const { preset, gpu } of CASES) {
	const own = COUNTS[preset];
	if (own === undefined) throw new Error(`NULL3D_PINE_PRESETS names ${preset}.`);
	const title = CASES.length === 1 ? NAME : `${NAME}, at ${preset} on ${gpu}`;
	test(title, async ({ page }) => {
		test.setTimeout(600_000);
		const part = await heldFrame(page, preset, gpu, own);
		const partAgain = await heldFrame(page, preset, gpu, own);
		// The same count draws the same frame, so the harness itself moves nothing.
		const still = differing(part, partAgain) * 100;
		expect(still).toBeLessThan(1);
		// The capacity draws the whole ring where the preset's count draws a part of it. Only the
		// count changed, so the difference is the pines.
		const full = await heldFrame(page, preset, gpu, CAPACITY);
		const moved = differing(part, full) * 100;
		console.log(
			`${preset} on ${gpu}: count ${own} against ${CAPACITY}: ${still.toFixed(2)}% moved between two frames of ${own}, ${moved.toFixed(2)}% between ${own} and ${CAPACITY}`,
		);
		expect(moved, `${moved.toFixed(1)} per cent of the frame moved with the count`).toBeGreaterThan(
			2,
		);
	});
}
