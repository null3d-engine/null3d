// The directed frames of the species that state one: each gives its stated counts, stands its limbs
// round the plant, holds the crown outline it states, bends gently with no straight run, thins
// evenly from the measured share of its parent, ends every axis in a socket or a fork, gives its
// sockets in the socket record, is one connected body, and is the same plant for the same seed.
// The crown test is itself held to crowns made by hand that must fail it, and the pedunculate oak
// is held to what its photographs show and a smooth dome does not.
import { describe, expect, it } from 'bun:test';
import { speciesProblems } from '../core/check';
import type { MacroSkeleton } from '../core/graph';
import { hashBytes } from '../core/hash';
import { quatRotate, type Vector3 } from '../core/math';
import type { Species } from '../core/record';
import { curveAt, spreadMean } from '../core/types';
import {
	evenOutline,
	FRAME_TURN_MOST,
	type FramePatch,
	type FramePlan,
	type FrameSpec,
	framedRecord,
	frameSkeleton,
	frameSockets,
	growFrame,
	outlineRadius,
	outlineSpan,
	outlineUnder,
	planFrame,
} from '../grow/frame';
import {
	bareEnds,
	baseShare,
	CROWN_BOUNDS,
	type Crown,
	crownFaults,
	crownFill,
	endAzimuth,
	forkShares,
	imbalance,
	longestStraight,
	looseAxes,
	planShape,
	rimLumps,
	sharpestTurn,
	steepestStep,
	thickens,
	underBoundary,
	widestGap,
	woodThrough,
} from '../grow/frame-measure';
import { frame as commonAlder, directed as commonAlderDirected } from './common-alder/directed';
import { record as commonAlderRecord } from './common-alder/record';
import { frame as commonAsh, directed as commonAshDirected } from './common-ash/directed';
import { record as commonAshRecord } from './common-ash/record';
import {
	frame as europeanBeech,
	directed as europeanBeechDirected,
} from './european-beech/directed';
import { record as europeanBeechRecord } from './european-beech/record';
import {
	frame as hawthornShrub,
	directed as hawthornShrubDirected,
} from './hawthorn-shrub/directed';
import { record as hawthornShrubRecord } from './hawthorn-shrub/record';
import { frame as holmOak, directed as holmOakDirected } from './holm-oak/directed';
import { record as holmOakRecord } from './holm-oak/record';
import { frame as olive, directed as oliveDirected } from './olive/directed';
import { record as oliveRecord } from './olive/record';
import clumpsFirst from './pedunculate-oak/clumps-first.fixture.json';
import {
	frame as pedunculateOak,
	directed as pedunculateOakDirected,
} from './pedunculate-oak/directed';
import { record as pedunculateOakRecord } from './pedunculate-oak/record';
import { frame as silverBirch, directed as silverBirchDirected } from './silver-birch/directed';
import { record as silverBirchRecord } from './silver-birch/record';
import {
	frame as weepingWillow,
	directed as weepingWillowDirected,
} from './weeping-willow/directed';
import { record as weepingWillowRecord } from './weeping-willow/record';

const SEEDS = [11, 12, 13, 14] as const;
/** The narrowest a crown's plan may be: its narrow side over its wide side, by the owner's ruling. */
const PLAN_LEAST = 0.75;
/**
 * How far a built crown may stand off the outline its species states: the patches' reach over the
 * outline's, as the mean over eight sides and the bands of the crown's wide part, and the least of
 * any one side's own mean. These are a builder's working band, not the review standard's.
 */
const FILL_MEAN: readonly [number, number] = [0.75, 1.15];
const FILL_SIDE = 0.5;
/**
 * The owner's five rules as the scaffold build's tests state them, held on every frame. Sky spread
 * evenly and balance through the turn: each eighth of the turn round the trunk holds this share of
 * an even eighth of the sockets, and the crown's width at eight angles differs by no more than the
 * species' all-round band. No kinks: no bend's radius is under this many of the wood's diameters
 * there, and no limb that leaves a stem runs back toward where it left by more than this share of
 * the height.
 * Not too many branches: the axes for each socket. No branch end bare is the socket test's.
 */
const EIGHTH_SHARE: readonly [number, number] = [0.45, 1.8];
const ROUND_BAND = 0.25;
const BEND_DIAMETERS_LEAST = 3;
const BACK_MOST = 0.03;
const BACKWARD_JOINTS_MOST = 0.02;
const AXES_PER_SOCKET_MOST = 1.6;
/**
 * How far, as a share of the height, the end of an axis that runs down may stand under the lower
 * boundary beyond where the axis left: its length is found on a course summed in steps, and the
 * course is then laid in arches.
 */
const UNDER_SLACK = 0.02;
const DEG = 180 / Math.PI;

/** The unit step from one node of a skeleton to another, and its length. */
function step(s: MacroSkeleton, from: number, to: number): [number, number, number, number] {
	const x = (s.position[to * 3] as number) - (s.position[from * 3] as number);
	const y = (s.position[to * 3 + 1] as number) - (s.position[from * 3 + 1] as number);
	const z = (s.position[to * 3 + 2] as number) - (s.position[from * 3 + 2] as number);
	const length = Math.hypot(x, y, z);
	return length > 0 ? [x / length, y / length, z / length, length] : [0, 1, 0, 0];
}

/** The radians between two unit steps. */
function between(a: readonly number[], b: readonly number[]): number {
	return Math.acos(
		Math.max(
			-1,
			Math.min(
				1,
				(a[0] as number) * (b[0] as number) +
					(a[1] as number) * (b[1] as number) +
					(a[2] as number) * (b[2] as number),
			),
		),
	);
}
/** The longest share of a limb or a branch that may hold one direction. */
const STRAIGHT_MOST = 0.2;
const STUB_DIAMETERS = 8;
/** The most of its thickest radius an axis may drop between two nodes: a stem's foot, and the rest. */
const STEP_STEM = 0.45;
const STEP_MOST = 0.2;

