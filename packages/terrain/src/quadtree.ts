// The quadtree's selection, as the terrain's reference reads it: a walk that keeps the ground near
// the camera at its finest and coarser blocks farther away, and writes the leaves it picks into
// flat arrays. The add-on's WebAssembly module holds the port that ships; this walk is the
// reference that the port is checked against, and the builder that the unit tests run in their own
// thread. Only those tests import it, and the package leaves it out of the tarball.
//
// A block splits while its grid would show more error, in screen pixels, than the caller allows.
// The error is the ground one cell of the block measures, projected through the camera's field of
// view, so a narrow field of view keeps detail farther out and a high camera draws the ground
// under it coarser. Each block's height box, read from the field once when the blocks are made,
// lets the distance run in three dimensions rather than across the ground alone.
import { Blocks, type BlocksOptions } from './blocks';

export { MAX_LEVELS } from './blocks';

/** The leaves that the arrays hold at first. */
const FIRST_NODES = 1024;

/** The settings of the quadtree. */
export type QuadtreeOptions = BlocksOptions;

/**
 * Selects the ground's visible blocks each time the camera moves. Every leaf covers
 * `size / 2 ** level` meters with its own grid, so the ground near the camera is fine and the far
 * ground is coarse. A leaf splits while one of its cells shows more screen error than the caller
 * allows, which the camera's position, field of view and drawing buffer's height set.
 */
export class Quadtree extends Blocks {
	/** The level of each picked leaf. */
	levels = new Int32Array(FIRST_NODES);
	/** The column of each picked leaf among the leaves of its level. */
	columns = new Int32Array(FIRST_NODES);
	/** The row of each picked leaf among the leaves of its level. */
	rows = new Int32Array(FIRST_NODES);
	/** How many leaves the last selection picked. */
	count = 0;
	/** The screen error, in pixels per world meter of a cell, that the last selection used. */
	private scale = 0;

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
		// How far one cell of a block reaches before its error fills the buffer: half the buffer over
		// the tangent of half the field of view, over the error allowed. A wider field of view shows
		// fewer pixels per meter, so the ground may stay coarse farther out.
		const half = Math.tan((Math.min(Math.max(fov, 0.01), 179.99) * Math.PI) / 360);
		const screen = screenHeight > 0 ? screenHeight : 1;
		return this.selectWithScale(
			eye,
			error > 0 ? screen / (2 * half * error) : Number.POSITIVE_INFINITY,
		);
	}

	/**
	 * Picks the leaves to draw for a camera at `eye`, reading a scale that the caller worked out
	 * from the field of view, the buffer's height and the error it allows. The builder that runs in
	 * a job worker gets the scale in its own call, so both pick the same leaves.
	 */
	selectWithScale(eye: { readonly [index: number]: number }, scale: number): number {
		const x = eye[0] as number;
		const y = eye[1] as number;
		const z = eye[2] as number;
		this.scale = scale;
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
		const low = this.lowAt(level, column, row);
		const high = this.highAt(level, column, row);
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
