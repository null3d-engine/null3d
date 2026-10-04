// Meshes from arrays: the checks of `geometry.fromArrays`, and the copy of its arrays into engine
// memory, where the engine core checks their values, computes normals and tangents, and builds the
// mesh. The arrays go in one after another, each from a whole 32-bit word, in the order that the
// core reads them. Each keeps its type of number, floats or the integers that glTF allows for its
// attribute, which the mesh's vertices then hold.

import { coreFailure } from '../errors/core-failure';
import { EngineError } from '../errors/engine-error';
import {
	ARRAY_COLORS,
	ARRAY_JOINTS,
	ARRAY_NORMALS,
	ARRAY_POSITIONS,
	ARRAY_TANGENTS,
	ARRAY_UVS,
	ARRAY_UVS1,
	ARRAY_WEIGHTS,
	ARRAYS_PROBLEM_INDEX_OUT_OF_RANGE,
	ARRAYS_PROBLEM_MORPH_LENGTH,
	ARRAYS_PROBLEM_MORPH_NOT_FINITE,
	ARRAYS_PROBLEM_MORPH_TOO_LARGE,
	ARRAYS_PROBLEM_NOT_FINITE,
	MESH_ARRAYS_COLORS,
	MESH_ARRAYS_COLORS_ALPHA,
	MESH_ARRAYS_COMPUTE_NORMALS,
	MESH_ARRAYS_COMPUTE_TANGENTS,
	MESH_ARRAYS_INDICES,
	MESH_ARRAYS_JOINTS,
	MESH_ARRAYS_NORMALS,
	MESH_ARRAYS_TANGENTS,
	MESH_ARRAYS_UVS,
	MESH_ARRAYS_UVS1,
	MESH_ARRAYS_WEIGHTS,
	MORPH_DELTA_BYTES,
	MORPH_MAX_TARGETS,
	MORPH_NORMALS,
	MORPH_POSITIONS,
	MORPH_TANGENTS,
} from '../generated/core';
import {
	VERTEX_ATTRIBUTES,
	VERTEX_TYPE_F32,
	VERTEX_TYPE_SINT8,
	VERTEX_TYPE_SINT16,
	VERTEX_TYPE_SNORM8,
	VERTEX_TYPE_SNORM16,
	VERTEX_TYPE_UINT8,
	VERTEX_TYPE_UINT16,
	VERTEX_TYPE_UNORM8,
	VERTEX_TYPE_UNORM16,
	VERTEX_TYPES,
} from '../generated/gpu';
import type { CoreMemory, ViewConstructor } from './memory';
import type { IntegerArray, MeshArrays, MorphTargets, VertexValues } from './resources';

/**
 * The bits that give the attribute at `location` the type `type` in a vertex format, or undefined
 * when the attribute takes no such type.
 */
export function typeField(location: number, type: number): number | undefined {
	const [, , shift, types] = VERTEX_ATTRIBUTES[location] ?? [];
	const place = types?.indexOf(type) ?? -1;
	return place < 0 || shift === undefined ? undefined : place << shift;
}

/** The code of an E1206 failure that the engine core reports. */
const BAD_ARRAYS = 1206;

type ArrayName =
	| 'positions'
	| 'normals'
	| 'uvs'
	| 'uvs1'
	| 'colors'
	| 'tangents'
	| 'joints'
	| 'weights';

/** How an attribute reads integers: as fractions, as whole numbers, or as its array says. */
type Reading = 'normalized' | 'plain' | 'either';

/** One array of a mesh, as the core reads it. */
interface ArraySpec {
	name: ArrayName;
	/** The array's code in the core's error details. */
	code: number;
	/** Its layout bit, or 0 for the positions, which every mesh has. */
	bit: number;
	/** The vertex shader location of its attribute. */
	location: number;
	/** Its numbers per vertex, or 0 for colors, which take three or four. */
	perVertex: number;
	reading: Reading;
}

