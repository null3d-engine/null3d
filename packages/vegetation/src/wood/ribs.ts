// The ribs of a column: the pleats of a cactus stem, as a cross-section the wood mesher draws and
// the grower reads to set its areoles on the crests. The pipe radius is the crest, so every areole
// stands on the surface its card grows from; each groove cuts inward by the record's depth, scaled
// by how thick the wood is, so a thin arm keeps shallow pleats.
import { unitAt } from '../core/hash';
import { cos } from '../core/math';
import type { Column } from '../core/record';
import { curveAt, spreadAt } from '../core/types';
import type { StemSection } from './flare';

/** Purposes of the ribs' hash keys, so no two draws share one. */
const Purpose = {
	Count: 0x71,
	Phase: 0x72,
} as const;

/** The fewest ribs an arm may carry, where its girth asks for fewer than a trunk's. */
const FEWEST_RIBS = 12;

/**
 * One axis's ribs: how many run round it, how deep a groove cuts, and where a crest stands round the
 * mesher's own angle.
 */
export interface RibPlan {
	/** Ribs around the axis. */
	readonly count: number;
	/** Metres of groove at the axis's base radius. */
	readonly depth: number;
	/** Radians from the mesher's angle 0 to a crest. */
	readonly phase: number;
}

/** The pipe radius at the middle of the trunk, which the record's rib depth is stated at. */
export function ribReferenceRadius(growth: Column): number {
	return Math.max(1e-3, curveAt(growth.radius, 0.5));
}

/**
 * The ribs of one axis of a column.
 *
 * @param growth The record's column growth.
 * @param seed The scene's seed.
 * @param salt The species' salt.
 * @param variant The variant.
 * @param axis The skeleton axis, which keys the draws.
 * @param baseRadius The axis's pipe radius at its base, in metres.
 * @returns The plan.
 */
export function ribPlan(
	growth: Column,
	seed: number,
	salt: number,
	variant: number,
	axis: number,
	baseRadius: number,
): RibPlan {
	const trunk = Math.max(
		3,
		Math.round(spreadAt(growth.ribs, unitAt(seed, salt, variant, Purpose.Count, 0))),
	);
	// An arm carries fewer ribs than the trunk: a crest stands about as far round the stem, so the
	// count follows the girth. The reference's arms show twelve to twenty where its trunk shows more.
	const share = Math.min(1, Math.max(0.35, baseRadius / ribReferenceRadius(growth)));
	const count = Math.max(FEWEST_RIBS, Math.min(trunk, Math.round(trunk * share)));
	const phase = unitAt(seed, salt, variant, Purpose.Phase, axis) * 2 * Math.PI;
	return { count, depth: growth.ribDepth, phase };
}

/**
 * The cross-section of a ribbed axis: the pipe radius at the crests, grooving inward between them.
 *
 * @param plan The axis's ribs.
 * @param baseRadius The axis's pipe radius at its base, which its groove depth was stated at.
 * @returns The section.
 */
export function ribSection(plan: RibPlan, baseRadius: number): StemSection {
	const share = plan.depth / Math.max(1e-3, baseRadius);
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
