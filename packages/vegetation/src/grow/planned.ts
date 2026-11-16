// The planned grower: a plant that builds only the state its request asks for, from the numbers the
// plan worked out first.
//
// This is a stub of the interface: it grows one bare stem whose height the record's height curve
// gives at the plan's age, so the model is registered and a record's planned form draws while the
// adult plan, the fill, the sparseness and the maximum are written against the same interface.
import { AXIS_STEM, type MacroSkeleton, SkeletonBuilder } from '../core/graph';
import type { Planned, Species } from '../core/record';
import { curveAt } from '../core/types';
import type { DetailPlan, GrowInput, GrowRequest } from '../stages';
import type { Grower } from './models';

/** Metres between the stem's nodes. */
const STEM_NODE = 0.5;

/** The plant's height at the plan's age, from the record's height curve in metres by age. */
function heightAt(growth: Planned, age: number): number {
	const full = Math.max(1e-6, growth.fullAge);
	return Math.max(0, curveAt(growth.height, Math.min(1, Math.max(0, age / full))));
}

/**
 * What one requested state costs, as numbers, before any geometry: the stub plans the record's
 * height at the request's age and nothing else.
 */
export function planTree(record: Species, request: GrowRequest): DetailPlan {
	const growth = record.growth as Planned;
	const age = request.maturity * growth.fullAge;
	return {
		age,
		finestOrder: 0,
		expected: [],
		tubeSides: [],
		foliage: [],
		triangles: { trunk: 0, limbs: 0, branches: 0, twigs: 0, foliage: 0, fruit: 0 },
		fruit: 0,
		flowers: 0,
		rankCut: [],
	};
}

/** Grows the stem only, to the plan's height, and counts what it made. */
export function growPlanned(input: GrowInput): MacroSkeleton {
	const growth = input.record.growth as Planned;
	const maturity = input.request?.maturity ?? 1;
	const age = input.plan?.age ?? maturity * growth.fullAge;
	const height = heightAt(growth, age);
	if (height <= 0) {
		const empty = new SkeletonBuilder();
		const skeleton = empty.finish(0);
		return { ...skeleton, clumps: [], made: 0, shed: 0 };
	}
	const builder = new SkeletonBuilder();
	const axis = builder.addAxis({ parent: -1, parentNode: -1, order: 0, kind: AXIS_STEM });
	const rings = Math.max(1, Math.ceil(height / STEM_NODE));
	let parent = -1;
	for (let ring = 0; ring <= rings; ring++) {
		const share = ring / rings;
		parent = builder.addNode({
			x: 0,
			y: height * share,
			z: 0,
			radius: 0.12 * (1 - share * 0.9),
			parent,
			axis,
		});
	}
	return { ...builder.finish(0), clumps: [], made: rings + 1, shed: 0 };
}

/** The planned grower. */
export const grower: Grower = {
	grow: growPlanned,
	plan: planTree,
};
