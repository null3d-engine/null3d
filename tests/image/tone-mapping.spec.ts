// null3D's tone mappings against three.js's: the bright scene drawn by three.js's WebGLRenderer
// with ACESFilmicToneMapping, AgXToneMapping, NeutralToneMapping and LinearToneMapping, and by
// null3D with each matching tone mapping on each GPU tier, at both exposures of the image tests,
// and on the 8-bit path too at an exposure of 1. Each tile's color must match. The spec compares a
// patch at the center of each tile, so the engines' antialiasing at the edges does not count, and
// the dithering averages out.
import { expect, type Page, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';
import {
	exposureOf,
	SIZE,
	STOPS,
	TONE_MAPPINGS,
	tileCenters,
	toneMappingTest,
} from '../pages/lib/bright-scene.ts';
import { eightBitTest, IMAGE_RUNS } from './manifest.ts';

test.describe.configure({ mode: 'parallel' });

/**
 * The most that a channel of a tile's mean color may differ between the engines, out of 255. The
 * 8-bit path and 16-bit floats come within 1 of three.js. The small float format that core WebGPU
 * uses where it can keeps 6 bits of red's and green's mantissa and 5 of blue's, and a GPU may round
 * toward zero when it writes one. On the Mac that drew blue up to 2.4 darker, and the worst case of
 * the format is about 3.5.
 */
const MAX_DIFFERENCE = 4;
/** The patch that a tile's color is the mean of: this many pixels each way from its center. */
const PATCH_RADIUS = 3;

interface Frame {
	ok: boolean;
	error?: string;
	width: number;
	height: number;
	pixels: string;
}

async function frameOf(page: Page, path: string): Promise<Uint8Array> {
	await page.goto(path);
	const frame = await pageResult<Frame>(page, 30_000);
	expect(frame.error).toBeUndefined();
	expect([frame.width, frame.height]).toEqual([...SIZE]);
	return new Uint8Array(Buffer.from(frame.pixels, 'base64'));
}

/** The mean RGB color of the patch at each tile's center. */
function tileColors(pixels: Uint8Array): number[][] {
	const [width] = SIZE;
	return tileCenters().map(([cx, cy]) => {
		const sum = [0, 0, 0];
		let count = 0;
		for (let y = cy - PATCH_RADIUS; y <= cy + PATCH_RADIUS; y++)
			for (let x = cx - PATCH_RADIUS; x <= cx + PATCH_RADIUS; x++) {
				const at = (y * width + x) * 4;
				for (let c = 0; c < 3; c++) sum[c] = (sum[c] ?? 0) + (pixels[at + c] ?? 0);
				count++;
			}
		return sum.map((value) => value / count);
	});
}

for (const tone of TONE_MAPPINGS)
	for (const stops of STOPS) {
		const exposure = exposureOf(stops);
		test(`${tone} tone mapping at exposure ${exposure} matches three.js on every path`, async ({
			page,
		}) => {
			const three = tileColors(
				await frameOf(page, `/bench/pages/threejs/tone-mapping.html?tone=${tone}&stops=${stops}`),
			);
			const tests = [toneMappingTest(tone, stops), ...(stops === 0 ? [eightBitTest(tone)] : [])];
			const runs = IMAGE_RUNS.filter((run) => tests.includes(run.test));
			expect(runs.length).toBe(stops === 0 ? 5 : 3);
			for (const run of runs) {
				const null3d = tileColors(await frameOf(page, run.path));
				const worst = null3d.map((color, tile) =>
					Math.max(...color.map((value, c) => Math.abs(value - (three[tile]?.[c] ?? 0)))),
				);
				const tile = worst.indexOf(Math.max(...worst));
				expect
					.soft(
						worst[tile],
						`${run.id}: tile ${tile} is ${null3d[tile]?.map((v) => v.toFixed(1))}, and three.js draws ${three[tile]?.map((v) => v.toFixed(1))}`,
					)
					.toBeLessThanOrEqual(MAX_DIFFERENCE);
			}
		});
	}

/**
 * The exposure in stops of the bright tiles test: it lights the brightest tiles to about 250, past
 * where the half precision builds once clipped each channel at 64. On CI's software GPU that clip
 * drew colored tiles 5 to 7 steps of 255 from full precision under AgX and Neutral, toward white or
 * another hue.
 */
const BRIGHT_STOPS = 4;

/** A run's page with the bright tiles' exposure and the precision that `half` names. */
const brightPage = (path: string, half: 'on' | 'off') =>
	`${path.replace('stops%3D0', `stops%3D${BRIGHT_STOPS}`)}&half=${half}`;

for (const tone of TONE_MAPPINGS.filter((tone) => tone !== 'none'))
	test(`${tone} tone mapping draws very bright colored light at half precision as at full precision`, async ({
		page,
	}) => {
		const runs = IMAGE_RUNS.filter((run) =>
			[toneMappingTest(tone, 0), eightBitTest(tone)].includes(run.test),
		);
		expect(runs.length).toBe(5);
		for (const run of runs) {
			expect(run.path).toContain('stops%3D0');
			const full = tileColors(await frameOf(page, brightPage(run.path, 'off')));
			const half = tileColors(await frameOf(page, brightPage(run.path, 'on')));
			const worst = half.map((color, tile) =>
				Math.max(...color.map((value, c) => Math.abs(value - (full[tile]?.[c] ?? 0)))),
			);
			const tile = worst.indexOf(Math.max(...worst));
			expect
				.soft(
					worst[tile],
					`${run.id}: tile ${tile} is ${half[tile]?.map((v) => v.toFixed(1))} at half precision, and ${full[tile]?.map((v) => v.toFixed(1))} at full precision`,
				)
				.toBeLessThanOrEqual(MAX_DIFFERENCE);
		}
	});
