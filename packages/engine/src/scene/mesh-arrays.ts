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
	ARRAYS_PROBLEM_POSED,
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
	MORPH_COLORS,
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
import type { CoreMemory, HeapConstructor } from './memory';
import type {
	IntegerArray,
	MeshArrays,
	MorphTargets,
	UpdatableAttribute,
	VertexValues,
} from './resources';

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
	type: HeapConstructor<IntegerArray> & { readonly name: string },
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
	['colors', MORPH_COLORS],
] as const;

type MorphList = (typeof MORPH_LISTS)[number][0];

/** The numbers per vertex of each color target that the core reads: red, green, blue and alpha. */
const CORE_COLOR_VALUES = 4;

/** The numbers per vertex of a mesh's colors, 3 or 4, or 0 for a mesh without colors. */
function colorValues(arrays: MeshArrays, vertices: number): number {
	return arrays.colors ? valuesOf(arrays.colors).array.length / vertices : 0;
}

/** The numbers per vertex of each array of morph target list `name`, as the arrays give them. */
function morphValues(name: MorphList, colors: number): number {
	return name === 'colors' ? colors : 3;
}

/** The number of morph targets that `targets` gives: the length of its first list, or 0. */
export function morphTargetCount(targets: MorphTargets | undefined): number {
	if (!targets) return 0;
	for (const [name] of MORPH_LISTS) {
		const list = targets[name];
		if (list) return list.length;
	}
	return 0;
}

/**
 * What is wrong with the shapes of a mesh's morph targets, or undefined when they fit it. `colors`
 * is the numbers per vertex of the mesh's colors, or 0 without colors.
 */
