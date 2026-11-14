// The subject check on the tool's side: what a posted subject says, what a matte shows of a view's
// regions, and when a picture is void.
import { describe, expect, test } from 'bun:test';
import {
	areaCovers,
	lackReason,
	matteCheck,
	PART,
	PART_RADIUS_SPAN,
	partCover,
	partsCheck,
	partsOf,
	postedSubject,
	regionCover,
	regionsRead,
	subjectFault,
	subjectWoodBounds,
	voidReason,
} from './subject-check.ts';

/** A mask of a size with the plant drawn over a box of pixels. */
function maskOf(
	width: number,
	height: number,
	boxes: readonly (readonly [number, number, number, number])[],
): Uint8Array {
	const mask = new Uint8Array(width * height);
	for (const [left, top, right, bottom] of boxes)
		for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) mask[y * width + x] = 1;
	return mask;
}

describe('the plant a matte shows in a part of the picture', () => {
	// A trunk down the left half of a picture 100 by 80.
	const mask = maskOf(100, 80, [[0, 0, 50, 80]]);

	test('is the share of the box that the plant covers', () => {
		expect(regionCover(mask, 100, 80, [0, 0, 1, 1])).toBe(0.5);
		expect(regionCover(mask, 100, 80, [0, 0, 0.5, 1])).toBe(1);
		expect(regionCover(mask, 100, 80, [0.5, 0, 1, 1])).toBe(0);
		expect(regionCover(mask, 100, 80, [0.25, 0.25, 0.75, 0.75])).toBe(0.5);
	});

	test('cuts a box that reaches past the frame to the frame, and reads an empty box as none', () => {
		expect(regionCover(mask, 100, 80, [-1, -1, 0.5, 2])).toBe(1);
		expect(regionCover(mask, 100, 80, [1.2, 0, 1.5, 1])).toBe(0);
	});
});

describe("a view's regions read on its matte", () => {
	const regions = [
		{ name: 'the trunk beside the joint', box: [0.3, 0.6, 0.45, 0.95], min: 0.7 },
		{ name: 'the open ground beside the limb', box: [0.75, 0.8, 1, 1], max: 0.6 },
	] as const;

	test('pass where the trunk stands and the ground beside the limb is open', () => {
		// The trunk on the left, a limb leaving to the upper right.
		const junction = maskOf(100, 100, [
			[0, 0, 47, 100],
			[47, 20, 100, 50],
		]);
		const read = matteCheck(junction, 100, 100, regions);
		expect(read.present).toBe(true);
		expect(read.covers).toEqual([
			{ name: 'the trunk beside the joint', cover: 1 },
			{ name: 'the open ground beside the limb', cover: 0 },
		]);
	});

	test('fail on a wall of bark, naming the part that should be open', () => {
		const wall = maskOf(100, 100, [[0, 0, 100, 100]]);
		const read = matteCheck(wall, 100, 100, regions);
		expect(read.present).toBe(false);
		expect(read.reason).toBe(
			'the open ground beside the limb: plant covers 1.00 of its box, over the most 0.60',
		);
	});

	test('fail on a picture with air where the subject should stand', () => {
		const air = maskOf(100, 100, [[60, 0, 70, 30]]);
		const read = matteCheck(air, 100, 100, regions);
		expect(read.present).toBe(false);
		expect(read.reason).toContain('the trunk beside the joint: plant covers 0.00');
	});
});

/** The display value the plant shader's blue holds for a wood radius in metres. */
function radiusByte(radius: number): number {
	const code = Math.sqrt(radius / PART_RADIUS_SPAN);
	const display = code <= 0.0031308 ? code * 12.92 : 1.055 * code ** (1 / 2.4) - 0.055;
	return Math.round(display * 255);
}

/**
 * A picture of the parts 100 by 80 on white: a limb 0.4 m in radius across the middle rows, a twig
 * 0.02 m in radius down one column over it, and a spray of leaves over the limb's right end.
 */
function partsPicture(): { data: Uint8Array; width: number; height: number } {
	const width = 100;
	const height = 80;
	const data = new Uint8Array(width * height * 4).fill(255);
	const paint = (
		[left, top, right, bottom]: readonly [number, number, number, number],
		[r, g, b]: readonly [number, number, number],
	) => {
		for (let y = top; y < bottom; y++)
			for (let x = left; x < right; x++) data.set([r, g, b, 255], (y * width + x) * 4);
	};
	paint([0, 30, 100, 50], [255, 0, radiusByte(0.4)]);
	paint([20, 0, 24, 80], [255, 0, radiusByte(0.02)]);
	paint([70, 20, 100, 60], [0, 255, 0]);
	paint([0, 70, 5, 80], [0, 255, 255]);
	return { data, width, height };
}

