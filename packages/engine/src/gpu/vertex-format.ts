// The layout of a vertex format, from the attribute table that the engine core shares: every
// vertex holds a position and a normal, then each optional attribute that its format has, in the
// table's order. Both GPU backends place a mesh's attributes with it.

import { VERTEX_ATTRIBUTES } from '../generated/gpu';

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
	forEachVertexAttribute(format, (at, floats, offset) => {
		if (at === location) found = { floats, offset };
	});
	return found;
}
