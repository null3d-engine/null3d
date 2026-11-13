// The directed frames of the species that state one: each gives its stated counts, stands its limbs
// round the plant, bends gently with no straight run, thins evenly from the measured share of its
// parent, ends every axis in foliage, is one connected body, and is the same plant for the same
// seed.
import { describe, expect, it } from 'bun:test';
import type { MacroSkeleton } from '../core/graph';
import { hashBytes } from '../core/hash';
import type { Species } from '../core/record';
import {
	FRAME_TURN_MOST,
	type FramePlan,
	type FrameSpec,
	frameSkeleton,
	planFrame,
} from '../grow/frame';
import {
	bareEnds,
	baseShare,
	endAzimuth,
	imbalance,
	longestStraight,
	looseAxes,
	planShape,
	sharpestTurn,
	steepestStep,
	thickens,
	widestGap,
} from '../grow/frame-measure';
import { frame as commonAlder } from './common-alder/directed';
import { record as commonAlderRecord } from './common-alder/record';
import { frame as europeanBeech } from './european-beech/directed';
import { record as europeanBeechRecord } from './european-beech/record';
import { frame as hawthornShrub } from './hawthorn-shrub/directed';
import { record as hawthornShrubRecord } from './hawthorn-shrub/record';
import { frame as holmOak } from './holm-oak/directed';
import { record as holmOakRecord } from './holm-oak/record';
import { frame as silverBirch } from './silver-birch/directed';
import { record as silverBirchRecord } from './silver-birch/record';
import { frame as weepingWillow } from './weeping-willow/directed';
import { record as weepingWillowRecord } from './weeping-willow/record';

const SEEDS = [11, 12, 13, 14] as const;
/** The narrowest a crown's plan may be: its narrow side over its wide side, by the owner's ruling. */
const PLAN_LEAST = 0.75;
/** The longest share of a limb or a branch that may hold one direction. */
const STRAIGHT_MOST = 0.2;
/** The most of its thickest radius an axis may drop between two nodes: a stem's foot, and the rest. */
const STEP_STEM = 0.45;
const STEP_MOST = 0.2;

/** What a species' frame is held to. */
interface Held {
	readonly id: string;
	readonly spec: FrameSpec;
	readonly record: Species;
	/** The axes each rule makes on one plant: a count, or the least and the most. */
	readonly counts: Readonly<Record<string, number | readonly [number, number]>>;
	/** The rule whose axes must stand round the plant, and the widest gap between two of them. */
	readonly round: { readonly rule: string; readonly gap: number; readonly lean: number };
	/** Each rule's radius where it leaves, as a share of its parent's there. */
	readonly base: Readonly<Record<string, number>>;
	/** The rules whose axes may run straight: a plumb stem, a hanging whip, a leading shoot. */
	readonly plumb: readonly string[];
	/** The plant's height over the record's, as the least and the most. */
	readonly tall: readonly [number, number];
}

const HELD: readonly Held[] = [
	{
		id: 'silver-birch',
		spec: silverBirch,
		record: silverBirchRecord,
		counts: { leader: 1, limb: 12, top: 5, side: [24, 72] },
		// Twelve limbs a golden angle apart leave no gap wider than two even shares and their jitter.
		round: { rule: 'limb', gap: 80, lean: 0.25 },
		base: { limb: 0.35, side: 0.45, top: 0.4 },
		plumb: ['leader'],
		tall: [0.98, 1.02],
	},
	{
		id: 'common-alder',
		spec: commonAlder,
		record: commonAlderRecord,
		counts: { leader: 1, limb: 16, twig: [16, 80] },
		// Sixteen limbs a golden angle apart leave no gap wider than two even shares and their jitter.
		round: { rule: 'limb', gap: 62, lean: 0.25 },
		base: { limb: 0.25, twig: 0.5 },
		plumb: ['leader'],
		tall: [0.98, 1.02],
	},
	{
		id: 'weeping-willow',
		spec: weepingWillow,
		record: weepingWillowRecord,
		counts: { trunk: 1, great: 3, upper: 3, secondary: 6, branch: [18, 54], whip: [100, 400] },
		// Six level limbs in three pairs leave no gap wider than a pair's share and its jitter.
		round: { rule: 'secondary', gap: 110, lean: 0.25 },
		base: { great: 0.5, upper: 0.55, secondary: 0.55, branch: 0.5, whip: 0.3 },
		// A whip hangs by its own weight.
		plumb: ['trunk', 'whip'],
		// The heads' foliage stands above the highest wood.
		tall: [0.93, 1.02],
	},
	{
		id: 'holm-oak',
		spec: holmOak,
		record: holmOakRecord,
		counts: { stem: 8, arm: 16, fork: 32, twig: 96 },
		// Six outer stems stand a sixth of a turn apart, and the two inner ones lean where they will.
		round: { rule: 'stem', gap: 80, lean: 0.2 },
		base: { arm: 0.65, fork: 0.65, twig: 0.65 },
		plumb: [],
		// The top masses' foliage stands above the highest twig.
		tall: [0.97, 1.06],
	},
	{
		id: 'hawthorn-shrub',
		spec: hawthornShrub,
		record: hawthornShrubRecord,
		counts: { stem: 8, limb: [24, 32], twig: [24, 64], shoot: [56, 104] },
		// Seven outer stems stand a seventh of a turn apart round the one at the middle.
		round: { rule: 'stem', gap: 75, lean: 0.2 },
		base: { limb: 0.7, twig: 0.7, shoot: 0.7 },
		// A leading shoot is straight: the owner's ruling passes it.
		plumb: ['shoot'],
		// The leading shoots' tips are the plant's top.
		tall: [0.95, 1.08],
	},
	{
		id: 'european-beech',
		spec: europeanBeech,
		record: europeanBeechRecord,
		counts: { trunk: 1, low: 4, upper: 3, bough: [28, 63], spray: [28, 252] },
		// Four limbs a quarter turn apart leave no gap wider than that and their jitter.
		round: { rule: 'low', gap: 112, lean: 0.25 },
		base: { low: 0.47, upper: 0.55, bough: 0.5, spray: 0.5 },
		plumb: ['trunk'],
		// The top tiers' foliage stands above the highest wood.
		tall: [0.93, 1.02],
	},
];