describe('a picture of the parts', () => {
	const parts = partsOf(partsPicture());

	test('reads each texel as ground, wood with its radius, foliage or an extra', () => {
		const at = (x: number, y: number) => y * 100 + x;
		expect(parts.kind[at(50, 5)]).toBe(PART.none);
		expect(parts.kind[at(50, 40)]).toBe(PART.wood);
		expect(parts.radius[at(50, 40)] as number).toBeCloseTo(0.4, 1);
		expect(parts.kind[at(21, 5)]).toBe(PART.wood);
		expect(parts.radius[at(21, 5)] as number).toBeLessThan(0.03);
		expect(parts.kind[at(80, 40)]).toBe(PART.foliage);
		expect(parts.kind[at(2, 75)]).toBe(PART.extras);
	});

	test('counts in a region only the parts the region names', () => {
		const box = [0.4, 0.375, 0.6, 0.625] as const;
		expect(partCover(parts, { name: 'any', box })).toBe(1);
		expect(partCover(parts, { name: 'wood', box, of: 'wood' })).toBe(1);
		expect(partCover(parts, { name: 'leaves', box, of: 'foliage' })).toBe(0);
		// The twig lies over the limb between columns 20 and 24: thin wood does not count as the limb.
		const across = [0.1, 0.375, 0.3, 0.625] as const;
		expect(partCover(parts, { name: 'wood', box: across, of: 'wood' })).toBe(1);
		expect(partCover(parts, { name: 'limb', box: across, of: 'wood', thick: 0.2 })).toBe(0.8);
	});

	test('sees leaves that lie over a subject whose points are all in the frame', () => {
		const regions = [
			{ name: "the limb's bark", box: [0.7, 0.4, 0.9, 0.6], min: 0.85, of: 'wood', thick: 0.2 },
			{ name: 'the leaves over the limb', box: [0.6, 0.3, 1, 0.7], max: 0.25, of: 'foliage' },
		] as const;
		const read = partsCheck(parts, regions);
		expect(read.present).toBe(false);
		expect(read.reason).toBe(
			"the limb's bark: wood 0.20 m in radius or more covers 0.00 of its box, under the least 0.85; the leaves over the limb: leaves covers 0.75 of its box, over the most 0.25",
		);
		const facts = {
			subject: { kind: 'the bark on a great limb', contract: { present: true }, regions },
		};
		// The camera holds the limb's place, so leaves across the bark are the plant's fault.
		expect(lackReason(facts, undefined, parts)).toContain('the picture does not show it');
		expect(voidReason(facts, undefined, parts)).toBe(undefined);
		expect(areaCovers(facts, parts).map((area) => area.name)).toEqual([
			"the limb's bark",
			'the leaves over the limb',
		]);
		// A matte cannot tell the parts apart, so it reads no region of wood or of foliage.
		const matte = { mask: new Uint8Array(100 * 80).fill(1), width: 100, height: 80 };
		expect(voidReason(facts, matte)).toBe(undefined);
		expect(matteCheck(matte.mask, 100, 80, regions).covers).toEqual([]);
		// So a picture with such regions is checked only where the run drew its parts.
		expect(regionsRead(facts, true, false)).toBe(false);
		expect(regionsRead(facts, false, true)).toBe(true);
		expect(regionsRead({ subject: { kind: 'the whole plant' } }, false, false)).toBe(true);
	});

	test("names each figure's own box when thinner wood lies across the trunk", () => {
		// The olive's bark-base at `olive-b0dfe9faa`: the whole box is wood, but roots thinner than the
		// trunk lie over it, so only a part of the box is trunk-thick. The cover is a share of the box
		// and the least is the least share; the radius is metres and is no figure to read as a share.
		const rooted = partsOf(rootedPicture());
		const box = [0.45, 0.3, 0.55, 0.75] as const;
		const region = { name: 'the trunk', box, min: 0.8, of: 'wood', thick: 0.86 } as const;
		expect(partCover(rooted, { name: 'any wood', box, of: 'wood' })).toBe(1);
		expect(partCover(rooted, region)).toBeCloseTo(0.56, 2);
		const read = partsCheck(rooted, [region]);
		expect(read.present).toBe(false);
		expect(read.covers).toEqual([{ name: 'the trunk', cover: 0.5556 }]);
		expect(read.reason).toBe(
			'the trunk: wood 0.86 m in radius or more covers 0.56 of its box, under the least 0.80',
		);
	});
});

/**
 * A picture of the parts where thinner wood lies over a thicker one: an olive's foot, with roots
 * across the trunk over the box's lower rows.
 */
function rootedPicture(): { data: Uint8Array; width: number; height: number } {
	const width = 100;
	const height = 100;
	const data = new Uint8Array(width * height * 4).fill(255);
	const paint = (
		[left, top, right, bottom]: readonly [number, number, number, number],
		[r, g, b]: readonly [number, number, number],
	) => {
		for (let y = top; y < bottom; y++)
			for (let x = left; x < right; x++) data.set([r, g, b, 255], (y * width + x) * 4);
	};
	// Roots of 0.2 m in radius across the whole box, and the trunk's bark of 1.1 m over its top.
	paint([45, 30, 55, 75], [255, 0, radiusByte(0.2)]);
	paint([45, 30, 55, 55], [255, 0, radiusByte(1.1)]);
	return { data, width, height };
}

