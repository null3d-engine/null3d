import { describe, expect, test } from 'bun:test';
import { chunkShape, writeChunkVertices } from './chunk';
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
