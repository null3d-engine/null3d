// Where a self-organizing plant's stems stand: one stem on the plant's axis, or a stool of several
// round it that share one light grid. Each stem leans from vertical by the record's lean, away from
// the stool's centre, and neighbouring stems start from one fused base when the record fuses them.
import { unitAt } from '../core/hash';
import { cos, PI, radians, sin } from '../core/math';
import type { StemSpec } from '../core/record';
import { spreadAt } from '../core/types';

/** One stem's foot and first direction. */
export interface StemStart {
	/** The foot in plant space, on the ground. */
	readonly x: number;
	readonly z: number;
	/** The stem's first direction, a unit vector. */
	readonly direction: readonly [number, number, number];
	/** Metres up which it stays fused with the stool's centre before it leans away. */
	readonly fused: number;
}

/** The hash purposes of the stems' choices. */
const Purpose = { Count: 101, Turn: 102, Lean: 103, Place: 104 } as const;

/**
 * The stems of one plant.
 *
 * @param spec The record's stems.
 * @param seed The scene's seed.
 * @param salt The species' salt.
 * @param variant The variant.
 * @returns One start per stem; the first is the main stem.
 */
export function stemStarts(
	spec: StemSpec,
	seed: number,
	salt: number,
	variant: number,
): StemStart[] {
	const count = Math.max(
		1,
		Math.round(spreadAt(spec.count, unitAt(seed, salt, variant, Purpose.Count))),
	);
	const turn = unitAt(seed, salt, variant, Purpose.Turn) * 2 * PI;
	const starts: StemStart[] = [];
	for (let s = 0; s < count; s++) {
		const lean = radians(
			Math.max(0, spreadAt(spec.lean, unitAt(seed, salt, variant, Purpose.Lean, s))),
		);
		const jitter =
			(unitAt(seed, salt, variant, Purpose.Place, s) - 0.5) *
			(count > 1 ? (2 * PI) / count : 2 * PI);
		const azimuth = turn + (count > 1 ? (s * 2 * PI) / count : 0) + jitter * 0.5;
		const ring = count > 1 ? spec.stool : 0;
		starts.push({
			x: ring * cos(azimuth),
			z: ring * sin(azimuth),
			direction: [sin(lean) * cos(azimuth), cos(lean), sin(lean) * sin(azimuth)],
			fused: count > 1 ? spec.fused : 0,
		});
	}
	return starts;
}
