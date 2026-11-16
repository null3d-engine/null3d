// The planned grower's fill: the wood and the sockets that clothe each clump. A clump is filled
// through its depth, not as one shell, and every socket is placed by a draw keyed on the clump and
// the socket's slot in it, so the same socket comes out at the same place in every request. What
// the age changes is whether a socket exists and how large its piece is, never where it stands.
//
// W owns this file from the crown-fill handover: the rows per clump, the depth through each clump,
// the rim clumps with sky bays, the inner layer and the branch kinks all live here.
import { AXIS_LIMB, BUD_TERMINAL, type SkeletonBuilder } from '../core/graph';
import { unitAt } from '../core/hash';
import { quatAxisAngle, quatFromFrame, quatMultiply, radians, type Vector3 } from '../core/math';
import { thinningRanks } from '../core/rank';
import type { Vec3 } from '../core/types';

/**
 * The shells a clump's sockets stand on, from the outermost in: each shell's size as a share of
 * the clump's inner radius, and the share of the outermost's spacing of points it keeps. Measured
 * from today's oak: its sockets stand through the clump's depth, not only at its rim.
 */
const SHELLS: readonly (readonly [size: number, keep: number])[] = [
	[1, 1],
	[0.65, 0.85],
	[0.35, 0.6],
];

/** The sum of the shells' sizes squared by their keeps: the sockets a clump's outer count makes. */
const SHELL_TOTAL = SHELLS.reduce((sum, [size, keep]) => sum + size * size * keep, 0);

/** Metres a socket stands inside its clump's surface: the reach of the piece it carries. */
const INSET = 0.85;

/** Sockets per square metre of a clump's own width, measured from today's oak at seeds 3, 11, 12. */
const SOCKETS_PER_AREA = 6;

/** The clump's depth against its width: an oak clump is about seven tenths as deep as it is wide. */
const DEPTH_SHARE = 0.35;

/** The first place of the fill's sockets in the plant as grown, clear of every stated axis. */
const SOCKET_BASE = 100_000;

/** The slots one shell may carry, which fix each socket's place in its clump. */
const SLOTS = [160, 136, 96] as const;

/** Metres from one twig node to the next, at the longest. */
const STEP = 1.0;

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
	/** Each twig axis's place in the plant as grown, in the order the axes were made. */
	readonly axisOrigins: number[];
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
	/** The SkeletonBuilder axis that carries it. */
	readonly axis: number;
	/** The SkeletonBuilder node where its carrying axis ends. */
	readonly node: number;
	/** The botanical order of its carrying axis, so its twigs stand one order deeper. */
	readonly order: number;
	/** Its root in plant space: where its twigs start, at its adult place. */
	readonly root: Vec3;
}

/** A socket that hangs on a piece of the frame's own wood, at its end. */
export interface ExtraSocket {
	/** The clump its piece belongs to. */
	readonly id: number;
	/** The SkeletonBuilder axis of the twig it hangs on. */
	readonly axis: number;
	/** The SkeletonBuilder node at that twig's end. */
	readonly node: number;
	/** The twig's botanical order, so its socket's piece stands one order deeper. */
	readonly order: number;
	/** Where it stands, at its twig's end. */
	readonly point: Vec3;
	/** Its place in the plant as grown. */
	readonly place: number;
	/** The scale of its piece. */
	readonly scale: number;
	/** The model age of the clump it belongs to. */
	readonly birth: number;
}

