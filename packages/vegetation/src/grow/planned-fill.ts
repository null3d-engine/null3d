// The planned grower's fill: the wood and the sockets that clothe each clump. A clump is filled
// through its depth, not as one shell, and every socket is placed by a draw keyed on the clump and
// the socket's slot in it, so the same socket comes out at the same place in every request. What
// the age changes is whether a socket exists and how large its piece is, never where it stands.
//
// W owns this file from the crown-fill handover: the rows per clump, the depth through each clump,
// the rim clumps with sky bays, the inner layer and the branch kinks all live here.
import { BUD_FLOWER, BUD_TERMINAL, type SkeletonBuilder } from '../core/graph';
import { unitAt } from '../core/hash';
import { quatAxisAngle, quatFromFrame, quatMultiply, radians, type Vector3 } from '../core/math';
import { thinningRanks } from '../core/rank';
import type { Vec3 } from '../core/types';

/**
 * How deep inside its clump's radius a socket stands, as a keyed draw: today's oak's sockets fill
 * the inner half of its clumps about half the time, so their depth runs from a third of the radius
 * out toward the surface, more of them shallow than deep.
 */
const DEPTH_FROM = 0.41;
const DEPTH_TO = 0.89;

/** Sockets per square metre of a clump's own width, measured from today's oak at seeds 3, 11, 12. */
const SOCKETS_PER_AREA = 8.5;

/** The clump's vertical radius against its horizontal one: an oak clump is flatter than a ball. */
const DEPTH_SHARE = 0.7;

/** The droop of a low limb's end clump, as a share of its radius at its outer face. */
const DIP_SHARE = 0.6;

/** The first place of the fill's sockets in the plant as grown, clear of every stated axis. */
const SOCKET_BASE = 100_000;

/** The slots one clump may carry, which fix each socket's place in its clump. */
const SLOTS = 320;

/** The steps of the two shares that turn each socket's piece about its own line. */
const SPREAD_ROLL = 0.7548776662466927;
const SPREAD_TILT = 0.5698402909980532;

/** The purpose of the draws that turn a socket's piece, which the frame model shares. */
const TURN = 15;

/** What the fill grows: the elements it made and the sockets it hung. */
export interface FillCount {
	/** The twig axes and their nodes, and the sockets: the elements the fill made. */
	readonly made: number;
	/** The sockets that carry a piece. */
	readonly sockets: number;
	/** Each socket's place in the plant as grown, in the order the sockets were hung. */
	readonly socketOrigins: number[];
}

/** One clump of the adult plan, as the age of its carrying axis leaves it. */
export interface FillClump {
	/** Its index, which its sockets name by `lobe`. */
	readonly id: number;
	/** Its middle in plant space, at its adult place. */
	readonly centre: Vec3;
	/** Its radius in metres, at its adult size. */
	readonly radius: number;
	/** The model age at which it appears. */
	readonly birth: number;
	/** How far the clump has come, 0 to 1: 0 hides it, 1 brings its pieces to full size. */
	readonly growth: number;
	/** How far its sockets have opened, 0 to 1: the share of its sockets that stand, squared. */
	readonly open: number;
	/** The SkeletonBuilder axis that carries it. */
	readonly axis: number;
	/** The SkeletonBuilder node where its carrying axis ends. */
	readonly node: number;
	/** The botanical order of its carrying axis, so its twigs stand one order deeper. */
	readonly order: number;
	/** Its root in plant space: where its twigs start, at its adult place. */
	readonly root: Vec3;
	/** The limb it belongs to in the adult plan, or -1 for a clump on the trunk. */
	readonly limb?: number;
	/** How far that limb's adult tip stands from the plant's centre line, in metres. */
	readonly limbReach?: number;
	/** Where it sits: at its limb's end, or on the limb's side. */
	readonly at?: 'limb-end' | 'limb-side';
}

/** What the fill takes. */
export interface FillInput {
	readonly builder: SkeletonBuilder;
	readonly seed: number;
	readonly variant: number;
	readonly clumps: readonly FillClump[];
	/** The crown's box at this state, in metres, when the grower states it. */
	readonly crown?: { readonly top: number; readonly base: number; readonly height: number };
	/** The share of the crown's rows kept at this sparseness, from 0 to 1. */
	readonly leaves: number;
	/** The scale of a socket's piece against the species' own. */
	readonly pieceScale: number;
	/** The record's salt, which keys the draws that turn each socket's piece. */
	readonly salt: number;
	/** The share of the sockets that also carries a flower site, 0 to 1: the catkins' ramp. */
	readonly flowers?: number;
	/** How far each socket's piece turns from the sky: its roll and its tilt, in degrees. */
	readonly turn?: { readonly roll: number; readonly tilt: number; readonly out?: number };
}

