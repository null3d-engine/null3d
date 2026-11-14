// The plant core's far cards must keep a crown's density as it recedes. One oak is drawn three
// times from one camera, at three distances: two copies in the first band of the core's card
// levels and one in the second. The measure is the share of each crown's own box that the plant
// draws: a card level that thinned without growing its cards leaves holes, and its share falls below
// the near copy's. Every drawn pixel counts, however dark it is. A count that left the dark pixels
// out cut through the leaves' own range, so a change to the plant's light moved the measure as
// though the cards had thinned. The move sits between `6756777a6` and its parent: the probe at
// `c08ecb041` reads the earlier figures, and the two commits between it and the shade touch only
// example files. That commit changes the wood branch alone, and no cut of the wood has yet shown
// whether it reaches the counted pixels, so the mechanism inside that pair is unproven. The count's
// fix stands whatever the cause was.
//
// The tolerance is set by the gap to the sparse frame, not by the nearest honest reading. With the
// plant forced toward its sparse form, the far crown loses 33.6 per cent of the near share, while
// the honest far crown loses 6.6 to 8.8 per cent at the landed head. Fourteen per cent sits between
// them with room on both sides: the honest frame keeps 5.2 points of margin, and the sparse frame
// still fails by 19.6 points. A device that rasterises an edge differently would have failed a
// tighter bound as though the cards had holes.
//
// The relative bound alone cannot see every level's cards breaking together: if the cut-outs failed
// on all levels at once, each crown would cover more of its box and still sit close to the near one.
// An absolute ceiling on every crown catches that frame.
import { expect, type Page, test } from '@playwright/test';
import { environmentNamed, type ImageRun, runIn } from '../lib/images.ts';
import { loadResult } from '../lib/page-result.ts';
import { failureText } from '../lib/runs.ts';
import { IMAGE_RUNS } from './manifest.ts';

test.describe.configure({ mode: 'parallel' });

/** The image test that the spec reads. */
const NAME = 'plant-coverage';

/**
 * How far a crown's covered share may stray from the near crown's, as a share of that near share.
 * The honest reading reaches 8.8 per cent below the near crown at the landed head, and the sparse
 * frame 33.6 per cent, so this sits between them rather than at the honest edge.
 */
const RELATIVE = 0.14;

/** The least share of its box that any crown must cover, so an empty frame cannot pass. */
const FLOOR = 0.1;

/**
 * The most of its box that any crown may cover. The honest crowns cover 0.475 to 0.615 at the landed
 * head. Forcing the cards solid, with the coverage cutoff at 0, raises them to 0.576 to 0.663, since
 * a full card quad fills only part of the crown's three-dimensional box and not all of it. This sits
 * between the two: it leaves 2.5 points above the honest maximum and fails the solid frame's middle
 * crown by 2.3 points.
 *
 * A fault confined to the far crown alone can stay under it, since that crown's honest reading is
 * the lowest. The ceiling catches a fault that fills every crown; the reference picture covers a
 * change it cannot, so it is not proof that no crown is solid.
 */
const CEILING = 0.64;

/** The least pixels that one box may hold. */
const BOX_FLOOR = 20_000;

/** A rectangle of a picture, in pixels. */
interface Box {
	readonly left: number;
	readonly top: number;
	readonly right: number;
	readonly bottom: number;
}

/** The covered share of each crown's own box. */
function coverage(
	pixels: Uint8Array,
	width: number,
	height: number,
	boxes: readonly Box[],
): number[] {
	return boxes.map((box) => {
		let drawn = 0;
		let total = 0;
		for (let y = Math.max(0, box.top); y < Math.min(height, box.bottom); y++)
			for (let x = Math.max(0, box.left); x < Math.min(width, box.right); x++) {
				const at = (y * width + x) * 4;
				total += 1;
				const lit = (pixels[at] ?? 0) + (pixels[at + 1] ?? 0) + (pixels[at + 2] ?? 0);
				// Any drawn pixel counts: the page clears to black, so the background reads a sum
				// of zero, and the plant's darkest pixels read one in every box and on every tier.
				if (lit > 0) drawn += 1;
			}
		return total > 0 ? drawn / total : 0;
	});
}

