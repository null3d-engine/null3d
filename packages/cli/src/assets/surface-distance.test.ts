import { describe, expect, it } from 'bun:test';
import { TriangleTree } from './surface-distance.js';

/** A number from 0 to 1 from an integer hash of `seed`. */
function unit(seed: number): number {
	let h = Math.imul(seed ^ 0x2545f491, 0x9e3779b1);
	h ^= h >>> 15;
	h = Math.imul(h, 0x85ebca6b);
	h ^= h >>> 13;
	return (h >>> 0) / 0xffffffff;
}

/** The distance from a point to a triangle, found by sampling the triangle densely. */
function sampled(p: number[], a: number[], b: number[], c: number[]): number {
	let best = Infinity;
	const steps = 60;
	for (let i = 0; i <= steps; i++)
		for (let j = 0; i + j <= steps; j++) {
			const u = i / steps;
			const v = j / steps;
			const q = [0, 1, 2].map(
				(k) =>
					(a[k] as number) +
					u * ((b[k] as number) - (a[k] as number)) +
					v * ((c[k] as number) - (a[k] as number)),
			);
			best = Math.min(
				best,
				Math.hypot(
					(p[0] as number) - (q[0] as number),
					(p[1] as number) - (q[1] as number),
					(p[2] as number) - (q[2] as number),
				),
			);
		}
	return best;
}

describe('the distance to a triangle surface', () => {
	// A crumpled sheet of 200 triangles over random corners.
	const positions = new Float32Array(Array.from({ length: 300 * 3 }, (_, k) => unit(k) * 10));
	const indices = Uint32Array.from({ length: 200 * 3 }, (_, k) => Math.floor(unit(k + 9000) * 300));
	const corner = (v: number) => [0, 1, 2].map((k) => positions[v * 3 + k] as number);

	it('finds the nearest triangle, as testing every one does', () => {
		const tree = new TriangleTree(positions, indices);
		for (let s = 0; s < 40; s++) {
			const p = [0, 1, 2].map((k) => unit(s * 3 + k + 50_000) * 14 - 2);
			let brute = Infinity;
			for (let t = 0; t < indices.length / 3; t++)
				brute = Math.min(
					brute,
					sampled(
						p,
						corner(indices[t * 3] as number),
						corner(indices[t * 3 + 1] as number),
						corner(indices[t * 3 + 2] as number),
					),
				);
			const found = tree.distance(p[0] as number, p[1] as number, p[2] as number);
			// The sampled triangles lie on the surface, so the exact distance is never above them.
			expect(found).toBeLessThanOrEqual(brute + 1e-4);
			expect(found).toBeGreaterThan(brute - 0.25);
		}
	});

	it('gives 0 on the surface and Infinity with no triangle', () => {
		const tree = new TriangleTree(positions, indices);
		const v = indices[0] as number;
		expect(tree.distance(...(corner(v) as [number, number, number]))).toBeCloseTo(0, 5);
		expect(new TriangleTree(positions, new Uint32Array()).distance(0, 0, 0)).toBe(Infinity);
	});
});
