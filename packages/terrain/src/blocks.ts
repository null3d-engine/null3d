// The blocks of a terrain: how many, how big and where, and the height box of each. A block's
// place follows from its level, column and row, and its box comes from the height field once, at
// setup. The selection that picks the blocks runs in the add-on's WebAssembly module on the
// engine's job workers, so this module holds only what a call reads.
import type { Heightfield } from './heightfield';

/** The most levels a terrain may take, so a leaf's key fits in a number. */
export const MAX_LEVELS = 15;
/** The default faces along each side of a block's grid. */
const DEFAULT_QUADS = 16;
/**
 * The deepest level whose height boxes the blocks keep. A block this deep holds about one height
 * sample a side, and a deeper block takes its ancestor's box, so the boxes stay a few megabytes
 * even for a height field of many samples.
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
export function leavesPerSide(level: number): number {
	return 1 << level;
}

/** The settings of the blocks of a terrain. */
export interface BlocksOptions {
	/** The width and depth of the ground, in meters. */
	size: number;
	/** The finest level, from 0 to 15. A leaf of level `L` covers `size / 2 ** L` meters. */
	maxLevel: number;
	/** The faces along each side of a block's grid, from 1 up. The default is 16. */
	quads?: number;
	/**
	 * The height field that bounds each block's height. Without one every block lies at height 0.
	 * The blocks read it once, so a selection costs no height reads.
	 */
	field?: Heightfield;
}

/**
 * The blocks of a terrain, by level, column and row, with the height box of each. A block's place
 * follows from those three numbers, and a level's blocks all have one size.
 */
export class Blocks {
	/** The width and depth of the ground, in meters. */
	readonly size: number;
	/** The finest level. */
	readonly maxLevel: number;
	/** The faces along each side of a block's grid. */
	readonly quads: number;
	/**
	 * The lowest and highest height of every block, for each level up to the deepest that the
	 * height field can tell apart. A deeper block takes its ancestor's box.
	 */
	private readonly lows: Float32Array[];
	private readonly highs: Float32Array[];
	/** The deepest level whose blocks the height field's samples bound. */
	readonly boundLevel: number;

	constructor(options: BlocksOptions) {
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
		const arrays = this.boundsLevel(level);
		return (this.lows[arrays] as Float32Array)[
			this.boundsIndex(arrays, level, column, row)
		] as number;
	}

	/** The highest height that the block at `level`, `column` and `row` holds, in meters. */
	highAt(level: number, column: number, row: number): number {
		const arrays = this.boundsLevel(level);
		return (this.highs[arrays] as Float32Array)[
			this.boundsIndex(arrays, level, column, row)
		] as number;
	}

	/**
	 * A leaf's key, which names it among every leaf of the terrain: the level's base, then the
	 * leaf's place in that level's own grid. Allocates nothing.
	 */
	key(level: number, column: number, row: number): number {
		return (LEVEL_BASE[level] as number) + column * leavesPerSide(level) + row;
	}

	/** How many height boxes the blocks keep at one level. */
	private static leavesOf(level: number): number {
		return leavesPerSide(level) ** 2;
	}

	/** How many height boxes the blocks keep, which is the length that `packBounds` writes. */
	get boundsLength(): number {
		let length = 0;
		for (let level = 0; level <= this.boundLevel; level++) length += Blocks.leavesOf(level);
		return length;
	}

	/**
	 * Copies every block's height box into two packed arrays, level by level, so a builder that
	 * runs in another thread reads the same boxes. The arrays must hold `boundsLength` numbers.
	 */
	packBounds(lows: Float32Array, highs: Float32Array): void {
		let at = 0;
		for (let level = 0; level <= this.boundLevel; level++) {
			const low = this.lows[level] as Float32Array;
			const high = this.highs[level] as Float32Array;
			lows.set(low, at);
			highs.set(high, at);
			at += low.length;
		}
	}

	/** The array that holds a block's height box: its own level, or its ancestor's. */
	private boundsLevel(level: number): number {
		return level < this.boundLevel ? level : this.boundLevel;
	}

	/** The place of a block's height box in the array of `arrays`, a level at or below its own. */
	private boundsIndex(arrays: number, level: number, column: number, row: number): number {
		const shift = level - arrays;
		return (column >> shift) * leavesPerSide(arrays) + (row >> shift);
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
}
