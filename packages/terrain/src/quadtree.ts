// The chunked level of detail: a quadtree over the height field that keeps the ground near the
// camera at its finest and coarser blocks farther away. The selection is pure: it writes the
// leaves it picks into flat arrays, which grow only when a selection picks more leaves than any
// before it, so a frame that moves the camera allocates nothing.
//
// A block splits while its grid would show more error, in screen pixels, than the caller allows.
// The error is the ground one cell of the block measures, projected through the camera's field of
// view, so a narrow field of view keeps detail farther out and a high camera draws the ground
// under it coarser. Each block's height box, read from the field once when the quadtree is made,
// lets the distance run in three dimensions rather than across the ground alone.
import type { Heightfield } from './heightfield';

/** The leaves that the arrays hold at first. */
const FIRST_NODES = 1024;
/** The most levels a terrain may take, so a leaf's key fits in a number. */
export const MAX_LEVELS = 15;
/** The default faces along each side of a block's grid. */
const DEFAULT_QUADS = 16;
/**
 * The deepest level whose height boxes the quadtree keeps. A block this deep holds about one
 * height sample a side, and a deeper block takes its ancestor's box, so the boxes stay a few
 * megabytes even for a height field of many samples.
 */
const MAX_BOUND_LEVEL = 8;

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
	/** The faces along each side of a block's grid, from 1 up. The default is 16. */
	quads?: number;
	/**
	 * The height field that bounds each block's height. Without one every block lies at height 0.
	 * The quadtree reads it once, so a selection costs no height reads.
	 */
	field?: Heightfield;
}

/**
 * Selects the ground's visible blocks each time the camera moves. Every leaf covers
 * `size / 2 ** level` meters with its own grid, so the ground near the camera is fine and the far
 * ground is coarse. A leaf splits while one of its cells shows more screen error than the caller
 * allows, which the camera's position, field of view and drawing buffer's height set.
 */
export class Quadtree {
	/** The width and depth of the ground, in meters. */
	readonly size: number;
	/** The finest level. */
	readonly maxLevel: number;
	/** The faces along each side of a block's grid. */
	readonly quads: number;
	/** The level of each picked leaf. */
	levels = new Int32Array(FIRST_NODES);
	/** The column of each picked leaf among the leaves of its level. */
	columns = new Int32Array(FIRST_NODES);
	/** The row of each picked leaf among the leaves of its level. */
	rows = new Int32Array(FIRST_NODES);
	/** How many leaves the last selection picked. */
	count = 0;
	/**
	 * The lowest and highest height of every block, for each level up to the deepest that the
	 * height field can tell apart. A deeper block takes its ancestor's box.
	 */
	private readonly lows: Float32Array[];
	private readonly highs: Float32Array[];
	/** The deepest level whose blocks the height field's samples bound, and its leaves a side. */
	private readonly boundLevel: number;
	/** The screen error, in pixels per world meter of a cell, that the last selection used. */
	private scale = 0;

