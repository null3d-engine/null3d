// Fog stays still while the camera turns. The fog turn sketch draws a white box in black fog, and
// turns the camera so that the box moves from the middle of the frame toward its edge. Fog that
// measures the straight-line distance from the camera keeps the box's color. Fog that measured the
// depth along the view, as three.js's does, would make the box near the edge about 20 levels
// brighter, because its depth there is a quarter shorter than its distance. On every GPU tier.
import { expect, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

interface ImageResult {
	error?: string;
	tier: string;
	width: number;
	height: number;
	pixels: string;
}

const [WIDTH, HEIGHT] = [480, 270];
/** The camera's turns in degrees. At the last, the box is near the frame's right edge. */
const YAWS = [0, 20, 40];
/** The most that the box's brightest channel may change between turns, in levels of 255. */
const MAX_CHANGE = 2;
/** The tier that the image page reports for each `gpu` switch. */
const TIERS = { webgpu: 'webgpu', compat: 'webgpu-compat', webgl2: 'webgl2' } as const;

/** The brightest channel value of any pixel of the frame: the box's nearest point. */
async function brightest(
	page: import('@playwright/test').Page,
	gpu: keyof typeof TIERS,
	yaw: number,
): Promise<number> {
	const sketch = `/tests/pages/sketches/fog-turn-sketch.ts?yaw=${yaw}`;
	const query = `gpu=${gpu}&hold=0&size=${WIDTH}x${HEIGHT}&sketch=${encodeURIComponent(sketch)}`;
	await page.goto(`image.html?${query}`);
	const result = await pageResult<ImageResult>(page, 30_000);
	expect(result.error).toBeUndefined();
	expect(result.tier).toBe(TIERS[gpu]);
	expect([result.width, result.height]).toEqual([WIDTH, HEIGHT]);
	const rgba = Buffer.from(result.pixels, 'base64');
	let most = 0;
	for (let i = 0; i < rgba.length; i += 4)
		most = Math.max(most, rgba[i] ?? 0, rgba[i + 1] ?? 0, rgba[i + 2] ?? 0);
	return most;
}

for (const gpu of Object.keys(TIERS) as (keyof typeof TIERS)[])
	test(`fog stays still while the camera turns on ${gpu}`, async ({ page }) => {
		test.setTimeout(90_000);
		const levels = [];
		for (const yaw of YAWS) levels.push(await brightest(page, gpu, yaw));
		const [ahead = 0] = levels;
		// The box shows through the fog: neither hidden nor clear.
		expect(ahead).toBeGreaterThan(64);
		expect(ahead).toBeLessThan(224);
		for (const level of levels) expect(Math.abs(level - ahead)).toBeLessThanOrEqual(MAX_CHANGE);
	});
