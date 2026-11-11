import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	plantReviewQuery,
	readPlantReviewQuery,
} from '../../../tests/pages/lib/plant-review/query.ts';
import { type PlantView, VIEW_SPECS } from '../../../tests/pages/lib/plant-review/views.ts';
import { blank, labImage, labOf, type Rgba } from './image.ts';
import {
	anyPlantMask,
	boxOf,
	classifySlot,
	classifyTurn,
	crownStartRow,
	findHorizon,
	greenLeaves,
	matteMask,
	measurePlant,
	type PlantMask,
	pieceCount,
	plantMask,
	readIndex,
	rowSpans,
	seasonFromPicture,
	shadowLike,
	widthProfile,
	withSlot,
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

	test('clears a river along the horizon that runs behind the plant from side to side', () => {
		const frame = scene();
		for (let y = 88; y < 94; y++)
			for (let x = 0; x < W; x++) if (!inPlant(x, y)) put(frame, x, y, [70, 140, 220]);
		const river = plantMask(frame);
		expect(river.mask[90 * W + 5]).toBe(0);
		expect(river.mask[90 * W + W - 5]).toBe(0);
		expect(river.mask[90 * W + 100]).toBe(1);
		const box = boxOf(river.mask, W, H);
		expect(box?.left).toBeGreaterThanOrEqual(48);
		expect(box?.right).toBeLessThanOrEqual(152);
	});

	test('clears a thin strip that reaches one side, and keeps a plant that runs off the frame', () => {
		const frame = scene();
		for (let y = 96; y < 99; y++) for (let x = 150; x < W; x++) put(frame, x, y, [120, 170, 90]);
		const strip = plantMask(frame);
		expect(boxOf(strip.mask, W, H)?.right).toBeLessThanOrEqual(152);
		const wide = blank(W, H, [0, 0, 0]);
		for (let y = 0; y < H; y++)
			for (let x = 0; x < W; x++) put(wide, x, y, y < HORIZON ? [180, 205, 235] : [150, 160, 95]);
		for (let y = 30; y < HORIZON; y++) for (let x = 0; x < 120; x++) put(wide, x, y, [35, 62, 30]);
		expect(plantMask(wide).mask[60 * W + 2]).toBe(1);
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

	test('finds the crown above a buttressed foot', () => {
		const width = 100;
		const height = 100;
		const mask = new Uint8Array(width * height);
		// A crown of 80 px over a trunk of 20, with a foot 50 px wide across the lowest rows.
		for (let y = 0; y < 50; y++) for (let x = 10; x < 90; x++) mask[y * width + x] = 1;
		for (let y = 50; y < 92; y++) for (let x = 40; x < 60; x++) mask[y * width + x] = 1;
		for (let y = 92; y < 100; y++) for (let x = 25; x < 75; x++) mask[y * width + x] = 1;
		const box = boxOf(mask, width, height) as NonNullable<ReturnType<typeof boxOf>>;
		// The foot's own width must not set the trunk's, or the clear margin never clears the crown.
		expect(crownStartRow(rowSpans(mask, width, height), box)).toBe(49);
	});

	test('finds the crown when a ground line runs below the foot', () => {
		const width = 100;
		const height = 100;
		const mask = new Uint8Array(width * height);
		// A crown of 80 px over a trunk of 4, over a grassy ground line that spans the frame.
		// The ground is wider than the crown, so the lowest bands make the trunk estimate the
		// ground's width and the upward scan finds no wide run.
		for (let y = 0; y < 50; y++) for (let x = 10; x < 90; x++) mask[y * width + x] = 1;
		for (let y = 50; y < 80; y++) for (let x = 48; x < 52; x++) mask[y * width + x] = 1;
		for (let y = 80; y < 100; y++) for (let x = 0; x < 100; x++) mask[y * width + x] = 1;
		const box = boxOf(mask, width, height) as NonNullable<ReturnType<typeof boxOf>>;
		// The crown's lower edge, not the frame's foot and not the ground line's top.
		expect(crownStartRow(rowSpans(mask, width, height), box)).toBe(49);
	});

	test("does not take a gap inside an airy crown for the crown's foot", () => {
		const width = 100;
		const height = 100;
		const mask = new Uint8Array(width * height);
		// An airy crown of 80 px broken by an empty row every seventh row, over a trunk of 4, over
		// a ground line that spans the frame. The gaps belong to the crown, not to its foot.
		for (let y = 0; y < 50; y++) {
			if (y % 7 === 3) continue;
			const inset = y < 20 ? 20 : 10;
			for (let x = inset; x < width - inset; x++) mask[y * width + x] = 1;
		}
		for (let y = 50; y < 80; y++) for (let x = 48; x < 52; x++) mask[y * width + x] = 1;
		for (let y = 80; y < 100; y++) for (let x = 0; x < 100; x++) mask[y * width + x] = 1;
		const box = boxOf(mask, width, height) as NonNullable<ReturnType<typeof boxOf>>;
		expect(crownStartRow(rowSpans(mask, width, height), box)).toBe(49);
	});

	test('finds the crown above a bole too thick for the margin alone', () => {
		const width = 100;
		const height = 100;
		const mask = new Uint8Array(width * height);
		// A crown of 90 px over a bole of 30: the stem is a third of the plant's height across, so a
		// margin of two and a half stems would swallow the crown and the foot would land at the base.
		for (let y = 0; y < 45; y++) for (let x = 5; x < 95; x++) mask[y * width + x] = 1;
		for (let y = 45; y < 100; y++) for (let x = 35; x < 65; x++) mask[y * width + x] = 1;
		const box = boxOf(mask, width, height) as NonNullable<ReturnType<typeof boxOf>>;
		expect(crownStartRow(rowSpans(mask, width, height), box)).toBe(44);
	});

	test('finds a crown whose lowest boughs are thin above a flared foot', () => {
		const width = 220;
		const height = 180;
		const mask = new Uint8Array(width * height);
		// A crown of 100, its lowest boughs 70, over a stem of 40, over a foot that widens to 200 in the
		// plant's last rows. The foot is the plant's widest row, so a limit taken from it sits above the
		// lowest boughs, which then read as stem and the crown's base lands at the foot.
		for (let y = 2; y < 30; y++) for (let x = 60; x < 160; x++) mask[y * width + x] = 1;
		for (let y = 30; y < 60; y++) for (let x = 75; x < 145; x++) mask[y * width + x] = 1;
		for (let y = 60; y < 161; y++) for (let x = 90; x < 130; x++) mask[y * width + x] = 1;
		for (let y = 161; y < 172; y++) {
			const half = Math.round(22 + 78 * ((y - 161) / 11));
			for (let x = 110 - half; x < 110 + half; x++) mask[y * width + x] = 1;
		}
		const box = boxOf(mask, width, height) as NonNullable<ReturnType<typeof boxOf>>;
		// The boughs' own bottom row is where the crown starts.
		expect(crownStartRow(rowSpans(mask, width, height), box)).toBe(59);
	});

	test('finds a thin crown foot above a thick flared stem', () => {
		// The giant sequoia's profile photograph, its plant outline row by row. The crown widens to 210
		// pixels at its foot and the stem flares below it; before the fix its crown box held 320 of the
		// plant's 549 rows, its base at row 376, because the flare set the width limit and the thin
		// crown's lowest boughs read as stem.
		const profile = JSON.parse(
			readFileSync(join(import.meta.dirname, 'fixtures/giant-sequoia-profile.json'), 'utf8'),
		) as {
			readonly width: number;
			readonly height: number;
			readonly top: number;
			readonly spans: readonly (readonly [number, number])[];
		};
		const mask = new Uint8Array(profile.width * profile.height);
		profile.spans.forEach(([left, right], index) => {
			if (left < 0) return;
			for (let x = left; x <= right; x++) mask[(profile.top + index) * profile.width + x] = 1;
		});
		const box = boxOf(mask, profile.width, profile.height) as NonNullable<ReturnType<typeof boxOf>>;
		// The crown's own lowest boughs, where the thin crown's rows first widen past the stem.
		expect(crownStartRow(rowSpans(mask, profile.width, profile.height), box)).toBe(454);
	});

	test("moves a crown's foot smoothly as a plant's foot widens", () => {
		const width = 120;
		const height = 100;
		// A crown of 100 over a stem of 10, its lowest rows a foot of the given width. At 0.8 of the
		// crown's width a plant stood on the mark: the rule counted its whole box as crown above the
		// mark and not below it, so two plants a pixel apart in the foot could differ by half a box.
		const startAt = (footHalf: number) => {
			const mask = new Uint8Array(width * height);
			for (let y = 0; y < 40; y++) for (let x = 10; x < 110; x++) mask[y * width + x] = 1;
			for (let y = 40; y < 60; y++) for (let x = 55; x < 65; x++) mask[y * width + x] = 1;
			for (let y = 60; y < height; y++)
				for (let x = 60 - footHalf; x < 60 + footHalf; x++) mask[y * width + x] = 1;
			const box = boxOf(mask, width, height) as NonNullable<ReturnType<typeof boxOf>>;
			return crownStartRow(rowSpans(mask, width, height), box);
		};
		const atTheMark = startAt(40);
		const above = startAt(42);
		// A fifth of the box: wide enough for the blend's own slope, far short of the old step.
		expect(Math.abs(above - atTheMark)).toBeLessThan(height / 5);
	});

	test('starts a mound with no bare stem at its foot', () => {
		const width = 100;
		const height = 100;
		const mask = new Uint8Array(width * height);
		// A tuft that runs as wide at the ground as at its widest: its crown is the whole plant.
		for (let y = 0; y < 30; y++) for (let x = 20; x < 80; x++) mask[y * width + x] = 1;
		for (let y = 30; y < 100; y++) for (let x = 4; x < 96; x++) mask[y * width + x] = 1;
		const box = boxOf(mask, width, height) as NonNullable<ReturnType<typeof boxOf>>;
		expect(crownStartRow(rowSpans(mask, width, height), box)).toBe(99);
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
		expect(classifySlot('04-crown-outside.png')?.view).toBe('limb');
		// A branch and a twig on a plain ground, as their photographs show them: cut pieces.
		expect(classifySlot('09-secondary-branching.png')).toMatchObject({
			view: 'branch',
			query: { leaves: 7.4, roll: -90 },
		});
		expect(classifySlot('10-fine-twigs-b.png')).toMatchObject({
			view: 'subbranch',
			query: { leaves: 4.5 },
		});
		// One branch on its own against the sky, as the reference shows it, not a crop into the plant.
		expect(classifySlot('20-winter-branch-architecture.png')).toMatchObject({
			view: 'branch',
			query: { season: 'winter' },
		});
		expect(classifySlot('21-branch-studio.png')?.view).toBe('branch');
		expect(classifySlot('22-subbranch-studio.png')?.view).toBe('subbranch');
		expect(classifySlot('23-leaf-cluster-studio.png')?.background).toBe('studio-grey');
		expect(classifySlot('22-forest-bole-dead-stubs.png')?.view).toBe('trunk');
		// A tall clean bole in leaf, looked up from a few steps back with a wide lens.
		expect(classifySlot('31-woodland-clean-bole.png')).toMatchObject({
			view: 'below',
			query: { fov: 75, footRow: 0.96, crownRow: 0.09 },
		});
		expect(classifySlot('19-acorns-on-stalk.png')?.note).toContain('fruit');
		expect(classifySlot('22-forest-bole-dead-stubs.png')?.query?.season).toBeUndefined();
		expect(classifySlot('32-young-oak-whole.png')).toMatchObject({
			view: 'whole',
			note: expect.stringContaining('young'),
		});
		expect(classifySlot('30-sucker-clump.png')?.view).toBe('whole');
	});

	test('ask the page only for what it reads back', () => {
		for (const name of [
			'03-whole-from-below.png',
			'04-crown-outside.png',
			'05-crown-underneath.png',
			'09-secondary-branching.png',
			'10-fine-twigs.png',
			'16-bark-on-limb.png',
			'31-woodland-clean-bole.png',
		]) {
			const slot = classifySlot(name) as NonNullable<ReturnType<typeof classifySlot>>;
			const query = { species: 'pedunculate-oak', view: slot.view, ...slot.query };
			expect(readPlantReviewQuery(new URLSearchParams(plantReviewQuery(query)))).toMatchObject(
				query,
			);
		}
		// A single-leaf still's pressed choice reads back either way, and is absent when not named.
		const pressed = (value?: boolean) =>
			readPlantReviewQuery(
				new URLSearchParams(
					plantReviewQuery({
						species: 'stub',
						view: 'leaf-under',
						...(value !== undefined && { pressed: value }),
					}),
				),
			).pressed;
		expect([pressed(true), pressed(false), pressed()]).toEqual([true, false, undefined]);
		const read = (text: string) => () =>
			readPlantReviewQuery(new URLSearchParams(`species=stub&view=bark-limb&${text}`));
		// A limb that fills none of the frame gives no distance to see it from.
		expect(read('girth=0')).toThrow('above 0');
		expect(read('girth=1.2')).toThrow('up to 1');
		expect(read('forkRow=1.5')).toThrow('from 0 to 1');
		expect(read('footRow=-0.1')).toThrow('from 0 to 1');
		// The crown's base stands over the foot, so its row is the higher one in the frame.
		expect(read('crownRow=0.96&footRow=0.09')).toThrow('not well above');
		// Rows nearly level would stand the camera kilometres back to fit the bole between them.
		expect(read('crownRow=0.49&footRow=0.5')).toThrow('not well above');
		expect(() =>
			readPlantReviewQuery(new URLSearchParams('species=stub&crownRow=0.4&footRow=0.5')),
		).not.toThrow();
		expect(read('leaves=0')).toThrow('above 0');
		expect(read('stand=1')).toThrow('above 1');
		// The daylight's strength is a multiple of the soft daylight: above none, and not past eight.
		expect(read('daylight=2.5')().daylight).toBe(2.5);
		expect(read('daylight=0')).toThrow('above 0');
		expect(read('daylight=9')).toThrow('up to 8');
		const lit = {
			species: 'pedunculate-oak',
			view: 'whole' as const,
			skyShare: 0.2,
			daylight: 2.7,
		};
		expect(readPlantReviewQuery(new URLSearchParams(plantReviewQuery(lit)))).toMatchObject(lit);
	});

	test("draw a still that names one of the record's forms in that form", () => {
		const forms = ['woodland', 'young'];
		expect(
			classifySlot('30-woodland-form-whole.png', 'A woodland oak, whole tree', forms),
		).toMatchObject({
			view: 'whole',
			framed: true,
			query: { form: 'woodland' },
			note: expect.stringContaining("record's woodland form"),
		});
		// The view rules choose 31's view; the form is this rule's.
		expect(
			classifySlot(
				'31-woodland-clean-bole.png',
				'The long branch-free bole of a woodland oak',
				forms,
			)?.query?.form,
		).toBe('woodland');
		expect(classifySlot('32-young-oak-whole.png', 'A young oak, whole tree', forms)?.query).toEqual(
			{
				form: 'young',
			},
		);
		// A texture source of young wood is the grown plant's own bark, and a standard still's row
		// that speaks of young shoots on the grown plant names no form.
		expect(
			classifySlot('28-young-bark.png', 'Young-branch bark', forms)?.query?.form,
		).toBeUndefined();
		expect(
			classifySlot('10-fine-twigs.png', 'The young shoots at the twig tips', forms)?.query?.form,
		).toBeUndefined();
		// A row's words do not pick a form, though they name one in passing: a still whose name names
		// none is judged beside the grown variant.
		const sapling = classifySlot('33-sapling.png', 'A sapling, unlike the young oak of 32', forms);
		expect(sapling?.query?.form).toBeUndefined();
		expect(sapling?.note).toContain('grows the mature plant');
		const stand = classifySlot(
			'34-stand-whole.png',
			'An oak in a stand, like the woodland oak',
			forms,
		);
		expect(stand?.query?.form).toBeUndefined();
		expect(stand?.note).toContain('another habit');
		// Without the record's forms, the still is judged beside the grown variant, with a note.
		expect(classifySlot('32-young-oak-whole.png')?.query?.form).toBeUndefined();
		expect(classifySlot('32-young-oak-whole.png')?.note).toContain('grows the mature plant');
	});

	test("carry the form in the review page's query, and refuse a name that is not a form's", () => {
		const text = plantReviewQuery({ species: 'pedunculate-oak', form: 'young', view: 'whole' });
		expect(new URLSearchParams(text).get('form')).toBe('young');
		expect(readPlantReviewQuery(new URLSearchParams(text)).form).toBe('young');
		expect(readPlantReviewQuery(new URLSearchParams('species=stub')).form).toBeUndefined();
		expect(() => readPlantReviewQuery(new URLSearchParams('species=stub&form=Old Tree'))).toThrow(
			/kebab-case/,
		);
	});

	test('draw a still of fruit among green leaves in summer, and one among autumn leaves in autumn', () => {
		const acorns = classifySlot('19-acorns-on-stalk.png') as NonNullable<
			ReturnType<typeof classifySlot>
		>;
		// Green leaves round a few brown acorns, as still 19 shows them.
		const late = blank(10, 10, [70, 110, 50]);
		for (let i = 0; i < 20; i++) late.data.set([130, 80, 30, 255], i * 4);
		expect(greenLeaves(late)).toBe(true);
		expect(seasonFromPicture(acorns, late).query?.season).toBe('summer');
		const turned = blank(10, 10, [190, 120, 40]);
		expect(greenLeaves(turned)).toBe(false);
		expect(seasonFromPicture(acorns, turned).query?.season).toBe('autumn');
		// Grey picture: neither colour, so the name's season stands.
		expect(seasonFromPicture(acorns, blank(4, 4, [128, 128, 128])).query?.season).toBe('autumn');
	});

	test('draw each still in the season it shows, from its name or its index row', () => {
		expect(classifySlot('19-acorns-on-stalk.png')?.query?.season).toBe('autumn');
		expect(classifySlot('19-hips-on-the-cane.png')?.query?.season).toBe('autumn');
		expect(classifySlot('19-flowers.png')?.query?.season).toBe('blossom');
		expect(classifySlot('19-cones-on-a-branch.png')?.query?.season).toBeUndefined();
		expect(
			classifySlot('19-hanging-clusters.png', 'The tree in full flower, white clusters')?.query
				?.season,
		).toBe('blossom');
		expect(classifySlot('19-on-the-twig.png', 'Ripe red berries on the twig')?.query?.season).toBe(
			'autumn',
		);
		expect(
			classifySlot('08-limb-fork.png', 'A thick limb dividing into two')?.query,
		).toBeUndefined();
		expect(classifySlot('20-winter-branch-architecture.png')?.query?.season).toBe('winter');
		expect(classifySlot('20-blossom-spring.png')?.query?.season).toBe('blossom');
		expect(classifySlot('20-fire-scar.png')?.query?.season).toBe('winter');
		expect(
			classifySlot('05-crown-underneath.png', 'Bright under the leaves, bare limbs in winter')
				?.query?.season,
		).toBeUndefined();
		expect(
			classifySlot('24-leaf-texture-upper.png', 'One leaf, autumn colours')?.query,
		).toBeUndefined();
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
			query: { along: 0.85, thin: 0.015, span: 0.1, barkMask: true },
		});
	});

	test('leave out files that are not numbered pictures', () => {
		expect(classifySlot('INDEX.md')).toBeUndefined();
		expect(classifySlot('branch-turntable-sheet.png')).toBeUndefined();
	});
});

