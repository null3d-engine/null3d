import { describe, expect, test } from 'bun:test';
import { blank, labImage, labOf, type Rgba } from './image.ts';
import {
	boxOf,
	classifySlot,
	classifyTurn,
	crownStartRow,
	findHorizon,
	measurePlant,
	plantMask,
	readIndex,
	rowSpans,
	shadowLike,
	widthProfile,
} from './references.ts';

/** Paints a pixel of an image. */
function put(image: Rgba, x: number, y: number, colour: readonly number[]): void {
	const at = (y * image.width + x) * 4;
	image.data[at] = colour[0] as number;
	image.data[at + 1] = colour[1] as number;
	image.data[at + 2] = colour[2] as number;
}

/** The test scene's sizes: the frame, the horizon, the trunk and the crown. */
const W = 200;
const H = 150;
const HORIZON = 100;
const TRUNK = { left: 96, right: 104, top: 70, bottom: 104 };
const CROWN = { cx: 100, cy: 50, rx: 50, ry: 30 };

/** Whether a pixel belongs to the test plant: an elliptic crown on a straight trunk. */
function inPlant(x: number, y: number): boolean {
	const crown = ((x - CROWN.cx) / CROWN.rx) ** 2 + ((y - CROWN.cy) / CROWN.ry) ** 2 <= 1;
	const trunk = x >= TRUNK.left && x <= TRUNK.right && y >= TRUNK.top && y <= TRUNK.bottom;
	return crown || trunk;
}

/**
 * A plant on a plain background: a sky that pales toward the horizon, a meadow below it, a dark
 * green crown on a brown trunk, and the crown's shadow on the meadow beside the trunk's foot.
 */
function scene(): Rgba {
	const image = blank(W, H, [0, 0, 0]);
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			if (y < HORIZON) put(image, x, y, [170 + Math.round((y / HORIZON) * 30), 205, 235]);
			else put(image, x, y, [150, 160, 95]);
			// The shadow: the meadow darkened, a flat ellipse round the trunk's foot.
			if (y >= HORIZON && ((x - 100) / 60) ** 2 + ((y - 106) / 5) ** 2 <= 1)
				put(image, x, y, [80, 88, 48]);
			if (inPlant(x, y))
				put(
					image,
					x,
					y,
					x >= TRUNK.left && x <= TRUNK.right && y > 78 ? [70, 52, 40] : [35, 62, 30],
				);
		}
	// Holes in the crown, where the sky shows through.
	for (let y = 40; y < 46; y++) for (let x = 80; x < 88; x++) put(image, x, y, [178, 205, 235]);
	return image;
}

describe('the horizon', () => {
	test('is the colour step down both edges of the frame', () => {
		const image = scene();
		const horizon = findHorizon(labImage(image), image.width, image.height);
		expect(horizon).not.toBeNull();
		expect(Math.abs((horizon as number) - HORIZON)).toBeLessThanOrEqual(1);
	});

	test('is absent from a plain studio backdrop', () => {
		const image = blank(120, 80, [204, 205, 209]);
		for (let y = 20; y < 60; y++) for (let x = 50; x < 70; x++) put(image, x, y, [40, 70, 30]);
		expect(findHorizon(labImage(image), image.width, image.height)).toBeNull();
	});
});