describe('a void picture', () => {
	const junction = { kind: 'a great limb leaving the trunk' };

	test('is one whose view has no subject, with the reason the page gave', () => {
		const facts = {
			subject: { kind: 'no subject', missing: 'no limb divides into two arms of like size' },
		};
		expect(voidReason(facts)).toBe(
			'the view has no subject: no limb divides into two arms of like size',
		);
	});

	test('is one whose camera does not hold the subject', () => {
		const facts = {
			subject: {
				...junction,
				contract: { present: false, reason: 'the collar lands at 1.40 across' },
			},
		};
		expect(voidReason(facts)).toBe(
			'the subject is not in the frame: the collar lands at 1.40 across',
		);
	});

	test('is one whose matte shows a wall where the view asks for open ground', () => {
		const facts = {
			subject: {
				...junction,
				contract: { present: true },
				regions: [{ name: 'the open ground beside the limb', box: [0.75, 0.8, 1, 1], max: 0.6 }],
			},
		};
		const wall = { mask: maskOf(40, 40, [[0, 0, 40, 40]]), width: 40, height: 40 };
		// The solve said it could take no clear stand, so the wall is the camera's.
		const warned = { subject: { ...facts.subject, warning: 'limb 4 stands before every joint' } };
		expect(voidReason(warned, wall)).toContain('the camera took no clear stand');
		expect(lackReason(warned, wall)).toBe(undefined);
		// The same contract with the ground open, and with no matte to read, is not void.
		const open = { mask: maskOf(40, 40, [[0, 0, 18, 40]]), width: 40, height: 40 };
		expect(voidReason(warned, open)).toBe(undefined);
		expect(voidReason(warned)).toBe(undefined);
	});

	test("is not a picture whose camera held its subject's place: that one fails the plant", () => {
		const regions = [{ name: 'the open ground beside the limb', box: [0.75, 0.8, 1, 1], max: 0.6 }];
		const held = { subject: { ...junction, contract: { present: true }, regions } };
		const wall = { mask: maskOf(40, 40, [[0, 0, 40, 40]]), width: 40, height: 40 };
		expect(subjectFault(held, wall)).toEqual({
			kind: 'plant',
			reason:
				"the camera holds the subject's place and the picture does not show it: the open ground beside the limb: plant covers 1.00 of its box, over the most 0.60",
		});
		expect(voidReason(held, wall)).toBe(undefined);
		// A plant with no such part at all fails the same way, on the page's own word.
		const none = { subject: { kind: 'the whole plant', missing: 'no limb divides', lacks: true } };
		expect(subjectFault(none)).toEqual({ kind: 'plant', reason: 'no limb divides' });
		// An area that is only reported gives its figure and judges nothing.
		const reported = {
			subject: {
				...junction,
				contract: { present: true },
				regions: [{ ...regions[0], report: true }],
			},
		};
		expect(subjectFault(reported, wall)).toBe(undefined);
	});

	test('is never a picture whose page posted no subject, such as a whole view', () => {
		expect(voidReason({ view: 'whole' })).toBe(undefined);
		expect(voidReason(undefined)).toBe(undefined);
		// A subject with a warning and no contract, as an unsolved view posts, still stands.
		expect(voidReason({ subject: { kind: 'a twig with its end clusters', warning: 'x' } })).toBe(
			undefined,
		);
	});

	test('reads the posted subject, and drops what is not a subject', () => {
		expect(postedSubject({ subject: { kind: 7 } })).toBe(undefined);
		expect(postedSubject({ subject: { kind: 'the bole', contract: { present: true } } })).toEqual({
			kind: 'the bole',
			contract: { present: true },
		});
	});
});

describe("the wood radius a bark view's colour reads", () => {
	test('takes the region of wood the page posted', () => {
		const facts = {
			subject: {
				kind: 'the bark on a great limb',
				regions: [
					{
						name: "the limb's bark",
						box: [0.4, 0.4, 0.6, 0.6],
						min: 0.85,
						of: 'wood',
						thick: 0.016,
						thickMost: 0.03,
					},
					{ name: 'the ground beside the limb', box: [0, 0, 1, 1], max: 0.9 },
				],
			},
		};
		expect(subjectWoodBounds(facts, 0.5)).toEqual({ least: 0.016, most: 0.03 });
	});

	test('falls back to the radius the slot asks for where the view has no contract', () => {
		const bounds = subjectWoodBounds({}, 0.04);
		expect(bounds.least).toBeCloseTo(0.03, 6);
		expect(bounds.most).toBeCloseTo(0.056, 6);
	});

	test('reads every wood where neither names a radius', () => {
		expect(subjectWoodBounds({}, undefined)).toEqual({ least: 0, most: Number.POSITIVE_INFINITY });
	});
});
