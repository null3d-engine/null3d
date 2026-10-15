// One block of the ground: a grid of vertices whose heights come from the height field, with a
// skirt around its edge. The skirt hangs a little below the block, so the seam between two
// neighbours that draw at different levels shows no gap. Positions are relative to the block's low
// corner, and the object that draws it stands there, so its bounds stay small and it culls well.
import type { Heightfield } from './heightfield';

/** The arrays of one block: 32-bit float positions, normals and texture coordinates, and indices. */
export interface ChunkArrays {
	positions: Float32Array;
	normals: Float32Array;
	uvs: Float32Array;
	indices: Uint32Array;
}

/**
 * Builds the arrays of one ground block. `quads` is the faces along each side of the block, and
 * `skirt` is how far the edge's skirt hangs down, in meters.
 */
export function chunkArrays(
	field: Heightfield,
	blockSize: number,
	originX: number,
	originZ: number,
	quads: number,
	skirt: number,
): ChunkArrays {
	const side = quads + 1;
	const cell = blockSize / quads;
	const grid = side * side;
	// The ring around the block: each edge's vertices, joining at the corners.
	const ring = new Uint32Array(4 * quads);
	let at = 0;
	for (let col = 0; col < quads; col++) ring[at++] = col; // low z edge, left to right
	for (let row = 0; row < quads; row++) ring[at++] = row * side + quads; // high x edge, low to high
	for (let col = quads; col > 0; col--) ring[at++] = quads * side + col; // high z edge, right to left
	for (let row = quads; row > 0; row--) ring[at++] = row * side; // low x edge, high to low
	const ringCount = 4 * quads;
	const skirtStart = grid;

	const positions = new Float32Array((grid + ringCount) * 3);
	const normals = new Float32Array((grid + ringCount) * 3);
	const uvs = new Float32Array((grid + ringCount) * 2);
	const normal = [0, 0, 0];
	for (let row = 0; row <= quads; row++)
		for (let col = 0; col <= quads; col++) {
			const i = row * side + col;
			const x = col * cell;
			const z = row * cell;
			positions[i * 3] = x;
			positions[i * 3 + 1] = field.heightAt(originX + x, originZ + z);
			positions[i * 3 + 2] = z;
			// The normal comes from the height field itself, so two blocks that meet at an edge
			// give that edge's vertices the same normal, and no shadow line shows along the seam.
			field.normalAt(originX + x, originZ + z, normal);
			normals[i * 3] = normal[0] as number;
			normals[i * 3 + 1] = normal[1] as number;
			normals[i * 3 + 2] = normal[2] as number;
			// The block's own coordinates, 0 to 1. The surface reads the world position for its
			// tiling, but the engine's vertex stage draws a mesh with texture coordinates.
			uvs[i * 2] = col / quads;
			uvs[i * 2 + 1] = row / quads;
		}
	// The skirt: a copy of each ring vertex, dropped by the skirt's depth.
	for (let k = 0; k < ringCount; k++) {
		const source = (ring[k] as number) * 3;
		const target = (skirtStart + k) * 3;
		positions[target] = positions[source] as number;
		positions[target + 1] = (positions[source + 1] as number) - skirt;
		positions[target + 2] = positions[source + 2] as number;
		normals[target] = normals[source] as number;
		normals[target + 1] = normals[source + 1] as number;
		normals[target + 2] = normals[source + 2] as number;
		const uvSource = (ring[k] as number) * 2;
		uvs[skirtStart * 2 + k * 2] = uvs[uvSource] as number;
		uvs[skirtStart * 2 + k * 2 + 1] = uvs[uvSource + 1] as number;
	}

	const indices = new Uint32Array(quads * quads * 6 + ringCount * 6);
	at = 0;
	for (let row = 0; row < quads; row++)
		for (let col = 0; col < quads; col++) {
			const a = row * side + col;
			// Counter-clockwise seen from above, as the engine's plane generators wind.
			indices[at++] = a;
			indices[at++] = a + side;
			indices[at++] = a + 1;
			indices[at++] = a + 1;
			indices[at++] = a + side;
			indices[at++] = a + side + 1;
		}
	for (let k = 0; k < ringCount; k++) {
		const a = ring[k] as number;
		const b = ring[(k + 1) % ringCount] as number;
		const aLow = skirtStart + k;
		const bLow = skirtStart + ((k + 1) % ringCount);
		indices[at++] = a;
		indices[at++] = b;
		indices[at++] = bLow;
		indices[at++] = a;
		indices[at++] = bLow;
		indices[at++] = aLow;
	}
	return { positions, normals, uvs, indices };
}
