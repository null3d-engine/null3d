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

	test("sends the axes to the square's middle and corners", () => {
		expect(encodeOctahedral([0, 0, 1])).toEqual([0, 0]);
		expect(encodeOctahedral([0, 0, -1])).toEqual([0, 0]);
		expect(encodeOctahedral([1, 0, 0])[0]).toBeCloseTo(1, 6);
		expect(encodeOctahedral([-1, 0, 0])[0]).toBeCloseTo(-1, 6);
		expect(encodeOctahedral([0, 1, 0])[1]).toBeCloseTo(1, 6);
		expect(encodeOctahedral([0, -1, 0])[1]).toBeCloseTo(-1, 6);
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

describe('the per-frame update', () => {
	test('folds each direction into a pair made once, and reads vectors by index', async () => {
		// The batch's update calls impostorFrame once per card in every frame, so a default pair or
		// a destructured array there makes an object per card: `bench:allocation --impostors`.
		const source = await Bun.file(new URL('./octahedral.ts', import.meta.url)).text();
		const frame = source.slice(source.indexOf('export function impostorFrame('));
		expect(frame.slice(0, frame.indexOf('\n}'))).toContain('encodeOctahedral(direction, FRAME_UV)');
		const encode = source.slice(source.indexOf('export function encodeOctahedral('));
		expect(encode.slice(0, encode.indexOf('\n}'))).not.toMatch(/const \[/);
		const batch = await Bun.file(new URL('./batch.ts', import.meta.url)).text();
		const update = batch.slice(batch.indexOf('\tupdate(eye'));
		expect(update.slice(0, update.indexOf('\n\t}'))).not.toMatch(/const \[|= \[|Math\.hypot/);
	});
});
