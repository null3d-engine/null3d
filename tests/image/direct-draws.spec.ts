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
 * A page whose frame holds a feature-instance draw, whose count the GPU writes. The draw needs the
 * frame's indirect arguments, so the builder takes the indirect path even when the probe chose the
 * direct one. Both runs must draw the same picture.
 */
const FEATURE_PAGE = `image.html?gpu=webgpu&hold=0&size=320x180&sketch=/tests/pages/sketches/feature-instances-sketch.ts`;
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

/** Draws the scene at `address` with the direct path forced on or off, and gives its held frame. */
async function held(page: Page, direct: 'on' | 'off', address = PAGE): Promise<HeldFrame> {
	await page.goto(`${address}&direct=${direct}`);
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
	// The test draws two held frames, and each may take its own wait of 120 seconds on a software
	// GPU: the default minute of a test cuts the first of them short, so a slow page fails as a
	// timeout instead of as a difference.
	test.setTimeout(300_000);
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

test('a feature-instance draw draws the same frame on both paths', async ({ page }) => {
	// The probe may choose the direct path on this device, and the builder takes the indirect one
	// for the session because the draw's count comes from GPU memory (D-174, D-229). Both runs
	// must draw one picture, so the routing is visible here.
	test.setTimeout(300_000);
	const direct = await held(page, 'on', FEATURE_PAGE);
	const indirect = await held(page, 'off', FEATURE_PAGE);
	expect([direct.ok, indirect.ok]).toEqual([true, true]);
	expect(direct.tier).toBe('webgpu');
	// The probe's choice differs, and only the builder's routing hides it.
	expect([direct.directDraws, indirect.directDraws]).toEqual([true, false]);
	expect([direct.width, direct.height]).toEqual([indirect.width, indirect.height]);
	const share = differentShare(
		Buffer.from(direct.pixels, 'base64'),
		Buffer.from(indirect.pixels, 'base64'),
		0.1,
	);
	expect(
		share,
		`${(share * 100).toFixed(4)}% of the pixels differ between the forced direct path and the indirect one, and at most ${(MAX_DIFF_RATIO * 100).toFixed(1)}% may`,
	).toBeLessThanOrEqual(MAX_DIFF_RATIO);
});