function morphProblem(targets: MorphTargets, vertices: number, colors: number): string | undefined {
	const count = morphTargetCount(targets);
	if (count === 0) return 'got morphTargets without any target.';
	if (count > MORPH_MAX_TARGETS)
		return `got ${count} morph targets; a mesh takes up to ${MORPH_MAX_TARGETS}.`;
	if (targets.colors && colors === 0)
		return "got morphTargets.colors but no colors; color targets move the mesh's own colors.";
	for (const [name] of MORPH_LISTS) {
		const list = targets[name];
		if (!list) continue;
		if (list.length !== count)
			return `got ${list.length} morph targets in ${name} and ${count} in another list; every list needs one array per target.`;
		const length = vertices * morphValues(name, colors);
		const at = list.findIndex((array) => array.length !== length);
		if (at >= 0)
			return `got ${list[at]?.length} numbers in morphTargets.${name}[${at}] for ${vertices} vertices, not ${length}.`;
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
	if (arrays.morphTargets)
		return morphProblem(arrays.morphTargets, vertices, colorValues(arrays, vertices));
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
	const colors = colorValues(arrays, vertices);
	if (colors === 4) layout |= MESH_ARRAYS_COLORS_ALPHA;
	if (indices) layout |= MESH_ARRAYS_INDICES;
	if (arrays.computeNormals) layout |= MESH_ARRAYS_COMPUTE_NORMALS;
	if (arrays.computeTangents) layout |= MESH_ARRAYS_COMPUTE_TANGENTS;
	const indexCount = indices?.length ?? 0;
	const targets = morphTargetCount(arrays.morphTargets);
	let morphBits = 0;
	let morphWords = 0;
	for (const [name, bit] of MORPH_LISTS) {
		if (!arrays.morphTargets?.[name]) continue;
		morphBits |= bit;
		morphWords += targets * vertices * (name === 'colors' ? CORE_COLOR_VALUES : 3);
	}
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
			if (name === 'colors' && colors !== CORE_COLOR_VALUES) {
				// Colors without alpha take an alpha delta of 0 in the core's four values per vertex.
				const out = core.f32(at, vertices * CORE_COLOR_VALUES);
				out.fill(0);
				for (let v = 0; v < vertices; v++)
					for (let c = 0; c < colors; c++)
						out[v * CORE_COLOR_VALUES + c] = array[v * colors + c] as number;
				at += out.length * 4;
				continue;
			}
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
		const vertices = valuesOf(arrays.positions).array.length / 3;
		// The core's place counts its own values per vertex; the arrays may hold fewer.
		const stored = name === 'colors' ? CORE_COLOR_VALUES : 3;
		const given = morphValues(name, colorValues(arrays, vertices));
		const value = (at & 0xfffffff) % (vertices * stored);
		const target = Math.floor((at & 0xfffffff) / (vertices * stored));
		const place = Math.floor(value / stored) * given + (value % stored);
		const found = arrays.morphTargets?.[name]?.[target]?.[place];
		return new EngineError(
			'E1206',
			`${call}() got ${found} at morphTargets.${name}[${target}][${place}].`,
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

/** The last vertex shader location whose attribute takes updates: the colors. */
const LAST_UPDATABLE = 5;

/** The format bits of the attributes that make a mesh refuse updates: joints and morph targets. */
const POSED_BITS = (VERTEX_ATTRIBUTES[6]?.[0] ?? 0) | (VERTEX_ATTRIBUTES[8]?.[0] ?? 0);

/** A mesh's vertex count and vertex format, as updates of its vertices read them. */
export interface VertexLayout {
	readonly count: number;
	readonly format: number;
}

/** The typed array class that holds values of a vertex type, as `INTEGER_ARRAYS` names them. */
function arrayClass(type: number): HeapConstructor<Float32Array | IntegerArray> {
	if (type === VERTEX_TYPE_F32) return Float32Array;
	const integer = INTEGER_ARRAYS.find(([, n, p]) => n === type || p === type);
	if (!integer) throw new Error(`no typed array holds vertex type ${type}`);
	return integer[0];
}

/**
 * What is wrong with an update of attribute `name` of a mesh, or undefined when it fits. Returns
 * the attribute's spec, type and values per vertex in `out`.
 */
function updateProblem(
	layout: VertexLayout,
	name: UpdatableAttribute,
	values: Float32Array | IntegerArray | readonly number[],
	start: number,
	count: number,
	out: { spec?: ArraySpec; type: number; components: number },
): string | undefined {
	const spec = ARRAYS.find((array) => array.name === name);
	if (!spec || spec.location > LAST_UPDATABLE)
		return `got ${String(name)}; updates take positions, normals, uvs, uvs1, colors or tangents.`;
	if (layout.format & POSED_BITS)
		return 'got a mesh with joints or morph targets, whose vertices take no updates.';
	const [bit = 0, , shift = 0, types = []] = VERTEX_ATTRIBUTES[spec.location] ?? [];
	if (bit !== 0 && (layout.format & bit) === 0) return `got ${name} for a mesh without ${name}.`;
	const width = 32 - Math.clz32(Math.max(types.length - 1, 0));
	const type = types[(layout.format >>> shift) & ((1 << width) - 1)] ?? VERTEX_TYPE_F32;
	const kind = arrayClass(type);
	const fits = Array.isArray(values) ? type === VERTEX_TYPE_F32 : values instanceof kind;
	if (!fits)
		return `got ${name} in ${withArticle(className(values))}; the mesh keeps its ${name} in ${withArticle(kind.name)}${type === VERTEX_TYPE_F32 ? ' or a plain array' : ''}.`;
	const vertices = layout.count;
	let components = spec.perVertex;
	if (components === 0) components = values.length === vertices * 3 ? 3 : 4;
	if (values.length !== vertices * components)
		return spec.perVertex === 0
			? `got ${values.length} numbers in ${name} for ${vertices} vertices, not ${vertices * 3} or ${vertices * 4}.`
			: `got ${values.length} numbers in ${name} for ${vertices} vertices, not ${vertices * components}.`;
	if (!Number.isInteger(start) || !Number.isInteger(count) || start < 0 || count < 0)
		return `got start ${start} and count ${count}; both take whole numbers of 0 or more.`;
	if (start + count > vertices)
		return `got vertices ${start} to ${start + count - 1}, past the last of ${vertices} vertices.`;
	out.spec = spec;
	out.type = type;
	out.components = components;
	return undefined;
}

/** What `updateProblem` found out about a fitting update, kept from call to call. */
const fitting: { spec?: ArraySpec; type: number; components: number } = {
	type: 0,
	components: 0,
};

/**
 * Writes new values of attribute `name` into vertices `start` to `start + count` of the mesh with
 * id `id` and layout `layout`. `values` holds the attribute's values of every vertex, as
 * `geometry.fromArrays` takes them, and the update copies those of the vertices it names. Throws
 * E1206 for an update that does not fit the mesh, which then keeps its vertices. Allocates nothing
 * unless the engine's memory grows.
 */
export function updateVertices(
	core: CoreMemory,
	id: number,
	layout: VertexLayout,
	name: UpdatableAttribute,
	values: Float32Array | IntegerArray | readonly number[],
	start: number,
	count: number,
	call: string,
): void {
	const problem = updateProblem(layout, name, values, start, count, fitting);
	if (problem) throw new EngineError('E1206', `${call}() ${problem}`);
	const { spec, type, components } = fitting;
	if (!spec || count === 0) return;
	const kind = arrayClass(type);
	const length = count * components;
	const words = Math.ceil((length * kind.BYTES_PER_ELEMENT) / 4);
	const address = core.checkGrowth(core.glue.meshArrays(words), call);
	const heap = core.heap(kind);
	const at = address / kind.BYTES_PER_ELEMENT;
	const from = start * components;
	if (from === 0 && length === values.length && !Array.isArray(values))
		heap.set(values as ArrayLike<number>, at);
	else for (let k = 0; k < length; k++) heap[at + k] = values[from + k] as number;
	const status = core.glue.updateVertices(id, spec.location, components, start, count);
	if (status === 0) return;
	const { glue } = core;
	if (glue.lastErrorCode() !== BAD_ARRAYS) throw coreFailure(glue, call);
	const found = glue.lastErrorDetail(0);
	if (found === ARRAYS_PROBLEM_POSED)
		throw new EngineError(
			'E1206',
			`${call}() got a mesh with joints or morph targets, whose vertices take no updates.`,
		);
	if (found === ARRAYS_PROBLEM_NOT_FINITE) {
		const place = from + glue.lastErrorDetail(1);
		throw new EngineError('E1206', `${call}() got ${values[place]} at ${name}[${place}].`);
	}
	throw new EngineError('E1206', `${call}() got values that do not fit the mesh.`);
}