	constructor(options: QuadtreeOptions) {
		const { size, maxLevel, field } = options;
		const quads = options.quads ?? DEFAULT_QUADS;
		if (!(size > 0) || !Number.isFinite(size))
			throw new Error(`a quadtree got the size ${size}, which is not a positive number.`);
		if (!Number.isInteger(maxLevel) || maxLevel < 0 || maxLevel > MAX_LEVELS)
			throw new Error(
				`a quadtree got the maxLevel ${maxLevel}, which is not a whole number from 0 to ${MAX_LEVELS}.`,
			);
		if (!Number.isInteger(quads) || quads < 1)
			throw new Error(
				`a quadtree got the quads ${quads}, which is not a whole number of 1 or more.`,
			);
		this.size = size;
		this.maxLevel = maxLevel;
		this.quads = quads;
		// A block finer than the ground's samples cannot hold more detail than their nearest one.
		const sampleLevel = field ? Math.ceil(Math.log2(field.resolution)) : 0;
		this.boundLevel = Math.min(maxLevel, sampleLevel, MAX_BOUND_LEVEL);
		const bounds = this.buildBounds(field);
		this.lows = bounds.lows;
		this.highs = bounds.highs;
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

	/** The lowest height that the block at `level`, `column` and `row` holds, in meters. */
	lowAt(level: number, column: number, row: number): number {
		const { index, arrays } = this.boundsIndex(level, column, row);
		return (this.lows[arrays] as Float32Array)[index] as number;
	}

	/** The highest height that the block at `level`, `column` and `row` holds, in meters. */
	highAt(level: number, column: number, row: number): number {
		const { index, arrays } = this.boundsIndex(level, column, row);
		return (this.highs[arrays] as Float32Array)[index] as number;
	}

	/**
	 * A leaf's key, which names it among every leaf of the quadtree: the level's base, then the
	 * leaf's place in that level's own grid. Allocates nothing.
	 */
	key(level: number, column: number, row: number): number {
		return (LEVEL_BASE[level] as number) + column * leavesPerSide(level) + row;
	}

	/**
	 * Picks the leaves to draw for a camera whose world position `eye` holds, as x, y and z, and
	 * which draws a buffer `screenHeight` device pixels tall through a vertical field of view of
	 * `fov` degrees. A block splits while one of its cells would show more than `error` pixels of
	 * the ground, and `error` at 0 splits every block to the finest level. Returns the count, which
	 * `count` also holds. Two calls with the same arguments pick the same leaves. A call allocates
	 * only when it picks more leaves than the arrays hold, and then grows them.
	 */
	select(
		eye: { readonly [index: number]: number },
		fov: number,
		screenHeight: number,
		error: number,
	): number {
		const x = eye[0] as number;
		const y = eye[1] as number;
		const z = eye[2] as number;
		// How far one cell of a block reaches before its error fills the buffer: half the buffer over
		// the tangent of half the field of view, over the error allowed. A wider field of view shows
		// fewer pixels per meter, so the ground may stay coarse farther out.
		const half = Math.tan((Math.min(Math.max(fov, 0.01), 179.99) * Math.PI) / 360);
		const screen = screenHeight > 0 ? screenHeight : 1;
		this.scale = error > 0 ? screen / (2 * half * error) : Number.POSITIVE_INFINITY;
		const count = this.visit(0, 0, 0, this.size, 0, 0, x, y, z, 0);
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
		block: number,
		centerX: number,
		centerZ: number,
		x: number,
		y: number,
		z: number,
		at: number,
	): number {
		const half = block / 2;
		const { index, arrays } = this.boundsIndex(level, column, row);
		const low = (this.lows[arrays] as Float32Array)[index] as number;
		const high = (this.highs[arrays] as Float32Array)[index] as number;
		const dx = Math.max(Math.abs(x - centerX) - half, 0);
		const dz = Math.max(Math.abs(z - centerZ) - half, 0);
		const dy = y < low ? low - y : y > high ? y - high : 0;
		// The distance by hand: `Math.hypot` makes one object per call.
		const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
		// The block's own cell is the finest ground it can show, so its screen error falls with it.
		const limit = (block / this.quads) * this.scale;
		if (level < this.maxLevel && distance < limit) {
			const next = level + 1;
			const child = block / 2;
			const quarter = block / 4;
			let written = this.visit(
				next,
				column * 2,
				row * 2,
				child,
				centerX - quarter,
				centerZ - quarter,
				x,
				y,
				z,
				at,
			);
			written += this.visit(
				next,
				column * 2 + 1,
				row * 2,
				child,
				centerX + quarter,
				centerZ - quarter,
				x,
				y,
				z,
				at + written,
			);
			written += this.visit(
				next,
				column * 2,
				row * 2 + 1,
				child,
				centerX - quarter,
				centerZ + quarter,
				x,
				y,
				z,
				at + written,
			);
			written += this.visit(
				next,
				column * 2 + 1,
				row * 2 + 1,
				child,
				centerX + quarter,
				centerZ + quarter,
				x,
				y,
				z,
				at + written,
			);
			return written;
		}
		if (at >= this.levels.length) this.grow();
		this.levels[at] = level;
		this.columns[at] = column;
		this.rows[at] = row;
		return 1;
	}

	/** The array of a block's height box, and its place there. */
	private boundsIndex(
		level: number,
		column: number,
		row: number,
	): { arrays: number; index: number } {
		const arrays = level < this.boundLevel ? level : this.boundLevel;
		const shift = level - arrays;
		const side = leavesPerSide(arrays);
		return { arrays, index: (column >> shift) * side + (row >> shift) };
	}

	/**
	 * Bounds every block's height, from the field's samples. The deepest blocks read the samples
	 * directly, and each coarser level takes the box of its four children.
	 */
	private buildBounds(field: Heightfield | undefined): {
		lows: Float32Array[];
		highs: Float32Array[];
	} {
		const deepest = this.boundLevel;
		const deepestSide = leavesPerSide(deepest);
		const lows: Float32Array[] = [];
		const highs: Float32Array[] = [];
		for (let level = 0; level <= deepest; level++) {
			const side = leavesPerSide(level);
			lows.push(new Float32Array(side * side).fill(Number.POSITIVE_INFINITY));
			highs.push(new Float32Array(side * side).fill(Number.NEGATIVE_INFINITY));
		}
		const leafLows = lows[deepest] as Float32Array;
		const leafHighs = highs[deepest] as Float32Array;
		if (field) {
			const { resolution, heights } = field;
			const span = field.size / deepestSide;
			const half = field.size / 2;
			for (let row = 0; row < resolution; row++) {
				// A sample on the ground's far edge belongs to the last block.
				const z = -half + (row / (resolution - 1)) * field.size;
				const blockRow = Math.min(Math.floor((z + half) / span), deepestSide - 1);
				for (let col = 0; col < resolution; col++) {
					const x = -half + (col / (resolution - 1)) * field.size;
					const blockCol = Math.min(Math.floor((x + half) / span), deepestSide - 1);
					const value = heights[row * resolution + col] as number;
					const index = blockCol * deepestSide + blockRow;
					if (value < (leafLows[index] as number)) leafLows[index] = value;
					if (value > (leafHighs[index] as number)) leafHighs[index] = value;
				}
			}
			// A block that no sample lands in takes the ground's height at its middle.
			for (let blockRow = 0; blockRow < deepestSide; blockRow++)
				for (let blockCol = 0; blockCol < deepestSide; blockCol++) {
					const index = blockCol * deepestSide + blockRow;
					if (leafLows[index] !== Number.POSITIVE_INFINITY) continue;
					const value = field.heightAt(
						-half + (blockCol + 0.5) * span,
						-half + (blockRow + 0.5) * span,
					);
					leafLows[index] = value;
					leafHighs[index] = value;
				}
		} else {
			leafLows.fill(0);
			leafHighs.fill(0);
		}
		for (let level = deepest - 1; level >= 0; level--) {
			const side = leavesPerSide(level);
			const childSide = side * 2;
			const low = lows[level] as Float32Array;
			const high = highs[level] as Float32Array;
			const childLow = lows[level + 1] as Float32Array;
			const childHigh = highs[level + 1] as Float32Array;
			for (let column = 0; column < side; column++)
				for (let row = 0; row < side; row++) {
					const index = column * side + row;
					let lowest = Number.POSITIVE_INFINITY;
					let highest = Number.NEGATIVE_INFINITY;
					for (let corner = 0; corner < 4; corner++) {
						const child = (column * 2 + (corner & 1)) * childSide + row * 2 + (corner >> 1);
						const childLo = childLow[child] as number;
						const childHi = childHigh[child] as number;
						if (childLo < lowest) lowest = childLo;
						if (childHi > highest) highest = childHi;
					}
					low[index] = lowest;
					high[index] = highest;
				}
		}
		return { lows, highs };
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
