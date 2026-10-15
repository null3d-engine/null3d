// The chunked level of detail: a quadtree over the height field that keeps the ground near the
// camera at its finest and coarser blocks farther away. The selection is pure: it writes the
// leaves it picks into flat arrays, which grow only when a selection picks more leaves than any
// before it, so a frame that moves the camera allocates nothing.

/** The leaves that the arrays hold at first. */
const FIRST_NODES = 1024;
/** The most levels a terrain may take, so a leaf's key fits in a number. */
export const MAX_LEVELS = 15;
/**
 * The largest split distance. At 15 levels it picks about 8,000 leaves; a larger one picks every
 * leaf of the finest levels over a wide ring, far more blocks than a frame can draw.
 */
export const MAX_SPLIT = 8;

/** The settings of the quadtree. */
export interface QuadtreeOptions {
	/** The width and depth of the ground, in meters. */
	size: number;
	/** The finest level, from 0 to 15. A leaf of level `L` covers `size / 2 ** L` meters. */
	maxLevel: number;
	/**
	 * How far from a block's edge the camera may stand and still split it, as a multiple of the
	 * block's size, above 0 and up to 8. A larger value keeps detail farther out and picks more
	 * leaves. The default is 2.
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
	levels = new Int32Array(FIRST_NODES);
	/** The column of each picked leaf among the leaves of its level. */
	columns = new Int32Array(FIRST_NODES);
	/** The row of each picked leaf among the leaves of its level. */
	rows = new Int32Array(FIRST_NODES);
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
		if (!(split > 0 && split <= MAX_SPLIT))
			throw new Error(
				`a quadtree got the split ${split}, which is not a number above 0 and up to ${MAX_SPLIT}.`,
			);
		this.size = size;
		this.maxLevel = maxLevel;
		this.split = split;
	}

	/** The meters that a leaf of level `level` covers, along each side. */
	blockSize(level: number): number {
		return this.size / 2 ** level;
	}

	/** The x of a leaf's low corner, from its level and column. */
	blockX(level: number, column: number): number {
		return -this.size / 2 + column * this.blockSize(level);
	}

	/** The z of a leaf's low corner, from its level and row. */
	blockZ(level: number, row: number): number {
		return -this.size / 2 + row * this.blockSize(level);
	}

	/** A leaf's key, which names it among every leaf of the quadtree. Allocates nothing. */
	key(level: number, column: number, row: number): number {
		return level * 2 ** 30 + column * 2 ** 15 + row;
	}

	/**
	 * Picks the leaves to draw for a camera at `x` and `z`, into the arrays. Returns the count,
	 * which `count` also holds. Two calls with the same arguments pick the same leaves. A call
	 * allocates only when it picks more leaves than the arrays hold, and then grows them.
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
		const block = size / 2 ** level;
		const half = block / 2;
		const centerX = -size / 2 + column * block + half;
		const centerZ = -size / 2 + row * block + half;
		const dx = Math.max(Math.abs(x - centerX) - half, 0);
		const dz = Math.max(Math.abs(z - centerZ) - half, 0);
		if (level < maxLevel && Math.hypot(dx, dz) < block * split) {
			const next = level + 1;
			let written = this.visit(next, column * 2, row * 2, x, z, at);
			written += this.visit(next, column * 2 + 1, row * 2, x, z, at + written);
			written += this.visit(next, column * 2, row * 2 + 1, x, z, at + written);
			written += this.visit(next, column * 2 + 1, row * 2 + 1, x, z, at + written);
			return written;
		}
		if (at >= this.levels.length) this.grow();
		this.levels[at] = level;
		this.columns[at] = column;
		this.rows[at] = row;
		return 1;
	}

	/** Doubles the arrays, keeping the leaves picked so far. */
	private grow(): void {
		const size = this.levels.length * 2;
		const levels = new Int32Array(size);
		const columns = new Int32Array(size);
		const rows = new Int32Array(size);
		levels.set(this.levels);
		columns.set(this.columns);
		rows.set(this.rows);
		this.levels = levels;
		this.columns = columns;
		this.rows = rows;
	}
}
