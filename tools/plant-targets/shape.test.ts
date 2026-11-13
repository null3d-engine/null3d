import { describe, expect, test } from 'bun:test';
import type { Box } from '../lib/plant-review/references.ts';
import { endsAtHorizon, followStem } from './foot.ts';
import {
	ENVELOPE_BANDS,
	envelopeOf,
	limbsOf,
	lobesOf,
	risingRuns,
	skyOf,
	stemOf,
} from './shape.ts';
import { boxOf, disc, empty, fill, HEIGHT, line, lollipop, WIDTH } from './shapes.fixture.ts';
import { figuresOf } from './whole.ts';

describe('the outline of a disc', () => {
	const mask = empty();
	disc(mask, 200, 200, 100);
	const box = boxOf(mask);

	test('is one lump with no notch', () => {
		const lobes = lobesOf(mask, WIDTH, box, 200, box.bottom);
		expect(lobes.count).toBe(1);
		expect(lobes.byDepth.map((entry) => entry.count)).toEqual([1, 1, 1]);
		expect(lobes.notchDepths).toEqual([]);
		expect(lobes.areaShares).toEqual([1]);
	});

	test('has no hole and no gap in any cell', () => {
		const sky = skyOf(mask, WIDTH, box, box.bottom);
		expect(sky.holes.count).toBe(0);
		expect(sky.holes.share).toBe(0);
		for (const row of sky.grid.enclosed) for (const cell of row) expect(cell ?? 0).toBe(0);
		// The corner cells of a disc's box are mostly sky; the middle cell is all plant.
		expect(sky.grid.box[1]?.[1]).toBe(0);
		expect(sky.grid.box[0]?.[0]).toBeGreaterThan(0.3);
		expect(sky.unevenness).toBeNull();
	});

	test('reaches as far as its chord in each height band', () => {
		const envelope = envelopeOf(mask, WIDTH, box, 200);
		expect(envelope.left).toHaveLength(ENVELOPE_BANDS);
		for (let band = 0; band < ENVELOPE_BANDS; band++) {
			// The widest chord of a band is at its edge nearest the disc's middle.
			const from = band / ENVELOPE_BANDS;
			const to = (band + 1) / ENVELOPE_BANDS;
			const near =
				from <= 0.5 && to >= 0.5 ? 0.5 : Math.abs(from - 0.5) < Math.abs(to - 0.5) ? from : to;
			const chord = Math.sqrt(Math.max(0, 0.25 - (near - 0.5) ** 2));
			expect(Math.abs((envelope.left[band] as number) - chord)).toBeLessThan(0.02);
			expect(Math.abs((envelope.right[band] as number) - chord)).toBeLessThan(0.02);
		}
	});

	test('is as tall as it is wide, with no stem', () => {
		const figures = figuresOf(
			mask,
			WIDTH,
			HEIGHT,
			box,
			200,
			{
				row: box.bottom,
				width: box.right - box.left + 1,
				enclosedGap: 0,
				boxGap: 0.2146,
			},
			null,
		);
		expect(figures.heightToWidth).toBe(1);
		expect(figures.crown.heightToWidth).toBe(1);
		expect(figures.crown.base).toBe(0);
		expect(figures.trunk.width).toBeNull();
		expect(figures.missing['trunk.width']).toContain('the crown starts at the foot');
		expect(figures.limbs).toBeNull();
	});
});

