import { describe, expect, test } from 'bun:test';
import { chunkArrays } from './chunk';
import { createHeightfield } from './heightfield';

describe('chunk arrays', () => {
	test('makes a grid of quads and a skirt around it', () => {
		const field = createHeightfield({ size: 16, resolution: 17, height: () => 2 });
		const quads = 4;
		const skirt = 3;
		const { positions, normals, uvs, indices } = chunkArrays(field, 16, -8, -8, quads, skirt);
		const side = quads + 1;
		const ring = quads * 4;
		expect(positions.length).toBe((side * side + ring) * 3);
		expect(normals.length).toBe((side * side + ring) * 3);
		expect(uvs.length).toBe((side * side + ring) * 2);
		expect(indices?.length).toBe(quads * quads * 6 + ring * 6);
		// On flat ground every normal points straight up, from the grid and the skirt alike.
		for (let v = 0; v < side * side + ring; v++) {
			expect(normals[v * 3]).toBeCloseTo(0, 6);
			expect(normals[v * 3 + 1]).toBeCloseTo(1, 6);
			expect(normals[v * 3 + 2]).toBeCloseTo(0, 6);
		}
		// Every index names a vertex.
		for (const index of indices as Uint32Array) expect(index).toBeLessThan(side * side + ring);
		// The grid sits on the ground, and the skirt hangs below it.
		for (let i = 0; i < side * side; i++) expect(positions[i * 3 + 1]).toBeCloseTo(2, 6);
		for (let k = 0; k < ring; k++)
			expect(positions[(side * side + k) * 3 + 1]).toBeCloseTo(2 - skirt, 6);
	});

	test('places the vertices in the block, relative to its corner', () => {
		const field = createHeightfield({ size: 32, resolution: 33, height: (x, z) => x - z });
		const block = 8;
		const originX = 4;
		const originZ = -12;
		const quads = 2;
		const { positions } = chunkArrays(field, block, originX, originZ, quads, 1);
		for (let i = 0; i < (quads + 1) * (quads + 1); i++) {
			const x = positions[i * 3] as number;
			const y = positions[i * 3 + 1] as number;
			const z = positions[i * 3 + 2] as number;
			expect(x).toBeGreaterThanOrEqual(0);
			expect(x).toBeLessThanOrEqual(block);
			expect(z).toBeGreaterThanOrEqual(0);
			expect(z).toBeLessThanOrEqual(block);
			// The height is the field's, at the vertex's own world position.
			expect(y).toBeCloseTo(field.heightAt(originX + x, originZ + z), 5);
		}
	});
});
