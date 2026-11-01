// A sky layer is a scene color, so the pass applies the scene's exposure to it, as the sky around it
// does, and the background's intensity dims it as that dims the sky. The sky layer exposure sketch
// puts a flat layer over the whole sky, and a mirror lake below it: the lake must show the sky's own
// value at either exposure, and only the exposure may part them, since the lake takes the sky's map
// and not the background's intensity. The map's light reaches a rough surface beside it, whose
// brightness follows the same exposure; the `sky-layer-light` page holds that light's own color.
import { expect, test } from '@playwright/test';
import { pageResultWhileProgressing } from '../lib/page-result.ts';

interface Capture {
	stretch: number;
	frame: number;
	sky: number[];
	lake: number[];
	rough: number[];
}

/** The stretch at the higher exposure and the one ten times dimmer; the third sits at half intensity. */
const [BRIGHT, DIM] = [0, 1];
/** How far the lake's color and the sky's may differ, in levels of 255: the lake mirrors one sky. */
const AGREEMENT = 6;
/** How much a stretch that is dimmed must fall below the bright one, as a share. */
const FALL = 0.6;
/** The stretch at half the background's intensity takes more than this share of the bright one. */
const ABOVE = 0.4;
/** The stretch at half the background's intensity takes less than this share of the bright one. */
const HALVED = 0.85;
/** The brightness that a lit rough surface must exceed, in levels of 255. */
const LIT = 10;
/** How far the captures at the end of a stretch must agree, in levels of 255. */
const STEADY = 3;
/**
 * The run fails when its page notes no new step for this long. The page notes a step at its first
 * frame and after each capture. CI's software GPU runs the page several times slower than a
 * desktop, so a wait on each step leaves a slow machine room and still fails a stuck page.
 */
const STALL_MS = 30_000;
/** The most time the run may take in all. */
const RUN_LIMIT_MS = 4 * 60_000;
const TIERS = { webgpu: 'webgpu', compat: 'webgpu-compat', webgl2: 'webgl2' } as const;

/** The mean of a stretch's last few captures of `place`. */
function settled(frames: Capture[], stretch: number, place: 'sky' | 'lake' | 'rough'): number[] {
	const inStretch = frames.filter((frame) => frame.stretch === stretch);
	const last = inStretch.slice(-4);
	return [0, 1, 2].map(
		(c) => last.reduce((sum, frame) => sum + (frame[place][c] as number), 0) / last.length,
	);
}

/** How bright a color is: the mean of its three channels, in levels of 255. */
const brightness = (color: number[]) =>
	((color[0] as number) + (color[1] as number) + (color[2] as number)) / 3;

/** The largest difference between two colors, in levels of 255. */
const apart = (one: number[], other: number[]) =>
	Math.max(...one.map((value, c) => Math.abs(value - (other[c] as number))));

for (const gpu of Object.keys(TIERS) as (keyof typeof TIERS)[])
	test(`a sky layer takes the scene's exposure in the sky and its reflection on ${gpu}`, async ({
		page,
	}) => {
		test.setTimeout(RUN_LIMIT_MS);
		await page.goto(`sky-layer-exposure.html?gpu=${gpu}&fps=20`);
		const result = await pageResultWhileProgressing<{
			error?: string;
			tier: string;
			frames: Capture[];
		}>(page, STALL_MS);
		expect(result.error).toBeUndefined();
		expect(result.tier).toBe(TIERS[gpu]);
		const { frames } = result;
		const places = ['sky', 'lake', 'rough'] as const;
		const colors = Object.fromEntries(
			['bright', 'dim', 'half'].map((name, k) => [
				name,
				Object.fromEntries(places.map((p) => [p, settled(frames, k, p)])),
			]),
		) as Record<'bright' | 'dim' | 'half', Record<(typeof places)[number], number[]>>;
		const text = JSON.stringify(colors);
		for (const [name, stretch] of [
			['bright', BRIGHT],
			['dim', DIM],
		] as const) {
			const { sky, lake, rough } = colors[name];
			// The lake mirrors a flat sky, so it shows the sky's own value.
			expect(apart(lake, sky), text).toBeLessThanOrEqual(AGREEMENT);
			// The map's light reaches the rough surface, so it draws more than black.
			if (name === 'bright') expect(brightness(rough), text).toBeGreaterThan(LIT);
			// The stretch settles, so its last captures are the settled color.
			for (const frame of frames.filter((f) => f.stretch === stretch).slice(-2))
				expect(apart(frame.sky, sky), text).toBeLessThanOrEqual(STEADY);
		}
		// Both places follow the exposure, so the dim stretch falls well below the bright one.
		expect(brightness(colors.dim.sky), text).toBeLessThan(FALL * brightness(colors.bright.sky));
		expect(brightness(colors.dim.rough), text).toBeLessThan(FALL * brightness(colors.bright.rough));
		// The background's intensity dims the sky and its layer, and never the map that the lake takes:
		// the sky falls and the lake keeps the value it had at the bright stretch.
		const halved = brightness(colors.half.sky);
		expect(halved, text).toBeLessThan(HALVED * brightness(colors.bright.sky));
		expect(halved, text).toBeGreaterThan(ABOVE * brightness(colors.bright.sky));
		expect(apart(colors.half.lake, colors.bright.lake), text).toBeLessThanOrEqual(AGREEMENT);
	});
