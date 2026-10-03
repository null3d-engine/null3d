import { describe, expect, test } from 'bun:test';
import {
	PERMUTATION_VERTEX_COLOR,
	PERMUTATION_VERTEX_TANGENT,
	VERTEX_ALL,
	VERTEX_COLOR,
	VERTEX_JOINTS,
	VERTEX_TANGENT,
	VERTEX_TYPE_F32,
	VERTEX_TYPE_SINT16,
	VERTEX_TYPE_SNORM8,
	VERTEX_TYPE_UINT8,
	VERTEX_TYPE_UINT16,
	VERTEX_TYPE_UNORM8,
	VERTEX_TYPE_UNORM16,
	VERTEX_UV0,
	VERTEX_UV1,
	VERTEX_WEIGHTS,
} from '../generated/gpu';
import { typeField } from '../scene/mesh-arrays';
import {
	forEachFallbackAttribute,
	forEachVertexAttribute,
	plainScale,
	typeOf,
	type VertexAttribute,
	variantLocations,
	vertexAttribute,
	vertexStride,
} from './vertex-format';
import { gpuVertexFormat } from './webgpu/pipelines';

/** The shader locations of a format's attributes, in vertex order. */
function locations(format: number): number[] {
	const found: number[] = [];
	forEachVertexAttribute(format, ({ location }) => found.push(location));
	return found;
}

/** A float attribute of `size` floats at `location` and `offset`. */
const floats = (location: number, size: number, offset: number): VertexAttribute => ({
	location,
	type: VERTEX_TYPE_F32,
	size,
	offset,
	integer: false,
});

/** A format with each attribute at a location given the type beside it. */
function typed(...pairs: [location: number, type: number][]): number {
	return pairs.reduce((format, [location, type]) => {
		const field = typeField(location, type);
		if (field === undefined) throw new Error(`location ${location} takes no type ${type}`);
		const bit = [0, 0, VERTEX_UV0, VERTEX_UV1, VERTEX_TANGENT, VERTEX_COLOR, VERTEX_JOINTS];
		return format | (bit[location] ?? VERTEX_WEIGHTS) | field;
	}, 0);
}

