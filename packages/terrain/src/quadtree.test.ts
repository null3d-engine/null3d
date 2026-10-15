import { describe, expect, test } from 'bun:test';
import { MAX_LEVELS, MAX_SPLIT, Quadtree } from './quadtree';

/** The leaves of a selection, as `[level, column, row]` triples. */
function leaves(tree: Quadtree, x: number, z: number): [number, number, number][] {
	const count = tree.select(x, z);
	const out: [number, number, number][] = [];
	for (let i = 0; i < count; i++)
		out.push([tree.levels[i] as number, tree.columns[i] as number, tree.rows[i] as number]);
	return out;
}

describe('quadtree', () => {
	test('the leaves tile the whole ground', () => {
		const tree = new Quadtree({ size: 512, maxLevel: 5, split: 2 });
		const picked = leaves(tree, 37, -91);
		expect(picked.length).toBeGreaterThan(1);
		let area = 0;
		for (const [level] of picked) area += tree.blockSize(level) ** 2;
		expect(area).toBeCloseTo(512 * 512, 6);
	});

	test('the ground near the camera is finer than the far ground', () => {
		const tree = new Quadtree({ size: 512, maxLevel: 5, split: 2 });
		const picked = leaves(tree, 0, 0);
		let near = 0;
		let far = 0;
		for (const [level, column, row] of picked) {
			const x = tree.blockX(level, column) + tree.blockSize(level) / 2;
			const z = tree.blockZ(level, row) + tree.blockSize(level) / 2;
			const distance = Math.hypot(x, z);
			if (distance < 64) near = Math.max(near, level);
			if (distance > 192) far = Math.max(far, level);
		}
		expect(near).toBe(5);
		expect(far).toBeLessThan(near);
	});

	test('the same camera position gives the same leaves, every time', () => {
		const tree = new Quadtree({ size: 256, maxLevel: 4 });
		const first = leaves(tree, 10, 20);
		const again = leaves(tree, 10, 20);
		expect(again).toEqual(first);
	});

	test('every leaf key is unique, and names its leaf', () => {
		const tree = new Quadtree({ size: 256, maxLevel: 4, split: 1.5 });
		const picked = leaves(tree, -100, 60);
		const keys = new Set<number>();
		for (const [level, column, row] of picked) {
			const key = tree.key(level, column, row);
			expect(keys.has(key)).toBe(false);
			keys.add(key);
		}
		expect(keys.size).toBe(picked.length);
	});

	test('a maximum level of 0 keeps only the root, and a deep maximum follows the camera', () => {
		const root = new Quadtree({ size: 64, maxLevel: 0 });
		expect(leaves(root, 0, 0)).toEqual([[0, 0, 0]]);
		const deep = new Quadtree({ size: 64, maxLevel: 6, split: 2 });
		const picked = leaves(deep, 0, 0);
		expect(picked.some(([level]) => level === 6)).toBe(true);
	});

	test('refuses a size, a level or a split that does not fit', () => {
		expect(() => new Quadtree({ size: -1, maxLevel: 3 })).toThrow(/positive/);
		expect(() => new Quadtree({ size: 1, maxLevel: MAX_LEVELS + 1 })).toThrow(/whole number/);
		expect(() => new Quadtree({ size: 1, maxLevel: 1, split: -1 })).toThrow(/above 0/);
		expect(() => new Quadtree({ size: 1, maxLevel: 1, split: MAX_SPLIT + 0.5 })).toThrow(
			`up to ${MAX_SPLIT}`,
		);
	});

	test('a selection larger than the arrays grows them and keeps every leaf', () => {
		// A wide split at many levels picks thousands of leaves.
		const tree = new Quadtree({ size: 10_000, maxLevel: MAX_LEVELS, split: 6 });
		const picked = leaves(tree, 1, 1);
		expect(picked.length).toBeGreaterThan(4096);
		let area = 0;
		for (const [level, column, row] of picked) {
			expect(Number.isInteger(column) && Number.isInteger(row)).toBe(true);
			area += tree.blockSize(level) ** 2;
		}
		expect(area / 10_000 ** 2).toBeCloseTo(1, 9);
	});
});
