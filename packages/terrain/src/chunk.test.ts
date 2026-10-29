import { describe, expect, test } from 'bun:test';
import { chunkShape, writeChunkVertices, writeParentHeights } from './chunk';
import { createHeightfield } from './heightfield';

describe('chunk shape', () => {
	test('makes a grid of quads and a skirt around it', () => {
		const quads = 4;
		const side = quads + 1;
		const ring = quads * 4;
		const shape = chunkShape(quads);
		expect(shape.vertices).toBe(side * side + ring);
		expect(shape.uvs.length).toBe(shape.vertices * 2);
		expect(shape.indices.length).toBe(quads * quads * 6 + ring * 6);
		// Every index names a vertex.
		for (const index of shape.indices) expect(index).toBeLessThan(shape.vertices);
		// The texture coordinates run from 0 to 1 across the block, and the skirt shares those of the
		// ring vertex that it copies.
		expect(shape.uvs[0]).toBe(0);
		expect(shape.uvs[(side * side - 1) * 2]).toBe(1);
		for (let k = 0; k < ring; k++) {
			const source = (shape.ring[k] as number) * 2;
			expect(shape.uvs[(side * side + k) * 2]).toBe(shape.uvs[source]);
			expect(shape.uvs[(side * side + k) * 2 + 1]).toBe(shape.uvs[source + 1]);
		}
	});

	test('writes the grid on the ground and the skirt below it', () => {
		const field = createHeightfield({ size: 16, resolution: 17, height: () => 2 });
		const quads = 4;
		const skirt = 3;
		const shape = chunkShape(quads);
		const positions = new Float32Array(shape.vertices * 3);
		const normals = new Float32Array(shape.vertices * 3);
		writeChunkVertices(field, shape, 16, -8, -8, skirt, positions, normals);
		const side = quads + 1;
		const ring = quads * 4;
		// On flat ground every normal points straight up, from the grid and the skirt alike.
		for (let v = 0; v < side * side + ring; v++) {
			expect(normals[v * 3]).toBeCloseTo(0, 6);
			expect(normals[v * 3 + 1]).toBeCloseTo(1, 6);
			expect(normals[v * 3 + 2]).toBeCloseTo(0, 6);
		}
		// The grid sits on the ground, and the skirt hangs below it.
		for (let i = 0; i < side * side; i++) expect(positions[i * 3 + 1]).toBeCloseTo(2, 6);
		for (let k = 0; k < ring; k++)
			expect(positions[(side * side + k) * 3 + 1]).toBeCloseTo(2 - skirt, 6);
	});

	test('places the vertices in the block, relative to its corner, at the height of the field', () => {
		const field = createHeightfield({ size: 32, resolution: 33, height: (x, z) => x - z });
		const block = 8;
		const originX = 4;
		const originZ = -12;
		const quads = 2;
		const shape = chunkShape(quads);
		const positions = new Float32Array(shape.vertices * 3);
		const normals = new Float32Array(shape.vertices * 3);
		writeChunkVertices(field, shape, block, originX, originZ, 1, positions, normals);
		const normal = [0, 0, 0];
		const grid = (quads + 1) * (quads + 1);
		for (let i = 0; i < grid; i++) {
			const x = positions[i * 3] as number;
			const y = positions[i * 3 + 1] as number;
			const z = positions[i * 3 + 2] as number;
			expect(x).toBeGreaterThanOrEqual(0);
			expect(x).toBeLessThanOrEqual(block);
			expect(z).toBeGreaterThanOrEqual(0);
			expect(z).toBeLessThanOrEqual(block);
			// The height is the field's, at the vertex's own world position.
			expect(y).toBeCloseTo(field.heightAt(originX + x, originZ + z), 5);
			// The normal is the field's own there, which one block of vertices reads in one call.
			field.normalAt(originX + x, originZ + z, normal);
			expect(normals[i * 3]).toBeCloseTo(normal[0] as number, 4);
			expect(normals[i * 3 + 1]).toBeCloseTo(normal[1] as number, 4);
			expect(normals[i * 3 + 2]).toBeCloseTo(normal[2] as number, 4);
		}
	});

	test('writes the parent surface over the block, as the parent grid triangulates it', () => {
		// The parent covers 16 meters in two cells, and its heights come from a field that is
		// bilinear in x and z: 0, 2, 4 and 8 at its four corners. The child block is its low
		// quadrant, and the middle of the parent's cell lies on the diagonal that splits it.
		const field = createHeightfield({
			size: 16,
			resolution: 17,
			height: (x, z) => x / 4 + z / 2 + (x * z) / 32,
		});
		const quads = 2;
		const shape = chunkShape(quads);
		const out = new Float32Array(shape.vertices);
		writeParentHeights(field, shape, 8, 0, 0, 2, 16, 0, 0, out);
		const side = quads + 1;
		const grid = side * side;
		// The child's corner and its middle of the parent's cell.
		expect(out[0]).toBeCloseTo(0, 5);
		expect(out[1 * side + 1]).toBeCloseTo(3, 5);
		// The middle is the triangle's plane, which is 3, not the field's bilinear 3.5.
		expect(field.heightAt(4, 4)).toBeCloseTo(3.5, 5);
		// Every other grid vertex lies on the parent's plane at its own place. The parent's
		// corner heights come from the field's own function here, not from `heightAt`.
		const height = (x: number, z: number) => x / 4 + z / 2 + (x * z) / 32;
		const surface = (x: number, z: number) => {
			const cx = Math.min(Math.floor(x / 8), 1);
			const cz = Math.min(Math.floor(z / 8), 1);
			const tx = x / 8 - cx;
			const tz = z / 8 - cz;
			const h00 = height(cx * 8, cz * 8);
			const h10 = height((cx + 1) * 8, cz * 8);
			const h01 = height(cx * 8, (cz + 1) * 8);
			const h11 = height((cx + 1) * 8, (cz + 1) * 8);
			return tx + tz <= 1
				? h00 + (h10 - h00) * tx + (h01 - h00) * tz
				: h11 + (h01 - h11) * (1 - tx) + (h10 - h11) * (1 - tz);
		};
		for (let row = 0; row <= quads; row++)
			for (let col = 0; col <= quads; col++)
				expect(out[row * side + col]).toBeCloseTo(surface(col * 4, row * 4), 5);
		// The skirt copies the ring's heights.
		for (let k = 0; k < shape.ring.length; k++)
			expect(out[grid + k]).toBeCloseTo((out[shape.ring[k] as number] as number) - 2, 6);
	});

	test('gives a flat parent the same height at every vertex', () => {
		const field = createHeightfield({ size: 32, resolution: 33, height: () => 2 });
		const shape = chunkShape(4);
		const out = new Float32Array(shape.vertices);
		writeParentHeights(field, shape, 8, -16, 8, 0, 16, -16, 8, out);
		for (const height of out) expect(height).toBeCloseTo(2, 6);
	});

	test('gives a block with no coarser level its own heights', () => {
		const field = createHeightfield({ size: 16, resolution: 17, height: (x, z) => x - z });
		const shape = chunkShape(4);
		const positions = new Float32Array(shape.vertices * 3);
		const normals = new Float32Array(shape.vertices * 3);
		writeChunkVertices(field, shape, 8, -8, -4, 2, positions, normals);
		const out = new Float32Array(shape.vertices);
		writeParentHeights(field, shape, 8, -8, -4, 2, 8, -8, -4, out);
		// The block's own size and origin as its parent leave every vertex where it is.
		for (let v = 0; v < shape.vertices; v++)
			expect(out[v]).toBeCloseTo(positions[v * 3 + 1] as number, 5);
	});

	test('writes a second block into the same arrays again', () => {
		// A ground that moves a block rewrites the arrays it holds, so the same block written twice
		// leaves the arrays as they were, and another block replaces them.
		const field = createHeightfield({
			size: 16,
			resolution: 17,
			height: (x, z) => x * 0.1 + z * 0.05,
		});
		const shape = chunkShape(4);
		const positions = new Float32Array(shape.vertices * 3);
		const normals = new Float32Array(shape.vertices * 3);
		writeChunkVertices(field, shape, 8, -8, -8, 2, positions, normals);
		const first = positions.slice();
		writeChunkVertices(field, shape, 8, -8, -8, 2, positions, normals);
		expect(positions).toEqual(first);
		writeChunkVertices(field, shape, 8, 0, -8, 2, positions, normals);
		expect(positions[1]).not.toBeCloseTo(first[1] as number, 3);
	});
});
