// The subjects of a plant that the review's close cameras frame: the trunk, the great limbs and
// their joints, the forks, the crown's lobes, twig tips, branch pieces and a leaf. A camera reads
// only this interface, so it holds for any generator that can fill it. A generator that cannot name
// a subject reports it as absent with its reason, and a camera that needs it then draws no picture
// to judge. The adapter at the foot fills the interface from a macro skeleton.

import type {
	ShootPrototype,
	ShootRows,
	SpeciesKitData,
} from '../../../../packages/vegetation/src/asset';
import {
	BUD_AREOLE,
	BUD_DORMANT,
	BUD_FLOWER,
	BUD_TERMINAL,
} from '../../../../packages/vegetation/src/core/graph';
import { DETAILS } from '../../../../packages/vegetation/src/core/types';
import {
	chainOf,
	dot,
	firstForkHeight,
	mainStem,
	nodeAt,
	normalize,
	placeOnRow,
	stemFoot,
	type V3,
} from './anatomy';
import { departures, forks } from './close';
import type { MacroSkeleton } from './plant-types';

/**
 * A subject a view cannot have, with the reason. Either the plant has no such part, which is a
 * fact about the plant, or the generator's data or the request cannot name one, which is not.
 */
export interface Absent {
	readonly absent: string;
	/** Whether the plant itself has no such part. */
	readonly lacks?: true;
}

/** A subject, or why the generator cannot name it. */
export type Maybe<T> = T | Absent;

/** A subject that the generator's data or the request cannot name, for a reason. */
export function absent(why: string): Absent {
	return { absent: why };
}

/** A part that the plant does not have, for a reason. */
export function lacking(why: string): Absent {
	return { absent: why, lacks: true };
}

/** Whether a subject is absent. */
export function isAbsent<T>(value: Maybe<T>): value is Absent {
	return typeof value === 'object' && value !== null && 'absent' in value;
}

/** One sample of a wood axis: where its centre line is and how thick the wood is there. */
export interface AxisSample {
	readonly at: V3;
	readonly radius: number;
}

/** The trunk: its foot, its centre line, and where it first divides. */
export interface TrunkSubject {
	/** Where the trunk meets the ground. */
	readonly base: V3;
	/** The centre line from the foot to the trunk's top, in order. */
	readonly axis: readonly AxisSample[];
	/** The trunk at breast height, or a third of the way up a trunk shorter than that. */
	readonly breast: AxisSample;
	/** Where the trunk first divides: the lowest joint of a limb that takes a real share of it. */
	readonly firstFork: Maybe<AxisSample>;
}

/** A great limb: where it leaves the trunk, which way, and its centre line. */
export interface GreatLimb {
	/** The generator's own name for the limb, which a slot can ask for. */
	readonly id: number;
	/** The joint, on the trunk's centre line. */
	readonly joint: V3;
	/** The trunk's radius and direction at the joint. */
	readonly trunkRadius: number;
	readonly trunkDirection: V3;
	/** The limb's direction once it is clear of the collar. */
	readonly direction: V3;
	/** The limb's radius at its base. */
	readonly radius: number;
	/** Metres the limb runs. */
	readonly length: number;
	/** The centre line from the joint outward, in order. */
	readonly axis: readonly AxisSample[];
}

/** A fork: a limb of one order dividing into two arms. */
export interface ForkSubject {
	readonly at: V3;
	/** The order of the limb that divides: 1 for a great limb. */
	readonly order: number;
	/** The limb's direction into the fork. */
	readonly into: V3;
	/** The two arms' directions out of it. */
	readonly arms: readonly [V3, V3];
	/** The limb's radius at the fork, and each arm's. */
	readonly radius: number;
	readonly armRadii: readonly [number, number];
}

/** A crown lobe: one foliage mass. */
export interface Lobe {
	readonly centre: V3;
	readonly radius: number;
	/** The great limb that carries it, by its id, where one does. */
	readonly limb?: number;
}

/** A twig's tip: where the twig ends, which way it grows and how thick it is there. */
export interface TwigTip {
	readonly at: V3;
	readonly direction: V3;
	readonly radius: number;
}