describe('vertex formats', () => {
	test('a mesh with only the first texture coordinates offers them as the second set', () => {
		expect(vertexAttribute(VERTEX_UV0, 3)).toEqual(floats(3, 2, 24));
		expect(vertexAttribute(VERTEX_UV0 | VERTEX_UV1, 3)).toEqual(floats(3, 2, 32));
		expect(vertexAttribute(0, 3)).toBeUndefined();
		const offered: VertexAttribute[] = [];
		forEachFallbackAttribute(VERTEX_UV0 | VERTEX_COLOR, (a) => offered.push(a));
		expect(offered).toEqual([floats(3, 2, 24)]);
		forEachFallbackAttribute(VERTEX_ALL, (a) => offered.push(a));
		expect(offered).toHaveLength(1);
	});

	test('variants read the colors and tangents that their bits ask for', () => {
		expect(variantLocations([0, 1], 0)).toEqual([0, 1]);
		const both = PERMUTATION_VERTEX_COLOR | PERMUTATION_VERTEX_TANGENT;
		expect(variantLocations([0, 1, 2, 3], both)).toEqual([0, 1, 2, 3, 4, 5]);
	});

	test('the base format holds a position and a normal, three floats each', () => {
		expect(vertexStride(0)).toBe(24);
		expect(vertexAttribute(0, 0)).toEqual(floats(0, 3, 0));
		expect(vertexAttribute(0, 1)).toEqual(floats(1, 3, 12));
		expect(vertexAttribute(0, 2)).toBeUndefined();
		expect(locations(0)).toEqual([0, 1]);
	});

	test('each optional attribute follows the ones before it, at its own location', () => {
		// Floats, apart from the joints, whose default is four 8-bit integers in one word.
		expect(vertexStride(VERTEX_ALL)).toBe(92);
		expect(vertexAttribute(VERTEX_ALL, 2)).toEqual(floats(2, 2, 24));
		expect(vertexAttribute(VERTEX_ALL, 3)).toEqual(floats(3, 2, 32));
		expect(vertexAttribute(VERTEX_ALL, 4)).toEqual(floats(4, 4, 40));
		expect(vertexAttribute(VERTEX_ALL, 5)).toEqual(floats(5, 4, 56));
		expect(vertexAttribute(VERTEX_ALL, 6)).toEqual({
			location: 6,
			type: VERTEX_TYPE_UINT8,
			size: 4,
			offset: 72,
			integer: true,
		});
		expect(vertexAttribute(VERTEX_ALL, 7)).toEqual(floats(7, 4, 76));
		// Without the first texture coordinates, the second take their place.
		expect(vertexAttribute(VERTEX_UV1, 3)).toEqual(floats(3, 2, 24));
		expect(vertexAttribute(VERTEX_UV1, 2)).toBeUndefined();
		expect(vertexAttribute(VERTEX_TANGENT | VERTEX_COLOR, 5)).toEqual(floats(5, 4, 40));
		expect(vertexStride(VERTEX_UV0 | VERTEX_COLOR)).toBe(48);
		expect(locations(VERTEX_UV1 | VERTEX_COLOR)).toEqual([0, 1, 3, 5]);
	});

	test('integer attributes take whole words, and GPUs read their padding too', () => {
		const format = typed(
			[0, VERTEX_TYPE_UINT16],
			[1, VERTEX_TYPE_SNORM8],
			[2, VERTEX_TYPE_UINT8],
			[3, VERTEX_TYPE_SINT16],
			[5, VERTEX_TYPE_UNORM8],
			[6, VERTEX_TYPE_UINT16],
			[7, VERTEX_TYPE_UNORM16],
		);
		const placed: VertexAttribute[] = [];
		forEachVertexAttribute(format, (a) => placed.push(a));
		expect(placed.map((a) => [a.location, a.size, a.offset])).toEqual([
			[0, 4, 0],
			[1, 4, 8],
			[2, 4, 12],
			[3, 2, 16],
			[5, 4, 20],
			[6, 4, 24],
			[7, 4, 32],
		]);
		expect(vertexStride(format)).toBe(40);
		expect(placed.map(gpuVertexFormat)).toEqual([
			'unorm16x4',
			'snorm8x4',
			'unorm8x4',
			'snorm16x2',
			'unorm8x4',
			'uint16x4',
			'unorm16x4',
		]);
		// WebGPU reads plain integers that shaders take as floats as fractions, which the shader
		// scales back by the type's largest value. Joints stay whole numbers.
		expect(placed.map(plainScale)).toEqual([65535, 1, 255, 32767, 1, 1, 1]);
		expect(typeOf(format, 3)).toBe(VERTEX_TYPE_SINT16);
		expect(typeOf(format, 4)).toBeUndefined();
	});

	test('each attribute takes only glTF types for it', () => {
		expect(typeField(1, VERTEX_TYPE_UINT8)).toBeUndefined();
		expect(typeField(6, VERTEX_TYPE_F32)).toBeUndefined();
		expect(typeField(5, VERTEX_TYPE_SNORM8)).toBeUndefined();
		expect(typeField(0, VERTEX_TYPE_F32)).toBe(0);
		expect(typeField(6, VERTEX_TYPE_UINT8)).toBe(0);
	});

	test('in every format of floats, the last attribute ends at the stride', () => {
		for (let format = 0; format <= VERTEX_ALL; format++) {
			let end = 0;
			forEachVertexAttribute(format, ({ offset, size, type }) => {
				expect(offset).toBe(end);
				end = offset + size * (type === VERTEX_TYPE_F32 ? 4 : 1);
			});
			expect(end).toBe(vertexStride(format));
		}
	});
});
