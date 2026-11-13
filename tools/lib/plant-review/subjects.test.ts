// The subjects a macro skeleton gives the close cameras: what the adapter fills, and what it
// reports as absent with its reason.
import { describe, expect, test } from 'bun:test';
import {
	AXIS_LIMB,
	AXIS_STEM,
	BUD_LATERAL,
	BUD_TERMINAL,
	type MacroSkeleton,
	SkeletonBuilder,
} from '../../../packages/vegetation/src/core/graph.ts';
import {
	checkShot,
	forkShot,
	junctionShot,
} from '../../../tests/pages/lib/plant-review/subject-shots.ts';
import {
	type AxisSample,
	absent,
	departureAngle,
	type ForkSubject,
	type GreatLimb,
	isAbsent,
	type Lobe,
	sampleAlong,
	sampleAtHeight,
	subjectsOfSkeleton,
	type TrunkSubject,
	type TwigTip,
} from '../../../tests/pages/lib/plant-review/subjects.ts';

/** A straight run of nodes on an axis from `from`, `count` steps of `step`, its radius tapering. */
function run(
	b: SkeletonBuilder,
	axis: number,
	parent: number,
	from: readonly number[],
	step: readonly number[],
	count: number,
	radius: number,
	taper: number,
): number[] {
	const nodes: number[] = [];
	let previous = parent;
	for (let k = 0; k < count; k++) {
		previous = b.addNode({
			x: (from[0] as number) + (step[0] as number) * k,
			y: (from[1] as number) + (step[1] as number) * k,
			z: (from[2] as number) + (step[2] as number) * k,
			radius: radius * (1 - taper * (k / Math.max(1, count - 1))),
			parent: previous,
			axis,
		});
		nodes.push(previous);
	}
	return nodes;
}

/** Bud sites spread about a point on an axis: terminal ones at the tips, the rest lateral. */
function buds(
	b: SkeletonBuilder,
	axis: number,
	node: number,
	centre: readonly number[],
	spread: number,
	count: number,
): void {
	for (let k = 0; k < count; k++) {
		const turn = (k / count) * 2 * Math.PI;
		b.addBud({
			node,
			x: (centre[0] as number) + Math.cos(turn) * spread,
			y: (centre[1] as number) + (k % 2 === 0 ? spread : -spread) * 0.5,
			z: (centre[2] as number) + Math.sin(turn) * spread,
			frame: [0, 0, 0, 1],
			kind: k % 4 === 0 ? BUD_TERMINAL : BUD_LATERAL,
			vigor: 0.5,
			light: k / count,
			axis,
			woodRadius: 0.004,
		});
	}
}

/**
 * A stem 5 m tall that runs on as a leader, a great limb leaving it nearly level toward +X at its
 * top and a thin limb toward -X. The great limb divides once, into two arms of like size that part
 * in an upright plane, and once more into a thin side shoot. The limbs and the leader carry buds.
 */
function oak(): MacroSkeleton {
	const b = new SkeletonBuilder();
	const stem = b.addAxis({ parent: -1, parentNode: -1, order: 0, kind: AXIS_STEM });
	const trunk = run(b, stem, -1, [0, 0, 0], [0, 1, 0], 6, 0.8, 0.3);
	const top = trunk[5] as number;
	const leader = b.addAxis({ parent: stem, parentNode: top, order: 1, kind: AXIS_LIMB });
	const lead = run(b, leader, top, [0, 6, 0], [0, 1, 0], 8, 0.5, 0.8);
	const great = b.addAxis({ parent: stem, parentNode: top, order: 1, kind: AXIS_LIMB });
	const limb = run(b, great, top, [1, 5.2, 0], [1, 0.1, 0], 9, 0.45, 0.5);
	const thin = b.addAxis({ parent: stem, parentNode: top, order: 1, kind: AXIS_LIMB });
	const twig = run(b, thin, top, [-1, 5.4, 0], [-1, 0.3, 0], 4, 0.1, 0.5);
	const fork = limb[5] as number;
	const arm = b.addAxis({ parent: great, parentNode: fork, order: 2, kind: AXIS_LIMB });
	const armNodes = run(b, arm, fork, [6.4, 6.3, 0], [0.4, 0.8, 0], 4, 0.25, 0.5);
	const shoot = b.addAxis({
		parent: great,
		parentNode: limb[7] as number,
		order: 2,
		kind: AXIS_LIMB,
	});
	run(b, shoot, limb[7] as number, [8, 5.9, 0.3], [0, 0, 0.3], 3, 0.03, 0.5);
	buds(b, great, limb[8] as number, [9, 6, 0], 0.6, 12);
	buds(b, arm, armNodes[3] as number, [7.6, 8.7, 0], 0.6, 12);
	buds(b, leader, lead[7] as number, [0, 13, 0], 0.8, 16);
	buds(b, thin, twig[3] as number, [-4, 6.3, 0], 0.5, 4);
	return b.finish(5);
}