/** One branch piece as the plant carries it: a branch end with its twigs and leaves at a socket. */
export interface BranchPiece {
	/**
	 * The piece's class, the name its grower gives it: a pine's `bough`, or a tuft's `stalk-0`, its
	 * first flowering stalk.
	 */
	readonly class: string;
	/** The socket: the piece's cut end. */
	readonly socket: V3;
	/** The direction the piece runs from its socket. */
	readonly direction: V3;
	/** Metres from the socket to the farthest tip. */
	readonly length: number;
	/** Metres the piece spreads to either side of its line. */
	readonly spread: number;
	/** The side of the piece's plane that faces up, where it has one. */
	readonly face?: V3;
	/** The piece's own side, square to its face, along which an arching piece shows its arch. */
	readonly side?: V3;
	/**
	 * Metres the piece stands off its own plane on either side: along its face, and along its side.
	 * A view square to either sees the piece that deep.
	 */
	readonly depth?: { readonly face: number; readonly side: number };
}

/**
 * A site the plant marks on its surface, of a class named by the site's kind: a `flower`, an
 * `areole`, or a `dormant` bud, which on a saguaro is a woodpecker's nest hole.
 */
export interface SiteSubject {
	readonly class: string;
	readonly at: V3;
	/** The way the site faces out of the surface it stands in. */
	readonly normal: V3;
	/** The radius of the wood it stands on. */
	readonly radius: number;
	/** The axis it stands on. */
	readonly axis: number;
}

/** A leaf's size. */
export interface LeafSubject {
	readonly length: number;
}

/** Everything a close camera may frame, each subject present or absent with its reason. */
export interface PlantSubjects {
	/** Which generator filled the subjects. */
	readonly source: string;
	/** The point on the ground the plant stands on. */
	readonly foot: V3;
	/** Metres from the ground to the plant's top. */
	readonly height: number;
	/** Metres the plant reaches from its foot across the ground. */
	readonly reach: number;
	/** Metres from the ground to the lowest foliage. */
	readonly crownBase: Maybe<number>;
	readonly trunk: Maybe<TrunkSubject>;
	/** The great limbs, the thickest first. */
	readonly limbs: Maybe<readonly GreatLimb[]>;
	readonly forks: Maybe<readonly ForkSubject[]>;
	readonly lobes: Maybe<readonly Lobe[]>;
	readonly twigTips: Maybe<readonly TwigTip[]>;
	readonly pieces: Maybe<readonly BranchPiece[]>;
	/** The sites marked on the plant's surface, the highest first. */
	readonly sites: Maybe<readonly SiteSubject[]>;
	readonly leaf: Maybe<LeafSubject>;
}

/** The sample of an axis at a height above the ground, or undefined when the axis misses it. */
export function sampleAtHeight(
	axis: readonly AxisSample[],
	height: number,
): AxisSample | undefined {
	for (let k = 1; k < axis.length; k++) {
		const a = axis[k - 1] as AxisSample;
		const b = axis[k] as AxisSample;
		if (height < a.at[1] || height > b.at[1] || b.at[1] <= a.at[1]) continue;
		const t = (height - a.at[1]) / (b.at[1] - a.at[1]);
		return {
			at: [a.at[0] + (b.at[0] - a.at[0]) * t, height, a.at[2] + (b.at[2] - a.at[2]) * t],
			radius: a.radius + (b.radius - a.radius) * t,
		};
	}
	return undefined;
}