/** One socket the fill places, its place and the clump it belongs to. */
interface Goal {
	readonly clump: FillClump;
	readonly point: [number, number, number];
	/** Its place in the plant as grown, which its clump and slot fix. */
	readonly place: number;
	/** Its rank across the crown, which sparseness keeps by. */
	rank: number;
	/** The scale of its piece. */
	readonly scale: number;
	/** Whether it is its clump's own socket, which stands before any second socket anywhere. */
	readonly anchor?: boolean;
	/** Its rank among the anchors, so a tight maximum thins the clumps evenly. */
	anchorRank?: number;
}

/**
 * Fills each clump through its depth with sockets, each on a short twig, and keeps a spread share
 * of them at the asked sparseness. The geometry never moves with age or sparseness: only which
 * sockets exist and how large their pieces are change.
 *
 * @param input The clumps, the skeleton to grow into and the shares that decide what is kept.
 * @returns The count of elements the fill made.
 * @category api/vegetation
 */
export function fillClumps(input: FillInput): FillCount {
	const { builder, seed, variant, clumps, leaves, pieceScale, salt, turn, flowers } = input;
	const goals: Goal[] = [];
	for (const clump of clumps) {
		if (!(clump.growth > 0)) continue;
		const radius = Math.max(1e-6, clump.radius);
		// One socket ends the clump's own axis, as every twig does.
		goals.push({
			clump,
			point: [clump.root[0], clump.root[1], clump.root[2]],
			place: SOCKET_BASE + clump.id * (SLOTS + 1),
			rank: 0,
			scale: pieceScale * clump.growth,
			anchor: true,
		});
		// A clump's own share of the sockets, keyed on the clump, so the crown has clumps of many
		// sizes as today's does rather than an even mesh.
		const variety = 1 + 0.6 * (unitAt(seed, clump.id, variant, 2) - 0.5);
		const count = Math.round(SOCKETS_PER_AREA * (2 * radius) ** 2 * variety);
		// Each slot is a fixed point of the clump; as the clump opens, more of them fill.
		const filled = Math.min(1, (count * clump.open) / SLOTS);
		for (let k = 0; k < SLOTS; k++) {
			if ((k + 0.5) / SLOTS > filled) continue;
			// An evenly spread direction and depth, fixed by the slot alone so it never moves with age.
			const y = 1 - (2 * (k + 0.5)) / SLOTS;
			const ring = Math.sqrt(Math.max(0, 1 - y * y));
			const spin = unitAt(seed, clump.id, variant, 1) * 2 * Math.PI;
			const angle = spin + k * radians(137.507);
			const depth = DEPTH_FROM + (DEPTH_TO - DEPTH_FROM) * unitAt(seed, clump.id, k, 1);
			const point: [number, number, number] = [
				clump.centre[0] + radius * depth * ring * Math.cos(angle),
				clump.centre[1] + radius * DEPTH_SHARE * depth * y,
				clump.centre[2] + radius * depth * ring * Math.sin(angle),
			];
			point[1] = dippedY(clump, point, input.crown);
			goals.push({
				clump,
				point,
				place: SOCKET_BASE + clump.id * (SLOTS + 1) + 1 + k,
				rank: 0,
				scale: pieceScale * clump.growth,
			});
		}
	}

	// The sockets kept at this sparseness stand spread through the crown.
	const ranks = thinningRanks(goals.map((goal) => goal.point));
	goals.forEach((goal, k) => {
		goal.rank = ranks[k] as number;
	});
	// Each clump's own socket goes before any second socket anywhere, and the anchors are thinned
	// evenly across the crown among themselves. Under a tight maximum the plant then draws one card a
	// kept clump over the whole crown rather than a few clumps and bare wood.
	const anchors = goals.filter((goal) => goal.anchor === true);
	const anchorRanks = thinningRanks(anchors.map((goal) => goal.point));
	anchors.forEach((goal, k) => {
		goal.anchorRank = anchorRanks[k] as number;
	});
	const most = Math.max(0, Math.round(goals.length * Math.min(1, Math.max(0, leaves))));
	const kept = goals
		.map((goal, k) => ({ goal, k }))
		.sort((a, b) => {
			const aAnchor = a.goal.anchor === true;
			const bAnchor = b.goal.anchor === true;
			if (aAnchor !== bAnchor) return aAnchor ? -1 : 1;
			if (aAnchor) return (a.goal.anchorRank as number) - (b.goal.anchorRank as number) || a.k - b.k;
			return a.goal.rank - b.goal.rank || a.k - b.k;
		})
		.slice(0, most)
		// The kept sockets then stand in their own places' order, so a plant that keeps every socket
		// draws each piece turned exactly as it was before any maximum was asked for.
		.sort((a, b) => a.k - b.k);
	let made = 0;
	const socketOrigins: number[] = [];
	const rollFrom = unitAt(seed, salt, variant, TURN, 0);
	const tiltFrom = unitAt(seed, salt, variant, TURN, 1);
	kept.forEach(({ goal }, socket) => {
		socketOrigins.push(goal.place);
		const seat: SocketSeat = {
			node: goal.clump.node,
			axis: goal.clump.axis,
			point: goal.point,
			direction: unitFrom(goal.clump.centre, goal.point),
			id: goal.clump.id,
			woodRadius: 0.004,
		};
		hangBud(
			builder,
			seat,
			goal.rank,
			goal.scale,
			turn === undefined ? undefined : { turn, socket, rollFrom, tiltFrom },
			flowerAt(seed, goal.place, flowers),
		);
		made++;
	});
	return { made, sockets: kept.length, socketOrigins };
}

