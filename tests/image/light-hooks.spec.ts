// The surface's two light hooks on every tier, drawn by `light-hooks-sketch.ts`: a normal for the
// sky's light alone (`s.ambientNormal`), and the switch that joins the surface's occlusion with
// screen-space ambient occlusion by the smaller of the two (`s.occlusionByMinimum`).
//
// Each test draws the cases it needs and compares them pixel by pixel. A material that names a
// hook and leaves it at its default draws the picture of a material that names none, down to the
// pixel. A hook that acts changes the picture only where its light reaches: the sky's normal moves
// no pixel under the sun alone, and the join moves no pixel without ambient occlusion.
import { expect, type Page, test } from '@playwright/test';
import { imageRuns, TIERS, type Tier } from '../lib/images.ts';
import { loadResult } from '../lib/page-result.ts';
import { failureText } from '../lib/runs.ts';

test.describe.configure({ mode: 'parallel' });

const SKETCH = 'tests/pages/sketches/light-hooks-sketch.ts';

/** A picture's pixels, four bytes each. */
type Pixels = Uint8Array;

/** The fewest pixels that a hook that acts must move: far more than an edge's rounding. */
const ACTS = 500;

/** Draws one picture of the sketch with `query`, as its pixels in order. */
async function draw(page: Page, tier: Tier, query: string): Promise<Pixels> {
	const [run] = imageRuns([
		{
			name: `light-hooks-${query.replaceAll(/[=&]/g, '-')}`,
			sketch: `${SKETCH}?${query}`,
			hold: 0,
			tiers: [tier],
		},
	]);
	if (!run) throw new Error('a sketch test has a run on its tier');
	const result = await loadResult(page, run.path, run.timeoutSeconds * 1000);
	expect(result.ok ? [] : [failureText(result)]).toEqual([]);
	return new Uint8Array(Buffer.from(String(result.pixels), 'base64'));
}

/** How many pixels of two pictures of one size differ in color. */
function differing(before: Pixels, after: Pixels): number {
	let count = 0;
	for (let at = 0; at < before.length; at += 4)
		if (
			before[at] !== after[at] ||
			before[at + 1] !== after[at + 1] ||
			before[at + 2] !== after[at + 2]
		)
			count++;
	return count;
}

/** A pixel's brightness, with the Rec. 709 weights, in steps of 255. */
const luma = (pixels: Pixels, at: number) =>
	0.2126 * (pixels[at] ?? 0) + 0.7152 * (pixels[at + 1] ?? 0) + 0.0722 * (pixels[at + 2] ?? 0);

/** The pixels that `after` draws brighter and darker than `before`, past `steps` of 255. */
function brightening(before: Pixels, after: Pixels, steps = 1.5) {
	let brighter = 0;
	let darker = 0;
	let blue = 0;
	for (let at = 0; at < before.length; at += 4) {
		const change = luma(after, at) - luma(before, at);
		if (change > steps) brighter++;
		if (change < -steps) darker++;
		blue += (after[at + 2] ?? 0) - (before[at + 2] ?? 0);
	}
	return { brighter, darker, blue: blue / (before.length / 4) };
}

for (const tier of TIERS) {
	test(`a surface's sky normal lights the sky's light alone on ${tier}`, async ({ page }) => {
		test.setTimeout(300_000);
		const sky = (normal: string, light: string) =>
			draw(page, tier, `normal=${normal}&sky=${light}`);
		const plain = await sky('plain', 'hemisphere');
		// Named and left at the mesh's normal, the sky's normal draws the plain picture.
		const same = differing(plain, await sky('same', 'hemisphere'));
		expect(same, `${same} pixels differ with the sky's normal at its default`).toBe(0);
		// Turned up, it lights the sphere's lower half by the blue sky instead of the brown ground.
		const up = await sky('up', 'hemisphere');
		const lifted = brightening(plain, up);
		expect(lifted.brighter, `${lifted.brighter} pixels brighten under the sky`).toBeGreaterThan(
			ACTS,
		);
		expect(lifted.darker, `${lifted.darker} pixels darken under the sky`).toBe(0);
		expect(lifted.blue, 'the sphere turns bluer').toBeGreaterThan(1);
		// The environment's light follows it too.
		const room = await sky('plain', 'environment');
		const roomUp = differing(room, await sky('up', 'environment'));
		expect(roomUp, `${roomUp} pixels change in the room's light`).toBeGreaterThan(ACTS);
		const roomSame = differing(room, await sky('same', 'environment'));
		expect(roomSame, `${roomSame} pixels differ in the room at the default`).toBe(0);
		// The sun alone keeps its own normal: turning the sky's normal moves no pixel, where turning
		// the diffuse normal moves many.
		const sun = await sky('plain', 'sun');
		const sunUp = differing(sun, await sky('up', 'sun'));
		expect(sunUp, `${sunUp} pixels differ under the sun alone`).toBe(0);
		const sunBent = differing(sun, await sky('diffuse-up', 'sun'));
		expect(sunBent, `${sunBent} pixels change with the diffuse normal`).toBeGreaterThan(ACTS);
	});

	test(`a surface's occlusion joins ambient occlusion by the smaller on ${tier}`, async ({
		page,
	}) => {
		test.setTimeout(300_000);
		const room = (occlusion: string, ao = 'on') =>
			draw(page, tier, `hook=occlusion&occlusion=${occlusion}&ao=${ao}`);
		const plain = await room('plain');
		// Ambient occlusion draws: without it, many pixels change.
		const unshaded = await room('plain', 'off');
		const drawn = differing(plain, unshaded);
		expect(drawn, `${drawn} pixels change when ambient occlusion is off`).toBeGreaterThan(ACTS);
		// Named and left false, the switch draws the plain picture, the product.
		const product = differing(plain, await room('product'));
		expect(product, `${product} pixels differ with the switch left false`).toBe(0);
		// Set, it takes the smaller of the two: never darker than the product, and lighter wherever
		// ambient occlusion shades more than the surface's own occlusion lets through.
		const minimum = brightening(plain, await room('minimum'));
		expect(minimum.brighter, `${minimum.brighter} pixels lighten`).toBeGreaterThan(ACTS);
		expect(minimum.darker, `${minimum.darker} pixels darken`).toBe(0);
		// Without ambient occlusion, both joins give the surface's own occlusion.
		const alone = differing(unshaded, await room('minimum', 'off'));
		expect(alone, `${alone} pixels differ without ambient occlusion`).toBe(0);
	});
}
