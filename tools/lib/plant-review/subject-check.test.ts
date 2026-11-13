// The subject check on the tool's side: what a posted subject says, what a matte shows of a view's
// regions, and when a picture is void.
import { describe, expect, test } from 'bun:test';
import { matteCheck, postedSubject, regionCover, voidReason } from './subject-check.ts';

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
			'the open ground beside the limb shows plant over 1.00 of its part of the picture, over 0.6',
		);
	});

	test('fail on a picture with air where the subject should stand', () => {
		const air = maskOf(100, 100, [[60, 0, 70, 30]]);
		const read = matteCheck(air, 100, 100, regions);
		expect(read.present).toBe(false);
		expect(read.reason).toContain('the trunk beside the joint shows plant over 0.00');
	});
});

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
		expect(voidReason(facts, wall)).toContain('the picture does not show the subject');
		// The same contract with the ground open, and with no matte to read, is not void.
		const open = { mask: maskOf(40, 40, [[0, 0, 18, 40]]), width: 40, height: 40 };
		expect(voidReason(facts, open)).toBe(undefined);
		expect(voidReason(facts)).toBe(undefined);
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
