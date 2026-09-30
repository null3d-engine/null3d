import { beforeEach, describe, expect, test } from 'bun:test';
import { type EngineError, setErrorFixes } from '../errors/engine-error';
import { ERROR_FIXES } from '../errors/fixes';
import {
	ARRAY_UVS,
	ARRAYS_PROBLEM_INDEX_OUT_OF_RANGE,
	ARRAYS_PROBLEM_NOT_FINITE,
	MESH_ARRAYS_COLORS,
	MESH_ARRAYS_COLORS_ALPHA,
	MESH_ARRAYS_COMPUTE_TANGENTS,
	MESH_ARRAYS_INDICES,
	MESH_ARRAYS_NORMALS,
	MESH_ARRAYS_UVS,
} from '../generated/core';
import type { CoreGlue } from '../shared/core';
import { CoreMemory } from './memory';
import { arraysProblem, meshFromArrays } from './mesh-arrays';
import type { MeshArrays } from './resources';

beforeEach(() => setErrorFixes(ERROR_FIXES));

const QUAD: MeshArrays = {
	positions: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0],
	normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
	indices: [0, 1, 2, 0, 2, 3],
};

describe('the shape checks of geometry.fromArrays', () => {
	test('accept whole vertices and triangles, with or without indices', () => {
		expect(arraysProblem(QUAD)).toBeUndefined();
		const colors = new Float32Array(16);
		expect(arraysProblem({ ...QUAD, uvs: new Float32Array(8), colors })).toBeUndefined();
		expect(arraysProblem({ ...QUAD, colors: new Float32Array(12) })).toBeUndefined();
		const soup = { positions: new Float32Array(9), computeNormals: true };
		expect(arraysProblem(soup)).toBeUndefined();
	});

	test('name the array or option at fault', () => {
		const cases: [MeshArrays, string][] = [
			[{ ...QUAD, positions: [] }, 'got no positions.'],
			[
				{ ...QUAD, positions: [0, 0, 0, 1] },
				'got 4 numbers in positions, which is not three per vertex.',
			],
			[{ ...QUAD, normals: [0, 0, 1] }, 'got 3 numbers in normals for 4 vertices, not 12.'],
			[{ ...QUAD, uvs: new Float32Array(6) }, 'got 6 numbers in uvs for 4 vertices, not 8.'],
			[{ ...QUAD, tangents: [1, 0, 0, 1] }, 'got 4 numbers in tangents for 4 vertices, not 16.'],
			[
				{ ...QUAD, colors: new Float32Array(10) },
				'got 10 numbers in colors for 4 vertices, not 12 or 16.',
			],
			[{ ...QUAD, indices: [0, 1, 2, 3] }, 'got 4 indices, which is not three per triangle.'],
			[
				{ ...QUAD, indices: undefined },
				'got 4 vertices and no indices, and without indices each three vertices make a triangle.',
			],
			[{ ...QUAD, computeNormals: true }, 'got normals and computeNormals: true both.'],
			[{ ...QUAD, normals: undefined }, 'got no normals and no computeNormals: true.'],
			[
				{ ...QUAD, tangents: new Float32Array(16), computeTangents: true },
				'got tangents and computeTangents: true both.',
			],
			[{ ...QUAD, computeTangents: true }, 'got computeTangents: true but no uvs.'],
		];
		for (const [arrays, problem] of cases) expect(arraysProblem(arrays)).toBe(problem);
	});
});

/** A core whose memory the arrays go into, and which records the mesh it is asked for. */
function fakeCore(failure?: { code: number; details: [number, number] }) {
	const memory = new WebAssembly.Memory({ initial: 1 });
	const asked: { words: number; vertices: number; indices: number; layout: number }[] = [];
	const glue = {
		meshArrays: (words: number) => {
			asked.push({ words, vertices: 0, indices: 0, layout: 0 });
			return 256;
		},
		createMeshFromArrays: (vertices: number, indices: number, layout: number) => {
			Object.assign(asked[asked.length - 1] as object, { vertices, indices, layout });
			return failure ? 0 : 7;
		},
		lastErrorCode: () => failure?.code ?? 0,
		lastErrorDetail: (index: number) => failure?.details[index] ?? 0,
	} as unknown as CoreGlue;
	return { core: new CoreMemory(glue, memory), memory, asked };
}

describe('meshes from arrays in engine memory', () => {
	test('go in one array after another, with a layout that names each one', () => {
		const { core, memory, asked } = fakeCore();
		const arrays: MeshArrays = {
			...QUAD,
			uvs: [0, 0, 1, 0, 1, 1, 0, 1],
			colors: new Float32Array(16).fill(0.5),
			computeTangents: true,
		};
		expect(meshFromArrays(core, arrays, 'geometry.fromArrays')).toBe(7);
		const layout =
			MESH_ARRAYS_NORMALS |
			MESH_ARRAYS_UVS |
			MESH_ARRAYS_COLORS |
			MESH_ARRAYS_COLORS_ALPHA |
			MESH_ARRAYS_INDICES |
			MESH_ARRAYS_COMPUTE_TANGENTS;
		expect(asked).toEqual([{ words: 12 + 12 + 8 + 16 + 6, vertices: 4, indices: 6, layout }]);
		const floats = new Float32Array(memory.buffer, 256, 48);
		expect(Array.from(floats.subarray(0, 12))).toEqual([...(QUAD.positions as number[])]);
		expect(Array.from(floats.subarray(24, 32))).toEqual([0, 0, 1, 0, 1, 1, 0, 1]);
		expect(floats[32]).toBe(0.5);
		expect(Array.from(new Uint32Array(memory.buffer, 256 + 48 * 4, 6))).toEqual([0, 1, 2, 0, 2, 3]);
	});

	test('that the core refuses name the value it found wrong', () => {
		const outside = fakeCore({ code: 1206, details: [ARRAYS_PROBLEM_INDEX_OUT_OF_RANGE, 4] });
		const indices = new Uint16Array([0, 1, 2, 0, 7, 3]);
		const refuse = (core: CoreMemory, arrays: MeshArrays) => {
			try {
				meshFromArrays(core, arrays, 'geometry.fromArrays');
			} catch (error) {
				return error as EngineError;
			}
			throw new Error('the mesh was built');
		};
		const index = refuse(outside.core, { ...QUAD, indices });
		expect(index.code).toBe('E1206');
		expect(index.message).toStartWith(
			'E1206: geometry.fromArrays() got the index 7 at indices[4], past the last of 4 vertices.',
		);
		const notFinite = fakeCore({
			code: 1206,
			details: [ARRAYS_PROBLEM_NOT_FINITE + ARRAY_UVS, 3],
		});
		const uvs = [0, 0, 1, Number.NaN, 1, 1, 0, 1];
		expect(refuse(notFinite.core, { ...QUAD, uvs }).message).toStartWith(
			'E1206: geometry.fromArrays() got NaN at uvs[3].',
		);
		const memoryFull = fakeCore({ code: 1109, details: [64 * 1024 * 1024, 0] });
		expect(refuse(memoryFull.core, QUAD).code).toBe('E1109');
	});
});
