// The directed frames of the species that state one: each gives its stated counts, stands its limbs
// round the plant, holds the crown outline it states, bends gently with no straight run, thins
// evenly from the measured share of its parent, ends every axis in a socket or a fork, gives its
// sockets in the socket record, is one connected body, and is the same plant for the same seed.
import { describe, expect, it } from 'bun:test';
import { speciesProblems } from '../core/check';
import type { MacroSkeleton } from '../core/graph';
import { hashBytes } from '../core/hash';
import { quatRotate, type Vector3 } from '../core/math';
import type { Species } from '../core/record';
import { spreadMean } from '../core/types';
import {
	FRAME_TURN_MOST,
	type FramePlan,
	type FrameSpec,
	frameSkeleton,
	frameSockets,
	growFrame,
	planFrame,
} from '../grow/frame';
import {
	bareEnds,
	baseShare,
	crownFaults,
	crownFill,
	endAzimuth,
	forkShares,
	imbalance,
	longestStraight,
	looseAxes,
	planShape,
	sharpestTurn,
	steepestStep,
	thickens,
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
 * The crown's shape, band by band. On each of four sides, every one of 16 height bands between the
 * outline's foot and nine tenths of its top must fill 0.6 to 1.2 of the outline there. A tree may
 * name at most this many bands that it is excused, each with its reason. The mean above guards
 * against a missing side; this guards against a crown that is wide at some heights only.
 */
const BAND_FILL: readonly [number, number] = [0.6, 1.2];
const EXCUSED_MOST = 2;
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
/**
 * The longest share of a twig of the last order that may hold one direction. A twig is short and
 * stiff, and where its curve turns from one side to the other it runs near straight for a while.
 */
const TWIG_STRAIGHT_MOST = 0.3;
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
	/** The rules whose axes are the last order of wood, grown to the foliage masses. */
	readonly twigs?: readonly string[];
	/** The plant's height over the record's, as the least and the most. */
	readonly tall: readonly [number, number];
	/**
	 * The requirements the tree is known not to meet yet: its crown's mean fill of its outline, the
	 * outline band by band, its sockets' spread through the turn, its bends' radius. A test of an open requirement expects the
	 * failure, and fails when the tree starts to hold, so the name must come off as the tree is
	 * mended. The bands a tree is excused are named by their number from the ground, with the reason.
	 */
	readonly open?: readonly ('fill' | 'bands' | 'spread' | 'bends')[];
	readonly excused?: Readonly<Record<number, string>>;
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
		tall: [0.98, 1.02],
		open: ['bands', 'spread'],
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
		tall: [0.98, 1.02],
		open: ['bands'],
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
		tall: [0.93, 1.02],
		open: ['bands', 'spread'],
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
		tall: [0.97, 1.06],
		open: ['bands'],
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
		tall: [0.95, 1.08],
		open: ['bands'],
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
		tall: [0.93, 1.02],
		open: ['fill', 'bands'],
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
		tall: [0.95, 1.05],
		open: ['bands', 'spread'],
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
		tall: [0.93, 1.05],
		open: ['bands', 'spread'],
	},
	{
		id: 'pedunculate-oak',
		spec: pedunculateOak,
		directed: pedunculateOakDirected,
		heightMean: spreadMean(pedunculateOakDirected.size.height),
		record: pedunculateOakRecord,
		counts: { trunk: 1, limb: 7, bough: [35, 56], branch: [300, 520] },
		// Seven limbs at their own stated directions: six an eighth of a turn apart and one gap of two.
		round: { rule: 'limb', gap: 112, lean: 0.25 },
		// A limb's share runs from 0.42 at the lowest to 0.5 at the highest, and a branch grown to a
		// clump is as thick as its length allows, so neither is held here.
		base: { bough: 0.5 },
		plumb: ['trunk'],
		twigs: ['branch'],
		through: 0,
		tall: [0.95, 1.04],
	},
];

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
		const required = (name: 'fill' | 'bands' | 'spread' | 'bends') =>
			held.open?.includes(name) ? it.failing : it;
		required('fill')('fills the crown outline it states, on every side', () => {
			for (const seed of SEEDS) {
				const fill = crownFill(planOf(held, seed), held.spec);
				expect(fill.mean).toBeGreaterThanOrEqual(FILL_MEAN[0]);
				expect(fill.mean).toBeLessThanOrEqual(FILL_MEAN[1]);
				expect(fill.least).toBeGreaterThanOrEqual(FILL_SIDE);
			}
		});

		const banded = required('bands');
		banded('holds the outline it states band by band, on four sides', () => {
			expect(Object.keys(held.excused ?? {}).length).toBeLessThanOrEqual(EXCUSED_MOST);
			for (const seed of SEEDS) {
				const faults = crownFaults(
					planOf(held, seed),
					held.spec,
					4,
					16,
					BAND_FILL[0],
					BAND_FILL[1],
				).filter((fault) => held.excused?.[fault.band] === undefined);
				expect(faults).toEqual([]);
			}
		});

		it('bends every axis gently and leaves no limb a straight run', () => {
			for (const seed of SEEDS)
				for (const axis of planOf(held, seed).axes) {
					expect(sharpestTurn(axis)).toBeLessThanOrEqual(FRAME_TURN_MOST + 0.5);
					// A stub shorter than this many of its own diameters cannot turn within a fifth of
					// its length on a bend its wood allows, so the bend radius alone judges it.
					if (
						!held.plumb.includes(axis.rule) &&
						axis.nodes.length >= 5 &&
						axis.length >= STUB_DIAMETERS * 2 * axis.base
					)
						expect(longestStraight(axis)).toBeLessThanOrEqual(
							held.twigs?.includes(axis.rule) ? TWIG_STRAIGHT_MOST : STRAIGHT_MOST,
						);
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
				expect(sockets.length).toBe(plan.patches.length);
				expect(skeleton.buds.count).toBe(sockets.length);
				expect(table).toBeDefined();
				if (!table) continue;
				// One rank for each socket, every rank from 0 used once.
				expect([...table.rank].sort((a, b) => a - b)).toEqual(sockets.map((_, k) => k));
				const along: Vector3 = [0, 0, 0];
				sockets.forEach((socket, b) => {
					expect(table.lobe[b]).toBe(socket.patch);
					expect(table.rank[b]).toBe(socket.rank);
					// A plant's pieces are its own height over the species' middle height.
					expect(table.scale[b]).toBeCloseTo(plan.scale / held.heightMean, 5);
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
				const s = grownOf(held, seed);
				let tightest = Number.POSITIVE_INFINITY;
				for (let n = 0; n < s.nodeCount; n++) {
					const at = s.parent[n] as number;
					const before = at >= 0 ? (s.parent[at] as number) : -1;
					if (before < 0 || s.axisOf[at] !== s.axisOf[n] || s.axisOf[before] !== s.axisOf[n])
						continue;
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
					// A hanging axis leaves its branch downward, which on rising wood is backward.
					const hangs = plan.axes[a]?.role === 'whip';
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

		it('keeps its branch count to its sockets', () => {
			for (const seed of SEEDS) {
				const s = grownOf(held, seed);
				expect(s.axes.count / s.buds.count).toBeLessThan(AXES_PER_SOCKET_MOST);
			}
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
