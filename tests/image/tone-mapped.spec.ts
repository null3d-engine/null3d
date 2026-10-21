// The per-material tone mapping flag on both GPU paths (D-200). One bright unlit color draws on
// two panels, the left with toneMapped: false. The 8-bit path applies the output transform in each
// material's shader, so it keeps that panel's color as the display shows it, and tone maps the
// right panel with AgX's punchy curve: the panels differ. The HDR path tone maps the whole image in
// its final pass, which carries no per-material flag, so there the curve maps both panels and they
// draw alike. The test reads the mean color inside each panel, away from their edges, and checks
// each path's promise: the 8-bit path's flagged panel shows the material's own sRGB color, and the
// HDR path's panels match each other and stand away from that color. A copy with the switch that
// turns HDR color off checks the 8-bit path on WebGPU and WebGL2, whose shaders come from another
// build.
import { expect, type Page, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';
import { CAMERA, PANEL, PANEL_SRGB, SIZE } from '../pages/lib/tone-mapped.ts';
import { IMAGE_RUNS } from './manifest.ts';

test.describe.configure({ mode: 'parallel' });

type Point = readonly [number, number];

/** How far the camera stands from the panels' plane, which fills the view at its field of view. */
const DISTANCE = CAMERA.position[2];
const HALF_HEIGHT = Math.tan((CAMERA.fov * Math.PI) / 360) * DISTANCE;
const HALF_WIDTH = (HALF_HEIGHT * SIZE[0]) / SIZE[1];
/** The center of each panel in the image: the left one first, which keeps its display color. */
const POINTS: readonly Point[] = PANEL.x.map(
	(x): Point => [
		Math.round(SIZE[0] / 2 + (x / HALF_WIDTH) * (SIZE[0] / 2)),
		Math.round(SIZE[1] / 2),
	],
);
/** Half the side of the square of pixels whose mean color stands for a panel, which evens out the dither. */
const BLOCK = 7;
/**
 * How far a mean color may stray from the color that it should show, in steps out of 255: the
 * dither, which the mean takes out, and a step of the path's rounding.
 */
const EXACT = 3;
/** How far the panels may differ on the HDR path, where the flag changes nothing. */
const SAME = 2;
/**
 * How far the flagged panel's color must stand from its tone-mapped value, so a flag that does
 * nothing fails. AgX's punchy curve moves this color's brightest channel by about 57 steps.
 */
const DIFFERENT = 30;

interface Frame {
	error?: string;
	width: number;
	hdr: boolean;
	pixels: string;
}

interface Image {
	width: number;
	hdr: boolean;
	pixels: Uint8Array;
}

async function imageOf(page: Page, path: string): Promise<Image> {
	await page.goto(path);
	const frame = await pageResult<Frame>(page, 60_000);
	expect(frame.error).toBeUndefined();
	return {
		width: frame.width,
		hdr: frame.hdr,
		pixels: new Uint8Array(Buffer.from(frame.pixels, 'base64')),
	};
}

/** The mean color of the square of pixels around `point`. */
function meanAt(image: Image, [x, y]: Point): number[] {
	const sum = [0, 0, 0];
	for (let dy = -BLOCK; dy <= BLOCK; dy++)
		for (let dx = -BLOCK; dx <= BLOCK; dx++) {
			const i = 4 * ((y + dy) * image.width + x + dx);
			for (let c = 0; c < 3; c++) sum[c] = (sum[c] ?? 0) + (image.pixels[i + c] ?? 0);
		}
	return sum.map((s) => s / (2 * BLOCK + 1) ** 2);
}

/** The largest gap between two colors, in steps out of 255. */
const gapOf = (a: readonly number[], b: readonly number[]) =>
	Math.max(...a.map((value, c) => Math.abs(value - (b[c] ?? 0))));

/** The pipelined run of a manifest test on a tier. */
function runOf(name: string, tier: string) {
	const run = IMAGE_RUNS.find(
		(candidate) =>
			candidate.test === name && candidate.tier === tier && candidate.mode?.name === 'pipelined',
	);
	if (!run) throw new Error(`the manifest has no pipelined run of ${name} on ${tier}`);
	return run;
}

/**
 * What the spec reads: each tier's default path, which checks both promises across the tiers, and
 * the scene forced onto the 8-bit path on both backends, since WebGL2 draws HDR color on some
 * machines and its shaders come from another build.
 */
const CASES = [
	...(['webgpu', 'compat', 'webgl2'] as const).map((tier) => ({
		test: 'tone-mapped',
		tier,
		forced: false,
	})),
	...(['webgpu', 'webgl2'] as const).map((tier) => ({
		test: 'tone-mapped-8-bit',
		tier,
		forced: true,
	})),
];

for (const { test: name, tier, forced } of CASES)
	test(`the tone mapping flag keeps a material's display color, ${forced ? 'on the 8-bit path ' : ''}on ${tier}`, async ({
		page,
	}) => {
		test.setTimeout(180_000);
		const image = await imageOf(page, runOf(name, tier).path);
		if (forced) expect(image.hdr, 'the switch draws 8-bit color').toBe(false);
		else {
			// The two promises need one tier on each path, whichever path WebGL2 takes on a device.
			if (tier === 'webgpu') expect(image.hdr, 'core WebGPU draws HDR color').toBe(true);
			if (tier === 'compat') expect(image.hdr, 'compatibility mode draws 8-bit color').toBe(false);
		}
		const [flagged, mapped] = POINTS.map((point) => meanAt(image, point));
		const gap = gapOf(flagged ?? [], mapped ?? []);
		if (image.hdr) {
			expect
				.soft(gap, `the panels differ although the HDR path maps both: ${flagged}, ${mapped}`)
				.toBeLessThanOrEqual(SAME);
			for (const color of [flagged, mapped])
				expect
					.soft(gapOf(color ?? [], PANEL_SRGB), `a panel shows the display color on the HDR path`)
					.toBeGreaterThanOrEqual(DIFFERENT);
			return;
		}
		expect
			.soft(gapOf(flagged ?? [], PANEL_SRGB), `the flagged panel keeps its display color`)
			.toBeLessThanOrEqual(EXACT);
		expect
			.soft(gap, `the flag leaves the two panels alike: ${flagged}, ${mapped}`)
			.toBeGreaterThanOrEqual(DIFFERENT);
	});