/** The sample a share of the way along an axis, and the axis's direction there. */
export function sampleAlong(
	axis: readonly AxisSample[],
	share: number,
): AxisSample & { readonly direction: V3 } {
	const first = axis[0] as AxisSample;
	if (axis.length < 2) return { ...first, direction: [0, 1, 0] };
	let total = 0;
	for (let k = 1; k < axis.length; k++)
		total += Math.hypot(
			(axis[k] as AxisSample).at[0] - (axis[k - 1] as AxisSample).at[0],
			(axis[k] as AxisSample).at[1] - (axis[k - 1] as AxisSample).at[1],
			(axis[k] as AxisSample).at[2] - (axis[k - 1] as AxisSample).at[2],
		);
	const want = Math.max(0, Math.min(1, share)) * total;
	let walked = 0;
	for (let k = 1; k < axis.length; k++) {
		const a = axis[k - 1] as AxisSample;
		const b = axis[k] as AxisSample;
		const d = Math.hypot(b.at[0] - a.at[0], b.at[1] - a.at[1], b.at[2] - a.at[2]);
		if (walked + d >= want || k === axis.length - 1) {
			const t = d > 0 ? Math.min(1, (want - walked) / d) : 0;
			return {
				at: [
					a.at[0] + (b.at[0] - a.at[0]) * t,
					a.at[1] + (b.at[1] - a.at[1]) * t,
					a.at[2] + (b.at[2] - a.at[2]) * t,
				],
				radius: a.radius + (b.radius - a.radius) * t,
				direction: normalize([b.at[0] - a.at[0], b.at[1] - a.at[1], b.at[2] - a.at[2]]),
			};
		}
		walked += d;
	}
	return { ...first, direction: [0, 1, 0] };
}

/** What the skeleton adapter is told beside the skeleton. */
export interface SkeletonSubjectOptions {
	/** A leaf's length in metres, from the species' record. */
	readonly leafLength?: number;
}

/** The least radius of a great limb, against the thickest limb that leaves the trunk. */
const GREAT = 0.35;
/** The fewest bud sites a branch carries for its foliage to count as a lobe. */
const LOBE_BUDS = 8;
/** The most radius a lobe may have, as a share of the plant's height, and the least that most may be, in metres. */
const LOBE_HEIGHT_SHARE = 0.12;
const LOBE_LEAST_RADIUS = 0.3;
/** A solid ball's radius over the root mean square distance of its points from its middle. */
const BALL = Math.sqrt(5 / 3);
/** The most twig tips the adapter names, the best lit and farthest out first. */
const MOST_TIPS = 64;
/** The least a stem reaches for the plant to have a trunk: a share of its height, and in metres. */
const TRUNK_HEIGHT_SHARE = 0.1;
const TRUNK_LEAST = 0.15;
/** The height of a person's chest, in metres, where a trunk's thickness is read. */
const BREAST = 1.3;

/** An axis's chain as samples. */
function samplesOf(skeleton: MacroSkeleton, nodes: readonly number[]): AxisSample[] {
	return nodes.map((n) => ({ at: nodeAt(skeleton, n), radius: skeleton.radius[n] as number }));
}

/**
 * The lobes of a skeleton. The skeleton names no lobes of its own, so the bud sites that one limb's
 * subtree carries stand in for one: a bud site is where a shoot draws its leaves, and a branch's
 * sites are one foliage mass. Each lobe is the largest subtree whose sites fit a ball of the most
 * radius a lobe may have, so a great limb's whole side of the crown divides into the masses its
 * branches carry. Sites on wood too large to be one lobe belong to none.
 */
