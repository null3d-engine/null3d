// The layout of a vertex format, from the attribute table that the engine core shares: every
// vertex holds a position and a normal, then each optional attribute that its format has, in the
// table's order. Each attribute has the type that its field in the format names, and takes whole
// 4-byte words. Both GPU backends place a mesh's attributes with it. A mesh without second texture
// coordinates offers its first set in their place, so shaders that read the second set draw it.

import {
	PERMUTATION_SKIN,
	PERMUTATION_VERTEX_COLOR,
	PERMUTATION_VERTEX_TANGENT,
	VERTEX_ATTRIBUTES,
	VERTEX_COLOR,
	VERTEX_JOINTS,
	VERTEX_TANGENT,
	VERTEX_TYPES,
	VERTEX_UV0,
	VERTEX_UV1,
	VERTEX_WEIGHTS,
} from '../generated/gpu';

/** The bytes per value, the largest value and whether it reads as fractions, of a vertex type. */
function typeInfo(type: number): readonly [bytes: number, max: number, normalized: boolean] {
	const info = VERTEX_TYPES[type];
	if (!info) throw new Error(`no vertex type has the code ${type}`);
	return info;
}

/** One attribute of a vertex format: where it sits in a vertex, and how GPUs read it. */
export interface VertexAttribute {
	/** The vertex shader location that reads it. */
	readonly location: number;
	/** Its type: a `VERTEX_TYPE_*` code. */
	readonly type: number;
	/** The values that GPUs read from it: its components, and the padding that fills its last word. */
	readonly size: number;
	/** Its first byte in the vertex. */
	readonly offset: number;
	/** True when shaders read it as whole numbers, false when they read floats. */
	readonly integer: boolean;
}

/** The type of the attribute at `location` in a format, or undefined when the format lacks it. */
export function typeOf(format: number, location: number): number | undefined {
	const [bit, , shift, types] = VERTEX_ATTRIBUTES[location] ?? [];
	if (bit === undefined || shift === undefined || !types) return undefined;
	if ((format & bit) !== bit) return undefined;
	const width = Math.max(1, Math.ceil(Math.log2(types.length)));
	return types[(format >>> shift) & ((1 << width) - 1)];
}

/** Calls `visit` with each attribute that a vertex format has, in vertex order. */
export function forEachVertexAttribute(
	format: number,
	visit: (attribute: VertexAttribute) => void,
): void {
	let offset = 0;
	VERTEX_ATTRIBUTES.forEach(([, components, , , integer], location) => {
		const type = typeOf(format, location);
		if (type === undefined) return;
		const [bytes] = typeInfo(type);
		const slot = Math.ceil((components * bytes) / 4) * 4;
		visit({ location, type, size: slot / bytes, offset, integer });
		offset += slot;
	});
}

/** The vertex shader location of the optional attribute with this format bit. */
export function locationOfAttribute(bit: number): number {
	const location = VERTEX_ATTRIBUTES.findIndex(([attribute]) => attribute === bit);
	if (location < 0) throw new Error(`no vertex attribute has the format bit ${bit}`);
	return location;
}

/** The shader location of the second texture coordinates. */
const UV1_LOCATION = locationOfAttribute(VERTEX_UV1);

/**
 * The locations that a shader variant reads besides its template's: the mesh's colors in the
 * vertex color variants, and its tangents in the tangent variants.
 */
export function variantLocations(template: readonly number[], permutation: number): number[] {
	const locations = [...template];
	if (permutation & PERMUTATION_VERTEX_TANGENT) locations.push(locationOfAttribute(VERTEX_TANGENT));
	if (permutation & PERMUTATION_VERTEX_COLOR) locations.push(locationOfAttribute(VERTEX_COLOR));
	if (permutation & PERMUTATION_SKIN)
		locations.push(locationOfAttribute(VERTEX_JOINTS), locationOfAttribute(VERTEX_WEIGHTS));
	return locations;
}

/**
 * Calls `visit` with each attribute that a vertex format offers in place of one it lacks: the
 * second texture coordinates, from the first set, on a mesh with only the first.
 */
export function forEachFallbackAttribute(
	format: number,
	visit: (attribute: VertexAttribute) => void,
): void {
	if ((format & VERTEX_UV0) === 0 || (format & VERTEX_UV1) !== 0) return;
	const uv0 = locationOfAttribute(VERTEX_UV0);
	forEachVertexAttribute(format, (attribute) => {
		if (attribute.location === uv0) visit({ ...attribute, location: UV1_LOCATION });
	});
}

/** Bytes per vertex of a vertex format. */
export function vertexStride(format: number): number {
	let stride = 0;
	forEachVertexAttribute(format, ({ size, type }) => {
		stride += size * typeInfo(type)[0];
	});
	return stride;
}

/**
 * The attribute that a vertex shader reads at `location` from a vertex format, or undefined when
 * the format lacks it.
 */
export function vertexAttribute(format: number, location: number): VertexAttribute | undefined {
	let found: VertexAttribute | undefined;
	const match = (attribute: VertexAttribute) => {
		if (attribute.location === location) found = attribute;
	};
	forEachVertexAttribute(format, match);
	forEachFallbackAttribute(format, match);
	return found;
}

/** True when an attribute's values are normalized integers, which read as fractions. */
export function isNormalized(attribute: VertexAttribute): boolean {
	return typeInfo(attribute.type)[2];
}

/**
 * What a shader multiplies an attribute by where the GPU reads plain integers as fractions, as
 * WebGPU does for those that shaders read as floats: the type's largest value. It is 1 for floats,
 * normalized integers, and attributes that shaders read as whole numbers.
 */
export function plainScale(attribute: VertexAttribute): number {
	const [, max, normalized] = typeInfo(attribute.type);
	return attribute.integer || normalized ? 1 : max;
}
