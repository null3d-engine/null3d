import { describe, expect, test } from 'bun:test';
import { farCellGroups, mergeFarGeometry } from './merge';

/** One triangle at the origin, facing +z. */
const triangle = {
	positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
	normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
	uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
	indices: new Uint16Array([0, 1, 2]),
};

/** Moves by x, y and z, column-major. */
const translate = (x: number, y: number, z: number) => [
	1,
	0,
	0,
	0,
	0,
	1,
	0,
	0,
	0,
	0,
	1,
	0,
	x,
	y,
	z,
	1,
];

describe('mergeFarGeometry', () => {
	test('keeps every vertex and moves each copy', () => {
		const merged = mergeFarGeometry([
			{ arrays: triangle },
			{ arrays: triangle, transform: translate(2, 0, 0) },
		]);
		expect(Array.from(merged.positions as Float32Array)).toEqual([
			0, 0, 0, 1, 0, 0, 0, 1, 0, 2, 0, 0, 3, 0, 0, 2, 1, 0,
		]);
		expect(Array.from(merged.indices as Uint32Array)).toEqual([0, 1, 2, 3, 4, 5]);
		expect(Array.from(merged.uvs as Float32Array)).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
	});

	test('turns normals with the copy', () => {
		// A quarter turn about Y sends (1, 0, 0) to (0, 0, -1) and leaves (0, 0, 1) as (1, 0, 0).
		const quarterY = [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1];
		const merged = mergeFarGeometry([{ arrays: triangle, transform: quarterY }]);
		const positions = merged.positions as Float32Array;
		expect(positions[3]).toBeCloseTo(0, 6);
		expect(positions[5]).toBeCloseTo(-1, 6);
		const normals = merged.normals as Float32Array;
		expect(normals[0]).toBeCloseTo(1, 6);
		expect(normals[1]).toBeCloseTo(0, 6);
		expect(normals[2]).toBeCloseTo(0, 6);
	});

	test('turns tangents with the copy and keeps their sign', () => {
		const withTangents = {
			...triangle,
			tangents: new Float32Array([1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, -1]),
		};
		const quarterY = [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1];
		const merged = mergeFarGeometry([{ arrays: withTangents, transform: quarterY }]);
		const tangents = Array.from(merged.tangents as Float32Array).map(
			(t) => Math.round(t * 1e6) / 1e6 + 0,
		);
		expect(tangents).toEqual([0, 0, -1, 1, 0, 0, -1, 1, 0, 0, -1, -1]);
	});

	test('reverses the winding and the tangent sign of a mirrored copy', () => {
		const withTangents = {
			...triangle,
			tangents: new Float32Array([1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1]),
		};
		const mirrorX = [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
		const merged = mergeFarGeometry([
			{ arrays: withTangents },
			{ arrays: withTangents, transform: mirrorX },
		]);
		expect(Array.from(merged.indices as Uint32Array)).toEqual([0, 1, 2, 3, 5, 4]);
		expect(Array.from(merged.tangents as Float32Array).slice(12)).toEqual([
			-1, 0, 0, -1, -1, 0, 0, -1, -1, 0, 0, -1,
		]);
		// The mirrored triangle's corners, in their new order, still turn counterclockwise about +z.
		const p = merged.positions as Float32Array;
		const corner = (v: number, axis: number) => p[v * 3 + axis] as number;
		const faceZ =
			(corner(5, 0) - corner(3, 0)) * (corner(4, 1) - corner(3, 1)) -
			(corner(5, 1) - corner(3, 1)) * (corner(4, 0) - corner(3, 0));
		expect(faceZ).toBeGreaterThan(0);
		expect((merged.normals as Float32Array)[11]).toBeCloseTo(1, 6);
	});

	test('reverses the winding of a mirrored copy without indices', () => {
		const plain = { positions: triangle.positions, normals: triangle.normals };
		const mirrorY = [1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
		const merged = mergeFarGeometry([{ arrays: plain, transform: mirrorY }, { arrays: plain }]);
		expect(Array.from(merged.indices as Uint32Array)).toEqual([0, 2, 1, 3, 4, 5]);
	});

	test('makes indices for a copy without any', () => {
		const plain = { positions: triangle.positions, normals: triangle.normals };
		const merged = mergeFarGeometry([{ arrays: plain }, { arrays: plain }]);
		expect(Array.from(merged.indices as Uint32Array)).toEqual([0, 1, 2, 3, 4, 5]);
	});

	test('leaves out an attribute that any copy lacks', () => {
		const merged = mergeFarGeometry([
			{ arrays: triangle },
			{ arrays: { positions: triangle.positions, indices: triangle.indices } },
		]);
		expect(merged.normals).toBeUndefined();
		expect(merged.uvs).toBeUndefined();
	});

	test('keeps a color that every copy carries, at three or four per vertex', () => {
		const withColor = { ...triangle, colors: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]) };
		const merged = mergeFarGeometry([{ arrays: withColor }, { arrays: withColor }]);
		expect(Array.from(merged.colors as Float32Array)).toEqual([
			1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0, 0, 1, 0, 0, 0, 1,
		]);
	});

	test('refuses copies that do not fit together', () => {
		expect(() => mergeFarGeometry([])).toThrow(RangeError);
		const odd = { positions: new Float32Array([0, 0, 0, 1, 0]), indices: [0] };
		expect(() => mergeFarGeometry([{ arrays: odd }])).toThrow(RangeError);
		const threeTangents = { ...triangle, tangents: new Float32Array(9) };
		expect(() => mergeFarGeometry([{ arrays: threeTangents }])).toThrow(RangeError);
	});
});

describe('farCellGroups', () => {
	test('groups centres by the cell each falls in', () => {
		const groups = farCellGroups(
			[
				[0, 0, 0],
				[1, 1, 1],
				[9, 0, 0],
				[2, 2, 2],
			],
			8,
		);
		expect(groups).toEqual([[0, 1, 3], [2]]);
	});

	test('puts the boundary in the higher cell', () => {
		expect(farCellGroups([[8, 0, 0]], 8)).toEqual([[0]]);
		expect(
			farCellGroups(
				[
					[7.9, 0, 0],
					[-0.1, 0, 0],
				],
				8,
			),
		).toEqual([[0], [1]]);
	});

	test('refuses a cell size that is not above 0', () => {
		expect(() => farCellGroups([], 0)).toThrow(RangeError);
	});
});
