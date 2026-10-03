import { describe, expect, it } from 'bun:test';
import { LutFileError, parse3dl, parseCube, parseLut } from './lut-files';

/** The texel of a table at (r, g, b): its four bytes. */
function texel(texels: Uint8Array, size: number, r: number, g: number, b: number): number[] {
	const at = ((b * size + g) * size + r) * 4;
	return [...texels.subarray(at, at + 4)];
}

/** A `.cube` file's text of a 2 x 2 x 2 table that maps each corner to `map(r, g, b)`. */
function cube(header: string, map: (r: number, g: number, b: number) => string): string {
	const lines = [header];
	for (let b = 0; b < 2; b++)
		for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++) lines.push(map(r, g, b));
	return lines.join('\n');
}

describe('.cube tables', () => {
	it('reads the size, title and texels in red-fastest order, with comments, CRLF and exponents', () => {
		const text = cube('# graded\r\nTITLE "Warm look"\r\nLUT_3D_SIZE 2\r\n', (r, g, b) =>
			r === 1 && g === 0 && b === 0 ? '1.0e0 0.5 2.5E-1\r' : `${r} ${g} ${b}\r`,
		);
		const table = parseLut(text);
		expect(table.size).toBe(2);
		expect(table.title).toBe('Warm look');
		expect(table.domainMin).toEqual([0, 0, 0]);
		expect(table.domainMax).toEqual([1, 1, 1]);
		expect(texel(table.texels, 2, 0, 0, 0)).toEqual([0, 0, 0, 255]);
		expect(texel(table.texels, 2, 1, 0, 0)).toEqual([255, 128, 64, 255]);
		expect(texel(table.texels, 2, 0, 1, 1)).toEqual([0, 255, 255, 255]);
	});

	it('clamps values outside 0 to 1, and reads the domain and the input range', () => {
		const high = parseCube(
			cube('LUT_3D_SIZE 2\nDOMAIN_MIN -0.5 0 0\nDOMAIN_MAX 2 1 1.5', () => '-0.2 1.7 0.5'),
		);
		expect(texel(high.texels, 2, 1, 1, 1)).toEqual([0, 255, 128, 255]);
		expect(high.domainMin).toEqual([-0.5, 0, 0]);
		expect(high.domainMax).toEqual([2, 1, 1.5]);
		const range = parseCube(cube('LUT_3D_SIZE 2\nLUT_3D_INPUT_RANGE 0 4', () => '0 0 0'));
		expect(range.domainMax).toEqual([4, 4, 4]);
	});

	it('refuses a 1D table, a wrong count, a bad texel or size, and an empty domain', () => {
		const bad = [
			'LUT_1D_SIZE 4\n0 0 0',
			cube('LUT_3D_SIZE 3', () => '0 0 0'),
			`${cube('LUT_3D_SIZE 2', () => '0 0 0')}\n1 1 1`,
			cube('LUT_3D_SIZE 2', () => '0 0'),
			cube('LUT_3D_SIZE 2', () => '0 0 0 0'),
			cube('LUT_3D_SIZE 2', () => '0 0 x'),
			'LUT_3D_SIZE 1\n0 0 0',
			'LUT_3D_SIZE 257',
			'0 0 0\nLUT_3D_SIZE 2',
			cube('LUT_3D_SIZE 2\nDOMAIN_MIN 1 0 0\nDOMAIN_MAX 1 1 1', () => '0 0 0'),
			cube('LUT_3D_SIZE 2\nDOMAIN_MIN 0 0', () => '0 0 0'),
		];
		for (const text of bad) expect(() => parseLut(text)).toThrow(LutFileError);
		expect(() => parseLut('LUT_3D_SIZE 2\n0 0')).toThrow('line 2');
	});
});

/** A `.3dl` file's lines of a table of `size` that maps each point to `map(r, g, b)`, blue fastest. */
function threeDl(size: number, map: (r: number, g: number, b: number) => number[]): string[] {
	const lines: string[] = [];
	for (let r = 0; r < size; r++)
		for (let g = 0; g < size; g++)
			for (let b = 0; b < size; b++) lines.push(map(r, g, b).join(' '));
	return lines;
}

describe('.3dl tables', () => {
	it('reads a rounded input grid, puts blue fastest in the file and red fastest in the table, and takes the depth from the largest value', () => {
		const lines = [
			'# Autodesk',
			'0 511 1023',
			...threeDl(3, (r, g, b) => [r * 2047, g * 2047, b === 2 ? 4095 : b * 1000]),
		];
		const table = parseLut(lines.join('\n'));
		expect(table.size).toBe(3);
		expect(table.title).toBeUndefined();
		expect(texel(table.texels, 3, 2, 0, 0)).toEqual([255, 0, 0, 255]);
		expect(texel(table.texels, 3, 0, 1, 0)).toEqual([0, 127, 0, 255]);
		expect(texel(table.texels, 3, 0, 0, 2)).toEqual([0, 0, 255, 255]);
		expect(texel(table.texels, 3, 0, 0, 1)).toEqual([0, 0, 62, 255]);
	});

	it('takes the output depth from a Mesh line, and the size from the count without a grid', () => {
		const lines = ['3DMESH', 'Mesh 4 12', ...threeDl(2, (r) => [r * 1023, 0, 0])];
		const table = parse3dl(lines.join('\n'));
		expect(table.size).toBe(2);
		expect(texel(table.texels, 2, 1, 0, 0)).toEqual([64, 0, 0, 255]);
	});

	it('refuses an uneven grid, a wrong count and values that are not whole numbers', () => {
		const bad = [
			['0 300 1023', ...threeDl(3, () => [0, 0, 0])],
			['0 511 1023', ...threeDl(2, () => [0, 0, 0])],
			['0 511 1023', ...threeDl(3, () => [0.5, 0, 0])],
			['0 511 1023', ...threeDl(3, () => [0, 0])],
			threeDl(3, () => [0, 0, 0]).slice(1),
		];
		for (const lines of bad) expect(() => parse3dl(lines.join('\n'))).toThrow(LutFileError);
	});
});
