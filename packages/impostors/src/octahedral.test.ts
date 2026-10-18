import { describe, expect, test } from 'bun:test';
import {
	decodeOctahedral,
	encodeOctahedral,
	frameDirection,
	impostorFrame,
	nearestFrame,
	octahedralAtlas,
	octahedralCells,
} from './octahedral';

describe('octahedralAtlas', () => {
	test('holds at least the views asked for, in the squarest grid', () => {
		expect(octahedralAtlas(1)).toEqual({ columns: 1, rows: 1 });
		expect(octahedralAtlas(8)).toEqual({ columns: 3, rows: 3 });
		expect(octahedralAtlas(16)).toEqual({ columns: 4, rows: 4 });
		expect(octahedralCells(octahedralAtlas(8))).toBe(9);
	});

	test('refuses a count that is not a whole number from 1', () => {
		expect(() => octahedralAtlas(0)).toThrow(RangeError);
		expect(() => octahedralAtlas(2.5)).toThrow(RangeError);
	});
});

describe('encodeOctahedral', () => {
	test('is the inverse of decodeOctahedral across the square', () => {
		const out = [0, 0] as [number, number];
		for (const u of [-0.9, -0.7, -0.2, 0, 0.3, 0.9]) {
			for (const v of [-0.9, -0.5, 0, 0.4, 0.8]) {
				const direction = decodeOctahedral([u, v]);
				encodeOctahedral(direction, out);
				expect(out[0]).toBeCloseTo(u, 6);
				expect(out[1]).toBeCloseTo(v, 6);
			}
		}
	});

	test("sends the axes to the square's middle, edges and corner", () => {
		expect(encodeOctahedral([0, 0, 1])).toEqual([0, 0]);
		expect(encodeOctahedral([0, 0, -1])).toEqual([1, 1]);
		expect(encodeOctahedral([1, 0, 0])[0]).toBeCloseTo(1, 6);
		expect(encodeOctahedral([-1, 0, 0])[0]).toBeCloseTo(-1, 6);
		expect(encodeOctahedral([0, 1, 0])[1]).toBeCloseTo(1, 6);
		expect(encodeOctahedral([0, -1, 0])[1]).toBeCloseTo(-1, 6);
	});

	test('keeps back directions with x or y at 0 in the back half', () => {
		for (const direction of [
			[0, 0, -1],
			[0, 0.6, -0.8],
			[0, -0.6, -0.8],
			[0.6, 0, -0.8],
			[-0.6, 0, -0.8],
		] as const) {
			const back = decodeOctahedral(encodeOctahedral(direction));
			expect(back[0]).toBeCloseTo(direction[0], 6);
			expect(back[1]).toBeCloseTo(direction[1], 6);
			expect(back[2]).toBeCloseTo(direction[2], 6);
		}
	});

	test('reads a direction of length 0 as the middle', () => {
		expect(encodeOctahedral([0, 0, 0])).toEqual([0, 0]);
	});
});

describe('impostorFrame and frameDirection', () => {
	test('round trips every frame of a grid', () => {
		const atlas = { columns: 4, rows: 4 };
		for (let frame = 0; frame < octahedralCells(atlas); frame++) {
			expect(impostorFrame(frameDirection(frame, atlas), atlas)).toBe(frame);
		}
	});

	test('round trips a grid that does not fill its last row', () => {
		const atlas = octahedralAtlas(8);
		for (let frame = 0; frame < octahedralCells(atlas); frame++) {
			expect(impostorFrame(frameDirection(frame, atlas), atlas)).toBe(frame);
		}
	});

	test('names the cell that faces the camera', () => {
		const atlas = { columns: 3, rows: 3 };
		// The middle cell of a 3 by 3 grid is the +z direction, as frame 4 counts from the top left.
		expect(impostorFrame([0, 0, 1], atlas)).toBe(4);
		expect(frameDirection(4, atlas)).toEqual([0, 0, 1]);
	});

	test('gives the back pole and the back half-planes their own cells', () => {
		const atlas = { columns: 4, rows: 4 };
		// The back pole is the last cell, at the bottom right corner, never a front cell.
		expect(impostorFrame([0, 0, -1], atlas)).toBe(15);
		expect(impostorFrame([0, 0, -1], atlas)).not.toBe(impostorFrame([0, 0, 1], atlas));
		// A back direction with x or y at 0 shows a cell whose view faces back too.
		for (const direction of [
			[0, 0.2, -1],
			[0, -0.2, -1],
			[0.2, 0, -1],
			[-0.2, 0, -1],
		] as const) {
			const seen = frameDirection(impostorFrame(direction, atlas), atlas);
			expect(seen[2]).toBeLessThan(0);
		}
	});

	test('refuses a frame outside the grid in frameDirection', () => {
		expect(() => frameDirection(9, { columns: 3, rows: 3 })).toThrow(RangeError);
		expect(() => frameDirection(-1, { columns: 3, rows: 3 })).toThrow(RangeError);
	});
});

describe('nearestFrame', () => {
	test('picks the view whose direction is nearest', () => {
		const views = [
			[0, 0, 1],
			[1, 0, 0],
			[-1, 0, 0],
			[0, 1, 0],
		] as const;
		expect(nearestFrame([0.2, 0, 1], views)).toBe(0);
		expect(nearestFrame([1, 0.1, 0], views)).toBe(1);
		expect(nearestFrame([0, 1, 0], views)).toBe(3);
		expect(nearestFrame([0, 0, 0], views)).toBe(0);
		expect(nearestFrame([1, 0, 0], [])).toBe(-1);
	});
});
