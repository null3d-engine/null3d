import { describe, expect, test } from 'bun:test';
import {
	PERMUTATION_VERTEX_COLOR,
	PERMUTATION_VERTEX_TANGENT,
	VERTEX_ALL,
	VERTEX_COLOR,
	VERTEX_TANGENT,
	VERTEX_UV0,
	VERTEX_UV1,
} from '../generated/gpu';
import {
	forEachFallbackAttribute,
	forEachVertexAttribute,
	variantLocations,
	vertexAttribute,
	vertexStride,
} from './vertex-format';

/** The shader locations of a format's attributes, in vertex order. */
function locations(format: number): number[] {
	const found: number[] = [];
	forEachVertexAttribute(format, (location) => found.push(location));
	return found;
}

describe('vertex formats', () => {
	test('a mesh with only the first texture coordinates offers them as the second set', () => {
		expect(vertexAttribute(VERTEX_UV0, 3)).toEqual({ floats: 2, offset: 24 });
		expect(vertexAttribute(VERTEX_UV0 | VERTEX_UV1, 3)).toEqual({ floats: 2, offset: 32 });
		expect(vertexAttribute(0, 3)).toBeUndefined();
		const offered: number[][] = [];
		forEachFallbackAttribute(VERTEX_UV0 | VERTEX_COLOR, (...place) => offered.push(place));
		expect(offered).toEqual([[3, 2, 24]]);
		forEachFallbackAttribute(VERTEX_ALL, (...place) => offered.push(place));
		expect(offered).toHaveLength(1);
	});

	test('variants read the colors and tangents that their bits ask for', () => {
		expect(variantLocations([0, 1], 0)).toEqual([0, 1]);
		const both = PERMUTATION_VERTEX_COLOR | PERMUTATION_VERTEX_TANGENT;
		expect(variantLocations([0, 1, 2, 3], both)).toEqual([0, 1, 2, 3, 4, 5]);
	});

	test('the base format holds a position and a normal, three floats each', () => {
		expect(vertexStride(0)).toBe(24);
		expect(vertexAttribute(0, 0)).toEqual({ floats: 3, offset: 0 });
		expect(vertexAttribute(0, 1)).toEqual({ floats: 3, offset: 12 });
		expect(vertexAttribute(0, 2)).toBeUndefined();
		expect(locations(0)).toEqual([0, 1]);
	});

	test('each optional attribute follows the ones before it, at its own location', () => {
		expect(vertexStride(VERTEX_ALL)).toBe(72);
		expect(vertexAttribute(VERTEX_ALL, 2)).toEqual({ floats: 2, offset: 24 });
		expect(vertexAttribute(VERTEX_ALL, 3)).toEqual({ floats: 2, offset: 32 });
		expect(vertexAttribute(VERTEX_ALL, 4)).toEqual({ floats: 4, offset: 40 });
		expect(vertexAttribute(VERTEX_ALL, 5)).toEqual({ floats: 4, offset: 56 });
		// Without the first texture coordinates, the second take their place.
		expect(vertexAttribute(VERTEX_UV1, 3)).toEqual({ floats: 2, offset: 24 });
		expect(vertexAttribute(VERTEX_UV1, 2)).toBeUndefined();
		expect(vertexAttribute(VERTEX_TANGENT | VERTEX_COLOR, 5)).toEqual({ floats: 4, offset: 40 });
		expect(vertexStride(VERTEX_UV0 | VERTEX_COLOR)).toBe(48);
		expect(locations(VERTEX_UV1 | VERTEX_COLOR)).toEqual([0, 1, 3, 5]);
	});

	test('in every format, the last attribute ends at the stride', () => {
		for (let format = 0; format <= VERTEX_ALL; format++) {
			let end = 0;
			forEachVertexAttribute(format, (_, floats, offset) => {
				expect(offset).toBe(end);
				end = offset + floats * 4;
			});
			expect(end).toBe(vertexStride(format));
		}
	});
});