function lobesOf(skeleton: MacroSkeleton, stem: number): Lobe[] {
	const { axes, buds } = skeleton;
	const most = Math.max(LOBE_LEAST_RADIUS, LOBE_HEIGHT_SHARE * skeleton.height);
	// Each axis's own sites: their count, the sum of their places and of their squared distances
	// from the origin, which together give a subtree's middle and spread without a second pass.
	const sums = new Float64Array(axes.count * 5);
	for (let b = 0; b < buds.count; b++) {
		const at = (buds.axis[b] as number) * 5;
		const x = buds.position[b * 3] as number;
		const y = buds.position[b * 3 + 1] as number;
		const z = buds.position[b * 3 + 2] as number;
		sums[at] = (sums[at] as number) + 1;
		sums[at + 1] = (sums[at + 1] as number) + x;
		sums[at + 2] = (sums[at + 2] as number) + y;
		sums[at + 3] = (sums[at + 3] as number) + z;
		sums[at + 4] = (sums[at + 4] as number) + x * x + y * y + z * z;
	}
	// Parents come before their children in the axis table, so one pass from the end carries each
	// subtree's sums up to its root.
	for (let a = axes.count - 1; a >= 0; a--) {
		const parent = axes.parent[a] as number;
		if (parent < 0 || parent === stem) continue;
		for (let k = 0; k < 5; k++)
			sums[parent * 5 + k] = (sums[parent * 5 + k] as number) + (sums[a * 5 + k] as number);
	}
	const radiusOf = (a: number): number => {
		const n = sums[a * 5] as number;
		if (n === 0) return 0;
		const x = (sums[a * 5 + 1] as number) / n;
		const y = (sums[a * 5 + 2] as number) / n;
		const z = (sums[a * 5 + 3] as number) / n;
		return Math.sqrt(Math.max(0, (sums[a * 5 + 4] as number) / n - x * x - y * y - z * z)) * BALL;
	};
	// The first-order limb each axis grows from, which names a lobe's great limb.
	const limbOf = new Int32Array(axes.count).fill(-1);
	// Whether an axis already belongs to a lobe that an ancestor of it makes.
	const held = new Uint8Array(axes.count);
	const lobes: Lobe[] = [];
	for (let a = 0; a < axes.count; a++) {
		const parent = axes.parent[a] as number;
		if (parent < 0) continue;
		limbOf[a] = parent === stem ? a : (limbOf[parent] as number);
		if (parent !== stem && held[parent] === 1) {
			held[a] = 1;
			continue;
		}
		const n = sums[a * 5] as number;
		const radius = radiusOf(a);
		if (n < LOBE_BUDS || radius > most) continue;
		held[a] = 1;
		lobes.push({
			centre: [
				(sums[a * 5 + 1] as number) / n,
				(sums[a * 5 + 2] as number) / n,
				(sums[a * 5 + 3] as number) / n,
			],
			radius,
			...((limbOf[a] as number) >= 0 && { limb: limbOf[a] as number }),
		});
	}
	return lobes;
}

/** The class of a site by its bud's kind, for the kinds that mark a surface. */
const SITE_CLASSES: ReadonlyMap<number, string> = new Map([
	[BUD_FLOWER, 'flower'],
	[BUD_AREOLE, 'areole'],
	[BUD_DORMANT, 'dormant'],
]);

/** The sites a skeleton marks on its surface: its flower, areole and dormant buds, the highest first. */
function sitesOf(skeleton: MacroSkeleton): SiteSubject[] {
	const { buds } = skeleton;
	const sites: SiteSubject[] = [];
	for (let b = 0; b < buds.count; b++) {
		const name = SITE_CLASSES.get(buds.kind[b] as number);
		if (name === undefined) continue;
		const q = buds.frame.subarray(b * 4, b * 4 + 4);
		const [x, y, z, w] = [q[0] as number, q[1] as number, q[2] as number, q[3] as number];
		sites.push({
			class: name,
			at: [
				buds.position[b * 3] as number,
				buds.position[b * 3 + 1] as number,
				buds.position[b * 3 + 2] as number,
			],
			// The frame's +Y, the way the site faces out of its surface.
			normal: normalize([2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)]),
			radius: buds.woodRadius[b] as number,
			axis: buds.axis[b] as number,
		});
	}
	return sites.sort((a, b) => b.at[1] - a.at[1]);
}

/**
 * The sites of one class, the highest first, or why there are none: the plant marks no site of
 * that class where it marks others, or marks none at all.
 *
 * @param subjects The plant's subjects.
 * @param name The class.
 */
export function sitesOfClass(subjects: PlantSubjects, name: string): Maybe<readonly SiteSubject[]> {
	if (isAbsent(subjects.sites)) return subjects.sites;
	const found = subjects.sites.filter((site) => site.class === name);
	if (found.length > 0) return found;
	const classes = [...new Set(subjects.sites.map((site) => site.class))].join(', ');
	return lacking(`the plant marks no ${name} site; its sites are ${classes}`);
}

