// The test copy of three.js's table of specular terms must equal three.js's own, in both of the
// files where three.js keeps it, and its lookup must give each entry at the entry's center.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { DFG_HALVES, DFG_SIZE, dfgLut, halfToFloat } from '../pages/lib/dfg-table';

const THREE = new URL('../../bench/node_modules/three/src/', import.meta.url);

/** The half floats of the `Uint16Array` in one of three.js's source files. */
function threeHalves(path: string): number[] {
	const source = readFileSync(new URL(path, THREE), 'utf8');
	const array = /new Uint16Array\( \[([\s\S]*?)\] \)/.exec(source)?.[1] ?? '';
	return (array.match(/0x[0-9a-f]+/g) ?? []).map((hex) => Number.parseInt(hex, 16));
}

describe('the table of specular terms', () => {
	test("equals three.js's in both of its files", () => {
		const copy = [...DFG_HALVES];
		expect(copy).toHaveLength(2 * DFG_SIZE * DFG_SIZE);
		expect(threeHalves('nodes/functions/BSDF/DFGLUT.js')).toEqual(copy);
		expect(threeHalves('renderers/shaders/DFGLUTData.js')).toEqual(copy);
	});

	test('the lookup gives each entry at its center, and clamps at the edges', () => {
		const entry = (column: number, row: number): [number, number] => [
			halfToFloat(DFG_HALVES[2 * (row * DFG_SIZE + column)] as number),
			halfToFloat(DFG_HALVES[2 * (row * DFG_SIZE + column) + 1] as number),
		];
		const center = (k: number) => (k + 0.5) / DFG_SIZE;
		expect(dfgLut(center(3), center(7))).toEqual(entry(7, 3));
		expect(dfgLut(center(15), center(0))).toEqual(entry(0, 15));
		expect(dfgLut(0, 0)).toEqual(entry(0, 0));
		expect(dfgLut(1, 1)).toEqual(entry(15, 15));
		const [a, b] = [entry(4, 2), entry(5, 2)];
		const halfway = dfgLut(center(2), (center(4) + center(5)) / 2);
		expect(halfway[0]).toBeCloseTo(((a[0] as number) + (b[0] as number)) / 2, 12);
	});

	test('decodes half floats', () => {
		expect(halfToFloat(0x3c00)).toBe(1);
		expect(halfToFloat(0x3800)).toBe(0.5);
		expect(halfToFloat(0x0001)).toBe(2 ** -24);
		expect(halfToFloat(0xbc00)).toBe(-1);
	});
});