describe('a crown of two lobes', () => {
	const mask = empty();
	const radius = 60;
	const apart = 50;
	disc(mask, 200 - apart, 200, radius);
	disc(mask, 200 + apart, 200, radius);
	const box = boxOf(mask);

	test('is two lumps of equal size, parted by a notch of the known depth', () => {
		const lobes = lobesOf(mask, WIDTH, box, 200, box.bottom);
		expect(lobes.count).toBe(2);
		expect(lobes.areaShares).toHaveLength(2);
		expect(Math.abs((lobes.areaShares[0] as number) - 0.5)).toBeLessThan(0.03);
		// The notch's foot is where the two discs cross; the hull runs level across their tops.
		const depth = radius - Math.sqrt(radius ** 2 - apart ** 2);
		const size = Math.sqrt(2 * radius * 2 * apart + Math.PI * radius ** 2);
		expect(lobes.notchDepths).toHaveLength(1);
		// The edge takes the farthest reach of a few rays, which lifts the foot of a sharp notch.
		expect(Math.abs((lobes.notchDepths[0] as number) - depth / size)).toBeLessThan(0.03);
	});

	test('three lobes in a row are three lumps', () => {
		const three = empty();
		for (const centre of [100, 200, 300]) disc(three, centre, 200, 60);
		expect(lobesOf(three, WIDTH, boxOf(three), 200, boxOf(three).bottom).count).toBe(3);
	});

	test('a tall column and a wide dome are one lump each', () => {
		const column = empty();
		for (let y = 20; y <= 380; y++) {
			const half = 25 * Math.sqrt(Math.max(0, 1 - ((y - 200) / 180) ** 2));
			fill(column, Math.round(200 - half), y, Math.round(200 + half), y);
		}
		expect(lobesOf(column, WIDTH, boxOf(column), 200, 380).count).toBe(1);
		const dome = empty();
		for (let y = 150; y <= 250; y++) {
			const half = 180 * Math.sqrt(Math.max(0, 1 - ((y - 200) / 50) ** 2));
			fill(dome, Math.round(200 - half), y, Math.round(200 + half), y);
		}
		expect(lobesOf(dome, WIDTH, boxOf(dome), 200, 250).count).toBe(1);
	});
});

describe('a crown with a hole', () => {
	const mask = empty();
	disc(mask, 200, 200, 100);
	fill(mask, 180, 180, 219, 219, 0);
	const box = boxOf(mask);
	const sky = skyOf(mask, WIDTH, box, box.bottom);

	test('counts the hole and its share of the crown box', () => {
		expect(sky.holes.count).toBe(1);
		expect(sky.holes.share).toBeCloseTo(1600 / 201 ** 2, 4);
		expect(sky.holes.largest).toBe(sky.holes.share);
		// A hole 40 across in a crown 201 wide is in the largest class.
		expect(sky.holes.bySize).toEqual([0, 0, 0, 1]);
		expect(sky.holes.medianDiameter).toBeCloseTo(Math.sqrt((4 * 1600) / Math.PI) / 201, 3);
	});

	test('puts the gap in the middle cell alone', () => {
		expect(sky.grid.enclosed[1]?.[1]).toBeCloseTo(1600 / 67 ** 2, 2);
		expect(sky.grid.enclosed[0]?.[1]).toBe(0);
		expect(sky.grid.enclosed[2]?.[1]).toBe(0);
		expect(sky.unevenness).toBeGreaterThan(1);
	});

	test('a bay open to the sky is no hole', () => {
		const bay = empty();
		disc(bay, 200, 200, 100);
		fill(bay, 190, 90, 210, 200, 0);
		expect(skyOf(bay, WIDTH, boxOf(bay), boxOf(bay).bottom).holes.count).toBe(0);
	});
});