/** The twig tips of a skeleton: its terminal buds, the best lit and farthest out first. */
function tipsOf(skeleton: MacroSkeleton, foot: V3, reach: number): TwigTip[] {
	const { buds } = skeleton;
	const ranked: { readonly bud: number; readonly score: number }[] = [];
	for (let b = 0; b < buds.count; b++) {
		if ((buds.kind[b] as number) !== BUD_TERMINAL) continue;
		const out = Math.hypot(
			(buds.position[b * 3] as number) - foot[0],
			(buds.position[b * 3 + 2] as number) - foot[2],
		);
		ranked.push({ bud: b, score: (buds.light[b] as number) + out / Math.max(reach, 1e-6) });
	}
	ranked.sort((a, b) => b.score - a.score || a.bud - b.bud);
	return ranked.slice(0, MOST_TIPS).map(({ bud }) => {
		const q = buds.frame.subarray(bud * 4, bud * 4 + 4);
		const [x, y, z, w] = [q[0] as number, q[1] as number, q[2] as number, q[3] as number];
		return {
			at: [
				buds.position[bud * 3] as number,
				buds.position[bud * 3 + 1] as number,
				buds.position[bud * 3 + 2] as number,
			],
			// The frame's +Y, the shoot's direction.
			direction: normalize([2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)]),
			radius: buds.woodRadius[bud] as number,
		};
	});
}

/**
 * The subjects of a plant grown as a macro skeleton. The skeleton names a trunk, the limbs that
 * leave it and the places a limb divides. It names no lobes, so the bud sites of each branch stand
 * in for one, and it instances no branch pieces, so those are absent.
 */
export function subjectsOfSkeleton(
	skeleton: MacroSkeleton,
	options: SkeletonSubjectOptions = {},
): PlantSubjects {
	const foot = stemFoot(skeleton);
	const reach = Math.max(
		Math.abs((skeleton.bounds.max[0] as number) - foot[0]),
		Math.abs((skeleton.bounds.min[0] as number) - foot[0]),
		Math.abs((skeleton.bounds.max[2] as number) - foot[2]),
		Math.abs((skeleton.bounds.min[2] as number) - foot[2]),
	);
	const stem = mainStem(skeleton);
	const { limbs: leaving, leader } = stem >= 0 ? departures(skeleton) : { limbs: [] };
	// The trunk runs on through the limb that carries its line past the first fork.
	const nodes = stem >= 0 ? chainOf(skeleton, stem) : [];
	if (leader) nodes.push(...chainOf(skeleton, leader.axis).slice(1));
	const axis = samplesOf(skeleton, nodes);
	const top = axis.length > 0 ? (axis[axis.length - 1] as AxisSample).at[1] : 0;
	// A ground plant's crown axis looks like a stem at its base but reaches no height, where a tree
	// that forks low still carries its stem a real share of the way up.
	const hasTrunk = top >= Math.max(TRUNK_LEAST, TRUNK_HEIGHT_SHARE * skeleton.height);
	const noTrunk = lacking('the plant has no stem that reaches a tenth of its height');

	let trunk: Maybe<TrunkSubject> = noTrunk;
	if (hasTrunk) {
		const breast = sampleAtHeight(axis, Math.min(BREAST, top * 0.3)) ?? (axis[0] as AxisSample);
		const fork = firstForkHeight(skeleton);
		const forkAt = fork === undefined ? undefined : sampleAtHeight(axis, fork);
		trunk = {
			base: foot,
			axis,
			breast,
			firstFork: forkAt ?? lacking("no limb takes a fifth of the trunk's cross-section"),
		};
	}

	const thickest = leaving[0]?.radius ?? 0;
	const limbs: Maybe<readonly GreatLimb[]> = hasTrunk
		? leaving
				.filter((d) => d.radius >= GREAT * thickest)
				.map((d) => ({
					id: d.axis,
					joint: d.at,
					trunkRadius: d.stem.radius,
					trunkDirection: d.stem.direction,
					direction: d.direction,
					radius: d.radius,
					length: d.length,
					axis: samplesOf(skeleton, chainOf(skeleton, d.axis)),
				}))
		: noTrunk;

	const divisions: Maybe<readonly ForkSubject[]> = hasTrunk
		? forks(skeleton).map((f) => ({
				at: f.at,
				order: skeleton.axes.order[f.limb] as number,
				into: f.into,
				// The limb runs on as one arm at its own thickness, and the axis that leaves is the other.
				arms: [f.on, f.out] as const,
				radius: f.radius,
				armRadii: [f.radius, f.armRadius] as const,
			}))
		: noTrunk;

	const lobes: Maybe<readonly Lobe[]> =
		skeleton.buds.count === 0
			? lacking('the plant carries no bud sites, so it has no foliage mass')
			: hasTrunk
				? lobesOf(skeleton, stem)
				: noTrunk;

	const tips = tipsOf(skeleton, foot, reach);
	const sites = sitesOf(skeleton);
	return {
		source: 'macro skeleton',
		foot,
		height: skeleton.height,
		reach,
		crownBase: skeleton.crownBase,
		trunk,
		limbs,
		forks: divisions,
		lobes,
		twigTips: tips.length > 0 ? tips : lacking('the plant carries no terminal bud'),
		pieces: absent('the skeleton instances no branch piece: the cut views draw the review cutting'),
		sites: sites.length > 0 ? sites : absent('the plant marks no flower, areole or dormant site'),
		leaf:
			options.leafLength === undefined
				? absent("the species' foliage has no single leaf length")
				: { length: options.leafLength },
	};
}

