// Motion vectors on every GPU tier (decision record D-140). Each exact case of the motion vectors
// sketch draws the motion debug view in hold mode, whose held frame has a last frame one step
// before it, and the pixels' colors decode back into motion: the camera's part, which the view
// takes from the depth, plus each surface's own, which the motion pass draws. Moving boxes, the
// rows of a dynamic batch, a custom material's vertex offset, a masked pane's holes, a skinned tube
// and a morphed sphere must each show the motion that the sketch gives them, and still surfaces
// none. tests/pages/lib/motion-vectors.ts holds the figures.
import { expect, type Page, test } from '@playwright/test';
import { imageRuns, TIERS, type Tier } from '../lib/images.ts';
import { loadResult } from '../lib/page-result.ts';
import { failureText } from '../lib/runs.ts';
import {
	decodeMotion,
	FAST,
	MOTION_HOLD,
	pixelOf,
	pixelsPerFrame,
	SIZE,
	SLOW,
	SWAY,
} from '../pages/lib/motion-vectors.ts';

const SKETCH = 'tests/pages/sketches/motion-vectors-sketch.ts';

/**
 * How far a decoded motion may stray from the expected one, in pixels. The color's 8 bits hold the
 * length to a sixteenth of a pixel; the rest allows for a texel at a surface's edge.
 */
const TOLERANCE = 0.5;

type Motion = readonly [number, number];
/** Reads the motion of the pixel at a point of the exact cases' view, in meters. */
type MotionAt = (x: number, y: number) => Motion;

/** Draws one case of the sketch on a tier, and returns a reader of its pixels' motion. */
async function drawCase(
	page: Page,
	tier: Tier,
	query: string,
): Promise<MotionAt & { all(): Motion[] }> {
	const [run] = imageRuns([
		{ name: 'motion-case', sketch: `${SKETCH}?${query}`, hold: MOTION_HOLD, tiers: [tier] },
	]);
	if (!run) throw new Error('a sketch test has a run on its tier');
	const result = await loadResult(page, run.path, run.timeoutSeconds * 1000);
	expect(result.ok ? [] : [failureText(result)]).toEqual([]);
	const pixels = new Uint8Array(Buffer.from(String(result.pixels), 'base64'));
	const decode = (index: number): Motion =>
		decodeMotion(pixels[index * 4] ?? 0, pixels[index * 4 + 1] ?? 0, pixels[index * 4 + 2] ?? 0);
	const at = (x: number, y: number) => {
		const [column, row] = pixelOf(x, y);
		return decode(row * SIZE[0] + column);
	};
	return Object.assign(at, {
		all: () => Array.from({ length: SIZE[0] * SIZE[1] }, (_, index) => decode(index)),
	});
}

const format = ([x, y]: Motion) => `(${x.toFixed(2)}, ${y.toFixed(2)})`;

/** A problem when the motion strays from the expected motion by more than the tolerance. */
const near = (label: string, got: Motion, want: Motion): string[] =>
	Math.hypot(got[0] - want[0], got[1] - want[1]) <= TOLERANCE
		? []
		: [`${label} moved ${format(got)} pixels, not ${format(want)}`];

const STILL: Motion = [0, 0];
const fast = pixelsPerFrame(FAST);

for (const tier of TIERS) {
	test(`moving boxes show their motion and still ones none on ${tier}`, async ({ page }) => {
		const motion = await drawCase(page, tier, 'case=slide');
		expect([
			...near('box A, to the right', motion(-4, 2), [fast, 0]),
			...near('box B, downward', motion(0, 2), [0, pixelsPerFrame(SLOW)]),
			...near('box C, still', motion(4, 2), STILL),
			...near('the wall', motion(0, -3), STILL),
		]).toEqual([]);
	});

	test(`a moving camera adds its motion to every pixel on ${tier}`, async ({ page }) => {
		const motion = await drawCase(page, tier, 'case=slide&follow');
		expect([
			...near('box A, which the camera follows', motion(-4, 2), STILL),
			...near('box B', motion(0, 2), [-fast, pixelsPerFrame(SLOW)]),
			...near('box C', motion(4, 2), [-fast, 0]),
			...near('the wall', motion(0, -3), [-fast, 0]),
		]).toEqual([]);
	});

	test(`each row of a dynamic batch shows its motion on ${tier}`, async ({ page }) => {
		const motion = await drawCase(page, tier, 'case=rows');
		expect([
			...[-4, -1, 2].flatMap((x, row) => near(`row ${row}`, motion(x, 0), [fast, 0])),
			...near('the wall', motion(0, -3), STILL),
		]).toEqual([]);
	});

	test(`a custom material's vertex offset shows its motion on ${tier}`, async ({ page }) => {
		const motion = await drawCase(page, tier, 'case=sway');
		expect([
			...near('the swaying quad', motion(0, 0), [pixelsPerFrame(SWAY), 0]),
			...near('the wall', motion(3, 3), STILL),
		]).toEqual([]);
	});

	test(`a masked pane's holes show the still wall behind on ${tier}`, async ({ page }) => {
		const motion = await drawCase(page, tier, 'case=masked');
		const quarters = [motion(-1, 1), motion(1, 1), motion(-1, -1), motion(1, -1)];
		const moving = quarters.filter((got) => near('', got, [fast, 0]).length === 0).length;
		const still = quarters.filter((got) => near('', got, STILL).length === 0).length;
		expect({ moving, still, quarters: quarters.map(format) }).toMatchObject({
			moving: 2,
			still: 2,
		});
	});

	test(`a skinned tube shows its bend, fastest at its tip, on ${tier}`, async ({ page }) => {
		const motion = await drawCase(page, tier, 'case=skin');
		const length = ([x, y]: Motion) => Math.hypot(x, y);
		const fastest = motion.all().reduce((best, got) => (length(got) > length(best) ? got : best));
		expect([
			...near('the tube at its base', motion(0, -4.2), STILL),
			...near('the wall', motion(6, -3), STILL),
		]).toEqual([]);
		expect(length(fastest), `the fastest pixel moved ${format(fastest)}`).toBeGreaterThan(1.5);
		expect(fastest[0], 'the tube bends to its left').toBeLessThan(0);
	});

	test(`a morphed sphere shows its rising top and a still lower half on ${tier}`, async ({
		page,
	}) => {
		const motion = await drawCase(page, tier, 'case=morph');
		const top = motion(0, 1.9);
		expect([
			...near('the lower half', motion(0, -1), STILL),
			...near('the wall', motion(6, -3), STILL),
		]).toEqual([]);
		expect(top[1], `the top moved ${format(top)}`).toBeLessThan(-1);
		expect(Math.abs(top[0]), `the top moved ${format(top)}`).toBeLessThan(TOLERANCE);
	});
}