describe("a reference file's own fields from the slot file", () => {
	test('go over its query, a field given as null dropping it, for a still or a video', () => {
		const measured = {
			species: 'pedunculate-oak',
			view: 'whole',
			fill: 0.69,
			targetY: 0.52,
			sunAzimuth: 9.3,
			sunRise: 41.5,
		} as const;
		expect(withSlot(measured, undefined)).toBe(measured);
		expect(withSlot(measured, { skyShare: 0.135, fov: 30, sunRise: 30 })).toEqual({
			...measured,
			skyShare: 0.135,
			fov: 30,
			sunRise: 30,
		});
		const traded = withSlot(measured, { fill: null, targetY: null, top: 0.05, eye: 1.6 });
		expect(traded).not.toHaveProperty('fill');
		expect(traded).not.toHaveProperty('targetY');
		expect(traded).toMatchObject({ top: 0.05, eye: 1.6, sunAzimuth: 9.3 });
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
				'| `alder-turntable-b.mp4` | The whole tree | Use this one. Superseded by `alder-turntable-c.mp4`. |',
				'| `cluster-turntable.mp4` | The cluster | (`23-a.png` is superseded by `23-b.png`) |',
			].join('\n'),
		);
		expect(rows.map((row) => row.file)).toEqual([
			'02-whole-profile.png',
			'02-whole-profile-b.png',
			'common-ash-turntable.mp4',
			'22-subbranch-studio.png',
			'alder-turntable-b.mp4',
			'cluster-turntable.mp4',
		]);
		expect(rows[0]?.supersededBy).toBe('02-whole-profile-b.png');
		expect(rows[1]?.supersededBy).toBeUndefined();
		expect(rows[2]?.supersededBy).toBe('a later file');
		expect(rows[3]?.supersededBy).toBeUndefined();
		expect(rows[4]?.supersededBy).toBe('alder-turntable-c.mp4');
		expect(rows[5]?.supersededBy).toBeUndefined();
	});
});