/** What a species' frame is held to. */
interface Held {
	readonly id: string;
	readonly spec: FrameSpec;
	readonly record: Species;
	/** The species' record with the frame as its growth, and the middle of its height in metres. */
	readonly directed: Species;
	readonly heightMean: number;
	/** The axes each rule makes on one plant: a count, or the least and the most. */
	readonly counts: Readonly<Record<string, number | readonly [number, number]>>;
	/** The rule whose axes must stand round the plant, and the widest gap between two of them. */
	readonly round: { readonly rule: string; readonly gap: number; readonly lean: number };
	/** Each rule's radius where it leaves, as a share of its parent's there. */
	readonly base: Readonly<Record<string, number>>;
	/** The rules whose axes may run straight: a plumb stem, a hanging whip, a leading shoot. */
	readonly plumb: readonly string[];
	/**
	 * The pairs of axes whose wood passes through each other, summed over the seeds. The number may
	 * only fall: the test fails when it rises, and fails when it falls until it is lowered here in
	 * the same commit.
	 */
	readonly through: number;
	/** The plant's height over the record's, as the least and the most. */
	readonly tall: readonly [number, number];
	/** The axes for each socket over the seeds, to three places: also a number that may only fall. */
	readonly axesPerSocket: number;
	/**
	 * The rules whose axes are the finest wood, grown to clothe a patch: short kinked twigs, which
	 * the bounds on a limb's bends and on the way a branch leaves do not hold.
	 */
	readonly fine?: readonly string[];
	/**
	 * The requirements the tree is known not to meet yet: its crown's mean fill of its outline, its
	 * sockets' spread through the turn, its bends' radius. A test of an open requirement expects the
	 * failure, and fails when the tree starts to hold, so the name must come off as the tree is
	 * mended.
	 */
	readonly open?: readonly ('fill' | 'spread' | 'bends')[];
}

const HELD: readonly Held[] = [
	{
		id: 'silver-birch',
		spec: silverBirch,
		directed: silverBirchDirected,
		heightMean: spreadMean(silverBirchDirected.size.height),
		record: silverBirchRecord,
		counts: { leader: 1, limb: 12, top: 5, side: [24, 72], fall: [12, 36] },
		// Twelve limbs a golden angle apart leave no gap wider than two even shares and their jitter.
		round: { rule: 'limb', gap: 80, lean: 0.25 },
		base: { limb: 0.35, side: 0.45, top: 0.4, fall: 0.4 },
		// A fall hangs by its own weight.
		plumb: ['leader', 'fall'],
		through: 0,
		axesPerSocket: 1.0,
		tall: [0.98, 1.02],
		open: ['spread'],
	},
	{
		id: 'common-alder',
		spec: commonAlder,
		directed: commonAlderDirected,
		heightMean: spreadMean(commonAlderDirected.size.height),
		record: commonAlderRecord,
		counts: { leader: 1, limb: 24, twig: [24, 168] },
		// Twenty-four limbs a golden angle apart leave no gap wider than two even shares and their
		// jitter.
		round: { rule: 'limb', gap: 46, lean: 0.25 },
		base: { limb: 0.25, twig: 0.5 },
		plumb: ['leader'],
		through: 0,
		axesPerSocket: 1.0,
		tall: [0.98, 1.02],
	},
	{
		id: 'weeping-willow',
		spec: weepingWillow,
		directed: weepingWillowDirected,
		heightMean: spreadMean(weepingWillowDirected.size.height),
		record: weepingWillowRecord,
		counts: { trunk: 1, great: 3, upper: 3, secondary: 6, branch: [18, 54], whip: [100, 400] },
		// Six level limbs in three pairs leave no gap wider than a pair's share and its jitter.
		round: { rule: 'secondary', gap: 110, lean: 0.25 },
		base: { great: 0.5, upper: 0.55, secondary: 0.55, branch: 0.5, whip: 0.3 },
		// A whip hangs by its own weight.
		plumb: ['trunk', 'whip'],
		// The heads' foliage stands above the highest wood.
		through: 13,
		axesPerSocket: 1.242,
		tall: [0.93, 1.02],
		open: ['spread'],
	},
	{
		id: 'holm-oak',
		spec: holmOak,
		directed: holmOakDirected,
		heightMean: spreadMean(holmOakDirected.size.height),
		record: holmOakRecord,
		counts: { stem: 8, arm: 16, fork: 32, twig: 96 },
		// Six outer stems stand a sixth of a turn apart, and the two inner ones lean where they will.
		round: { rule: 'stem', gap: 80, lean: 0.2 },
		base: { arm: 0.65, fork: 0.65, twig: 0.65 },
		plumb: [],
		// The top masses' foliage stands above the highest twig.
		through: 5,
		axesPerSocket: 1.583,
		tall: [0.97, 1.06],
	},
	{
		id: 'hawthorn-shrub',
		spec: hawthornShrub,
		directed: hawthornShrubDirected,
		heightMean: spreadMean(hawthornShrubDirected.size.height),
		record: hawthornShrubRecord,
		counts: { stem: 8, limb: [24, 32], twig: [24, 64], shoot: [56, 104] },
		// Seven outer stems stand a seventh of a turn apart round the one at the middle.
		round: { rule: 'stem', gap: 75, lean: 0.2 },
		base: { limb: 0.7, twig: 0.7, shoot: 0.7 },
		// A leading shoot is straight: the owner's ruling passes it.
		plumb: ['shoot'],
		// The leading shoots' tips are the plant's top.
		through: 3,
		axesPerSocket: 1.0,
		tall: [0.95, 1.08],
	},
	{
		id: 'european-beech',
		spec: europeanBeech,
		directed: europeanBeechDirected,
		heightMean: spreadMean(europeanBeechDirected.size.height),
		record: europeanBeechRecord,
		counts: { trunk: 1, low: 4, upper: 3, bough: [28, 63], spray: [28, 252] },
		// Four limbs a quarter turn apart leave no gap wider than that and their jitter.
		round: { rule: 'low', gap: 112, lean: 0.25 },
		base: { low: 0.47, upper: 0.55, bough: 0.5, spray: 0.5 },
		plumb: ['trunk'],
		// The top tiers' foliage stands above the highest wood.
		through: 3,
		axesPerSocket: 1.007,
		tall: [0.93, 1.02],
		open: ['fill'],
	},
	{
		id: 'common-ash',
		spec: commonAsh,
		directed: commonAshDirected,
		heightMean: spreadMean(commonAshDirected.size.height),
		record: commonAshRecord,
		counts: { trunk: 1, limb: 4, top: 2, branch: [18, 36], twig: [36, 144] },
		// Two crossed pairs stand a quarter turn apart.
		round: { rule: 'limb', gap: 110, lean: 0.2 },
		base: { limb: 0.52, top: 0.62, branch: 0.45, twig: 0.5 },
		plumb: ['trunk'],
		// The outline's top is blunt, so the bunches on the highest tips stand a little over it.
		through: 0,
		axesPerSocket: 1.012,
		tall: [0.95, 1.05],
		open: ['spread'],
	},
	{
		id: 'olive',
		spec: olive,
		directed: oliveDirected,
		heightMean: spreadMean(oliveDirected.size.height),
		record: oliveRecord,
		counts: { trunk: 1, outer: 4, centre: 2, branch: 18, spray: 54 },
		// Four outer limbs leave a quarter of a turn apart; each one's end wanders with its elbows.
		round: { rule: 'outer', gap: 140, lean: 0.3 },
		base: { outer: 0.34, centre: 0.55, branch: 0.6, spray: 0.6 },
		plumb: ['trunk'],
		through: 5,
		axesPerSocket: 1.463,
		tall: [0.93, 1.05],
		open: ['spread'],
	},
	{
		id: 'pedunculate-oak',
		spec: pedunculateOak,
		directed: pedunculateOakDirected,
		heightMean: spreadMean(pedunculateOakDirected.size.height),
		record: pedunculateOakRecord,
		counts: { trunk: 1, limb: 7, bough: [35, 56], branch: [70, 224], twig: [3500, 6500] },
		// Seven limbs at their own stated directions: six an eighth of a turn apart and one gap of two.
		round: { rule: 'limb', gap: 112, lean: 0.25 },
		// A limb's share runs from 0.42 at the lowest to 0.5 at the highest, so it is not held here.
		base: { bough: 0.5, branch: 0.55 },
		plumb: ['trunk'],
		through: 0,
		// Every twig that clothes a clump is an axis that ends in a socket.
		axesPerSocket: 1,
		fine: ['twig'],
		tall: [0.95, 1.04],
	},
];