/** What the fill takes. */
export interface FillInput {
	readonly builder: SkeletonBuilder;
	readonly seed: number;
	readonly variant: number;
	readonly clumps: readonly FillClump[];
	/** The sockets that hang on the frame's own fine wood, which the fill keeps and thins alike. */
	readonly extra?: readonly ExtraSocket[];
	/** The share of the crown's rows kept at this sparseness, from 0 to 1. */
	readonly leaves: number;
	/** The scale of a socket's piece against the species' own. */
	readonly pieceScale: number;
	/** The record's salt, which keys the draws that turn each socket's piece. */
	readonly salt: number;
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
	const { builder, seed, variant, clumps, extra, leaves, pieceScale, salt, turn } = input;
	const goals: Goal[] = [];
	for (const clump of clumps) {
		if (!(clump.growth > 0)) continue;
		const radius = Math.max(1e-6, clump.radius);
		// A socket stands inside the clump's surface by its piece's reach, never under a third of
		// the clump's radius.
		const inner = Math.max(radius - INSET, radius * 0.3);
		// One socket ends the clump's own axis, as every twig does.
		goals.push({
			clump,
			point: [clump.root[0], clump.root[1], clump.root[2]],
			place: SOCKET_BASE + clump.id * 512,
			rank: 0,
			scale: pieceScale * clump.growth,
		});
		SHELLS.forEach(([size, keep], shell) => {
			const slots = SLOTS[shell] as number;
			const widest =
				(Math.round((SOCKETS_PER_AREA * (2 * radius) ** 2) / SHELL_TOTAL) * size * size * keep);
			// Each slot is a fixed point of the shell; as the clump grows, more of them fill.
			const filled = Math.min(1, widest / slots);
			for (let k = 0; k < slots; k++) {
				if ((k + 0.5) / slots > filled) continue;
				// An evenly spread direction, fixed by the slot alone so it never moves with age.
				const y = 1 - (2 * (k + 0.5)) / slots;
				const ring = Math.sqrt(Math.max(0, 1 - y * y));
				const spin = unitAt(seed, clump.id, variant, 1) * 2 * Math.PI;
				const angle = spin + shell * radians(137.507) + k * radians(137.507);
				goals.push({
					clump,
					point: [
						clump.centre[0] + inner * size * ring * Math.cos(angle),
						clump.centre[1] + inner * DEPTH_SHARE * 2 * size * y,
						clump.centre[2] + inner * size * ring * Math.sin(angle),
					],
					place: SOCKET_BASE + clump.id * 512 + 1 + shell * 160 + k,
					rank: 0,
					scale: pieceScale * clump.growth,
				});
			}
		});
	}
	for (const socket of extra ?? []) {
		goals.push({
			clump: {
				id: socket.id,
				centre: socket.point,
				radius: 0,
				birth: socket.birth,
				growth: 1,
				axis: socket.axis,
				node: socket.node,
				order: socket.order,
				root: socket.point,
			},
			point: [socket.point[0], socket.point[1], socket.point[2]],
			place: socket.place,
			rank: 0,
			scale: socket.scale,
		});
	}
	// The sockets kept at this sparseness stand spread through the crown.
	const ranks = thinningRanks(goals.map((goal) => goal.point));
	goals.forEach((goal, k) => {
		goal.rank = ranks[k] as number;
	});
	const most = Math.max(0, Math.round(goals.length * Math.min(1, Math.max(0, leaves))));
	const kept = goals
		.map((goal, k) => ({ goal, k }))
		.sort((a, b) => a.goal.rank - b.goal.rank || a.k - b.k)
		.slice(0, most);
	let made = 0;
	const axisOrigins: number[] = [];
	const socketOrigins: number[] = [];
	const rollFrom = unitAt(seed, salt, variant, TURN, 0);
	const tiltFrom = unitAt(seed, salt, variant, TURN, 1);
	kept.forEach(({ goal }, socket) => {
		axisOrigins.push(goal.place);
		socketOrigins.push(goal.place);
		made += hangTwig(
			builder,
			goal.clump,
			goal.point,
			goal.rank,
			goal.scale,
			turn === undefined ? undefined : { turn, socket, rollFrom, tiltFrom },
		);
	});
	return { made, sockets: kept.length, axisOrigins, socketOrigins };
}

/**
 * Hangs one socket on a short twig from its clump's carrying wood to its point, and returns the
 * elements it made.
 */
function hangTwig(
	builder: SkeletonBuilder,
	clump: FillClump,
	point: Vector3,
	rank: number,
	pieceScale: number,
	turning:
		| {
				readonly turn: { readonly roll: number; readonly tilt: number; readonly out?: number };
				readonly socket: number;
				readonly rollFrom: number;
				readonly tiltFrom: number;
		  }
		| undefined,
): number {
	const axis = builder.addAxis({
		parent: clump.axis,
		parentNode: clump.node,
		// A socket's twig stands below the boughs, never among the bones the contract compares.
		order: Math.max(3, clump.order + 1),
		kind: AXIS_LIMB,
		fine: true,
	});
	// The twig runs from the clump's root out to its point, along a line fixed with the clump.
	const from = clump.root;
	const dx = point[0] - from[0];
	const dy = point[1] - from[1];
	const dz = point[2] - from[2];
	const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
	const steps = Math.max(1, Math.min(2, Math.ceil(length / STEP)));
	let parent = clump.node;
	let node = clump.node;
	let radius = 0;
	for (let k = 1; k <= steps; k++) {
		const share = k / steps;
		node = builder.addNode({
			x: from[0] + dx * share,
			y: from[1] + dy * share,
			z: from[2] + dz * share,
			radius: 0.004,
			parent,
			axis,
			light: 1,
			age: Math.round(clump.birth),
		});
		parent = node;
		radius = 0.004;
	}
	// The socket's own frame: +Y out of the clump, +Z toward the sky.
	const out =
		length > 1e-9
			? ([dx / length, dy / length, dz / length] as Vector3)
			: ([0, 1, 0] as Vector3);
	const frame = new Float32Array(4);
	quatFromFrame(out, [0, 1, 0], frame);
	// A piece turns about its own line and tilts off it, by its socket's place in two spread runs
	// of shares, as the frame model turns the pieces at its own sockets.
	if (turning) {
		const spin = new Float32Array(4);
		const share = (shareFrom: number, step: number): number =>
			((shareFrom + turning.socket * step) % 1) * 2 - 1;
		quatAxisAngle([0, 1, 0], radians(share(turning.rollFrom, SPREAD_ROLL) * turning.turn.roll), spin);
		quatMultiply(frame, 0, spin, 0, frame);
		quatAxisAngle([1, 0, 0], radians(share(turning.tiltFrom, SPREAD_TILT) * turning.turn.tilt), spin);
		quatMultiply(frame, 0, spin, 0, frame);
	}
	builder.addBud({
		node,
		x: point[0],
		y: point[1],
		z: point[2],
		frame,
		kind: BUD_TERMINAL,
		vigor: 1,
		light: 1,
		axis,
		woodRadius: radius,
		socket: { scale: pieceScale, rank, lobe: clump.id },
	});
	return steps + 2;
}
