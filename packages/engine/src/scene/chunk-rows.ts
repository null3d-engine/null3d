// The writer that packs chunks of rows into an instance batch's rows in the core's memory. An
// add-on whose cloud arrives as chunks, such as the splats add-on, stores each chunk once at load
// and then asks this writer to pack the chosen prefix of each chunk into the batch's rows in
// chunk order. The pack runs in the core, so a frame copies no rows through the sketch's heap and
// no loop over instances runs in TypeScript.
//
// The chunk arrays live in the engine's memory: the add-on gets their addresses and writes them
// once, when a chunk arrives. The chosen counts cross in a plan of one number for each slot, which
// the writer fills from the selection and the core reads. The batch's active count and its dirty
// rows belong to the core's pack, so the rows upload once, as they changed.
//
// Each writer owns a cloud of the core's table, so several chunked draws of one scene keep their
// slots apart. This module loads on first use, with the first `instanceBatch.createChunkRows()`.

import type { CoreMemory, ViewHolder } from './memory';
import type { InstanceBatch } from './scene';

/** The fields of a chunk's arrays, as the core numbers them. */
const POSITIONS = 0;
const ROTATIONS = 1;
const SCALES = 2;
const COLORS = 3;
const COVERAGE = 4;

/** The clouds of the thread's engines, each of which takes a number of its own. */
let lastCloud = 0;

/**
 * Fills a pack plan with one chosen count for each slot, and zero past the end of `counts`. A slot
 * that a short list does not name then takes no row, as the pack's rule says. Exported for the
 * unit test of that rule.
 */
export function fillPlan(plan: Float32Array, counts: ArrayLike<number>): void {
	const length = Math.min(plan.length, counts.length);
	if (counts instanceof Float32Array && counts.length === plan.length) plan.set(counts);
	else for (let i = 0; i < length; i++) plan[i] = counts[i] as number;
	plan.fill(0, length);
}

/**
 * One chunk's rows, in the order that a coarser level keeps: its count, and its arrays.
 *
 * @category api/scene
 */
export interface ChunkRowData {
	/** The number of rows. Every array holds this many entries. */
	readonly count: number;
	/** The rows' positions, three floats each. */
	readonly positions: Float32Array;
	/** The rows' rotations as unit quaternions, four floats each. */
	readonly rotations: Float32Array;
	/** The rows' scales, three floats each. */
	readonly scales: Float32Array;
	/** The rows' linear RGBA colors, four floats each. */
	readonly colors: Float32Array;
	/**
	 * The share of the chunk's surface that each prefix covers, at the prefix lengths that halve
	 * every two steps: index 0 is the whole chunk. The add-on measures it when it cuts the chunk.
	 */
	readonly coverage: Float32Array;
}

/**
 * Packs chunked rows into an instance batch's rows. Store each chunk once with [`write`], then
 * call [`pack`] with one chosen count for each slot. The pack writes the chosen prefix of each
 * chunk, in slot order, and sets the batch's active count.
 *
 * The batch must own its rows' transforms. A batch that reads another batch's rows, such as a
 * part of a model, or a sprite or line batch, takes no chunked rows: a pack on one writes nothing
 * and keeps its active count.
 *
 * The writer keeps one plan array in the engine's memory, so a frame's pack allocates nothing
 * once the slot count is set.
 *
 * @category api/scene
 */
export class ChunkRowWriter implements ViewHolder {
	/** This writer's cloud of the core's table. */
	private readonly cloud = ++lastCloud;
	/** The plan's address, and the generation that its view was made at. */
	private planAddress = 0;
	private generation = -1;
	/** The plan that holds one chosen count for each slot. */
	private plan: Float32Array | undefined;
	/** The number of chunk places that this cloud holds. */
	private slots = 0;

	/** @internal */
	constructor(
		private readonly core: CoreMemory,
		/** The batch whose rows the pack writes. */
		private readonly batch: InstanceBatch,
	) {
		core.holdViews(this);
	}