/**
 * The side of a piece's plane that faces up: its +Z, or the other way where +Z points down. A grower
 * names one face +Z, the sky side of a branch piece or the lower face of a fern's leaf, and a view
 * of the piece's face looks on its upper side either way.
 */
function upward(normal: V3): V3 {
	return normal[1] >= 0 ? normal : [-normal[0], -normal[1], -normal[2]];
}

/** A vector of a piece's own frame, turned as one of the plant's rows turns its prototype. */
function turnedBy(rows: ShootRows, r: number, x: number, y: number, z: number): V3 {
	const out: [number, number, number] = [0, 0, 0];
	placeOnRow(rows, r, x, y, z, out, 0);
	const s = rows.scale[r] as number;
	return normalize([
		(out[0] - (rows.position[r * 3] as number)) / s,
		(out[1] - (rows.position[r * 3 + 1] as number)) / s,
		(out[2] - (rows.position[r * 3 + 2] as number)) / s,
	]);
}

/** A piece's run in its own frame: the way to its farthest vertex, how far, and its spread off that line. */
interface PieceRun {
	readonly way: V3;
	readonly length: number;
	readonly spread: number;
	/** How far its vertices stand off the socket along its own +Z and its own +X. */
	readonly face: number;
	readonly side: number;
}

/** The run of a piece whose parts are these prototypes' meshes, at scale 1. */
function runOf(meshes: readonly Float32Array[]): PieceRun {
	let far: V3 = [0, 1, 0];
	let length = 0;
	for (const positions of meshes)
		for (let i = 0; i + 2 < positions.length; i += 3) {
			const v: V3 = [
				positions[i] as number,
				positions[i + 1] as number,
				positions[i + 2] as number,
			];
			const d = Math.hypot(v[0], v[1], v[2]);
			if (d > length) {
				length = d;
				far = v;
			}
		}
	const way = length > 0 ? normalize(far) : ([0, 1, 0] as V3);
	let spread = 0;
	let face = 0;
	let side = 0;
	for (const positions of meshes)
		for (let i = 0; i + 2 < positions.length; i += 3) {
			const x = positions[i] as number;
			const y = positions[i + 1] as number;
			const z = positions[i + 2] as number;
			const along = x * way[0] + y * way[1] + z * way[2];
			spread = Math.max(
				spread,
				Math.hypot(x - along * way[0], y - along * way[1], z - along * way[2]),
			);
			face = Math.max(face, Math.abs(z));
			side = Math.max(side, Math.abs(x));
		}
	return { way, length, spread, face, side };
}