describe('the plant mask', () => {
	const image = scene();
	const plant = plantMask(image);

	test('finds a plain background', () => {
		expect(plant.background.plain).toBe(true);
	});

	test('matches the drawn plant above the horizon, with the crown holes left open', () => {
		let wrong = 0;
		let total = 0;
		for (let y = 0; y < HORIZON - 2; y++)
			for (let x = 0; x < W; x++) {
				const hole = y >= 40 && y < 46 && x >= 80 && x < 88;
				const truth = inPlant(x, y) && !hole;
				total += truth ? 1 : 0;
				if ((plant.mask[y * W + x] === 1) !== truth) wrong++;
			}
		expect(wrong / total).toBeLessThan(0.02);
		expect(plant.mask[42 * W + 84]).toBe(0);
	});

	test("keeps the trunk's foot below the horizon and drops the ground shadow", () => {
		expect(plant.mask[103 * W + 100]).toBe(1);
		// The shadow beside the trunk, below the horizon and not under the plant.
		expect(plant.mask[106 * W + 60]).toBe(0);
		expect(plant.mask[106 * W + 140]).toBe(0);
	});

	test('drops a sliver of ground along the foot of a frame that shows no horizon', () => {
		// A cone that runs off the frame's foot against a plain sky, and a strip of darker ground two
		// rows deep along the foot of the frame's right half.
		const frame = blank(160, 100, [200, 210, 212]);
		for (let y = 10; y < 100; y++)
			for (let x = 80 - Math.floor((y - 10) / 3); x <= 80 + Math.floor((y - 10) / 3); x++)
				put(frame, x, y, [40, 66, 36]);
		for (let y = 98; y < 100; y++)
			for (let x = 110; x < 160; x++) put(frame, x, y, [150, 160, 140]);
		const cone = plantMask(frame);
		expect(cone.background.horizon).toBeNull();
		expect(cone.mask[99 * 160 + 140]).toBe(0);
		expect(cone.mask[99 * 160 + 80]).toBe(1);
		expect(boxOf(cone.mask, 160, 100)?.right).toBeLessThan(115);
	});

	test('reads the meadow in shade as shadow and the trunk as plant', () => {
		const meadow = labOf(150, 160, 95);
		expect(shadowLike(labOf(80, 88, 48), meadow)).toBe(true);
		expect(shadowLike(labOf(70, 52, 40), meadow)).toBe(false);
	});

	test('measures the box, the gap fraction and the crown start', () => {
		const m = measurePlant(image, plant);
		expect(m.box).not.toBeNull();
		const box = m.box as { left: number; top: number; right: number; bottom: number };
		expect(Math.abs(box.left - 50)).toBeLessThanOrEqual(1);
		expect(Math.abs(box.right - 150)).toBeLessThanOrEqual(1);
		expect(Math.abs(box.top - 20)).toBeLessThanOrEqual(1);
		expect(Math.abs(box.bottom - TRUNK.bottom)).toBeLessThanOrEqual(1);
		// The crown's outline holds the one hole of 48 pixels.
		expect(m.gapFraction).toBeGreaterThan(0.005);
		expect(m.gapFraction).toBeLessThan(0.03);
		// The crown starts where the ellipse ends, 80 rows down: 24 of the plant's 85 rows up.
		expect(Math.abs(m.crownStart - 24 / 85)).toBeLessThan(0.04);
		expect(m.horizon).toBeCloseTo(HORIZON / H, 1);
	});
});

describe('the width profile', () => {
	test('gives each height band its widest run over the plant height', () => {
		// A triangle 40 rows tall that widens by two pixels a row: a cone.
		const width = 100;
		const height = 50;
		const mask = new Uint8Array(width * height);
		for (let y = 5; y < 45; y++)
			for (let x = 50 - (y - 5); x <= 50 + (y - 5); x++) mask[y * width + x] = 1;
		const box = boxOf(mask, width, height);
		expect(box).toEqual({ left: 11, top: 5, right: 89, bottom: 44 });
		const profile = widthProfile(rowSpans(mask, width, height), box as NonNullable<typeof box>, 4);
		// Band k holds rows 10k to 10k + 9; its widest row is 2(10k + 9) + 1 pixels wide.
		expect(profile).toEqual([19 / 40, 39 / 40, 59 / 40, 79 / 40]);
	});

	test('finds where a crown starts over a narrow trunk', () => {
		const width = 60;
		const height = 60;
		const mask = new Uint8Array(width * height);
		for (let y = 0; y < 30; y++) for (let x = 10; x < 50; x++) mask[y * width + x] = 1;
		for (let y = 30; y < 60; y++) for (let x = 28; x < 32; x++) mask[y * width + x] = 1;
		const box = boxOf(mask, width, height) as NonNullable<ReturnType<typeof boxOf>>;
		expect(crownStartRow(rowSpans(mask, width, height), box)).toBe(29);
	});
});