/** A foliage patch made by hand: a rounded body of a width and a depth about a centre, in metres. */
function madePatch(centre: Vector3, width: number, depth: number): FramePatch {
	return { kind: 'made', axis: 0, centre, begins: 0, width, depth, along: [1, 0, 0] };
}

/** A species' frame at one seed. */
const PLANS = new Map<string, FramePlan>();
const GROWN = new Map<string, MacroSkeleton>();

/** A species' frame at one seed, planned once for all the tests that read it. */
function planOf(held: Held, seed: number, variant = 0): FramePlan {
	const key = `${held.id}:${seed}:${variant}`;
	let plan = PLANS.get(key);
	if (!plan) {
		plan = planFrame(held.spec, { record: held.record, seed, variant, season: 'summer' });
		PLANS.set(key, plan);
	}
	return plan;
}

/** A species' frame with its sockets, grown once for all the tests that read it. */
function grownOf(held: Held, seed: number): MacroSkeleton {
	const key = `${held.id}:${seed}`;
	let skeleton = GROWN.get(key);
	if (!skeleton) {
		skeleton = growFrame({ record: held.directed, seed, variant: 0, season: 'summer' });
		GROWN.set(key, skeleton);
	}
	return skeleton;
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

describe('a crown outline stated side by side', () => {
	/** A crown that reaches twice as far to one side as to the other, with its own depth each way. */
	const lopsided: FrameSpec = {
		outline: [
			{
				toward: 0,
				reach: [
					[0.2, 0.4],
					[1, 0],
				],
				under: 0.2,
			},
			{
				toward: 90,
				reach: [
					[0.1, 0.3],
					[1, 0],
				],
				under: [
					[0, 0.1],
					[0.3, 0.3],
				],
			},
			{
				toward: 180,
				reach: [
					[0.2, 0.2],
					[1, 0],
				],
				under: 0.2,
			},
			{
				toward: 270,
				reach: [
					[0.1, 0.25],
					[1, 0],
				],
				under: 0.1,
			},
		],
		stems: pedunculateOak.stems,
	};
	const HEIGHT = 10;

	it('gives each side its own reach, and never the mean of two', () => {
		expect(outlineRadius(lopsided, HEIGHT, 2, 0)).toBeCloseTo(4, 9);
		expect(outlineRadius(lopsided, HEIGHT, 2, Math.PI)).toBeCloseTo(2, 9);
		expect(outlineRadius(lopsided, HEIGHT, 2, Math.PI / 2)).toBeCloseTo(2.6667, 3);
		expect(outlineRadius(lopsided, HEIGHT, 2, -Math.PI / 2)).toBeCloseTo(2.2222, 3);
	});

	it('shows a view from any stated side the reach that side states', () => {
		for (const height of [2, 4, 6, 8])
			lopsided.outline.forEach((side) => {
				const toward = (side.toward * Math.PI) / 180;
				let seen = 0;
				for (let k = 0; k < 360; k++) {
					const azimuth = (k * Math.PI) / 180;
					seen = Math.max(
						seen,
						outlineRadius(lopsided, HEIGHT, height, azimuth) * Math.cos(azimuth - toward),
					);
				}
				expect(seen).toBeCloseTo(outlineRadius(lopsided, HEIGHT, height, toward), 6);
			});
	});

	it('has no crown toward a side outside the heights the side states', () => {
		expect(outlineRadius(lopsided, HEIGHT, 1.5, Math.PI / 2)).toBeGreaterThan(0);
		expect(outlineRadius(lopsided, HEIGHT, 1.5, 0)).toBe(0);
		expect(outlineRadius(lopsided, HEIGHT, 1.5, Math.PI / 4)).toBe(0);
		expect(outlineRadius(lopsided, HEIGHT, 10.5, Math.PI / 2)).toBe(0);
		expect(outlineSpan(lopsided)).toEqual({ foot: 0.1, top: 1 });
	});

	it('reads the lower boundary in the view that looks across each side', () => {
		const patch = (x: number, y: number, z: number) => madePatch([x, y, z], 1, 1);
		// A patch 3 m toward the first side and 6 m deep in its view: its foot stands at 1.9 m, under
		// that side's boundary of 2 m, though the boundary where it stands in the quarter-turn view
		// is lower.
		const hung = patch(3, 2.4, -6);
		const found = underBoundary({ scale: HEIGHT, patches: [hung] }, lopsided);
		expect(found.read).toBe(2);
		expect(found.under.map((fault) => fault.side)).toEqual([0]);
		expect(found.under[0]?.reach).toBeCloseTo(0.3, 9);
		expect(found.under[0]?.by).toBeCloseTo(0.01, 9);
		// Raised clear of that boundary, it is under neither.
		expect(underBoundary({ scale: HEIGHT, patches: [patch(3, 2.6, -6)] }, lopsided).under).toEqual(
			[],
		);
		// Only the patches inside the stated distance of the trunk's line are read.
		expect(underBoundary({ scale: HEIGHT, patches: [hung] }, lopsided, 0.2).read).toBe(0);
	});

	it('answers at a place to every side the place stands on', () => {
		// Toward the first side and the second: the higher of the two boundaries there.
		expect(outlineUnder(lopsided, HEIGHT, 3, 3)).toBeCloseTo(3, 9);
		expect(outlineUnder(lopsided, HEIGHT, 3, 1.5)).toBeCloseTo(2, 9);
		// Toward the third side and the fourth.
		expect(outlineUnder(lopsided, HEIGHT, -3, -3)).toBeCloseTo(2, 9);
		// An outline of one curve states no lower boundary.
		const even: FrameSpec = { outline: evenOutline(0.4, 0.8), stems: pedunculateOak.stems };
		expect(outlineUnder(even, HEIGHT, 3, 3)).toBe(0);
	});

	it('builds an even outline as the ellipse of its two axes', () => {
		const reach = [
			[0.3, 0.2],
			[0.6, 0.5],
			[1, 0],
		] as const;
		const even: FrameSpec = { outline: evenOutline(reach, 0.8, 30), stems: pedunculateOak.stems };
		for (let k = 0; k < 72; k++) {
			const azimuth = (k * 5 * Math.PI) / 180;
			const off = azimuth - (30 * Math.PI) / 180;
			const ellipse = 5 / Math.sqrt(Math.cos(off) ** 2 + (Math.sin(off) / 0.8) ** 2);
			expect(outlineRadius(even, HEIGHT, 6, azimuth)).toBeCloseTo(ellipse, 9);
		}
		expect(outlineRadius(even, HEIGHT, 2.5, 1)).toBe(0);
	});

	it('is refused by the record check with one side, or with sides out of their order', () => {
		const stated = (outline: FrameSpec['outline']) =>
			speciesProblems(
				framedRecord(pedunculateOakRecord, { ...lopsided, outline }, { rows: 4, fan: 45 }),
			).filter((problem) => problem.includes('frame.outline'));
		expect(stated(lopsided.outline)).toEqual([]);
		expect(stated(lopsided.outline.slice(0, 1))).toHaveLength(1);
		expect(stated([...lopsided.outline].reverse())).not.toEqual([]);
	});

	it('states the oak by the two sides of still 01 and the two of still 02', () => {
		const right = outlineRadius(pedunculateOak, 1, 0.25, 0);
		const left = outlineRadius(pedunculateOak, 1, 0.25, Math.PI);
		expect(right).toBeCloseTo(0.892, 3);
		expect(left).toBeCloseTo(0.8005, 3);
		expect(pedunculateOak.outline.map((side) => side.toward)).toEqual([0, 90, 180, 270]);
		// On the trunk's line each side's lower boundary is the height the bole stands bare to.
		expect(pedunculateOak.outline.map((side) => curveAt(side.under, 0))).toEqual([
			0.186, 0.164, 0.186, 0.164,
		]);
	});
});

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

		/** A test of a requirement: one that expects its failure while the tree names it open. */
		const required = (name: 'fill' | 'spread' | 'bends') =>
			held.open?.includes(name) ? it.failing : it;
		required('fill')('fills the crown outline it states, on every side', () => {
			for (const seed of SEEDS) {
				const fill = crownFill(planOf(held, seed), held.spec);
				expect(fill.mean).toBeGreaterThanOrEqual(FILL_MEAN[0]);
				expect(fill.mean).toBeLessThanOrEqual(FILL_MEAN[1]);
				expect(fill.least).toBeGreaterThanOrEqual(FILL_SIDE);
			}
		});

		it('stands no foliage under the lower boundary it states, and ends down-running wood at it', () => {
			for (const seed of SEEDS) {
				const plan = planOf(held, seed);
				expect(underBoundary(plan, held.spec).under).toEqual([]);
				const under = (node: { x: number; y: number; z: number }): number =>
					outlineUnder(held.spec, plan.scale, node.x, node.z) - node.y;
				for (const axis of plan.axes) {
					const first = axis.nodes[0];
					const last = axis.nodes[axis.nodes.length - 1];
					if (axis.order === 0 || !first || !last || last.y >= first.y) continue;
					expect(under(last)).toBeLessThanOrEqual(
						Math.max(0, under(first)) + UNDER_SLACK * plan.scale,
					);
				}
			}
		});

		it('bends every axis gently and leaves no limb a straight run', () => {
			for (const seed of SEEDS)
				for (const axis of planOf(held, seed).axes) {
					if (held.fine?.includes(axis.rule)) continue;
					expect(sharpestTurn(axis)).toBeLessThanOrEqual(FRAME_TURN_MOST + 0.5);
					// A stub shorter than this many of its own diameters cannot turn within a fifth of
					// its length on a bend its wood allows, so the bend radius alone judges it.
					if (
						!held.plumb.includes(axis.rule) &&
						axis.nodes.length >= 5 &&
						axis.length >= STUB_DIAMETERS * 2 * axis.base
					)
						expect(longestStraight(axis)).toBeLessThanOrEqual(STRAIGHT_MOST);
				}
		});

		it("thins every axis evenly from the measured share of its parent's radius", () => {
			for (const seed of SEEDS) {
				const plan = planOf(held, seed);
				plan.axes.forEach((axis, index) => {
					// Past a fork an axis may drop by what the fork took of its cross-section, and no more.
					const forks = forkShares(plan, index);
					expect(thickens(axis)).toBe(false);
					expect(steepestStep(axis, forks)).toBeLessThanOrEqual(
						axis.role === 'stem' ? STEP_STEM : STEP_MOST,
					);
					const share = held.base[axis.rule];
					if (share !== undefined) expect(baseShare(plan, axis)).toBeCloseTo(share, 2);
				});
			}
		});

		it('ends every axis in a socket or in a fork', () => {
			for (const seed of SEEDS) {
				const plan = planOf(held, seed);
				const sockets = frameSockets(plan);
				plan.axes.forEach((axis, index) => {
					const forks = plan.axes.some(
						(child) => child.parent === index && (axis.along[child.parentNode] as number) >= 0.9,
					);
					const end = axis.nodes[axis.nodes.length - 1];
					const socket = sockets.some(
						(one) =>
							one.axis === index &&
							one.at[0] === end?.x &&
							one.at[1] === end?.y &&
							one.at[2] === end?.z,
					);
					expect(forks || socket).toBe(true);
				});
				expect(bareEnds(plan)).toEqual([]);
			}
		});

		it('gives its sockets as bud sites in the socket record, ranked once across the plant', () => {
			expect(speciesProblems(held.directed)).toEqual([]);
			for (const seed of SEEDS) {
				const input = { record: held.directed, seed, variant: 0, season: 'summer' } as const;
				const plan = planOf(held, seed);
				const sockets = frameSockets(plan);
				const skeleton = growFrame(input);
				const table = skeleton.buds.sockets;
				// One socket at the end of each patch's wood, and the rest along the wood under it.
				expect(
					sockets.filter((socket) => socket.along === 1).map((socket) => socket.patch),
				).toEqual(plan.patches.map((_, k) => k));
				for (const socket of sockets) {
					const patch = plan.patches[socket.patch];
					expect(patch?.axis).toBe(socket.axis);
					if (socket.along < 1) expect(patch?.sockets).toBeDefined();
				}
				expect(skeleton.buds.count).toBe(sockets.length);
				expect(table).toBeDefined();
				if (!table) continue;
				// One rank for each socket, every rank from 0 used once.
				expect([...table.rank].sort((a, b) => a - b)).toEqual(sockets.map((_, k) => k));
				const along: Vector3 = [0, 0, 0];
				sockets.forEach((socket, b) => {
					expect(table.lobe[b]).toBe(socket.patch);
					expect(table.rank[b]).toBe(socket.rank);
					// Shoot rows are the plant's own height over the species' middle height; a branch
					// piece is the size its leaves make it.
					const growth = held.directed.growth;
					const piece = growth.model === 'frame' && growth.sockets.piece !== undefined;
					expect(table.scale[b]).toBeCloseTo(piece ? 1 : plan.scale / held.heightMean, 5);
					expect(skeleton.buds.position[b * 3 + 1]).toBeCloseTo(socket.at[1], 4);
					quatRotate(skeleton.buds.frame, b * 4, [0, 1, 0], along);
					expect(
						along[0] * socket.heading[0] +
							along[1] * socket.heading[1] +
							along[2] * socket.heading[2],
					).toBeGreaterThan(0.999);
				});
				// The first quarter of the ranks stands in every quarter round the trunk that any
				// socket stands in, so a plant thinned to it keeps every side.
				const quarter = (socket: (typeof sockets)[number]) =>
					(socket.at[0] >= 0 ? 1 : 0) + (socket.at[2] >= 0 ? 2 : 0);
				const kept = sockets.filter((socket) => socket.rank < Math.ceil(sockets.length / 4));
				expect(new Set(kept.map(quarter)).size).toBe(new Set(sockets.map(quarter)).size);
			}
		});

		required('spread')('spreads its sockets through the whole turn round the trunk', () => {
			for (const seed of SEEDS) {
				const s = grownOf(held, seed);
				const eighths = new Float64Array(8);
				for (let b = 0; b < s.buds.count; b++) {
					const turn = Math.atan2(
						s.buds.position[b * 3 + 2] as number,
						s.buds.position[b * 3] as number,
					);
					const eighth = Math.floor(((turn + 2 * Math.PI) % (2 * Math.PI)) / (Math.PI / 4)) % 8;
					eighths[eighth] = (eighths[eighth] as number) + 1;
				}
				const even = s.buds.count / 8;
				expect(Math.min(...eighths) / even).toBeGreaterThan(EIGHTH_SHARE[0]);
				expect(Math.max(...eighths) / even).toBeLessThan(EIGHTH_SHARE[1]);
				const widths: number[] = [];
				for (let k = 0; k < 8; k++) {
					const turn = (k * Math.PI) / 4;
					let low = Number.POSITIVE_INFINITY;
					let high = Number.NEGATIVE_INFINITY;
					for (let b = 0; b < s.buds.count; b++) {
						const across =
							(s.buds.position[b * 3] as number) * Math.cos(turn) -
							(s.buds.position[b * 3 + 2] as number) * Math.sin(turn);
						low = Math.min(low, across);
						high = Math.max(high, across);
					}
					widths.push(high - low);
				}
				const mean = widths.reduce((sum, width) => sum + width, 0) / widths.length;
				expect((Math.max(...widths) - Math.min(...widths)) / mean).toBeLessThan(
					held.directed.roundBand ?? ROUND_BAND,
				);
			}
		});

		required('bends')("bends on no radius under three of its wood's diameters", () => {
			for (const seed of SEEDS) {
				const plan = planOf(held, seed);
				const s = grownOf(held, seed);
				let tightest = Number.POSITIVE_INFINITY;
				for (let n = 0; n < s.nodeCount; n++) {
					const at = s.parent[n] as number;
					const before = at >= 0 ? (s.parent[at] as number) : -1;
					if (before < 0 || s.axisOf[at] !== s.axisOf[n] || s.axisOf[before] !== s.axisOf[n])
						continue;
					if (held.fine?.includes(plan.axes[s.axisOf[n] as number]?.rule ?? '')) continue;
					// The radius of the bend at a node: the mean of its two pieces over the turn between
					// them.
					const last = step(s, before, at);
					const next = step(s, at, n);
					const turn = between(last, next);
					if (turn > 0.01)
						tightest = Math.min(
							tightest,
							(last[3] + next[3]) / 2 / turn / (2 * (s.radius[at] as number)),
						);
				}
				expect(tightest).toBeGreaterThanOrEqual(BEND_DIAMETERS_LEAST);
			}
		});

		it('runs no limb back toward the trunk and leaves its branches forward', () => {
			for (const seed of SEEDS) {
				const plan = planOf(held, seed);
				const s = grownOf(held, seed);
				let back = 0;
				let sides = 0;
				let backward = 0;
				for (let a = 0; a < s.axes.count; a++) {
					// A hanging axis leaves its branch downward, which on rising wood is backward, and a
					// twig that clothes a clump leaves toward the clump's surface, wherever that is.
					const hangs =
						plan.axes[a]?.role === 'whip' || held.fine?.includes(plan.axes[a]?.rule ?? '') === true;
					const joint = s.axes.parentNode[a] as number;
					const before = joint >= 0 ? (s.parent[joint] as number) : -1;
					if (before >= 0 && !hangs) {
						sides++;
						if (
							between(step(s, before, joint), step(s, joint, s.axes.first[a] as number)) * DEG >
							90
						)
							backward++;
					}
					if ((s.axes.order[a] as number) !== 1 || joint < 0) continue;
					// How far the limb stands out from where it leaves its stem, node by node.
					let reach = -1;
					for (let n = s.axes.first[a] as number; n <= (s.axes.last[a] as number); n++) {
						const out = Math.hypot(
							(s.position[n * 3] as number) - (s.position[joint * 3] as number),
							(s.position[n * 3 + 2] as number) - (s.position[joint * 3 + 2] as number),
						);
						if (reach >= 0) back = Math.max(back, reach - out);
						reach = Math.max(reach, out);
					}
				}
				expect(back).toBeLessThan(BACK_MOST * plan.scale);
				expect(backward / Math.max(1, sides)).toBeLessThan(BACKWARD_JOINTS_MOST);
			}
		});

		it('passes no wood through other wood, beyond the pairs it is known to', () => {
			let pairs = 0;
			for (const seed of SEEDS) pairs += woodThrough(planOf(held, seed)).length;
			expect(pairs).toBe(held.through);
		});

		it('keeps its branch count to its sockets, at the figure it is known by', () => {
			let axes = 0;
			let sockets = 0;
			for (const seed of SEEDS) {
				const s = grownOf(held, seed);
				axes += s.axes.count;
				sockets += s.buds.count;
			}
			expect(axes / sockets).toBeLessThan(AXES_PER_SOCKET_MOST);
			expect(Number((axes / sockets).toFixed(3))).toBe(held.axesPerSocket);
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
			// A second plan from the same inputs, not the kept one.
			const again = planFrame(held.spec, {
				record: held.record,
				seed: 11,
				variant: 0,
				season: 'summer',
			});
			expect(digest(frameSkeleton(again))).toBe(first);
			expect(digest(frameSkeleton(planOf(held, 12)))).not.toBe(first);
			expect(digest(frameSkeleton(planOf(held, 11, 1)))).not.toBe(first);
		});
	});

