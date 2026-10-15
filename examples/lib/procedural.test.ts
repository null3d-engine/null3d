// The showcase scenes' generators: the meshes have the sizes their settings ask for. The noise and
// the seeded generator are the engine's, which its own tests cover.
import { describe, expect, test } from 'bun:test';
import { rock, terrain, within } from './procedural';

describe('procedural', () => {
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