/**
 * The branch pieces a plant places at its sockets, read from its rows. A piece's parts stand as
 * rows one after another at one place, with one turn and one scale. The piece runs from its socket
 * toward its farthest vertex, so an arching piece runs to its tip, spreads as far as its vertices
 * stand off that line, faces the side of its plane that looks up, and has its +X for its side.
 * The pieces come outermost first, so a view of one frames a piece at the plant's rim.
 *
 * @param rows The plant's rows.
 * @param kit The kit the rows draw, for its prototypes and the tier its rows draw at.
 * @param foot Where the plant stands.
 * @returns The pieces, or why the plant has none: its rows are shoots.
 */
export function piecesOfRows(
	rows: ShootRows,
	kit: Pick<SpeciesKitData, 'detail' | 'prototypes'>,
	foot: V3,
): Maybe<readonly BranchPiece[]> {
	const tier = DETAILS.indexOf(kit.detail);
	// Each set of parts' run at scale 1, found once: the sockets of one variant share it.
	const runs = new Map<string, PieceRun>();
	const runAt = (first: number, end: number): PieceRun => {
		const parts: number[] = [];
		for (let part = first; part < end; part++) parts.push(rows.prototype[part] as number);
		const key = parts.join(',');
		let run = runs.get(key);
		if (!run) {
			run = runOf(
				parts.map((index) => kit.prototypes[index]?.tiers[tier]?.positions ?? new Float32Array(0)),
			);
			runs.set(key, run);
		}
		return run;
	};
	const pieces: (BranchPiece & { readonly out: number })[] = [];
	const sameSocket = (a: number, b: number) =>
		rows.scale[a] === rows.scale[b] &&
		rows.position[a * 3] === rows.position[b * 3] &&
		rows.position[a * 3 + 1] === rows.position[b * 3 + 1] &&
		rows.position[a * 3 + 2] === rows.position[b * 3 + 2];
	for (let r = 0; r < rows.count; ) {
		const prototype = kit.prototypes[rows.prototype[r] as number];
		const name = prototype?.piece?.name;
		let end = r + 1;
		while (end < rows.count && sameSocket(r, end)) end++;
		if (name !== undefined) {
			const scale = rows.scale[r] as number;
			const run = runAt(r, end);
			const length = run.length * scale;
			const socket: V3 = [
				rows.position[r * 3] as number,
				rows.position[r * 3 + 1] as number,
				rows.position[r * 3 + 2] as number,
			];
			const direction = turnedBy(rows, r, run.way[0], run.way[1], run.way[2]);
			pieces.push({
				class: name,
				socket,
				direction,
				length,
				spread: run.spread * scale,
				face: upward(turnedBy(rows, r, 0, 0, 1)),
				side: turnedBy(rows, r, 1, 0, 0),
				depth: { face: run.face * scale, side: run.side * scale },
				out: Math.hypot(
					socket[0] + direction[0] * length - foot[0],
					socket[2] + direction[2] * length - foot[2],
				),
			});
		}
		r = end;
	}
	if (pieces.length === 0)
		return absent('the plant places no branch piece at a socket: its rows are shoots');
	pieces.sort((a, b) => b.out - a.out);
	return pieces.map(({ out: _out, ...piece }) => piece);
}

/**
 * The placed pieces of one class, outermost first. A class names a piece by its grower's name, or
 * by its leading words, so `stalk` names every flowering stalk a tuft places.
 *
 * @param subjects The plant's subjects.
 * @param name The class.
 * @returns The pieces, or that the plant lacks the class: it places pieces, and none of this one.
 */
export function piecesOfClass(
	subjects: PlantSubjects,
	name: string,
): Maybe<readonly BranchPiece[]> {
	if (isAbsent(subjects.pieces)) return subjects.pieces;
	const found = subjects.pieces.filter(
		(piece) => piece.class === name || piece.class.startsWith(`${name}-`),
	);
	if (found.length > 0) return found;
	const classes = [...new Set(subjects.pieces.map((piece) => piece.class))].join(', ');
	return lacking(`the plant places no piece of the class ${name}; its pieces are ${classes}`);
}

/** The degrees between a limb's line and the trunk's where the limb leaves. */
export function departureAngle(limb: GreatLimb): number {
	return (
		(Math.acos(Math.max(-1, Math.min(1, dot(limb.direction, limb.trunkDirection)))) * 180) / Math.PI
	);
}
