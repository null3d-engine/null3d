// Shadow edges stay still while the camera turns. The shadow turn sketch draws a camera that turns
// on the spot in small steps, each frame with shadows and without. The test maps each frame's pixels
// onto the first frame's. Where the first frame shows plain lit ground or plain shadow, with no edge
// nearby, a later frame must show the same. A cascade fitted afresh to each turn of the view would
// move its texels, and its shadow edges by several pixels. On both GPU paths, which draw shadows
// with the same code.
import { expect, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';
import { inFirstFrame, TURN } from '../pages/lib/shadow-turn.ts';

interface ImageResult {
	error?: string;
	tier: string;
	width: number;
	height: number;
	pixels: string;
}

const [WIDTH, HEIGHT] = [480, 270];
/** The camera's turns in degrees. The first frame is the one the others map onto. */
const YAWS = [0, 1.5, 3.7, 6];
/** A pixel is in shadow where shadows leave less than this share of its unshadowed brightness. */
const SHADOWED = 0.8;
/** Pixels of the first frame closer than this to a shadow edge or an object's edge are skipped. */
const MARGIN = 2;
/** The most an object's edge may change the brightness of the pixels around a compared pixel. */
const FLAT = 24;
/** The share of compared pixels that may differ: a few, where a pixel rounds onto an edge. */
const MAX_DIFFERENT = 0.002;

/** The brightness of each pixel of a frame: the sum of its red, green and blue. */
async function drawn(
	page: import('@playwright/test').Page,
	gpu: string,
	yaw: number,
	off: boolean,
): Promise<Float32Array> {
	const sketch = `/tests/pages/sketches/shadow-turn-sketch.ts?yaw=${yaw}${off ? '&off' : ''}`;
	const query = `gpu=${gpu}&hold=0&size=${WIDTH}x${HEIGHT}&sketch=${encodeURIComponent(sketch)}`;
	await page.goto(`image.html?${query}`);
	const result = await pageResult<ImageResult>(page, 30_000);
	expect(result.error).toBeUndefined();
	expect([result.width, result.height]).toEqual([WIDTH, HEIGHT]);
	const rgba = Buffer.from(result.pixels, 'base64');
	const light = new Float32Array(WIDTH * HEIGHT);
	for (let i = 0; i < light.length; i++)
		light[i] = (rgba[i * 4] ?? 0) + (rgba[i * 4 + 1] ?? 0) + (rgba[i * 4 + 2] ?? 0);
	return light;
}

/** A frame's shadows: 1 where a pixel is in shadow, 0 where it is not. */
function shadowsOf(lit: Float32Array, unshadowed: Float32Array): Uint8Array {
	return Uint8Array.from(lit, (value, i) => (value < SHADOWED * (unshadowed[i] ?? 0) ? 1 : 0));
}

/** True when the pixels within the margin of (x, y) hold one shadow value and no object's edge. */
function flatAround(shadows: Uint8Array, unshadowed: Float32Array, x: number, y: number): boolean {
	const at = y * WIDTH + x;
	let low = Number.POSITIVE_INFINITY;
	let high = 0;
	for (let dy = -MARGIN; dy <= MARGIN; dy++)
		for (let dx = -MARGIN; dx <= MARGIN; dx++) {
			const k = (y + dy) * WIDTH + x + dx;
			if (shadows[k] !== shadows[at]) return false;
			const value = unshadowed[k] ?? 0;
			low = Math.min(low, value);
			high = Math.max(high, value);
		}
	return high - low <= FLAT;
}

/** The frames' size and lens, for the map between them. */
const FRAME = { width: WIDTH, height: HEIGHT, ...TURN };

for (const gpu of ['webgpu', 'webgl2'] as const)
	test(`shadow edges stay still while the camera turns on ${gpu}`, async ({ page }) => {
		test.setTimeout(120_000);
		const frames = [];
		for (const yaw of YAWS) {
			const lit = await drawn(page, gpu, yaw, false);
			const unshadowed = await drawn(page, gpu, yaw, true);
			frames.push({ yaw, shadows: shadowsOf(lit, unshadowed), unshadowed });
		}
		const [first, ...turned] = frames;
		if (!first) throw new Error('no first frame');
		const shadowed = first.shadows.reduce((sum, value) => sum + value, 0);
		expect(shadowed, 'the first frame shows shadows').toBeGreaterThan(WIDTH * HEIGHT * 0.02);
		for (const frame of turned) {
			let compared = 0;
			let different = 0;
			for (let y = 0; y < HEIGHT; y++)
				for (let x = 0; x < WIDTH; x++) {
					const seen = inFirstFrame(FRAME, x, y, frame.yaw, MARGIN);
					if (!seen) continue;
					const [x0, y0] = seen;
					if (!flatAround(first.shadows, first.unshadowed, x0, y0)) continue;
					compared++;
					if (frame.shadows[y * WIDTH + x] !== first.shadows[y0 * WIDTH + x0]) different++;
				}
			expect(compared, `pixels compared at ${frame.yaw} degrees`).toBeGreaterThan(
				WIDTH * HEIGHT * 0.3,
			);
			expect(different / compared, `share that differs at ${frame.yaw} degrees`).toBeLessThan(
				MAX_DIFFERENT,
			);
		}
	});