describe('the slots', () => {
	test('sort stills by the words in their names before their numbers', () => {
		expect(classifySlot('13-single-needle-underside.png')?.view).toBe('leaf-under');
		expect(classifySlot('05-crown-underneath.png')?.view).toBe('below');
		expect(classifySlot('02-whole-profile-b.png')).toMatchObject({
			view: 'whole',
			turn: 90,
			framed: true,
		});
		expect(classifySlot('07-limb-leaving-trunk.png')?.view).toBe('junction');
		expect(classifySlot('08-limb-fork.png')?.view).toBe('fork');
		expect(classifySlot('10-fine-twigs-b.png')?.view).toBe('twigs');
		expect(classifySlot('20-winter-branch-architecture.png')).toMatchObject({
			view: 'skeleton',
			query: { season: 'winter' },
		});
		expect(classifySlot('21-branch-studio.png')?.view).toBe('branch');
		expect(classifySlot('22-subbranch-studio.png')?.view).toBe('subbranch');
		expect(classifySlot('23-leaf-cluster-studio.png')?.background).toBe('studio-grey');
		expect(classifySlot('22-forest-bole-dead-stubs.png')?.view).toBe('trunk');
		expect(classifySlot('19-acorns-on-stalk.png')?.note).toContain('fruit');
		expect(classifySlot('32-young-oak-whole.png')).toMatchObject({
			view: 'whole',
			note: expect.stringContaining('young'),
		});
		expect(classifySlot('30-sucker-clump.png')?.view).toBe('whole');
	});

	test('lay each texture source beside the surface it paints', () => {
		expect(classifySlot('24-leaf-texture-upper-c.png')).toMatchObject({
			kind: 'texture',
			view: 'leaf-upper',
		});
		expect(classifySlot('25-leaf-texture-underside.png')?.view).toBe('leaf-under');
		expect(classifySlot('26-bark-texture.png')).toMatchObject({
			kind: 'texture',
			view: 'bark-mid',
		});
		expect(classifySlot('28-young-bark.png')).toMatchObject({
			kind: 'texture',
			view: 'bark-limb',
			query: { along: 0.85 },
		});
	});

	test('leave out files that are not numbered pictures', () => {
		expect(classifySlot('INDEX.md')).toBeUndefined();
		expect(classifySlot('branch-turntable-sheet.png')).toBeUndefined();
	});
});

describe('the videos', () => {
	test('name the piece a turning video turns round and the arc it covers', () => {
		expect(classifyTurn('oak-turntable.mp4')).toMatchObject({ piece: 'whole', arc: 360 });
		expect(classifyTurn('hedge-turntable-halfturn.mp4')).toMatchObject({
			piece: 'whole',
			arc: 180,
		});
		expect(classifyTurn('branch-turntable-halfturn-b-b.mp4')).toMatchObject({
			piece: 'branch',
			arc: 180,
		});
		expect(classifyTurn('subbranch-turntable-c.mp4')?.piece).toBe('subbranch');
		expect(classifyTurn('leaf-cluster-turntable-b.mp4')?.piece).toBe('cluster');
		expect(classifyTurn('oak-wind-motion-b.mp4')).toBeUndefined();
	});
});

describe('the index', () => {
	test('marks a superseded file out of use, with the file that supersedes it', () => {
		const rows = readIndex(
			[
				'| file | what it shows | why |',
				'| --- | --- | --- |',
				'| `02-whole-profile.png` | Side-on. Superseded by `02-whole-profile-b.png` | Rows 1 and 9 |',
				'| `02-whole-profile-b.png` | Side-on, on meadow | Rows 1 and 9 |',
				'| `common-ash-turntable.mp4` | First try at the whole-tree turn, superseded | The trunk |',
				'| `22-subbranch-studio.png` | A frond | First frame (and of the superseded `x.mp4`) |',
			].join('\n'),
		);
		expect(rows.map((row) => row.file)).toEqual([
			'02-whole-profile.png',
			'02-whole-profile-b.png',
			'common-ash-turntable.mp4',
			'22-subbranch-studio.png',
		]);
		expect(rows[0]?.supersededBy).toBe('02-whole-profile-b.png');
		expect(rows[1]?.supersededBy).toBeUndefined();
		expect(rows[2]?.supersededBy).toBe('a later file');
		expect(rows[3]?.supersededBy).toBeUndefined();
	});
});