describe('the subjects of a macro skeleton', () => {
	const subjects = subjectsOfSkeleton(oak(), { leafLength: 0.11 });
	const trunk = subjects.trunk as TrunkSubject;
	const limbs = subjects.limbs as readonly GreatLimb[];

	test('names the trunk from its foot through the limb that carries its line on', () => {
		expect(subjects.source).toBe('macro skeleton');
		expect(trunk.base).toEqual([0, 0, 0]);
		// The stem's six nodes and the leader's eight.
		expect(trunk.axis.length).toBe(14);
		expect((trunk.axis[trunk.axis.length - 1] as AxisSample).at[1]).toBe(13);
		expect(trunk.breast.at[1]).toBeCloseTo(1.3, 9);
		expect(trunk.breast.radius).toBeCloseTo(0.8 * (1 - 0.3 * (1.3 / 5)), 6);
		// The great limb takes more than a fifth of the stem's section at 5 m.
		expect((trunk.firstFork as AxisSample).at[1]).toBe(5);
		expect(subjects.crownBase).toBe(5);
		expect(subjects.height).toBe(13);
	});

	test('names the great limbs with their joints, the thickest first, less the leader', () => {
		// The thin limb is under the share of the thickest that makes a limb great.
		expect(limbs.length).toBe(1);
		const limb = limbs[0] as GreatLimb;
		expect(limb.joint).toEqual([0, 5, 0]);
		expect(limb.trunkDirection).toEqual([0, 1, 0]);
		expect(limb.radius).toBeCloseTo(0.45, 6);
		expect(limb.trunkRadius).toBeCloseTo(0.8 * 0.7, 6);
		expect(limb.direction[0]).toBeGreaterThan(0.9);
		expect(departureAngle(limb)).toBeGreaterThan(60);
		// Its centre line starts at the joint and runs to its tip.
		expect((limb.axis[0] as AxisSample).at).toEqual([0, 5, 0]);
		expect(limb.axis.length).toBe(10);
		expect(limb.length).toBeGreaterThan(9);
	});

	test('names the forks where a limb divides, each with its arms and its order', () => {
		const forks = subjects.forks as readonly ForkSubject[];
		expect(forks.length).toBe(1);
		const fork = forks[0] as ForkSubject;
		expect(fork.at[0]).toBeCloseTo(6, 6);
		expect(fork.order).toBe(1);
		expect(fork.radius).toBeGreaterThan(fork.armRadii[1]);
		// The limb runs on toward +X and the arm rises.
		expect(fork.arms[0][0]).toBeGreaterThan(0.9);
		expect(fork.arms[1][1]).toBeGreaterThan(0.5);
	});

	test("stands a branch's bud sites in for a lobe, no larger than a lobe may be", () => {
		const lobes = subjects.lobes as readonly Lobe[];
		// The great limb's sites and its arm's lie 3 m apart, too far for one lobe, so the arm's own
		// sites make a lobe and the leader's make another. The thin limb carries too few.
		expect(lobes.length).toBe(2);
		const [top, side] = [...lobes].sort((a, b) => b.centre[1] - a.centre[1]);
		expect((top as Lobe).centre[0]).toBeCloseTo(0, 6);
		expect((top as Lobe).centre[1]).toBeCloseTo(13, 6);
		// The arm's lobe names the great limb it grows from.
		expect((side as Lobe).limb).toBe(limbs[0]?.id);
		expect((side as Lobe).centre[0]).toBeCloseTo(7.6, 6);
		expect((side as Lobe).centre[1]).toBeCloseTo(8.7, 6);
		expect((side as Lobe).radius).toBeGreaterThan(0.6);
		expect((side as Lobe).radius).toBeLessThan(0.12 * 13);
		for (const lobe of lobes) expect(lobe.radius).toBeLessThanOrEqual(0.12 * 13);
	});

	test('names the twig tips, the best lit and farthest out first', () => {
		const tips = subjects.twigTips as readonly TwigTip[];
		// Every fourth bud site is a terminal one.
		expect(tips.length).toBe(3 + 3 + 4 + 1);
		expect((tips[0] as TwigTip).radius).toBeCloseTo(0.004, 9);
		expect((tips[0] as TwigTip).direction).toEqual([0, 1, 0]);
	});

	test('reports what a skeleton cannot name as absent, with the reason', () => {
		expect(subjects.pieces).toEqual(
			absent('the skeleton instances no branch piece: the cut views draw the review cutting'),
		);
		expect(subjects.leaf).toEqual({ length: 0.11 });
		expect(isAbsent(subjectsOfSkeleton(oak()).leaf)).toBe(true);
	});

	test('gives the cameras a junction and a fork they can frame', () => {
		const lens = { fov: 50, aspect: 3 / 4 };
		const junction = junctionShot(subjects, lens);
		if (isAbsent(junction)) throw new Error(junction.absent);
		expect(junction.facts.limb).toBe(limbs[0]?.id);
		expect(checkShot(junction, lens).present).toBe(true);
		const fork = forkShot(subjects, lens);
		if (isAbsent(fork)) throw new Error(fork.absent);
		expect(checkShot(fork, lens).present).toBe(true);
	});
});

