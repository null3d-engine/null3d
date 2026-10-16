// The chunked level of detail: a quadtree over the height field that keeps the ground near the
// camera at its finest and coarser blocks farther away. The selection is pure: it writes the
// leaves it picks into flat arrays, so a frame that moves the camera allocates nothing.

/** The most leaves one selection may pick. A quadtree of 15 levels over any ground picks fewer. */
export const MAX_NODES = 4096;
/** The most levels a terrain may take, so a leaf's key fits in a number. */
export const MAX_LEVELS = 15;

/**
 * How many leaves every level above a level holds: a level of `n` holds `4 ** n` leaves, and the
 * levels above it hold `(4 ** n - 1) / 3`. A leaf's key counts from its level's base, so the keys
 * of a 15 level quadtree run from 0 to 1431655764. That is below the range where the engine turns
 * a number into an object, which a key above it would do on every leaf of every selection.
 */
const LEVEL_BASE = new Int32Array([
	0, 1, 5, 21, 85, 341, 1365, 5461, 21845, 87381, 349525, 1398101, 5592405, 22369621, 89478485,
	357913941,
]);

/** The leaves a level holds along each side, as a whole number: `2 ** level`. */
function leavesPerSide(level: number): number {
	return 1 << level;
}

/** The settings of the quadtree. */
export interface QuadtreeOptions {
	/** The width and depth of the ground, in meters. */
	size: number;
	/** The finest level, from 0 to 15. A leaf of level `L` covers `size / 2 ** L` meters. */
	maxLevel: number;
	/**
	 * How far from a block's edge the camera may stand and still split it, as a multiple of the
	 * block's size. A larger value keeps detail farther out and picks more leaves. The default is
	 * 2.
	 */
	split?: number;
}

/**
 * Selects the ground's visible blocks each time the camera moves into a new cell. Every leaf
 * covers `size / 2 ** level` meters with its own grid, so the ground near the camera is fine and
 * the far ground is coarse. The selection reads only the camera's x and z.
 */
export class Quadtree {
	/** The width and depth of the ground, in meters. */
	readonly size: number;
	/** The finest level. */
	readonly maxLevel: number;
	/** The split distance, as a multiple of a block's size. */
	readonly split: number;
	/** The level of each picked leaf. */
	readonly levels = new Int32Array(MAX_NODES);
	/** The column of each picked leaf among the leaves of its level. */
	readonly columns = new Int32Array(MAX_NODES);
	/** The row of each picked leaf among the leaves of its level. */
	readonly rows = new Int32Array(MAX_NODES);
	/** How many leaves the last selection picked. */
	count = 0;

	constructor(options: QuadtreeOptions) {
		const { size, maxLevel } = options;
		const split = options.split ?? 2;
		if (!(size > 0) || !Number.isFinite(size))
			throw new Error(`a quadtree got the size ${size}, which is not a positive number.`);
		if (!Number.isInteger(maxLevel) || maxLevel < 0 || maxLevel > MAX_LEVELS)
			throw new Error(
				`a quadtree got the maxLevel ${maxLevel}, which is not a whole number from 0 to ${MAX_LEVELS}.`,
			);
		if (!(split > 0) || !Number.isFinite(split))
			throw new Error(`a quadtree got the split ${split}, which is not a positive number.`);
		this.size = size;
		this.maxLevel = maxLevel;
		this.split = split;
	}

	/** The meters that a leaf of level `level` covers, along each side. */
	blockSize(level: number): number {
		return this.size / leavesPerSide(level);
	}

	/** The x of a leaf's low corner, from its level and column. */
	blockX(level: number, column: number): number {
		return -this.size / 2 + column * this.blockSize(level);
	}

	/** The z of a leaf's low corner, from its level and row. */
	blockZ(level: number, row: number): number {
		return -this.size / 2 + row * this.blockSize(level);
	}

	/**
	 * A leaf's key, which names it among every leaf of the quadtree: the level's base, then the
	 * leaf's place in that level's own grid. Allocates nothing.
	 */
	key(level: number, column: number, row: number): number {
		return (LEVEL_BASE[level] as number) + column * leavesPerSide(level) + row;
	}

	/**
	 * Picks the leaves to draw for a camera at `x` and `z`, into the arrays. Returns the count,
	 * which `count` also holds. Two calls with the same arguments pick the same leaves, and a call
	 * allocates nothing.
	 */
	select(x: number, z: number): number {
		const count = this.visit(0, 0, 0, x, z, 0);
		this.count = count;
		return count;
	}

	/**
	 * Visits the leaf or block at `level`, `column` and `row`, and returns the number of leaves
	 * that the subtree below it added. `at` is the write position in the arrays.
	 */
	private visit(
		level: number,
		column: number,
		row: number,
		x: number,
		z: number,
		at: number,
	): number {
		const { size, maxLevel, split } = this;
		const block = size / leavesPerSide(level);
		const half = block / 2;
		const centerX = -size / 2 + column * block + half;
		const centerZ = -size / 2 + row * block + half;
		const dx = Math.max(Math.abs(x - centerX) - half, 0);
		const dz = Math.max(Math.abs(z - centerZ) - half, 0);
		// The distance by hand: `Math.hypot` makes one object per call.
		if (level < maxLevel && Math.sqrt(dx * dx + dz * dz) < block * split) {
			const next = level + 1;
			let written = this.visit(next, column * 2, row * 2, x, z, at);
			written += this.visit(next, column * 2 + 1, row * 2, x, z, at + written);
			written += this.visit(next, column * 2, row * 2 + 1, x, z, at + written);
			written += this.visit(next, column * 2 + 1, row * 2 + 1, x, z, at + written);
			return written;
		}
		this.levels[at] = level;
		this.columns[at] = column;
		this.rows[at] = row;
		return 1;
	}
}