/**
 * The crown test itself, held to crowns made by hand that are plainly wrong: each must fail. They
 * are the independent reviewer's, which a test of four sides by the farthest patch let pass. Each
 * is a set of patches placed against a plain dome's outline.
 */
describe('the crown test, on crowns made by hand', () => {
	const SCALE = 20;
	const dome: FrameSpec = {
		outline: evenOutline(
			[
				[0.25, 0.3],
				[0.5, 0.5],
				[1, 0.25],
			],
			1,
		),
		stems: pedunculateOak.stems,
	};
	const band = SCALE / CROWN_BOUNDS.bands;

	/** Patches on the outline, one toward each direction in each band, each at a share of the outline. */
	function shell(
		reach: (band: number, degrees: number, height: number) => number,
		directions: readonly number[],
		width: number,
		depth: number,
	): FramePatch[] {
		const out: FramePatch[] = [];
		for (let k = 0; k < CROWN_BOUNDS.bands; k++) {
			const y = (k + 0.5) * band;
			for (const degrees of directions) {
				const angle = (degrees * Math.PI) / 180;
				const share = reach(k, degrees, (k + 0.5) / CROWN_BOUNDS.bands);
				if (share <= 0) continue;
				const away = Math.max(0, outlineRadius(dome, SCALE, y, angle) * share - width / 2);
				out.push(madePatch([Math.cos(angle) * away, y, Math.sin(angle) * away], width, depth));
			}
		}
		return out;
	}
	const faultsOf = (patches: FramePatch[]) => crownFaults({ scale: SCALE, patches }, dome);
	const EIGHT = [0, 45, 90, 135, 180, 225, 270, 315];
	/** Directions a twenty-fourth of a turn apart, so a ring of wide patches covers every arc. */
	const ROUND = Array.from({ length: 24 }, (_, k) => k * 15);
	/** A quarter of the turn, about one side. */
	const quarter = (degrees: number): boolean => degrees <= 45 || degrees >= 315;

	it('passes a full crown: wide patches on the outline on every side, in every band', () => {
		expect(faultsOf(shell(() => 1, ROUND, 4, band * 1.4))).toEqual([]);
	});

	it('fails a crown with one side missing altogether', () => {
		const wide = faultsOf(shell((_k, d) => (quarter(d) ? 0 : 1), ROUND, 4, band * 1.4));
		expect(wide.length).toBeGreaterThan(0);
		expect(wide.every((fault) => fault.side === 0)).toBe(true);
		const small = faultsOf(shell((_k, d) => (d === 0 ? 0 : 1), EIGHT, 0.5, 0.4));
		expect(small.some((fault) => fault.side === 0 && fault.kind === 'reach')).toBe(true);
	});

	it('fails a plus sign in plan, and a cross on the diagonals', () => {
		const plus = faultsOf(shell(() => 1, [0, 90, 180, 270], 4, band * 1.4));
		expect(new Set(plus.map((fault) => fault.side))).toEqual(new Set([45, 135, 225, 315]));
		const cross = faultsOf(shell(() => 1, [45, 135, 225, 315], 4, band * 1.4));
		expect(new Set(cross.map((fault) => fault.side))).toEqual(new Set([0, 90, 180, 270]));
	});

	it('fails a crown whose top is cut off at 0.875 of the height', () => {
		const cut = faultsOf(shell((_k, _d, h) => (h > 0.875 ? 0 : 1), ROUND, 4, band * 1.4));
		expect(cut.length).toBeGreaterThan(0);
		expect(cut.every((fault) => fault.height > 0.875)).toBe(true);
	});

	it('fails a hollow shell of half-metre patches toward eight directions', () => {
		const hollow = faultsOf(shell(() => 1, EIGHT, 0.5, 0.4));
		expect(hollow.some((fault) => fault.kind === 'arc')).toBe(true);
		expect(hollow.some((fault) => fault.kind === 'height')).toBe(true);
	});

	it('fails discs of foliage every third band with sky between them', () => {
		const discs = faultsOf(shell((k) => (k % 3 === 1 ? 1 : 0), ROUND, 4, 2.6));
		expect(discs.some((fault) => fault.kind === 'height')).toBe(true);
	});
});