describe('the subjects of a plant with no trunk', () => {
	test('reports the trunk, the limbs, the forks and the lobes as absent', () => {
		// A tuft: a crown axis a hand tall, and blades that leave it.
		const b = new SkeletonBuilder();
		const crown = b.addAxis({ parent: -1, parentNode: -1, order: 0, kind: AXIS_STEM });
		const nodes = run(b, crown, -1, [0, 0, 0], [0, 0.02, 0], 3, 0.03, 0);
		const blade = b.addAxis({
			parent: crown,
			parentNode: nodes[2] as number,
			order: 1,
			kind: AXIS_LIMB,
		});
		run(b, blade, nodes[2] as number, [0.1, 0.1, 0], [0.1, 0.25, 0], 4, 0.004, 0.5);
		const subjects = subjectsOfSkeleton(b.finish(0));
		const why = absent('the plant has no stem that reaches a tenth of its height');
		expect(subjects.trunk).toEqual(why);
		expect(subjects.limbs).toEqual(why);
		expect(subjects.forks).toEqual(why);
		expect(isAbsent(subjects.lobes)).toBe(true);
		expect(isAbsent(subjects.twigTips)).toBe(true);
		expect(subjects.height).toBeCloseTo(0.85, 6);
		// A cut piece that carries an empty skeleton names nothing either, and does not throw.
		const empty = subjectsOfSkeleton(new SkeletonBuilder().finish(0));
		expect(isAbsent(empty.trunk)).toBe(true);
		expect(isAbsent(empty.forks)).toBe(true);
	});
});

describe('the subjects of a tree that forks low', () => {
	test('keep its trunk, though the stem ends a fifth of the way up', () => {
		// A willow: the stem ends at 2 m in two great limbs that part wide, on a tree 9 m tall.
		const b = new SkeletonBuilder();
		const stem = b.addAxis({ parent: -1, parentNode: -1, order: 0, kind: AXIS_STEM });
		const top = run(b, stem, -1, [0, 0, 0], [0, 0.5, 0], 5, 0.5, 0.2)[4] as number;
		for (const side of [1, -1]) {
			const limb = b.addAxis({ parent: stem, parentNode: top, order: 1, kind: AXIS_LIMB });
			run(b, limb, top, [side, 3, 0], [side, 1, 0], 7, 0.3, 0.6);
		}
		const subjects = subjectsOfSkeleton(b.finish(2));
		const trunk = subjects.trunk as TrunkSubject;
		expect(isAbsent(trunk)).toBe(false);
		expect((trunk.axis[trunk.axis.length - 1] as AxisSample).at[1]).toBe(2);
		expect((subjects.limbs as readonly GreatLimb[]).length).toBe(2);
	});
});

describe('a sample of an axis', () => {
	const line: AxisSample[] = [
		{ at: [0, 0, 0], radius: 1 },
		{ at: [0, 4, 0], radius: 0.6 },
		{ at: [3, 8, 0], radius: 0.2 },
	];

	test('at a height lies on the axis with the radius between its neighbours', () => {
		expect(sampleAtHeight(line, 2)).toEqual({ at: [0, 2, 0], radius: 0.8 });
		expect(sampleAtHeight(line, 6)?.at[0]).toBeCloseTo(1.5, 9);
		expect(sampleAtHeight(line, 9)).toBe(undefined);
	});

	test('a share of the way along carries the direction there', () => {
		// The axis runs 4 m, then 5 m.
		const at = sampleAlong(line, 4 / 9);
		expect(at.at[1]).toBeCloseTo(4, 9);
		const far = sampleAlong(line, 1);
		expect(far.at).toEqual([3, 8, 0]);
		expect(far.direction[0]).toBeCloseTo(0.6, 9);
		expect(far.direction[1]).toBeCloseTo(0.8, 9);
	});
});