/** The arrays in the order that the core reads them. */
const ARRAYS: readonly ArraySpec[] = [
	{
		name: 'positions',
		code: ARRAY_POSITIONS,
		bit: 0,
		location: 0,
		perVertex: 3,
		reading: 'either',
	},
	{
		name: 'normals',
		code: ARRAY_NORMALS,
		bit: MESH_ARRAYS_NORMALS,
		location: 1,
		perVertex: 3,
		reading: 'normalized',
	},
	{
		name: 'uvs',
		code: ARRAY_UVS,
		bit: MESH_ARRAYS_UVS,
		location: 2,
		perVertex: 2,
		reading: 'either',
	},
	{
		name: 'uvs1',
		code: ARRAY_UVS1,
		bit: MESH_ARRAYS_UVS1,
		location: 3,
		perVertex: 2,
		reading: 'either',
	},
	{
		name: 'colors',
		code: ARRAY_COLORS,
		bit: MESH_ARRAYS_COLORS,
		location: 5,
		perVertex: 0,
		reading: 'normalized',
	},
	{
		name: 'tangents',
		code: ARRAY_TANGENTS,
		bit: MESH_ARRAYS_TANGENTS,
		location: 4,
		perVertex: 4,
		reading: 'normalized',
	},
	{
		name: 'joints',
		code: ARRAY_JOINTS,
		bit: MESH_ARRAYS_JOINTS,
		location: 6,
		perVertex: 4,
		reading: 'plain',
	},
	{
		name: 'weights',
		code: ARRAY_WEIGHTS,
		bit: MESH_ARRAYS_WEIGHTS,
		location: 7,
		perVertex: 4,
		reading: 'normalized',
	},
];

/** The largest joint index that a plain array may hold: 16-bit. */
const MAX_JOINT = 0xffff;

/** Each integer typed array's name, with its types when normalized and when plain. */
const INTEGER_ARRAYS: readonly [
	type: ViewConstructor<IntegerArray> & { readonly name: string },
	normalized: number,
	plain: number,
][] = [
	[Int8Array, VERTEX_TYPE_SNORM8, VERTEX_TYPE_SINT8],
	[Uint8Array, VERTEX_TYPE_UNORM8, VERTEX_TYPE_UINT8],
	[Int16Array, VERTEX_TYPE_SNORM16, VERTEX_TYPE_SINT16],
	[Uint16Array, VERTEX_TYPE_UNORM16, VERTEX_TYPE_UINT16],
];

/** One array's numbers and how its integers read, after `VertexArray`'s fields are taken apart. */
interface Values {
	array: Float32Array | IntegerArray | readonly number[];
	/** The `normalized` that the array came with, if any. */
	normalized: boolean | undefined;
}

function valuesOf(values: VertexValues): Values {
	if (ArrayBuffer.isView(values) || Array.isArray(values))
		return { array: values as Values['array'], normalized: undefined };
	const { array, normalized } = values as { array: Values['array']; normalized?: boolean };
	return { array, normalized };
}

/** The name of the class of an array, such as `Uint16Array`, or `array` for a plain one. */
function className(array: unknown): string {
	return Array.isArray(array) ? 'array' : ((array as object)?.constructor?.name ?? typeof array);
}

/** A class name after "a" or "an", as it sounds: an Int8Array, a Uint8Array, an array. */
function withArticle(name: string): string {
	return `${/^(?:I|a)/.test(name) ? 'an' : 'a'} ${name}`;
}

/** The typed arrays that an attribute takes, as messages list them. */
function takenArrays(spec: ArraySpec): string {
	const types = VERTEX_ATTRIBUTES[spec.location]?.[3] ?? [];
	const names: string[] = [];
	for (const type of types) {
		const name =
			type === VERTEX_TYPE_F32
				? 'Float32Array'
				: INTEGER_ARRAYS.find(([, n, p]) => n === type || p === type)?.[0].name;
		if (name && !names.includes(name)) names.push(name);
	}
	const listed = names.map(withArticle);
	return `${listed.slice(0, -1).join(', ')} or ${listed.at(-1)}`;
}

