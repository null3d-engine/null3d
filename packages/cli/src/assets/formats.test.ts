import { describe, expect, it } from 'bun:test';
import { meshBvh } from './formats.js';

/** A grid of 8 x 8 squares, two triangles each. */
function grid() {
	const positions: number[] = [];
	const indices: number[] = [];
	for (let z = 0; z <= 8; z++) for (let x = 0; x <= 8; x++) positions.push(x, Math.sin(x + z), z);
	for (let z = 0; z < 8; z++)
		for (let x = 0; x < 8; x++) {
			const a = z * 9 + x;
			indices.push(a, a + 9, a + 1, a + 1, a + 9, a + 10);
		}
	return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

describe("the asset tool's formats", () => {
	it('store a mesh tree as the engine reads it: the header, the nodes, then one index per triangle', () => {
		const { positions, indices } = grid();
		const bytes = meshBvh(positions, indices);
		expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe('N3BV');
		const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		const triangles = view.getUint32(8, true);
		const nodes = view.getUint32(12, true);
		expect(triangles).toBe(128);
		expect(bytes.byteLength).toBe(48 + 112 * nodes + 4 * triangles);
		expect(Buffer.from(meshBvh(positions, indices)).equals(Buffer.from(bytes))).toBe(true);
	});

	it('refuse an index past the vertices with a message', () => {
		expect(() => meshBvh(new Float32Array(9), new Uint32Array([0, 1, 3]))).toThrow(
			'the index 3 lies past the mesh',
		);
	});
});
