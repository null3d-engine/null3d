// Prototype L1: how the room's work splits into GPU steps. Each step is a list of bands of rows of
// the generator's draws, in the draws' order. Four ways to size the steps:
//
// - `fixed`: the engine's split into a fixed count of slices of about equal modelled work.
// - `first`: a small first step, a share of the modelled work, whose measured time gives one rate
//   for all work. Every later step holds the work that the rate says fits the target time.
// - `adaptive`: as `first`, and each later step's measured time corrects the rate of each
//   pipeline in it, in proportion to its share of the step.
// - `kind`: each kind of draw (the trace, the blur, the chain's halving, and each level's filter)
//   starts with a small step of its own, whose measured time gives that kind's rate. Later steps
//   of the kind fill the target at that rate, and their times correct it. A step never holds work
//   of a kind whose rate is unknown. The rows of one draw cost the same, but the kinds differ by
//   more than ten times per unit of modelled work on the Mac's GPU.
// - `level`: as `kind`, but a filter draw of a small level runs whole, in a step of its own. Each of
//   its texels runs a loop of thousands of reads, and a band of a few rows holds too few texels to
//   keep the GPU's cores busy, so on the cloud phones a step of one row took as long as the whole
//   level, or longer.
import {
	type Band,
	rowCost,
	type Step,
	sliceBands,
} from '../../../packages/engine/src/gpu/environment-steps';

export type Sizing = 'fixed' | 'first' | 'adaptive' | 'kind' | 'level';

export interface SizingOptions {
	sizing: Sizing;
	/** The fixed split's slice count. */
	slices: number;
	/** The time that a sized step aims at, in milliseconds. */
	targetMs: number;
	/**
	 * The first step's share of the whole modelled work, or under `kind`, each kind's first step's
	 * share of that kind's modelled work. A first step holds at least one row.
	 */
	probeShare: number;
}

/** A planned step: its bands and their modelled work, in all and by rate key. */
export interface PlannedStep {
	bands: Band[];
	cost: number;
	costs: Record<string, number>;
	/** The time that the planner expected the step to take, in milliseconds, or 0 before a rate. */
	predictedMs: number;
	/** Whether the step measures a rate that no step measured before. */
	probe: boolean;
}

/** The most texels of a filter draw that `level` sizing runs whole: six faces of 32 by 32. */
export const WHOLE_TEXELS = 6 * 32 * 32;

/** Whether `level` sizing runs a draw whole, in a step of its own. */
export function runsWhole(step: Step): boolean {
	return step.pipeline === 'prefilter' && 6 * step.size * step.size <= WHOLE_TEXELS;
}

/** The kind of a draw: its pipeline, and for the filter, its level. */
export function drawKind(step: Step): string {
	return step.pipeline === 'prefilter' ? `prefilter ${step.level}` : step.pipeline;
}

/** Hands out the steps of one map, one at a time, from the times measured so far. */
export class StepPlanner {
	readonly total: number;
	private readonly steps: readonly Step[];
	private readonly options: SizingOptions;
	private readonly fixed: Band[][];
	private readonly key: (step: Step) => string;
	/** Each key's whole modelled work. */
	private readonly keyTotals = new Map<string, number>();
	private fixedNext = 0;
	private step = 0;
	private row = 0;
	/** Milliseconds per unit of modelled work, by key, once measured. */
	private readonly rate = new Map<string, number>();
	private last: PlannedStep | undefined;

	constructor(steps: readonly Step[], options: SizingOptions) {
		this.steps = steps;
		this.options = options;
		this.total = steps.reduce((sum, s) => sum + s.size * rowCost(s), 0);
		this.fixed = options.sizing === 'fixed' ? sliceBands(steps, options.slices) : [];
		this.key =
			options.sizing === 'kind' || options.sizing === 'level'
				? drawKind
				: options.sizing === 'adaptive'
					? (s) => s.pipeline
					: () => 'all';
		for (const s of steps)
			this.keyTotals.set(this.key(s), (this.keyTotals.get(this.key(s)) ?? 0) + s.size * rowCost(s));
	}