describe('the stem below a crown', () => {
	test('stands upright with its own width, bare to the crown', () => {
		const { mask, crownRow } = lollipop(0);
		const box = boxOf(mask);
		const tall = box.bottom - box.top + 1;
		const stem = stemOf(mask, WIDTH, box, 200, crownRow, 0.1);
		expect(stem.width).toBeCloseTo(10 / tall, 3);
		expect(stem.breastHeightWidth).toBeCloseTo(10 / tall, 3);
		expect(stem.flare).toBe(1);
		expect(stem.stems).toBe(1);
		expect(Math.abs(stem.lean as number)).toBeLessThan(0.5);
		expect(Math.abs((stem.bareShare as number) - (380 - 209) / tall)).toBeLessThan(0.03);
	});

	test('leans by the angle it is drawn at, to either side', () => {
		for (const lean of [12, -7]) {
			const { mask, crownRow } = lollipop(lean);
			const stem = stemOf(mask, WIDTH, boxOf(mask), 200, crownRow, null);
			expect(Math.abs((stem.lean as number) - lean)).toBeLessThan(1);
			expect(stem.missing.breastHeightWidth).toContain('breast height is not placed');
		}
	});

	test('reads a flare at the foot', () => {
		const { mask, crownRow } = lollipop(0);
		fill(mask, 185, 372, 214, 380);
		const stem = stemOf(mask, WIDTH, boxOf(mask), 200, crownRow, null);
		expect(stem.flare).toBe(3);
		expect(stem.width).toBeCloseTo(10 / (380 - 30 + 1), 3);
	});

	test('counts two stems that rise apart, and no foliage that hangs beside one', () => {
		const two = empty();
		fill(two, 150, 200, 159, 380);
		fill(two, 240, 200, 249, 380);
		disc(two, 200, 120, 90);
		expect(stemOf(two, WIDTH, boxOf(two), 155, 209, null).stems).toBe(2);
		const hung = lollipop(0).mask;
		fill(hung, 140, 150, 149, 360);
		const stem = stemOf(hung, WIDTH, boxOf(hung), 200, 209, null);
		expect(stem.stems).toBeNull();
		expect(stem.missing.stems).toContain('hangs beside the stem');
	});

	test('reads no flare where the horizon hides the foot', () => {
		const { mask, crownRow } = lollipop(0);
		const stem = stemOf(mask, WIDTH, boxOf(mask), 200, crownRow, null, 340);
		expect(stem.flare).toBeNull();
		expect(stem.missing.flare).toContain('below the horizon');
		expect(stem.width).toBeCloseTo(10 / 351, 3);
	});

	test('reads the stem behind foliage that hangs beside it to near the ground', () => {
		const { mask } = lollipop(0);
		fill(mask, 120, 150, 139, 360);
		fill(mask, 260, 150, 279, 360);
		// The crown's start is at the hanging foliage's foot, and the stem stands clear above it.
		const stem = stemOf(mask, WIDTH, boxOf(mask), 200, 360, null);
		expect(stem.width).toBeCloseTo(10 / 351, 3);
		expect(stem.column).toBe(false);
		// With the rows below the crown under the horizon, the stem is read where sky parts it
		// from the foliage beside it.
		const hidden = stemOf(mask, WIDTH, boxOf(mask), 200, 360, null, 355);
		expect(hidden.width).toBeCloseTo(10 / 351, 3);
		// A mound has no such run, so it has no stem.
		const mound = empty();
		disc(mound, 200, 380, 150);
		const none = stemOf(mound, WIDTH, boxOf(mound), 200, 380, null, 370);
		expect(none.width).toBeNull();
	});

	test('names a plant that never forks a column, and a wide foot no stem', () => {
		// A spindle whose foot is under half its middle's width, and that never widens to a fork.
		const column = empty();
		for (let y = 20; y <= 380; y++) {
			const half = 12 + 18 * Math.sin((Math.PI * (380 - y)) / 360);
			fill(column, Math.round(200 - half), y, Math.round(200 + half) - 1, y);
		}
		const stem = stemOf(column, WIDTH, boxOf(column), 200, 370, null);
		expect(stem.column).toBe(true);
		expect(stem.bareShare).toBeGreaterThan(0.99);
		const mass = empty();
		fill(mass, 100, 330, 299, 380);
		fill(mass, 20, 250, 379, 329);
		const none = stemOf(mass, WIDTH, boxOf(mass), 200, 329, null);
		expect(none.width).toBeNull();
		expect(none.missing.width).toContain('wider than a stem');
	});

	test('rising runs leave out what hangs from above', () => {
		const mask = lollipop(0).mask;
		fill(mask, 140, 150, 149, 360);
		const box = boxOf(mask);
		const rows = risingRuns(mask, WIDTH, box);
		expect(rows[300 - box.top]).toEqual([{ left: 195, right: 204 }]);
		expect(rows[380 - box.top]).toEqual([{ left: 195, right: 204 }]);
	});
});

