import { describe, expect, test } from 'bun:test';
import { createHeightfield } from './heightfield';
import { MAX_LEVELS, Quadtree } from './quadtree';

/** The screen error, in pixels, that most tests allow a block's cell. */
const ERROR = 32;
/** A vertical field of view, in degrees, and a buffer height, in device pixels. */
const FOV = 52;
const SCREEN = 1080;

/** The leaves of a selection at the camera's x and z and a height, as `[level, column, row]`. */
function leaves(
	tree: Quadtree,
	x: number,
	z: number,
	y = 0,
	fov = FOV,
	screen = SCREEN,
	error = ERROR,
): [number, number, number][] {
	const count = tree.select([x, y, z], fov, screen, error);
	const out: [number, number, number][] = [];
	for (let i = 0; i < count; i++)
		out.push([tree.levels[i] as number, tree.columns[i] as number, tree.rows[i] as number]);
	return out;
}

/** The level of the leaf that covers the world point (`x`, `z`), or -1 when no leaf covers it. */
function levelAt(tree: Quadtree, picked: [number, number, number][], x: number, z: number): number {
	for (const [level, column, row] of picked) {
		const size = tree.blockSize(level);
		const lowX = tree.blockX(level, column);
		const lowZ = tree.blockZ(level, row);
		if (x >= lowX && x < lowX + size && z >= lowZ && z < lowZ + size) return level;
	}
	return -1;
}

describe('quadtree', () => {
	test('the leaves tile the whole ground', () => {
		const tree = new Quadtree({ size: 512, maxLevel: 5 });
		const picked = leaves(tree, 37, -91);
		expect(picked.length).toBeGreaterThan(1);
		let area = 0;
		for (const [level] of picked) area += tree.blockSize(level) ** 2;
		expect(area).toBeCloseTo(512 * 512, 6);
	});

	test('the ground near the camera is finer than the far ground', () => {
		const tree = new Quadtree({ size: 512, maxLevel: 5 });
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

	test('a high camera draws the ground under it coarser', () => {
		const tree = new Quadtree({ size: 512, maxLevel: 5 });
		const low = leaves(tree, 0, 0, 0);
		const high = leaves(tree, 0, 0, 500);
		expect(levelAt(tree, low, 8, 8)).toBe(5);
		expect(levelAt(tree, high, 8, 8)).toBeLessThan(5);
		expect(high.length).toBeLessThan(low.length);
	});

	test('a narrow field of view keeps detail farther out', () => {
		const tree = new Quadtree({ size: 512, maxLevel: 5 });
		const wide = leaves(tree, 0, 0, 0, 90);
		const narrow = leaves(tree, 0, 0, 0, 20);
		// A point well away from the camera, so the field of view decides its block.
		expect(levelAt(tree, narrow, 150, 150)).toBeGreaterThan(levelAt(tree, wide, 150, 150));
		expect(narrow.length).toBeGreaterThan(wide.length);
	});

	test("a block's height box counts in the distance", () => {
		// A hill at the middle reaches high enough that a camera above it stands inside the block's
		// own height box, where the flat ground beside it is far below the camera.
		const hill = createHeightfield({
			size: 512,
			resolution: 65,
			height: (x, z) => 200 * Math.exp(-(x * x + z * z) / (2 * 200 * 200)),
		});
		const hillTree = new Quadtree({ size: 512, maxLevel: 5, field: hill });
		const flatTree = new Quadtree({
			size: 512,
			maxLevel: 5,
			field: createHeightfield({ size: 512, resolution: 65, height: () => 0 }),
		});
		const eye = 150;
		const aboveHill = leaves(hillTree, 0, 0, eye);
		const aboveFlat = leaves(flatTree, 0, 0, eye);
		expect(levelAt(hillTree, aboveHill, 4, 4)).toBeGreaterThan(levelAt(flatTree, aboveFlat, 4, 4));
		expect(hillTree.lowAt(0, 0, 0)).toBeCloseTo(hill.min, 5);
		expect(hillTree.highAt(0, 0, 0)).toBeGreaterThan(150);
	});

	test('a leaf key stays a small integer, and names one leaf', () => {
		// A number past 2147483647 becomes an object in the browser, one for every leaf of every
		// selection, so the pack must keep every key below it.
		const tree = new Quadtree({ size: 1024, maxLevel: 6 });
		const keys = new Set<number>();
		let count = 0;
		for (let level = 0; level <= 6; level++) {
			const side = 2 ** level;
			for (let column = 0; column < side; column++)
				for (let row = 0; row < side; row++) {
					const key = tree.key(level, column, row);
					expect(key).toBeGreaterThanOrEqual(0);
					expect(key).toBeLessThanOrEqual(2147483647);
					keys.add(key);
					count++;
				}
		}
		expect(keys.size).toBe(count);
	});

	test('the deepest level a terrain may take keeps its keys below that', () => {
		const tree = new Quadtree({ size: 1024, maxLevel: MAX_LEVELS });
		const side = 2 ** MAX_LEVELS - 1;
		expect(tree.key(MAX_LEVELS, side, side)).toBeLessThanOrEqual(2147483647);
	});

	test('the same camera position gives the same leaves, every time', () => {
		const tree = new Quadtree({ size: 256, maxLevel: 4 });
		const first = leaves(tree, 10, 20);
		const again = leaves(tree, 10, 20);
		expect(again).toEqual(first);
	});

	test('every leaf key is unique, and names its leaf', () => {
		const tree = new Quadtree({ size: 256, maxLevel: 4 });
		const picked = leaves(tree, -100, 60, 20, FOV, SCREEN, 16);
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
		const deep = new Quadtree({ size: 64, maxLevel: 6 });
		const picked = leaves(deep, 0, 0);
		expect(picked.some(([level]) => level === 6)).toBe(true);
	});

	test('a screen error of 0 keeps the finest level everywhere', () => {
		const tree = new Quadtree({ size: 64, maxLevel: 4 });
		const picked = leaves(tree, 500, 500, 500, FOV, SCREEN, 0);
		expect(picked.every(([level]) => level === 4)).toBe(true);
		expect(picked.length).toBe(4 ** 4);
	});

	test('refuses a size, a level, a grid or a block of a block', () => {
		expect(() => new Quadtree({ size: -1, maxLevel: 3 })).toThrow(/positive/);
		expect(() => new Quadtree({ size: 1, maxLevel: MAX_LEVELS + 1 })).toThrow(/whole number/);
		expect(() => new Quadtree({ size: 1, maxLevel: 1, quads: 0 })).toThrow(/whole number/);
		expect(() => new Quadtree({ size: 1, maxLevel: 1, quads: 2.5 })).toThrow(/whole number/);
	});

	test('a selection larger than the arrays grows them and keeps every leaf', () => {
		// A fine error at many levels picks thousands of leaves.
		const tree = new Quadtree({ size: 10_000, maxLevel: MAX_LEVELS });
		const picked = leaves(tree, 1, 1, 0, FOV, SCREEN, 11.5);
		expect(picked.length).toBeGreaterThan(4096);
		let area = 0;
		for (const [level, column, row] of picked) {
			expect(Number.isInteger(column) && Number.isInteger(row)).toBe(true);
			area += tree.blockSize(level) ** 2;
		}
		expect(area / 10_000 ** 2).toBeCloseTo(1, 9);
	});
});