	/** The next step's bands, or undefined when the map is done. */
	next(): PlannedStep | undefined {
		if (this.options.sizing === 'fixed') {
			while (this.fixedNext < this.fixed.length) {
				const bands = this.fixed[this.fixedNext++] as Band[];
				if (bands.length > 0) return this.plan(bands, false);
			}
			return undefined;
		}
		if (this.step >= this.steps.length) return undefined;
		const current = this.steps[this.step] as Step;
		if (this.options.sizing === 'level' && runsWhole(current)) {
			// A small filter level: every row at once, whatever its rate.
			const bands: Band[] = [{ step: this.step, y: this.row, rows: current.size - this.row }];
			const probe = !this.rate.has(this.key(current));
			this.step++;
			this.row = 0;
			return this.plan(bands, probe);
		}
		const key = this.key(current);
		const probe = !this.rate.has(key);
		const bands: Band[] = [];
		let cost = 0;
		let predicted = 0;
		const probeBudget =
			this.options.probeShare *
			(this.options.sizing === 'kind' ? (this.keyTotals.get(key) ?? 0) : this.total);
		while (this.step < this.steps.length) {
			const s = this.steps[this.step] as Step;
			const units = rowCost(s);
			if (this.options.sizing === 'level' && runsWhole(s)) break;
			if (probe) {
				// A first step measures one key alone, up to its share of the key's work.
				if (this.key(s) !== key) break;
				if (bands.length > 0 && cost + units > probeBudget) break;
			} else {
				const rate = this.rate.get(this.key(s));
				// A step stops before work of a key with no rate yet, and before the row that would pass
				// the target. It takes at least one row.
				if (rate === undefined) break;
				if (bands.length > 0 && predicted + units * rate > this.options.targetMs) break;
				predicted += units * rate;
			}
			const tail = bands[bands.length - 1];
			if (tail && tail.step === this.step && tail.y + tail.rows === this.row)
				bands[bands.length - 1] = { step: tail.step, y: tail.y, rows: tail.rows + 1 };
			else bands.push({ step: this.step, y: this.row, rows: 1 });
			cost += units;
			if (++this.row >= s.size) {
				this.step++;
				this.row = 0;
			}
		}
		return this.plan(bands, probe);
	}

	/** Takes the measured time of the step that `next` gave last. */
	record(ms: number): void {
		const step = this.last;
		if (!step || this.options.sizing === 'fixed') return;
		const keys = Object.keys(step.costs);
		if (step.probe) {
			// A first step sets its key's rate. Under `adaptive`, the map's first step sets every
			// pipeline's rate, which later steps correct.
			const rate = ms / step.cost;
			if (this.options.sizing === 'adaptive')
				for (const key of this.keyTotals.keys()) this.rate.set(key, rate);
			else this.rate.set(keys[0] as string, rate);
			return;
		}
		if (this.options.sizing === 'first' || step.predictedMs <= 0) return;
		// Each key's rate moves by the step's error, in proportion to its share of the step.
		const ratio = ms / step.predictedMs;
		for (const key of keys) {
			const rate = this.rate.get(key) ?? 0;
			const share = ((step.costs[key] ?? 0) * rate) / step.predictedMs;
			this.rate.set(key, rate * ratio ** share);
		}
	}

	private plan(bands: Band[], probe: boolean): PlannedStep {
		const costs: Record<string, number> = {};
		let cost = 0;
		let predictedMs = 0;
		for (const band of bands) {
			const s = this.steps[band.step] as Step;
			const units = band.rows * rowCost(s);
			const key = this.key(s);
			costs[key] = (costs[key] ?? 0) + units;
			cost += units;
			predictedMs += units * (this.rate.get(key) ?? 0);
		}
		this.last = { bands, cost, costs, predictedMs, probe };
		return this.last;
	}
}

/** Every band of every step, for a map made in one step. */
export function wholeMap(steps: readonly Step[]): Band[] {
	return steps.map((s, step) => ({ step, y: 0, rows: s.size }));
}
