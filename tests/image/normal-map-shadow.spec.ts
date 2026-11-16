// The shadow of a plate on normal-mapped ground, on every GPU tier. The ground's normal map tilts
// its normals hard, while the plate floats just above it, so the shadow filter's comparison lies
// within reach of the plate's near face. The filter compares each stored depth with the surface
// plane at the receiver, which must follow the flat triangles that the shadow map holds: a plane
// built from the normal map's bent normal lifts the comparison over the plate and lights ground
// inside the shadow. The sun's cascades keep one plane for a whole map, while a point or spot
// light keeps one for each face of its cube or cone; both take the receiver's here. The page draws the shadow factor alone through the debug view, which reads the vertex
// normal and so shows the shadow of the ground's own plane, and the lit frame with the sun, and
// with the sun off for the floor that a fully shadowed texel keeps. No texel of the true shadow may
// leave that floor.
import { expect, type Page, test } from '@playwright/test';
import { imageRuns } from '../lib/images.ts';
import { pageResult } from '../lib/page-result.ts';

test.describe.configure({ mode: 'parallel' });

const SKETCH = 'tests/pages/sketches/normal-map-shadow-sketch.ts';
/** A channel's change, out of 255, that counts as more light than the ambient floor. */
const STEP = 6;
/**
 * How far inside the true shadow the check reads. It keeps out the shadow's own edge, where a
 * partial shadow blends, and the edge of the box that the debug view and the lit frame outline a
 * little differently.
 */
const MARGIN = 3;
/** The fewest pixels of the true shadow that the check must find, so the check is not empty. */
const SHADOW_PIXELS = 2000;
/**
 * The most texels of the true shadow that the frame may light. The fault lights tens of them, and
 * a software GPU may round a comparison at the mask's edge the other way on a few.
 */
const LEAK_LIMIT = 4;

interface Frame {
	error?: string;
	width: number;
	height: number;
	pixels: string;
}

/** The pixels of one run of the sketch, on one tier. */
async function frameOf(page: Page, path: string): Promise<{ width: number; pixels: Uint8Array }> {
	await page.goto(path);
	const frame = await pageResult<Frame>(page, 60_000);
	expect(frame.error).toBeUndefined();
	return { width: frame.width, pixels: new Uint8Array(Buffer.from(frame.pixels, 'base64')) };
}

/** The dev-server path of one run of the sketch, with `query` after the sketch's address. */
const pathOf = (query: string, tier: string) => {
	const runs = imageRuns([
		{ name: `normal-map-shadow${query}`, sketch: `${SKETCH}${query}`, hold: 0 },
	]);
	const run = runs.find((candidate) => candidate.tier === tier);
	if (!run) throw new Error(`no run of the normal-map shadow sketch on ${tier}`);
	return run.path;
};

for (const tier of ['webgpu', 'compat', 'webgl2'])
	test(`shadows follow the ground's own plane under a normal map on ${tier}`, async ({ page }) => {
		test.setTimeout(180_000);
		const shadow = await frameOf(page, pathOf('?view=shadows', tier));
		const lit = await frameOf(page, pathOf('', tier));
		const dark = await frameOf(page, pathOf('?sun=off', tier));
		expect(lit.width).toBe(shadow.width);
		expect(dark.pixels.length).toBe(lit.pixels.length);
		const { width } = lit;
		const height = lit.pixels.length / 4 / width;
		// The debug view's red channel is the shadow factor: 0 in full shadow. The threshold keeps
		// out the filter's partial shadow, whose sun still lights the ground a little.
		const shadowed = (x: number, y: number) => (shadow.pixels[4 * (y * width + x)] ?? 255) < 4;
		let pixels = 0;
		let leaked = 0;
		let worst = 0;
		for (let y = MARGIN; y < height - MARGIN; y++)
			for (let x = MARGIN; x < width - MARGIN; x++) {
				let inside = true;
				for (let dy = -MARGIN; dy <= MARGIN && inside; dy++)
					for (let dx = -MARGIN; dx <= MARGIN && inside; dx++) inside = shadowed(x + dx, y + dy);
				if (!inside) continue;
				pixels++;
				const i = 4 * (y * width + x);
				const change = Math.max(
					Math.abs((lit.pixels[i] ?? 0) - (dark.pixels[i] ?? 0)),
					Math.abs((lit.pixels[i + 1] ?? 0) - (dark.pixels[i + 1] ?? 0)),
					Math.abs((lit.pixels[i + 2] ?? 0) - (dark.pixels[i + 2] ?? 0)),
				);
				if (change > STEP) leaked++;
				worst = Math.max(worst, change);
			}
		// The box's shadow must cover enough of the frame for the check to mean something, and
		// the sun must light the frame, or the comparison would pass with no light at all.
		expect(pixels, 'pixels of the ground that its own plane leaves in full shadow').toBeGreaterThan(
			SHADOW_PIXELS,
		);
		const mean = (pixels: Uint8Array) => {
			let sum = 0;
			for (let i = 0; i < pixels.length; i += 4)
				sum += ((pixels[i] ?? 0) + (pixels[i + 1] ?? 0) + (pixels[i + 2] ?? 0)) / 3;
			return sum / (pixels.length / 4);
		};
		expect(mean(lit.pixels), 'the lit frame against the frame with no sun').toBeGreaterThan(
			mean(dark.pixels) + 20,
		);
		expect(
			leaked,
			`texels of the ground that the shadow's own plane shadows and the frame lights instead, the largest change ${worst} of 255`,
		).toBeLessThanOrEqual(LEAK_LIMIT);
	});