/**
 * The height a socket stands at, after the dip of a low limb's end. Stills 01, 02 and 18 hang the
 * skirt of the crown below the fork: the clumps at the ends of the lowest limbs droop, and the
 * droop grows toward the clump's outer face, so the lobe hangs rather than slides down whole. A
 * clump on a limb's side, or in the crown's upper half, keeps its own height, and no socket falls
 * under the crown's base.
 */
function dippedY(
	clump: FillClump,
	point: readonly [number, number, number],
	crown: { readonly top: number; readonly base: number; readonly height: number } | undefined,
): number {
	if (clump.at !== 'limb-end' || crown === undefined || crown.height <= 0) return point[1];
	// One at the crown's base, falling to none halfway up it: only the lowest limbs' ends droop.
	const lowness = 1 - Math.min(1, Math.max(0, (clump.centre[1] - crown.base) / (crown.height * 0.5)));
	if (lowness <= 0) return point[1];
	const out =
		Math.hypot(point[0] - clump.root[0], point[2] - clump.root[2]) /
		Math.max(1e-6, clump.radius);
	const dip = DIP_SHARE * clump.radius * Math.min(1, out) * lowness;
	return Math.max(crown.base, point[1] - dip);
}

/** Whether a socket also carries a flower site at this ramp: the same sockets at every larger ramp. */function flowerAt(seed: number, place: number, flowers: number | undefined): boolean {
	return flowers !== undefined && flowers > 0 && unitAt(seed, place, 2) < flowers;
}

/** The unit direction from one point toward another, or straight up for one point. */
function unitFrom(from: Vec3, to: Vec3): Vector3 {
	const dx = to[0] - from[0];
	const dy = to[1] - from[1];
	const dz = to[2] - from[2];
	const long = Math.sqrt(dx * dx + dy * dy + dz * dz);
	return long > 1e-9 ? [dx / long, dy / long, dz / long] : [0, 1, 0];
}

/** A socket's place on the wood: the node it stands on and where its piece stands. */
interface SocketSeat {
	/** The SkeletonBuilder node it hangs on. */
	readonly node: number;
	/** The axis that node belongs to. */
	readonly axis: number;
	/** Where the socket stands. */
	readonly point: Vector3;
	/** The direction its piece stands out along. */
	readonly direction: Vector3;
	/** The clump its piece belongs to. */
	readonly id: number;
	/** The wood's radius where it stands. */
	readonly woodRadius: number;
}

/** Hangs one socket on a node of the carrying wood, with no axis of its own. */
function hangBud(
	builder: SkeletonBuilder,
	seat: SocketSeat,
	rank: number,
	scale: number,
	turning:
		| {
				readonly turn: { readonly roll: number; readonly tilt: number; readonly out?: number };
				readonly socket: number;
				readonly rollFrom: number;
				readonly tiltFrom: number;
		  }
		| undefined,
	flower: boolean,
): void {
	const frame = new Float32Array(4);
	quatFromFrame(seat.direction, [0, 1, 0], frame);
	turnFrame(frame, turning);
	builder.addBud({
		node: seat.node,
		x: seat.point[0],
		y: seat.point[1],
		z: seat.point[2],
		frame,
		kind: BUD_TERMINAL,
		vigor: 1,
		light: 1,
		axis: seat.axis,
		woodRadius: seat.woodRadius,
		socket: { scale, rank, lobe: seat.id },
	});
	// A blossom season's catkins hang on their own sites beside the leaves, so the leaf piece stays.
	if (flower)
		builder.addBud({
			node: seat.node,
			x: seat.point[0],
			y: seat.point[1],
			z: seat.point[2],
			frame,
			kind: BUD_FLOWER,
			vigor: 1,
			light: 1,
			axis: seat.axis,
			woodRadius: seat.woodRadius,
		});
}

/** Turns a socket's frame about its own line and off it, by its place in two spread runs. */
function turnFrame(
	frame: Float32Array,
	turning:
		| {
				readonly turn: { readonly roll: number; readonly tilt: number; readonly out?: number };
				readonly socket: number;
				readonly rollFrom: number;
				readonly tiltFrom: number;
		  }
		| undefined,
): void {
	if (!turning) return;
	const spin = new Float32Array(4);
	const share = (shareFrom: number, step: number): number =>
		((shareFrom + turning.socket * step) % 1) * 2 - 1;
	quatAxisAngle([0, 1, 0], radians(share(turning.rollFrom, SPREAD_ROLL) * turning.turn.roll), spin);
	quatMultiply(frame, 0, spin, 0, frame);
	quatAxisAngle([1, 0, 0], radians(share(turning.tiltFrom, SPREAD_TILT) * turning.turn.tilt), spin);
	quatMultiply(frame, 0, spin, 0, frame);
}