/** The shares of a control frame. */
async function controlShares(
	page: Page,
	environment: ReturnType<typeof environmentNamed>,
	label: string,
	query: string,
) {
	const run = IMAGE_RUNS.find(
		(candidate) => candidate.test === NAME && candidate.tier === 'webgpu',
	);
	if (!run) throw new Error(`the manifest has no webgpu run of ${NAME}`);
	const result = await loadResult(
		page,
		`${runIn(run, environment).path}${query}`,
		run.timeoutSeconds * 1000,
	);
	expect(result.ok ? [] : [failureText(result)]).toEqual([]);
	const pixels = new Uint8Array(Buffer.from(result.pixels as string, 'base64'));
	const width = result.width as number;
	const height = result.height as number;
	const boxes = result.boxes as readonly Box[];
	const shares = coverage(pixels, width, height, boxes);
	console.log(`${label}: ${shares.map((share) => share.toFixed(3)).join(', ')}`);
	return shares;
}

/** Whether two boxes share a pixel. */
const overlap = (a: Box, b: Box) =>
	a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

for (const run of IMAGE_RUNS.filter((candidate) => candidate.test === NAME))
	test(`${NAME} on ${run.tier}: the far cards keep the crown's coverage`, async ({
		page,
	}, testInfo) => {
		test.setTimeout(run.timeoutSeconds * 1000);
		const placed: ImageRun = runIn(run, environmentNamed(testInfo.project.name));
		const result = await loadResult(page, placed.path, run.timeoutSeconds * 1000);
		expect(result.ok ? [] : [failureText(result)]).toEqual([]);
		const pixels = new Uint8Array(Buffer.from(result.pixels as string, 'base64'));
		const width = result.width as number;
		const height = result.height as number;
		expect(pixels.length).toBe(width * height * 4);
		const boxes = result.boxes as readonly Box[];
		const distances = result.distances as readonly number[];
		expect(boxes).toHaveLength(3);
		expect(distances).toHaveLength(3);
		for (const box of boxes) {
			expect(box.left).toBeGreaterThanOrEqual(0);
			expect(box.top).toBeGreaterThanOrEqual(0);
			expect(box.right).toBeLessThanOrEqual(width);
			expect(box.bottom).toBeLessThanOrEqual(height);
			expect((box.right - box.left) * (box.bottom - box.top)).toBeGreaterThan(BOX_FLOOR);
		}
		expect(overlap(boxes[0] as Box, boxes[1] as Box)).toBe(false);
		expect(overlap(boxes[1] as Box, boxes[2] as Box)).toBe(false);
		expect(overlap(boxes[0] as Box, boxes[2] as Box)).toBe(false);

		const shares = coverage(pixels, width, height, boxes);
		const [near = 0, middle = 0, far = 0] = shares;
		console.log(
			`${run.id}: at ${distances.map((d) => d.toFixed(1)).join(', ')} m the crowns cover ${near.toFixed(3)}, ${middle.toFixed(3)} and ${far.toFixed(3)} of their boxes`,
		);
		expect(near).toBeGreaterThan(FLOOR);
		// A solid box is no crown. Every level's cards breaking solid together would pass the
		// relative bounds, since all three shares would sit close to the near one.
		for (const [index, share] of shares.entries())
			expect(share, `${run.id}: crown ${index + 1} is not a solid box`).toBeLessThan(CEILING);
		// A level whose cards thinned without growing leaves holes, so the farther crowns cover
		// less of their boxes than the nearer one.
		expect(middle, `${run.id}: the middle crown keeps the near crown's coverage`).toBeGreaterThan(
			near * (1 - RELATIVE),
		);
		expect(far, `${run.id}: the far crown keeps the near crown's coverage`).toBeGreaterThan(
			near * (1 - RELATIVE),
		);
		// A level that filled its whole box would draw solid cards, which is no crown.
		expect(middle, `${run.id}: the middle crown keeps its leaves' cut-outs`).toBeLessThan(
			near * (1 + RELATIVE),
		);
		expect(far, `${run.id}: the far crown keeps its leaves' cut-outs`).toBeLessThan(
			near * (1 + RELATIVE),
		);
	});

test(`${NAME} on webgpu: the sparse frame fails the far bound`, async ({ page }, testInfo) => {
	const [near = 0, , far = 0] = await controlShares(
		page,
		environmentNamed(testInfo.project.name),
		'sparse',
		'&sparse=1',
	);
	expect(far).toBeLessThan(near * (1 - RELATIVE));
});

test(`${NAME} on webgpu: the solid frame exceeds the ceiling`, async ({ page }, testInfo) => {
	const shares = await controlShares(
		page,
		environmentNamed(testInfo.project.name),
		'solid',
		'&cardCutoff=0',
	);
	expect(Math.max(...shares)).toBeGreaterThan(CEILING);
});
