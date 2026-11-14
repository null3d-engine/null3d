import { describe, expect, test } from 'bun:test';
import { oceanMesh } from './ocean';

describe('the sea’s mesh', () => {
	const reach = 1000;
	const segments = 16;
	const mesh = oceanMesh(reach, segments);

	test('it covers the square that reaches past the camera', () => {
		const positions = mesh.positions as Float32Array;
		let minX = Infinity;
		let maxX = -Infinity;
		let minZ = Infinity;
		let maxZ = -Infinity;
		for (let at = 0; at < positions.length; at += 3) {
			minX = Math.min(minX, positions[at] as number);
			maxX = Math.max(maxX, positions[at] as number);
			minZ = Math.min(minZ, positions[at + 2] as number);
			maxZ = Math.max(maxZ, positions[at + 2] as number);
			expect(positions[at + 1]).toBe(0);
		}
		expect(minX).toBeCloseTo(-reach, 6);
		expect(maxX).toBeCloseTo(reach, 6);
		expect(minZ).toBeCloseTo(-reach, 6);
		expect(maxZ).toBeCloseTo(reach, 6);
		expect((mesh.positions as Float32Array).length).toBe((segments + 1) ** 2 * 3);
	});

	test('its cells grow with distance, so the camera keeps fine waves', () => {
		const positions = mesh.positions as Float32Array;
		const row = segments + 1;
		const stepAt = (vertex: number): number =>
			(positions[(vertex + 1) * 3] as number) - (positions[vertex * 3] as number);
		// The mesh's middle row runs across the view, so the cell at its middle is small and the
		// cells at its two ends are large.
		const middle = row * Math.floor(segments / 2);
		const centre = middle + Math.floor(segments / 2);
		expect(stepAt(centre)).toBeLessThan(stepAt(middle));
		expect(stepAt(centre)).toBeLessThan(stepAt(middle + segments - 1));
	});

	test('every index names a vertex', () => {
		const indices = mesh.indices as Uint32Array;
		const count = (segments + 1) ** 2;
		for (const index of indices) expect(index).toBeLessThan(count);
		expect(indices.length).toBe(segments * segments * 6);
	});
});