/**
 * A point or spot light above the box casts the same kind of comparison through the receiver's
 * plane, and its receiver takes the map's normal where the sun's does. The true shadow here is the
 * box's own footprint, which a run with the normal map left out draws from the ground's flat
 * plane; the run with the map may not light any texel inside it.
 */
for (const tier of ['webgpu', 'compat', 'webgl2'] as const)
	for (const light of ['point', 'spot'] as const)
		test(`a ${light} light's shadow follows the ground's own plane under a normal map on ${tier}`, async ({
			page,
		}) => {
			test.setTimeout(240_000);
			const tilted = await frameOf(page, pathOf(`?light=${light}&sun=off`, tier));
			const floor = await frameOf(page, pathOf(`?light=${light}&sun=off&power=off`, tier));
			const plane = await frameOf(page, pathOf(`?light=${light}&sun=off&bump=off`, tier));
			const planeFloor = await frameOf(
				page,
				pathOf(`?light=${light}&sun=off&bump=off&power=off`, tier),
			);
			const { width } = tilted;
			const height = tilted.pixels.length / 4 / width;
			/** The largest channel change, out of 255, between two frames at one texel. */
			const changeAt = (a: Uint8Array, b: Uint8Array, x: number, y: number) => {
				const i = 4 * (y * width + x);
				return Math.max(
					Math.abs((a[i] ?? 0) - (b[i] ?? 0)),
					Math.abs((a[i + 1] ?? 0) - (b[i + 1] ?? 0)),
					Math.abs((a[i + 2] ?? 0) - (b[i + 2] ?? 0)),
				);
			};
			// The flat ground's own shadow: texels that the light does not reach there at all.
			const shadowed = (x: number, y: number) =>
				changeAt(plane.pixels, planeFloor.pixels, x, y) < STEP;
			let pixels = 0;
			let leaked = 0;
			let worst = 0;
			for (let y = MARGIN; y < height - MARGIN; y++)
				for (let x = MARGIN; x < width - MARGIN; x++) {
					let inside = true;
					for (let dy = -MARGIN; dy <= MARGIN && inside; dy++)
						for (let dx = -MARGIN; dx <= MARGIN && inside; dx++) inside = shadowed(x + dx, y + dy);
					if (!inside) continue;
					pixels++;
					const change = changeAt(tilted.pixels, floor.pixels, x, y);
					if (change > STEP) leaked++;
					worst = Math.max(worst, change);
				}
			const mean = (pixels: Uint8Array) => {
				let sum = 0;
				for (let i = 0; i < pixels.length; i += 4)
					sum += ((pixels[i] ?? 0) + (pixels[i + 1] ?? 0) + (pixels[i + 2] ?? 0)) / 3;
				return sum / (pixels.length / 4);
			};
			expect(pixels, `pixels of the ${light} light's shadow`).toBeGreaterThan(SHADOW_PIXELS);
			expect(mean(tilted.pixels), 'the lit frame against the frame with no light').toBeGreaterThan(
				mean(floor.pixels) + 20,
			);
			expect(
				leaked,
				`texels that the ${light} light's shadow covers and the frame lights instead, the largest change ${worst} of 255`,
			).toBeLessThanOrEqual(LEAK_LIMIT);
		});