/**
 * The pedunculate oak against what its photographs show and a smooth dome does not. Four things
 * are held: no foliage under the fork near the bole, a rim broken into lumps with sky bays
 * between, great limbs of the thickness each has in the view from below, and the reach of the long
 * low limb the tree is known by. The oak built with its clumps placed first passed every test of
 * its day and read as a clipped dome; its patches are kept beside the record, and it must fail.
 */
describe("the pedunculate oak's frame against its photographs", () => {
	const oak = HELD.find((held) => held.id === 'pedunculate-oak') as Held;
	/**
	 * The distance from the trunk's line, in a view, inside which the bole and the fork stand: the
	 * bole's flare is a tenth of the height to each side, and the limbs leave inside this.
	 */
	const FORK_NEAR = 0.15;
	/**
	 * The lumps a whole view's rim divides into: the least and the most over the 193 frames of the
	 * turning video. Still 01 has seven and still 02 five. A view is read from its still's own
	 * crown base. The photograph's rim is its foliage and wood and the frame's is its patches'
	 * rounded bodies, so the count is held and the notches' depths are not.
	 */
	const LUMPS: readonly [number, number] = [4, 9];
	const VIEWS = [
		{ turn: 0, base: 0.131 },
		{ turn: 90, base: 0.094 },
	] as const;
	/**
	 * Each great limb's thickness over the low left limb's, lowest first, from still 03: the limb
	 * toward the camera, the one away from it, a steeper one, the long low right limb, the low left
	 * limb, the other steeper one and the trunk's upright continuation.
	 */
	const LIMB_THICKNESS = [0.6, 0.6, 0.67, 0.86, 1, 0.57, 1.53] as const;
	const THICKNESS_WITHIN = 0.05;
	const LOW_LEFT = 4;
	/** The long low limb's place among the limbs, and the reach of its foliage in still 01. */
	const LANDMARK = 3;
	const LANDMARK_REACH = 0.89;
	const REACH_WITHIN = 0.05;

	/** What these tests read of one tree. */
	interface Facts {
		readonly crown: Crown;
		/** Each great limb's radius where it leaves, lowest first. */
		readonly radii: readonly number[];
		/** The patches that hang from the long low limb. */
		readonly landmark: readonly FramePatch[];
	}

	function factsOf(plan: FramePlan): Facts {
		const limbs = plan.axes.filter((axis) => axis.order === 1).sort((a, b) => a.place - b.place);
		const limbOf = (index: number): number => {
			let at = index;
			while ((plan.axes[at]?.order ?? 0) > 1) at = plan.axes[at]?.parent ?? -1;
			return at;
		};
		const landmark = plan.axes.indexOf(limbs[LANDMARK] as FramePlan['axes'][number]);
		return {
			crown: plan,
			radii: limbs.map((limb) => limb.base),
			landmark: plan.patches.filter((patch) => limbOf(patch.axis) === landmark),
		};
	}

	/** The clumps-first oak, from the patches and limbs kept of it. */
	const clumps: Facts = (() => {
		const patches = clumpsFirst.patches.map(([x, y, z, width, depth]) =>
			madePatch([x as number, y as number, z as number], width as number, depth as number),
		);
		return {
			crown: { scale: clumpsFirst.scale, patches },
			radii: clumpsFirst.limbs.map((limb) => limb.radius),
			landmark: patches.filter((_, k) => clumpsFirst.patches[k]?.[5] === LANDMARK),
		};
	})();

	const underFork = (facts: Facts): number =>
		underBoundary(facts.crown, oak.spec, FORK_NEAR).under.length;
	const lumps = (facts: Facts): number[] =>
		VIEWS.map((view) => rimLumps(facts.crown, view.turn, view.base).count);
	const thickness = (facts: Facts): number[] =>
		facts.radii.map((radius) => radius / (facts.radii[LOW_LEFT] as number));
	/** How far the long low limb's foliage reaches toward its own side, over the plant's height. */
	const reach = (facts: Facts): number =>
		Math.max(...facts.landmark.map((patch) => patch.centre[0] + patch.width / 2)) /
		facts.crown.scale;

	const lumpsHold = (facts: Facts): boolean =>
		lumps(facts).every((count) => count >= LUMPS[0] && count <= LUMPS[1]);
	const thicknessHolds = (facts: Facts): boolean =>
		thickness(facts).every(
			(share, k) => Math.abs(share - (LIMB_THICKNESS[k] as number)) <= THICKNESS_WITHIN,
		);
	const reachHolds = (facts: Facts): boolean =>
		Math.abs(reach(facts) - LANDMARK_REACH) <= REACH_WITHIN;

	it('shows no foliage under the fork near the bole', () => {
		for (const seed of SEEDS) expect(underFork(factsOf(planOf(oak, seed)))).toBe(0);
	});

	it('breaks its rim into lumps with sky bays between, as its stills and its turn do', () => {
		for (const seed of SEEDS) expect(lumpsHold(factsOf(planOf(oak, seed)))).toBe(true);
	});

	it('gives each great limb the thickness the view from below shows', () => {
		for (const seed of SEEDS) {
			const shares = thickness(factsOf(planOf(oak, seed)));
			shares.forEach((share, k) => {
				expect(Math.abs(share - (LIMB_THICKNESS[k] as number))).toBeLessThanOrEqual(
					THICKNESS_WITHIN,
				);
			});
			expect(Math.max(...shares) / Math.min(...shares)).toBeGreaterThan(2);
		}
	});

	it('holds the reach of the long low limb, the widest of the crown on its side', () => {
		for (const seed of SEEDS) {
			const facts = factsOf(planOf(oak, seed));
			expect(Math.abs(reach(facts) - LANDMARK_REACH)).toBeLessThanOrEqual(REACH_WITHIN);
			const widest = Math.max(
				...facts.crown.patches.map((patch) => patch.centre[0] + patch.width / 2),
			);
			expect(reach(facts) * facts.crown.scale).toBeCloseTo(widest, 9);
		}
	});

	it('fails the oak built with its clumps first on three of the four', () => {
		expect(clumpsFirst.commit).toBe('5b5c56272');
		// One patch in eight that a view shows near the trunk's line hangs under the boundary.
		expect(underFork(clumps)).toBe(26);
		expect(lumps(clumps)).toEqual([2, 1]);
		expect(lumpsHold(clumps)).toBe(false);
		const shares = thickness(clumps);
		expect(Math.max(...shares) / Math.min(...shares)).toBeLessThan(1.05);
		expect(thicknessHolds(clumps)).toBe(false);
		// Its long low limb reaches as far as the photograph's: the limbs were stated in both.
		expect(reachHolds(clumps)).toBe(true);
	});
});