describe('the strands view', () => {
	test('a slot names it, and no standard picture takes it', () => {
		// A slot file's own fields go over the query, so a species names the view itself.
		const named = withSlot({ species: 'silver-birch', view: 'whole' }, { view: 'strands' });
		expect(named.view).toBe('strands');
		// It is off every slot number: no standard picture takes it, so no other render moves.
		expect(VIEW_SPECS.strands.slots).toEqual([]);
		// The standard names keep the views they had before the view was added. The birch's
		// `19-drooping-twig-ends` name reads as `subbranch` by the twig rule today; the species
		// names the view it wants in its own slot entry.
		const standard: readonly (readonly [string, PlantView])[] = [
			['01-whole-distant.png', 'whole'],
			['02-whole-profile.png', 'whole'],
			['03-whole-from-below.png', 'below'],
			['04-crown-outside.png', 'limb'],
			['05-crown-underside.png', 'below'],
			['06-inside-crown.png', 'inside'],
			['07-limb-leaving-trunk.png', 'junction'],
			['08-limb-fork.png', 'fork'],
			['09-secondary-branching.png', 'branch'],
			['10-fine-twigs.png', 'subbranch'],
			['11-leaf-cluster.png', 'cluster'],
			['12-single-leaf-upper.png', 'leaf-upper'],
			['13-single-leaf-underside.png', 'leaf-under'],
			['14-bark-base.png', 'bark-base'],
			['15-bark-mid-trunk.png', 'bark-mid'],
			['16-bark-on-limb.png', 'bark-limb'],
			['17-trunk-taper.png', 'trunk'],
			['18-silhouette.png', 'silhouette'],
			['19-drooping-twig-ends.png', 'subbranch'],
			['20-winter-held-leaves.png', 'limb'],
			['21-branch-studio.png', 'branch'],
			['22-subbranch-studio.png', 'subbranch'],
			['23-leaf-cluster-studio.png', 'cluster'],
			['24-leaf-texture-upper.png', 'leaf-upper'],
			['25-leaf-texture-underside.png', 'leaf-under'],
			['26-bark-texture.png', 'bark-mid'],
			['28-young-bark.png', 'bark-limb'],
		];
		for (const [file, view] of standard) expect(classifySlot(file)?.view, file).toBe(view);
	});
});