/**
 * The vertex type of an array, or a problem: an array that its attribute does not take, or a
 * `normalized` that its attribute's integers cannot follow.
 */
function typeOfArray(spec: ArraySpec, values: Values): number | string {
	const { array, normalized } = values;
	const name = spec.name;
	if (Array.isArray(array)) return name === 'joints' ? VERTEX_TYPE_UINT16 : VERTEX_TYPE_F32;
	if (array instanceof Float32Array) {
		if (normalized)
			return `got normalized: true for ${name} in a Float32Array; only integers can be normalized.`;
		return VERTEX_TYPE_F32;
	}
	const integer = INTEGER_ARRAYS.find(([type]) => array instanceof type);
	if (integer) {
		const reads = spec.reading === 'either' ? (normalized ?? false) : spec.reading === 'normalized';
		if (normalized !== undefined && normalized !== reads)
			return `got normalized: ${normalized} for ${name}, whose integers always read as ${reads ? 'fractions' : 'whole numbers'}.`;
		const type = reads ? integer[1] : integer[2];
		if (typeField(spec.location, type) !== undefined) return type;
	}
	return `got ${name} in ${withArticle(className(array))}; ${name} take ${takenArrays(spec)}, or a plain array of numbers.`;
}

/** The vertex type of each array that a mesh's arrays give, by its place in `ARRAYS`. */
function arrayTypes(arrays: MeshArrays): (number | string | undefined)[] {
	return ARRAYS.map((spec) => {
		const given = arrays[spec.name];
		return given === undefined ? undefined : typeOfArray(spec, valuesOf(given));
	});
}

/** The morph target lists in the order that the core reads them, with their bits. */
const MORPH_LISTS = [
	['positions', MORPH_POSITIONS],
	['normals', MORPH_NORMALS],
	['tangents', MORPH_TANGENTS],
] as const;

/** The number of morph targets that `targets` gives: the length of its first list, or 0. */
export function morphTargetCount(targets: MorphTargets | undefined): number {
	if (!targets) return 0;
	for (const [name] of MORPH_LISTS) {
		const list = targets[name];
		if (list) return list.length;
	}
	return 0;
}

/** What is wrong with the shapes of a mesh's morph targets, or undefined when they fit it. */
function morphProblem(targets: MorphTargets, vertices: number): string | undefined {
	const count = morphTargetCount(targets);
	if (count === 0) return 'got morphTargets without any target.';
	if (count > MORPH_MAX_TARGETS)
		return `got ${count} morph targets; a mesh takes up to ${MORPH_MAX_TARGETS}.`;
	for (const [name] of MORPH_LISTS) {
		const list = targets[name];
		if (!list) continue;
		if (list.length !== count)
			return `got ${list.length} morph targets in ${name} and ${count} in another list; every list needs one array per target.`;
		const at = list.findIndex((array) => array.length !== vertices * 3);
		if (at >= 0)
			return `got ${list[at]?.length} numbers in morphTargets.${name}[${at}] for ${vertices} vertices, not ${vertices * 3}.`;
	}
	if (targets.names && targets.names.length !== count)
		return `got ${targets.names.length} morph target names for ${count} targets.`;
	return undefined;
}