/** A species' frame at one seed. */
function planOf(held: Held, seed: number, variant = 0): FramePlan {
	return planFrame(held.spec, { record: held.record, seed, variant, season: 'summer' });
}

/** The digest of the arrays a frame's skeleton holds, so two runs compare byte for byte. */
function digest(skeleton: MacroSkeleton): string {
	return [
		hashBytes(new Uint8Array(skeleton.position.buffer), 1),
		hashBytes(new Uint8Array(skeleton.radius.buffer), 2),
		hashBytes(new Uint8Array(skeleton.parent.buffer), 3),
		hashBytes(skeleton.axes.order, 4),
	].join(':');
}

for (const held of HELD)
	describe(`the ${held.id}'s directed frame`, () => {
		it('gives the stated count of every kind of axis', () => {
			for (const seed of SEEDS) {
				const plan = planOf(held, seed);
				const byRule = new Map<string, number>();
				for (const axis of plan.axes) byRule.set(axis.rule, (byRule.get(axis.rule) ?? 0) + 1);
				expect([...byRule.keys()].sort()).toEqual(Object.keys(held.counts).sort());
				for (const [rule, count] of Object.entries(held.counts)) {
					const made = byRule.get(rule) ?? 0;
					if (typeof count === 'number') expect(made).toBe(count);
					else {
						expect(made).toBeGreaterThanOrEqual(count[0]);
						expect(made).toBeLessThanOrEqual(count[1]);
					}
				}
			}
		});

		it('stands its limbs round the plant and keeps the crown nearly round', () => {
			for (const seed of SEEDS) {
				const plan = planOf(held, seed);
				const round = plan.axes.filter((axis) => axis.rule === held.round.rule);
				expect(widestGap(round.map(endAzimuth))).toBeLessThanOrEqual(held.round.gap);
				expect(imbalance(round)).toBeLessThanOrEqual(held.round.lean);
				expect(planShape(plan).narrow).toBeGreaterThanOrEqual(PLAN_LEAST);
			}
		});

		it('bends every axis gently and leaves no limb a straight run', () => {
			for (const seed of SEEDS)
				for (const axis of planOf(held, seed).axes) {
					expect(sharpestTurn(axis)).toBeLessThanOrEqual(FRAME_TURN_MOST + 0.5);
					if (!held.plumb.includes(axis.rule) && axis.nodes.length >= 5)
						expect(longestStraight(axis)).toBeLessThanOrEqual(STRAIGHT_MOST);
				}
		});

		it("thins every axis evenly from the measured share of its parent's radius", () => {
			for (const seed of SEEDS) {
				const plan = planOf(held, seed);
				for (const axis of plan.axes) {
					expect(thickens(axis)).toBe(false);
					expect(steepestStep(axis)).toBeLessThanOrEqual(
						axis.role === 'stem' ? STEP_STEM : STEP_MOST,
					);
					const share = held.base[axis.rule];
					if (share !== undefined) expect(baseShare(plan, axis)).toBeCloseTo(share, 2);
				}
			}
		});

		it('ends every axis in or under a foliage patch, or in a fork', () => {
			for (const seed of SEEDS) expect(bareEnds(planOf(held, seed))).toEqual([]);
		});

		it('is one connected body that stands at the height of its record', () => {
			for (const seed of SEEDS) {
				const plan = planOf(held, seed);
				expect(looseAxes(plan)).toEqual([]);
				const skeleton = frameSkeleton(plan);
				expect(skeleton.nodeCount).toBe(
					plan.axes.reduce((sum, axis) => sum + axis.nodes.length, 0),
				);
				for (let n = 0; n < skeleton.nodeCount; n++) {
					let at = n;
					let steps = 0;
					while ((skeleton.parent[at] as number) >= 0 && steps++ < skeleton.nodeCount)
						at = skeleton.parent[at] as number;
					expect(skeleton.position[at * 3 + 1]).toBe(0);
				}
				expect(plan.height / plan.scale).toBeGreaterThanOrEqual(held.tall[0]);
				expect(plan.height / plan.scale).toBeLessThanOrEqual(held.tall[1]);
			}
		});

		it('grows the same plant for the same seed and another for another', () => {
			const first = digest(frameSkeleton(planOf(held, 11)));
			expect(digest(frameSkeleton(planOf(held, 11)))).toBe(first);
			expect(digest(frameSkeleton(planOf(held, 12)))).not.toBe(first);
			expect(digest(frameSkeleton(planOf(held, 11, 1)))).not.toBe(first);
		});
	});
