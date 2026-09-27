import { describe, expect, test } from 'bun:test';
import { packRows, rowStrideOf } from './pixels';

describe('packRows', () => {
	// Two pixels wide and three rows high; every byte of row r is r + 1.
	const rows = (stride: number) => {
		const source = new Uint8Array(stride * 3);
		for (let r = 0; r < 3; r++) source.fill(r + 1, r * stride, r * stride + 8);
		return source;
	};

	test('keeps rows that are already top first and packed', () => {
		const packed = packRows(rows(8), 2, 3, 8, false);
		expect([...packed]).toEqual([...rows(8)]);
	});

	test('turns bottom-first rows, as WebGL reads them, top first', () => {
		const packed = packRows(rows(8), 2, 3, 8, true);
		expect([packed[0], packed[8], packed[16]]).toEqual([3, 2, 1]);
	});

	test('drops the padding at the end of each row', () => {
		const padded = rows(256).subarray(0, 256 * 2 + 8);
		expect(rowStrideOf(padded.length, 2, 3)).toBe(256);
		const packed = packRows(padded, 2, 3, 256, false);
		expect(packed).toHaveLength(24);
		expect([packed[0], packed[8], packed[16]]).toEqual([1, 2, 3]);
	});

	test('refuses a buffer that is too short for the image', () => {
		expect(() => packRows(new Uint8Array(20), 2, 3, 8, false)).toThrow(RangeError);
		expect(() => rowStrideOf(23, 2, 3)).toThrow(RangeError);
	});
});