/** What is wrong with the shapes of a mesh's arrays, or undefined when they make a mesh. */
export function arraysProblem(arrays: MeshArrays): string | undefined {
	const { indices, computeNormals = false, computeTangents = false } = arrays;
	if (!arrays.positions) return 'got no positions.';
	const positions = valuesOf(arrays.positions).array;
	if (positions.length === 0) return 'got no positions.';
	if (positions.length % 3 !== 0)
		return `got ${positions.length} numbers in positions, which is not three per vertex.`;
	const vertices = positions.length / 3;
	const types = arrayTypes(arrays);
	for (const [k, spec] of ARRAYS.entries()) {
		const given = arrays[spec.name];
		if (given === undefined) continue;
		const type = types[k];
		if (typeof type === 'string') return type;
		const { array } = valuesOf(given);
		const length = array.length;
		if (spec.perVertex === 0) {
			if (length !== vertices * 3 && length !== vertices * 4)
				return `got ${length} numbers in ${spec.name} for ${vertices} vertices, not ${vertices * 3} or ${vertices * 4}.`;
		} else if (length !== vertices * spec.perVertex)
			return `got ${length} numbers in ${spec.name} for ${vertices} vertices, not ${vertices * spec.perVertex}.`;
		if (spec.name === 'joints' && Array.isArray(array)) {
			const at = array.findIndex((j) => !Number.isInteger(j) || j < 0 || j > MAX_JOINT);
			if (at >= 0)
				return `got ${array[at]} at joints[${at}], which is not a whole number from 0 to ${MAX_JOINT}.`;
		}
	}
	if (indices && indices.length % 3 !== 0)
		return `got ${indices.length} indices, which is not three per triangle.`;
	if (!indices && vertices % 3 !== 0)
		return `got ${vertices} vertices and no indices, and without indices each three vertices make a triangle.`;
	if (arrays.normals && computeNormals) return 'got normals and computeNormals: true both.';
	if (!arrays.normals && !computeNormals) return 'got no normals and no computeNormals: true.';
	if (arrays.tangents && computeTangents) return 'got tangents and computeTangents: true both.';
	if (computeTangents && !arrays.uvs) return 'got computeTangents: true but no uvs.';
	if (arrays.joints && !arrays.weights) return 'got joints but no weights.';
	if (arrays.weights && !arrays.joints) return 'got weights but no joints.';
	if (arrays.morphTargets) return morphProblem(arrays.morphTargets, vertices);
	return undefined;
}

/** The bytes that `length` values of a vertex type take in engine memory: whole words. */
function wordBytes(type: number, length: number): number {
	return Math.ceil((length * (VERTEX_TYPES[type]?.[0] ?? 4)) / 4) * 4;
}

/** The typed array of engine memory that holds `length` values of a vertex type from `address`. */
function memoryOf(core: CoreMemory, type: number, address: number, length: number) {
	if (type === VERTEX_TYPE_F32) return core.view(Float32Array, address, length);
	const integer = INTEGER_ARRAYS.find(([, n, p]) => n === type || p === type);
	if (!integer) throw new Error(`no typed array holds vertex type ${type}`);
	return core.view(integer[0], address, length);
}

/**
 * Builds a mesh from checked arrays in the engine core, and returns its id. The arrays go into
 * engine memory one after another, each from a whole word, then the indices.
 */
