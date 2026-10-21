// The direct-draw path must draw the same frame as the indirect one (D-174). This draws one scene
// twice in one browser, once with ?direct=on and once with ?direct=off, and compares the two frames
// with each other. It needs no references, so a divergence in either path fails here even on a
// device whose pictures were never saved.
import { expect, type Page, test } from '@playwright/test';
import { differentShare } from '../lib/images.ts';

/** The scene: crates with spot shadows, an environment, ambient occlusion and bloom, held at 1 s. */
const SCENE = '/examples/objects/sketch.ts';
/** The page of the two runs: the sketch test's image page on WebGPU, held at one second. */
const PAGE = `image.html?gpu=webgpu&hold=1&preset=high&size=320x180&sketch=${SCENE}`;
/**
 * The largest share of pixels that may differ. The two paths read one scene and must draw one
 * frame; this allows a pixel of rounding where a culling sphere lies on a plane.
 */
const MAX_DIFF_RATIO = 0.001;

/** A held frame, as the page publishes it, with the engine's choice of draw path. */
interface HeldFrame {
	ok: boolean;
	error?: string;
	tier: string;
	width: number;
	height: number;
	directDraws: boolean;
	/** The frame's pixels, base64 of RGBA rows. */
	pixels: string;
}

/** Draws the scene with the direct path forced on or off, and gives its held frame. */
async function held(page: Page, direct: 'on' | 'off'): Promise<HeldFrame> {
	await page.goto(`${PAGE}&direct=${direct}`);
	await page.waitForFunction('globalThis.__null3dHold !== undefined', undefined, {
		timeout: 120_000,
	});
	return page.evaluate(() => {
		const globe = globalThis as Record<string, unknown>;
		const hold = globe.__null3dHold as {
			ok: boolean;
			error?: string;
			tier: string;
			width: number;
			height: number;
			directDraws: boolean;
			pixels: Uint8Array;
		};
		let binary = '';
		for (let at = 0; at < hold.pixels.length; at += 0x8000)
			binary += String.fromCharCode(...hold.pixels.subarray(at, at + 0x8000));
		return {
			ok: hold.ok,
			error: hold.error,
			tier: hold.tier,
			width: hold.width,
			height: hold.height,
			directDraws: hold.directDraws,
			pixels: btoa(binary),
		};
	});
}

test('the direct and indirect draw paths draw the same frame', async ({ page }) => {
	const direct = await held(page, 'on');
	const indirect = await held(page, 'off');
	expect([direct.ok, indirect.ok]).toEqual([true, true]);
	expect(direct.tier).toBe('webgpu');
	// The switch must have forced the path each run measured the other against.
	expect([direct.directDraws, indirect.directDraws]).toEqual([true, false]);
	expect([direct.width, direct.height]).toEqual([indirect.width, indirect.height]);
	const share = differentShare(
		Buffer.from(direct.pixels, 'base64'),
		Buffer.from(indirect.pixels, 'base64'),
		0.1,
	);
	expect(
		share,
		`${(share * 100).toFixed(4)}% of the pixels differ between ?direct=on and ?direct=off, and at most ${(MAX_DIFF_RATIO * 100).toFixed(1)}% may`,
	).toBeLessThanOrEqual(MAX_DIFF_RATIO);
});