describe('a stem cut at the horizon', () => {
	/** A picture's colours: pale sky above the horizon, mottled ground below, and a dark stem. */
	function scene(stemBottom: number): { lab: Float32Array; mask: Uint8Array } {
		const lab = new Float32Array(WIDTH * HEIGHT * 3);
		const mask = empty();
		for (let y = 0; y < HEIGHT; y++)
			for (let x = 0; x < WIDTH; x++) {
				const at = (y * WIDTH + x) * 3;
				const stem = x >= 195 && x <= 204 && y >= 100 && y <= stemBottom;
				// The ground's lightness steps from pixel to pixel, as a meadow's does.
				lab[at] = stem ? 35 : y < 300 ? 80 : 55 + (((x * 7 + y * 13) % 5) - 2);
				lab[at + 1] = stem ? 6 : y < 300 ? -2 : -8;
				lab[at + 2] = stem ? 14 : y < 300 ? -12 : 24;
				// The outline holds the stem above the horizon only, and a crown on top of it.
				if (stem && y < 300) mask[y * WIDTH + x] = 1;
			}
		disc(mask, 200, 90, 60);
		return { lab, mask };
	}

	test('follows the stem down to the row where it ends', () => {
		const { lab, mask } = scene(340);
		const box = boxOf(mask);
		expect(box.bottom).toBe(299);
		expect(endsAtHorizon(box, 300, HEIGHT)).toBe(true);
		expect(followStem(lab, WIDTH, HEIGHT, mask, box, 200)).toEqual({
			kind: 'stem',
			foot: 340,
			left: 195,
			right: 204,
		});
	});

	test('finds no stem where the plant stands on the horizon', () => {
		const { lab, mask } = scene(299);
		expect(followStem(lab, WIDTH, HEIGHT, mask, boxOf(mask), 200)).toEqual({ kind: 'none' });
	});

	test('calls a wide last row a mass', () => {
		const { lab } = scene(299);
		const mask = empty();
		fill(mask, 100, 200, 299, 299);
		expect(followStem(lab, WIDTH, HEIGHT, mask, boxOf(mask), 200)).toEqual({ kind: 'mass' });
		expect(endsAtHorizon({ left: 0, top: 0, right: 10, bottom: 340 }, 300, HEIGHT)).toBe(false);
	});
});

describe('the limbs at a fork', () => {
	/** A stem that divides into limbs at set angles from upright. */
	function forked(angles: readonly number[]): { mask: Uint8Array; box: Box } {
		const mask = empty();
		fill(mask, 194, 250, 205, 380);
		for (const angle of angles)
			line(
				mask,
				200,
				250,
				200 + 200 * Math.sin((angle * Math.PI) / 180),
				250 - 200 * Math.cos((angle * Math.PI) / 180),
				7,
			);
		return { mask, box: boxOf(mask) };
	}

	test('counts three limbs and gives their angles', () => {
		const { mask, box } = forked([-45, 0, 45]);
		const stem = stemOf(mask, WIDTH, box, 200, 250, null);
		const limbs = limbsOf(mask, WIDTH, HEIGHT, box, 200, stem);
		if ('reason' in limbs) throw new Error(limbs.reason);
		expect(limbs.count).toBe(3);
		expect(limbs.angles).toHaveLength(3);
		for (const [k, angle] of [-45, 0, 45].entries())
			expect(Math.abs((limbs.angles[k] as number) - angle)).toBeLessThan(6);
	});

	test('ends the bare stem where a limb rises beside it', () => {
		const { mask, box } = forked([-45, 0]);
		const stem = stemOf(mask, WIDTH, box, 200, 250, null);
		const tall = box.bottom - box.top + 1;
		expect(Math.abs((stem.bareShare as number) - (380 - 250) / tall)).toBeLessThan(0.06);
	});

	test('gives a reason where foliage covers the fork', () => {
		const { mask, crownRow } = lollipop(0);
		const box = boxOf(mask);
		const limbs = limbsOf(
			mask,
			WIDTH,
			HEIGHT,
			box,
			200,
			stemOf(mask, WIDTH, box, 200, crownRow, null),
		);
		expect('reason' in limbs && limbs.reason).toContain('foliage covers the fork');
	});
});