export function meshFromArrays(core: CoreMemory, arrays: MeshArrays, call: string): number {
	const vertices = valuesOf(arrays.positions).array.length / 3;
	const indices = arrays.indices;
	const types = arrayTypes(arrays) as (number | undefined)[];
	let layout = 0;
	let typeFields = 0;
	let words = 0;
	for (const [k, spec] of ARRAYS.entries()) {
		const given = arrays[spec.name];
		const type = types[k];
		if (given === undefined || type === undefined) continue;
		layout |= spec.bit;
		typeFields |= typeField(spec.location, type) ?? 0;
		words += wordBytes(type, valuesOf(given).array.length) / 4;
	}
	if (valuesOf(arrays.colors ?? []).array.length === vertices * 4)
		layout |= MESH_ARRAYS_COLORS_ALPHA;
	if (indices) layout |= MESH_ARRAYS_INDICES;
	if (arrays.computeNormals) layout |= MESH_ARRAYS_COMPUTE_NORMALS;
	if (arrays.computeTangents) layout |= MESH_ARRAYS_COMPUTE_TANGENTS;
	const indexCount = indices?.length ?? 0;
	const targets = morphTargetCount(arrays.morphTargets);
	let morphBits = 0;
	for (const [name, bit] of MORPH_LISTS) if (arrays.morphTargets?.[name]) morphBits |= bit;
	const morphWords = targets * vertices * 3 * bitCount(morphBits);
	const address = core.checkGrowth(core.glue.meshArrays(words + indexCount + morphWords), call);
	let at = address;
	for (const [k, spec] of ARRAYS.entries()) {
		const given = arrays[spec.name];
		const type = types[k];
		if (given === undefined || type === undefined) continue;
		const { array } = valuesOf(given);
		memoryOf(core, type, at, array.length).set(array);
		at += wordBytes(type, array.length);
	}
	if (indices) core.u32(at, indexCount).set(indices);
	at += indexCount * 4;
	for (const [name] of MORPH_LISTS)
		for (const array of arrays.morphTargets?.[name] ?? []) {
			core.f32(at, array.length).set(array);
			at += array.length * 4;
		}
	const id = core.glue.createMeshFromArrays(
		vertices,
		indexCount,
		layout,
		typeFields,
		targets,
		morphBits,
	);
	if (id === 0) throw arraysFailure(core, arrays, call);
	return id;
}

/** The number of bits set in `bits`. */
function bitCount(bits: number): number {
	let count = 0;
	for (let rest = bits; rest !== 0; rest &= rest - 1) count++;
	return count;
}

/** The error of a mesh that the engine core refused, naming the value it found wrong. */
function arraysFailure(core: CoreMemory, arrays: MeshArrays, call: string): EngineError {
	const { glue } = core;
	if (glue.lastErrorCode() !== BAD_ARRAYS) return coreFailure(glue, call);
	const problem = glue.lastErrorDetail(0);
	const at = glue.lastErrorDetail(1);
	if (problem === ARRAYS_PROBLEM_MORPH_TOO_LARGE) {
		const mib = ((at * MORPH_DELTA_BYTES) / 2 ** 20).toLocaleString('en-US', {
			maximumFractionDigits: 1,
		});
		return new EngineError(
			'E1206',
			`${call}() got morph targets that move a vertex more than 255 times, or that would pass the ${at.toLocaleString('en-US')} delta texels (${mib} MiB) that the engine holds for every mesh's targets together.`,
		);
	}
	if (problem === ARRAYS_PROBLEM_MORPH_NOT_FINITE) {
		const [name] = MORPH_LISTS[at >>> 28] ?? MORPH_LISTS[0];
		const place = at & 0xfffffff;
		const vertices = valuesOf(arrays.positions).array.length / 3;
		const target = Math.floor(place / (vertices * 3));
		const value = arrays.morphTargets?.[name]?.[target]?.[place % (vertices * 3)];
		return new EngineError(
			'E1206',
			`${call}() got ${value} at morphTargets.${name}[${target}][${place % (vertices * 3)}].`,
		);
	}
	if (problem === ARRAYS_PROBLEM_MORPH_LENGTH)
		return new EngineError('E1206', `${call}() got morph targets that do not fit its vertices.`);
	if (problem === ARRAYS_PROBLEM_INDEX_OUT_OF_RANGE) {
		const index = arrays.indices?.[at];
		const vertices = valuesOf(arrays.positions).array.length / 3;
		return new EngineError(
			'E1206',
			`${call}() got the index ${index} at indices[${at}], past the last of ${vertices} vertices.`,
		);
	}
	// A value that is not a finite number: its array's code follows the problem's.
	const spec = ARRAYS.find(({ code }) => code === problem - ARRAYS_PROBLEM_NOT_FINITE);
	const given = spec && arrays[spec.name];
	if (spec && given)
		return new EngineError(
			'E1206',
			`${call}() got ${valuesOf(given).array[at]} at ${spec.name}[${at}].`,
		);
	return new EngineError('E1206', `${call}() got arrays that do not make whole vertices.`);
}
