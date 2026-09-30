// The layout of a vertex format, from the attribute table that the engine core shares: every
// vertex holds a position and a normal, then each optional attribute that its format has, in the
// table's order. Both GPU backends place a mesh's attributes with it. A mesh without second texture
// coordinates offers its first set in their place, so shaders that read the second set draw it.

import {
	PERMUTATION_VERTEX_COLOR,
	PERMUTATION_VERTEX_TANGENT,
	VERTEX_ATTRIBUTES,
	VERTEX_COLOR,
	VERTEX_TANGENT,
	VERTEX_UV0,
	VERTEX_UV1,
} from '../generated/gpu';

/**
 * Calls `visit` with each attribute that a vertex format has, in vertex order: its vertex shader
 * location, its floats and its byte offset in the vertex.
 */
export function forEachVertexAttribute(
	format: number,
	visit: (location: number, floats: number, offset: number) => void,
): void {
	let offset = 0;
	for (const [bit, floats, location] of VERTEX_ATTRIBUTES) {
		if ((format & bit) !== bit) continue;
		visit(location, floats, offset);
		offset += floats * 4;
	}
}

/** The vertex shader location of the optional attribute with this format bit. */
export function locationOfAttribute(bit: number): number {
	for (const [attribute, , location] of VERTEX_ATTRIBUTES) if (attribute === bit) return location;
	throw new Error(`no vertex attribute has the format bit ${bit}`);
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
	return locations;
}

/**
 * Calls `visit` with each location that a vertex format offers in place of an attribute it lacks:
 * the second texture coordinates, from the first set, on a mesh with only the first.
 */
export function forEachFallbackAttribute(
	format: number,
	visit: (location: number, floats: number, offset: number) => void,
): void {
	if ((format & VERTEX_UV0) === 0 || (format & VERTEX_UV1) !== 0) return;
	const uv0 = locationOfAttribute(VERTEX_UV0);
	forEachVertexAttribute(format, (location, floats, offset) => {
		if (location === uv0) visit(UV1_LOCATION, floats, offset);
	});
}

/** Bytes per vertex of a vertex format. */
export function vertexStride(format: number): number {
	let stride = 0;
	forEachVertexAttribute(format, (_, floats) => {
		stride += floats * 4;
	});
	return stride;
}

/**
 * Where a vertex format keeps the attribute that a vertex shader reads at `location`: its floats
 * and its byte offset in the vertex, or undefined when the format lacks it.
 */
export function vertexAttribute(
	format: number,
	location: number,
): { floats: number; offset: number } | undefined {
	let found: { floats: number; offset: number } | undefined;
	const match = (at: number, floats: number, offset: number) => {
		if (at === location) found = { floats, offset };
	};
	forEachVertexAttribute(format, match);
	forEachFallbackAttribute(format, match);
	return found;
}
