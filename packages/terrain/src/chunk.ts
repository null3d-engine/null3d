// One block of the ground: a grid of vertices whose heights come from the height field, with a
// skirt around its edge. The skirt hangs a little below the block, so the seam between two
// neighbours that draw at different levels shows no gap. Positions are relative to the block's low
// corner, and the object that draws it stands there, so its bounds stay small and it culls well.
//
// Every block of one grid has the same vertices, texture coordinates and triangles, so those are
// worked out once and shared, and a block's heights and normals are written into arrays that the
// caller keeps. A ground that moves its blocks as the camera travels therefore builds no arrays of
// its own in a frame.
import type { Heightfield } from './heightfield';

/**
 * What every block of one grid shares: how many vertices it has, the ring of vertices around it
 * that its skirt copies, and the texture coordinates and triangles of all of them.
 */
export interface ChunkShape {
	/** The faces along each side of a block. */
	readonly quads: number;
	/** The vertices of a block: its grid of vertices, with the skirt around it. */
	readonly vertices: number;
	/** The ring around a block: the grid vertices along its edges, which the skirt copies. */
	readonly ring: Uint32Array;
	/** The texture coordinates of every vertex, each vertex's own place in the block. */
	readonly uvs: Float32Array;
	/** The triangles of a block: the grid's quads, then the skirt's wall. */
	readonly indices: Uint32Array;
}

/** The ring around a block: each edge's grid vertices, joining at the corners, in draw order. */
function ringOf(quads: number): Uint32Array {
	const side = quads + 1;
	const ring = new Uint32Array(quads * 4);
	let at = 0;
	for (let col = 0; col < quads; col++) ring[at++] = col; // low z edge, left to right
	for (let row = 0; row < quads; row++) ring[at++] = row * side + quads; // high x edge, low to high
	for (let col = quads; col > 0; col--) ring[at++] = quads * side + col; // high z edge, right to left
	for (let row = quads; row > 0; row--) ring[at++] = row * side; // low x edge, high to low
	return ring;
}

/**
 * The shape of a block with `quads` faces along each side. One shape serves every block of a
 * terrain, whatever level each block draws at.
 */
export function chunkShape(quads: number): ChunkShape {
	const side = quads + 1;
	const grid = side * side;
	const ring = ringOf(quads);
	const vertices = grid + ring.length;
	const uvs = new Float32Array(vertices * 2);
	for (let row = 0; row <= quads; row++)
		for (let col = 0; col <= quads; col++) {
			const i = row * side + col;
			uvs[i * 2] = col / quads;
			uvs[i * 2 + 1] = row / quads;
		}
	// The skirt shares the texture coordinates of the ring vertex that it copies.
	for (let k = 0; k < ring.length; k++) {
		const source = (ring[k] as number) * 2;
		uvs[grid * 2 + k * 2] = uvs[source] as number;
		uvs[grid * 2 + k * 2 + 1] = uvs[source + 1] as number;
	}
	const indices = new Uint32Array(quads * quads * 6 + ring.length * 6);
	let at = 0;
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
	for (let k = 0; k < ring.length; k++) {
		const a = ring[k] as number;
		const b = ring[(k + 1) % ring.length] as number;
		const aLow = grid + k;
		const bLow = grid + ((k + 1) % ring.length);
		indices[at++] = a;
		indices[at++] = b;
		indices[at++] = bLow;
		indices[at++] = a;
		indices[at++] = bLow;
		indices[at++] = aLow;
	}
	return { quads, vertices, ring, uvs, indices };
}

/**
 * Writes the positions and normals of one block into `positions` and `normals`, both holding three
 * numbers per vertex of `shape`. The block stands at the world point (`originX`, `originZ`), covers
 * `blockSize` meters along each side, and its skirt hangs `skirt` meters below its edge.
 */
export function writeChunkVertices(
	field: Heightfield,
	shape: ChunkShape,
	blockSize: number,
	originX: number,
	originZ: number,
	skirt: number,
	positions: Float32Array,
	normals: Float32Array,
): void {
	const { quads, ring } = shape;
	const grid = (quads + 1) * (quads + 1);
	field.writeGridVertices(blockSize, originX, originZ, quads, positions, normals);
	// The skirt: a copy of each ring vertex, dropped by the skirt's depth.
	for (let k = 0; k < ring.length; k++) {
		const source = (ring[k] as number) * 3;
		const target = (grid + k) * 3;
		positions[target] = positions[source] as number;
		positions[target + 1] = (positions[source + 1] as number) - skirt;
		positions[target + 2] = positions[source + 2] as number;
		normals[target] = normals[source] as number;
		normals[target + 1] = normals[source + 1] as number;
		normals[target + 2] = normals[source + 2] as number;
	}
}