	/** Forgets the plan view, which the next pack makes again. */
	dropViews(): void {
		this.plan = undefined;
		this.generation = -1;
	}

	/**
	 * Makes room for `slots` chunks, each with its own chosen count. Call it at setup, and again
	 * when the cloud grows more chunks.
	 */
	reserve(slots: number): void {
		const next = Math.max(this.slots, Math.max(0, Math.floor(slots)));
		if (next === this.slots) return;
		this.slots = next;
		this.core.checkGrowth(
			this.core.glue.splatChunksReserve(this.cloud, this.slots),
			'splat chunks',
			'a chunked row writer',
			true,
		);
		this.dropViews();
	}

	/**
	 * Stores a chunk's arrays at `slot`, replacing what the slot held. Call it once when the chunk
	 * arrives, never in a frame.
	 */
	write(slot: number, rows: ChunkRowData): void {
		const core = this.core;
		const count = rows.count;
		core.checkGrowth(
			core.glue.splatChunkPrepare(this.cloud, slot, count),
			'splat chunk',
			'a chunk of rows',
			true,
		);
		// A chunk of no rows holds no array to write.
		if (count === 0) return;
		const field = (which: number): Float32Array => {
			const at = core.check(
				core.glue.splatChunkField(this.cloud, slot, which),
				'splat chunk',
				'a chunk of rows',
			);
			return core.f32(at, count * (which === ROTATIONS || which === COLORS ? 4 : 3));
		};
		field(POSITIONS).set(rows.positions.subarray(0, count * 3));
		field(ROTATIONS).set(rows.rotations.subarray(0, count * 4));
		field(SCALES).set(rows.scales.subarray(0, count * 3));
		field(COLORS).set(rows.colors.subarray(0, count * 4));
		// The pack grows a prefix's splats by the surface it leaves bare, and reads that share from
		// this table, so a frame never measures a chunk's rows again.
		if (rows.coverage.length > 0) {
			const at = core.check(
				core.glue.splatChunkField(this.cloud, slot, COVERAGE),
				'splat chunk',
				'a chunk of rows',
			);
			const shares = core.f32(at, rows.coverage.length);
			shares.set(rows.coverage.subarray(0, shares.length));
		}
	}

	/** Forgets a chunk at `slot`, so it takes no row. */
	forget(slot: number): void {
		this.core.check(
			this.core.glue.splatChunkDestroy(this.cloud, slot),
			'splat chunk',
			'a chunk of rows',
			true,
		);
	}

	/**
	 * Packs each chunk's chosen prefix into the batch's rows, in slot order, and sets the batch's
	 * active count. `counts` gives one chosen count for each slot; a slot past its end, or with a
	 * count of zero, takes no row. Returns the count that the batch draws after the pack, which is
	 * the rows it wrote, or the count it kept when it owns no transform rows.
	 */
	pack(counts: ArrayLike<number>): number {
		const core = this.core;
		const at = core.checkGrowth(core.glue.splatPackPlan(this.slots), 'splat pack plan');
		// The plan only grows, so its address moves only when a broader cloud asks for more slots.
		if (this.generation !== core.generation || this.plan === undefined || at !== this.planAddress) {
			this.plan = core.f32(at, this.slots);
			this.planAddress = at;
			this.generation = core.generation;
		}
		fillPlan(this.plan as Float32Array, counts);
		core.check(
			core.glue.splatPack(this.batch.id, this.cloud, this.slots),
			'splat pack',
			'a chunked row batch',
			true,
		);
		const packed = Math.min(core.glue.splatPackedCount(), this.batch.count);
		// The development check of unmarked writes reads the rows that draw from here.
		this.batch.activeRows = packed;
		return packed;
	}

	/** Forgets every chunk of this writer's cloud, and drops its plan view. */
	destroy(): void {
		this.core.glue.splatChunksDrop(this.cloud);
		this.dropViews();
		this.slots = 0;
	}
}