describe('the sheath view', () => {
	test('a ground plant’s sheath, collar and ligule pictures take it', () => {
		expect(classifySlot('15-sheath-and-collar.png')?.view).toBe('sheath');
		expect(classifySlot('16-ligule-and-collar.png')?.view).toBe('sheath');
		expect(classifySlot('15-sheath-and-ligule.png')?.view).toBe('sheath');
		// The bark pictures keep the views they had: only the sheath words take the new view.
		expect(classifySlot('15-bark-mid-trunk.png')?.view).toBe('bark-mid');
		expect(classifySlot('16-bark-on-limb.png')?.view).toBe('bark-limb');
	});
});

/** A plant's mask on the matte's plain white background. */
function mattePlant(
	width: number,
	height: number,
	mask: Uint8Array,
	coverage?: Uint8Array,
): PlantMask {
	const flat = {
		coefficients: [
			[100, 0, 0, 0, 0, 0],
			[0, 0, 0, 0, 0, 0],
			[0, 0, 0, 0, 0, 0],
		],
		noise: 0.5,
		fit: 1,
	};
	return {
		width,
		height,
		mask,
		...(coverage && { coverage }),
		background: { horizon: null, sky: flat, plain: true },
	};
}

describe('the coverage matte', () => {
	test("keeps a texel's own coverage beside the half-black mask", () => {
		const image = blank(4, 1, [255, 255, 255]);
		put(image, 1, 0, [0, 0, 0]);
		put(image, 2, 0, [128, 128, 128]);
		put(image, 3, 0, [254, 254, 254]);
		const plant = matteMask(image);
		expect([...plant.mask]).toEqual([0, 1, 0, 0]);
		expect([...(plant.coverage as Uint8Array)]).toEqual([0, 255, 127, 0]);
	});

	test('reads any coverage for the piece test, and a plain mask as it stands', () => {
		const plain = mattePlant(2, 1, Uint8Array.from([1, 0]));
		expect([...anyPlantMask(plain)]).toEqual([1, 0]);
		const covered = mattePlant(2, 1, Uint8Array.from([0, 0]), Uint8Array.from([0, 3]));
		expect([...anyPlantMask(covered)]).toEqual([0, 1]);
	});

	test('joins two runs through a texel that a leaf only partly covers', () => {
		const width = 20;
		const height = 8;
		const mask = new Uint8Array(width * height);
		for (let y = 1; y <= 6; y++)
			for (const x of [2, 3, 4, 5, 6, 9, 10, 11, 12, 13]) mask[y * width + x] = 1;
		const coverage = new Uint8Array(width * height);
		for (let at = 0; at < coverage.length; at++) coverage[at] = mask[at] ? 255 : 0;
		for (let y = 1; y <= 6; y++) coverage[y * width + 7] = 100;
		const plant = mattePlant(width, height, mask, coverage);
		// The blocks stand two background texels apart, so the plain mask reads two pieces. The
		// partly covered texel closes the gap to the one the piece rule already bridges.
		expect(pieceCount(mask, width, height, 24)).toBe(2);
		expect(pieceCount(anyPlantMask(plant), width, height, 24)).toBe(1);
	});

	test('counts a partly covered texel as the sky it leaves in the gap', () => {
		const width = 20;
		const height = 20;
		const mask = new Uint8Array(width * height);
		for (let y = 5; y <= 14; y++) for (let x = 5; x <= 14; x++) mask[y * width + x] = 1;
		const hole = [8, 9, 10, 11].map((x) => 10 * width + x);
		for (const at of hole) mask[at] = 0;
		const coverage = new Uint8Array(width * height);
		for (let at = 0; at < coverage.length; at++) coverage[at] = mask[at] ? 255 : 0;
		for (const at of hole.slice(0, 2)) coverage[at] = 128;
		const image = blank(width, height, [0, 0, 0]);
		const binary = measurePlant(image, mattePlant(width, height, mask));
		const fractional = measurePlant(image, mattePlant(width, height, mask, coverage));
		// The hole is four texels of the crown's hundred; two are half covered, so the fractional
		// gap gives back the half texel each of them leaves. The measure rounds the share to four
		// places, which is where three per cent sits.
		expect(binary.gapFraction).toBeCloseTo(4 / 100, 4);
		expect(fractional.gapFraction).toBeCloseTo(3 / 100, 4);
		// The crown's own box holds the same hole as the outline, so its gap agrees; the frame keeps
		// the empty sky around the plant and reads far larger.
		expect(binary.crownBoxGap).toBeCloseTo(4 / 100, 4);
		expect(fractional.crownBoxGap).toBeCloseTo(3 / 100, 4);
		expect(binary.frameGap).toBeCloseTo(304 / 400, 4);
		expect(fractional.frameGap).toBeCloseTo((300 + 2 + 2 * (1 - 128 / 255)) / 400, 4);
	});
});
