// The Creek's trees come from a file whose levels are made in Blender, with switch errors the author
// set by hand. Those switches change a whole crown, so they must fade: the engine hands them over in
// a dither band rather than in one frame. The page holds the camera still and sweeps the level bias
// across the first switch, so every change between two frames is the hand-over alone
// (tests/pages/creek-lod.ts). A crown that swaps at once shows as one step that changes a wide,
// solid block; a fade changes a few per cent of the crown as single dither pixels.
//
// The run with the level of detail off changes nothing at all, which proves the camera holds still.
import { expect, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

interface Step {
	bias: number;
	share: number;
	block: number;
	drawn: number;
}

interface CreekLodResult {
	tier: string;
	levels: { errors: number[]; fades: (boolean | undefined)[]; switches: number[] };
	lod: number;
	switchBias: number;
	found: Step[];
	fine: Step[];
	worst: Step & { index: number };
	images: string[];
}

/** The canvas, so the crown fills a good share of it. */
const SIZE = { width: 640, height: 360 };
/** The page's first and last level bias, and the share of the picture that counts as a change. */
const SEARCH_HIGH = 32;
const VISIBLE = 0.001;

for (const gpu of ['webgpu', 'webgl2'] as const)
	test(`the Creek's hand-set tree levels fade at their switch on ${gpu}`, async ({ page }) => {
		test.setTimeout(300_000);
		await page.setViewportSize({ width: SIZE.width + 20, height: SIZE.height + 20 });
		await page.goto(
			`creek-lod.html?gpu=${gpu}&lod=1&steps=24&width=${SIZE.width}&height=${SIZE.height}`,
		);
		const result = await pageResult<CreekLodResult>(page, 240_000);
		console.log(
			`creek-lod facts ${gpu} ${JSON.stringify({ switchBias: result.switchBias, worst: result.worst, fades: result.levels.fades, switches: result.levels.switches })}`,
		);
		// The file gives its levels errors alone, so its switches are hand-set and they fade. A level
		// that asked for no fade would set its entry false.
		expect(result.levels.errors.length).toBeGreaterThan(0);
		expect(result.levels.fades).not.toContain(false);
		// The switch lies inside the range that the test searched: the bisection saw the picture change
		// and narrowed the switch below the highest bias. A level that never switched would leave the
		// high end in place, and the sweep that follows would compare frames that match.
		expect(result.found.some((step) => step.share > VISIBLE)).toBe(true);
		expect(result.switchBias).toBeLessThan(SEARCH_HIGH);
		// One crown changes in one step when the switch does not fade: a block of over 50,000
		// pixels and about 30 per cent of the frame. A faded hand-over changes about 2 per cent of
		// the frame in single pixels as the dither advances.
		expect(result.worst.block).toBeLessThan(2000);
		expect(result.worst.share).toBeLessThan(0.1);
		// Both levels draw through the band, so the crown stays drawn across it.
		for (const step of result.fine) expect(step.drawn).toBeGreaterThan(0.45);

		// The camera holds still, so the base mesh at every bias changes nothing.
		await page.goto(
			`creek-lod.html?gpu=${gpu}&lod=0&steps=24&width=${SIZE.width}&height=${SIZE.height}`,
		);
		const still = await pageResult<CreekLodResult>(page, 240_000);
		expect(still.worst.share).toBe(0);
	});
