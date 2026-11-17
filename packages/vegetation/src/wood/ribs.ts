// The ribs of a column: the pleats of a cactus stem, as a cross-section the wood mesher draws and
// the grower reads to set its areoles on the crests. The pipe radius is the crest, so every areole
// stands on the surface its card grows from; each groove cuts inward by the record's share of the
// radius where it is, so a thin arm and a stout trunk carry pleats of the same proportion.
import { unitAt } from '../core/hash';
import { cos } from '../core/math';
import type { Column, Growth } from '../core/record';
import type { Spread } from '../core/types';
import { spreadAt } from '../core/types';
import type { StemSection } from './flare';

/** Purposes of the ribs' hash keys, so no two draws share one. */
const Purpose = {
	Count: 0x71,
	Phase: 0x72,
} as const;

/**
 * One axis's ribs: how many run round it, how deep a groove cuts, and where a crest stands round the
 * mesher's own angle.
 */
export interface RibPlan {
	/** Ribs around the axis. */
	readonly count: number;
	/** How deep a groove cuts, as a share of the radius where it is. */
	readonly depth: number;
	/** Radians from the mesher's angle 0 to a crest. */
	readonly phase: number;
}

/** The numbers a ribbed section reads: a column's growth or a planned plant's column block. */
export interface RibSource {
	/** Ribs round the stem. */
	readonly ribs: Spread;
	/** Ribs round each arm. */
	readonly armRibs: Spread;
	/** How deep a groove cuts, as a share of the radius. */
	readonly ribDepth: number;
}

/** A column's growth as the rib numbers a section reads. */
export function columnRibs(growth: Column): RibSource {
	return { ribs: growth.ribs, armRibs: growth.arms.ribs, ribDepth: growth.ribDepth };
}

/**
 * The rib numbers a plant's growth states: the column model's growth, or a planned plant whose
 * record names a column block. A plant without ribs returns undefined.
 *
 * @param growth The record's growth.
 * @returns The source, or undefined for a plant without ribs.
 */
export function ribSource(growth: Growth): RibSource | undefined {
	if (growth.model === 'column') return columnRibs(growth);
	if (growth.model === 'planned' && growth.column) return growth.column;
	return undefined;
}

/**
 * The ribs of one axis of a column: the record's count for the stem or for an arm, and a turn of
 * the axis's own.
 *
 * @param source The plant's rib numbers.
 * @param seed The scene's seed.
 * @param salt The species' salt.
 * @param variant The variant.
 * @param axis The skeleton axis, which keys the draws.
 * @param arm Whether the axis is an arm; the stem otherwise.
 * @returns The plan.
 */
export function ribPlan(
	source: RibSource,
	seed: number,
	salt: number,
	variant: number,
	axis: number,
	arm: boolean,
): RibPlan {
	// The stem's count is one draw for the plant; each arm draws its own.
	const count = Math.max(
		3,
		Math.round(
			arm
				? spreadAt(source.armRibs, unitAt(seed, salt, variant, Purpose.Count, axis + 1))
				: spreadAt(source.ribs, unitAt(seed, salt, variant, Purpose.Count, 0)),
		),
	);
	const phase = unitAt(seed, salt, variant, Purpose.Phase, axis) * 2 * Math.PI;
	return { count, depth: source.ribDepth, phase };
}

/**
 * The angle round an axis where one of its rib crests stands, from the mesher's angle 0.
 *
 * @param plan The axis's ribs.
 * @param crest The crest, from 0 to one less than the plan's count.
 * @returns Radians.
 */
export function crestAngle(plan: RibPlan, crest: number): number {
	return (2 * Math.PI * crest - plan.phase) / plan.count;
}

/**
 * The cross-section of a ribbed axis: the pipe radius at the crests, grooving inward between them.
 *
 * @param plan The axis's ribs.
 * @returns The section.
 */
export function ribSection(plan: RibPlan): StemSection {
	const share = Math.min(1, Math.max(0, plan.depth));
	return {
		// Ribs run the whole axis, so the section never settles to the plain pipe.
		reach: Number.POSITIVE_INFINITY,
		lobes: [],
		radius(_h: number, theta: number, r: number): number {
			const pleat = 0.5 - 0.5 * cos(plan.count * theta + plan.phase);
			return r * (1 - share * pleat);
		},
	};
}
