// The showcase scenes' generators: the same seed gives the same detail, tiled noise repeats, and
// the meshes have the sizes their settings ask for.
import { describe, expect, test } from 'bun:test';
import { Noise, random, rock, terrain, within } from './procedural';

describe('procedural', () => {
	test('a seed gives the same numbers on every run, and another seed others', () => {
		const [a, b, c] = [random(7), random(7), random(8)];
		const first = Array.from({ length: 5 }, a);
		expect(Array.from({ length: 5 }, b)).toEqual(first);
		expect(Array.from({ length: 5 }, c)).not.toEqual(first);
		expect(first.every((n) => n >= 0 && n < 1)).toBe(true);
	});

	test('noise with a period repeats after it, at every octave', () => {
		const noise = new Noise(3);
		for (const [x, y] of [
			[0.3, 0.7],
			[2.25, 5.5],
		] as const) {
			expect(noise.value2(x + 8, y, 8)).toBeCloseTo(noise.value2(x, y, 8), 6);
			expect(noise.fbm2(x, y + 4, 4, 4)).toBeCloseTo(noise.fbm2(x, y, 4, 4), 6);
		}
		const values = Array.from({ length: 200 }, (_, i) =>
			noise.value3(i * 0.37, i * 0.11, i * 0.53),
		);
		expect(Math.max(...values.map(Math.abs))).toBeLessThanOrEqual(1);
	});

	test('a terrain has a vertex at each corner of its quads, and two triangles in each quad', () => {
		const grid = terrain({
			size: 10,
			quads: 4,
			tile: 2,
			middle: 0.5,
			height: (x, z) => x + z,
			color: (_x, _z, y, _slope, out) => out.splice(0, 3, y, y, y),
		});
		expect((grid.positions as Float32Array).length).toBe(25 * 3);
		expect(grid.indices?.length).toBe(16 * 6);
		// The grid spans the whole size, with the height function's value at each corner.
		const p = grid.positions as Float32Array;
		expect([p[0], p[1], p[2]]).toEqual([-5, -10, -5]);
		expect([p[72], p[73], p[74]]).toEqual([5, 10, 5]);
	});

	test('a rock has the vertices of its subdivided icosahedron', () => {
		expect((rock(1, 1, [1, 1, 1]).positions as Float32Array).length).toBe(42 * 3);
		expect(rock(1, 2, [1, 1, 1]).indices?.length).toBe(320 * 3);
	});

	test('a point lies within a footprint only inside its circle', () => {
		const clear = within([{ x: 1, z: 1, r: 1 }]);
		expect(clear(1.5, 1)).toBe(true);
		expect(clear(2.5, 1)).toBe(false);
	});
});
