// Meshes from arrays: the checks of `geometry.fromArrays`, and the copy of its arrays into engine
// memory, where the engine core checks their values, computes normals and tangents, and builds the
// mesh. The arrays go in one after another, in the order that the core reads them.

import { coreFailure } from '../errors/core-failure';
import { EngineError } from '../errors/engine-error';
import {
	ARRAYS_PROBLEM_INDEX_OUT_OF_RANGE,
	ARRAYS_PROBLEM_NOT_FINITE,
	MESH_ARRAYS_COLORS,
	MESH_ARRAYS_COLORS_ALPHA,
	MESH_ARRAYS_COMPUTE_NORMALS,
	MESH_ARRAYS_COMPUTE_TANGENTS,
	MESH_ARRAYS_INDICES,
	MESH_ARRAYS_NORMALS,
	MESH_ARRAYS_TANGENTS,
	MESH_ARRAYS_UVS,
	MESH_ARRAYS_UVS1,
} from '../generated/core';
import type { CoreMemory } from './memory';
import type { MeshArrays } from './resources';

/** The code of an E1206 failure that the engine core reports. */
const BAD_ARRAYS = 1206;

type FloatArrayName = 'positions' | 'normals' | 'uvs' | 'uvs1' | 'colors' | 'tangents';

/** The arrays of floats in the order that the core reads them, which is also the order of its array codes, with their layout bits. */
const FLOAT_ARRAYS: readonly [FloatArrayName, number][] = [
	['positions', 0],
	['normals', MESH_ARRAYS_NORMALS],
	['uvs', MESH_ARRAYS_UVS],
	['uvs1', MESH_ARRAYS_UVS1],
	['colors', MESH_ARRAYS_COLORS],
	['tangents', MESH_ARRAYS_TANGENTS],
];

/** Numbers per vertex of the arrays whose size never changes. */
const PER_VERTEX: Readonly<Record<Exclude<FloatArrayName, 'colors'>, number>> = {
	positions: 3,
	normals: 3,
	uvs: 2,
	uvs1: 2,
	tangents: 4,
};

/** What is wrong with the shapes of a mesh's arrays, or undefined when they make a mesh. */
export function arraysProblem(arrays: MeshArrays): string | undefined {
	const { positions, normals, uvs, colors, tangents, indices } = arrays;
	const { computeNormals = false, computeTangents = false } = arrays;
	if (!positions || positions.length === 0) return 'got no positions.';
	if (positions.length % 3 !== 0)
		return `got ${positions.length} numbers in positions, which is not three per vertex.`;
	const vertices = positions.length / 3;
	for (const [name, per] of Object.entries(PER_VERTEX)) {
		const array = arrays[name as keyof typeof PER_VERTEX];
		if (array && array.length !== vertices * per)
			return `got ${array.length} numbers in ${name} for ${vertices} vertices, not ${vertices * per}.`;
	}
	if (colors && colors.length !== vertices * 3 && colors.length !== vertices * 4)
		return `got ${colors.length} numbers in colors for ${vertices} vertices, not ${vertices * 3} or ${vertices * 4}.`;
	if (indices && indices.length % 3 !== 0)
		return `got ${indices.length} indices, which is not three per triangle.`;
	if (!indices && vertices % 3 !== 0)
		return `got ${vertices} vertices and no indices, and without indices each three vertices make a triangle.`;
	if (normals && computeNormals) return 'got normals and computeNormals: true both.';
	if (!normals && !computeNormals) return 'got no normals and no computeNormals: true.';
	if (tangents && computeTangents) return 'got tangents and computeTangents: true both.';
	if (computeTangents && !uvs) return 'got computeTangents: true but no uvs.';
	return undefined;
}

/**
 * Builds a mesh from checked arrays in the engine core, and returns its id. The arrays go into
 * engine memory: the floats one array after another, then the indices.
 */
export function meshFromArrays(core: CoreMemory, arrays: MeshArrays, call: string): number {
	const vertices = arrays.positions.length / 3;
	const indices = arrays.indices;
	let layout = 0;
	let floats = 0;
	for (const [name, bit] of FLOAT_ARRAYS) {
		const array = arrays[name];
		if (!array) continue;
		layout |= bit;
		floats += array.length;
	}
	if (arrays.colors?.length === vertices * 4) layout |= MESH_ARRAYS_COLORS_ALPHA;
	if (indices) layout |= MESH_ARRAYS_INDICES;
	if (arrays.computeNormals) layout |= MESH_ARRAYS_COMPUTE_NORMALS;
	if (arrays.computeTangents) layout |= MESH_ARRAYS_COMPUTE_TANGENTS;
	const indexCount = indices?.length ?? 0;
	const address = core.check(core.glue.meshArrays(floats + indexCount), call);
	const words = core.f32(address, floats);
	let at = 0;
	for (const [name] of FLOAT_ARRAYS) {
		const array = arrays[name];
		if (!array) continue;
		words.set(array, at);
		at += array.length;
	}
	if (indices) core.u32(address + floats * 4, indexCount).set(indices);
	const id = core.glue.createMeshFromArrays(vertices, indexCount, layout);
	if (id === 0) throw arraysFailure(core, arrays, call);
	return id;
}

/** The error of a mesh that the engine core refused, naming the value it found wrong. */
function arraysFailure(core: CoreMemory, arrays: MeshArrays, call: string): EngineError {
	const { glue } = core;
	if (glue.lastErrorCode() !== BAD_ARRAYS) return coreFailure(glue, call);
	const problem = glue.lastErrorDetail(0);
	const at = glue.lastErrorDetail(1);
	if (problem === ARRAYS_PROBLEM_INDEX_OUT_OF_RANGE) {
		const index = arrays.indices?.[at];
		const vertices = arrays.positions.length / 3;
		return new EngineError(
			'E1206',
			`${call}() got the index ${index} at indices[${at}], past the last of ${vertices} vertices.`,
		);
	}
	// A value that is not a finite number: its array's code follows the problem's.
	const name = FLOAT_ARRAYS[problem - ARRAYS_PROBLEM_NOT_FINITE]?.[0];
	if (name)
		return new EngineError('E1206', `${call}() got ${arrays[name]?.[at]} at ${name}[${at}].`);
	return new EngineError('E1206', `${call}() got arrays that do not make whole vertices.`);
}
