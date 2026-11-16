// The planned grower's fill: the wood and the sockets that clothe each clump. A clump is filled
// through its depth, not as one shell, and every socket is placed by a draw keyed on the clump and
// the socket's place in it, so a socket comes out the same wherever the plan keeps it. Sparseness
// keeps a spread share of the sockets by their rank across the whole crown.
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
 * the clump's own radius, and the share of the outermost's spacing of points it keeps. Measured
 * from today's oak: its sockets stand at about 0.55, 0.36 and 0.19 of the clump's radius, so the
 * clump is clothed through and not only at its rim.
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

/** Metres from one twig node to the next, at the longest. */
const STEP = 1.0;

/** The steps between the two spread shares that turn each socket's piece about its own line. */
const SPREAD_ROLL = 0.7548776662466927;
const SPREAD_TILT = 0.5698402909980532;

/** The purpose of the draws that turn a socket's piece, which the frame model shares. */
const TURN = 15;

/** The fewest points a clump's own end carries, where the shell count rounds low. */
const LEAST_POINTS = 1;

/** What the fill grows: how many elements it made and how many sockets it hung. */
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

/** The sockets one clump may carry, which bounds its sockets' places in the plant. */
const SOCKETS_MOST = 256;

/** One clump of the adult plan, grown to its asked state. */
export interface FillClump {
	/** Its index, which its sockets name by `lobe`. */
	readonly id: number;
	/** Its grown middle in plant space. */
	readonly centre: Vec3;
	/** Its grown radius in metres. */
	readonly radius: number;
	/** The model age at which it appears. */
	readonly birth: number;
	/** The SkeletonBuilder axis that carries it. */
	readonly axis: number;
	/** The SkeletonBuilder node where its axis ends. */
	readonly node: number;
	/** The botanical order of its carrying axis, so its twigs stand one order deeper. */
	readonly order: number;
	/** The point on its carrying axis where its twigs start, in plant space. */
	readonly root: Vec3;
}

/** What the fill takes. */
export interface FillInput {
	readonly builder: SkeletonBuilder;
	readonly seed: number;
	readonly variant: number;
	readonly clumps: readonly FillClump[];
	/** The share of the crown's rows kept at this sparseness, from 0.08 to 1. */
	readonly leaves: number;
	/** The scale of a socket's piece against the species' own. */
	readonly pieceScale: number;
	/** The record's salt, which keys the draws that turn each socket's piece. */
	readonly salt: number;
	/** How far each socket's piece turns from the sky: its roll and its tilt, in degrees. */
	readonly turn?: { readonly roll: number; readonly tilt: number; readonly out?: number };
}

/**
 * Fills each clump through its depth with sockets, each on a short twig, and keeps a spread share
 * of them at the asked sparseness.
 *
 * @param input The clumps, the skeleton to grow into and the shares that decide what is kept.
 * @returns The count of elements the fill made.
 * @category api/vegetation
 */
export function fillClumps(input: FillInput): FillCount {
	const { builder, seed, salt, variant, clumps, leaves, pieceScale, turn } = input;
	interface Goal {
		readonly clump: FillClump;
		readonly point: Vector3;
		readonly rank: number;
		/** Its place in the plant as grown, which the clump's own order fixes. */
		readonly place: number;
	}
	const goals: Goal[] = [];
	clumps.forEach((clump) => {
		const radius = Math.max(1e-6, clump.radius);
		// A socket stands inside the clump's surface by its piece's reach, so the shells shrink by
		// that inset, never under a third of the clump's radius.
		const inner = Math.max(radius - INSET, radius * 0.3);
		// The outer shell's own count; every shell together makes the socket count.
		const count = Math.max(
			LEAST_POINTS,
			Math.round((SOCKETS_PER_AREA * (2 * radius) ** 2) / SHELL_TOTAL),
		);
		// The clump's own axis ends in a socket, as every twig does.
		let local = 0;
		goals.push({
			clump,
			point: [clump.root[0], clump.root[1], clump.root[2]],
			rank: 0,
			place: clump.id * SOCKETS_MOST + local++,
		});
		SHELLS.forEach(([size, keep], shell) => {
			const many = Math.max(0, Math.round(count * size * size * keep));
			for (let k = 0; k < many; k++) {
				// An evenly spread direction, turned by the clump's own draw so two clumps differ.
				const y = 1 - (2 * (k + 0.5)) / many;
				const ring = Math.sqrt(Math.max(0, 1 - y * y));
				const turn = unitAt(seed, clump.id, variant, 1) * 2 * Math.PI;
				const angle = turn + shell * radians(137.507) + k * radians(137.507);
				goals.push({
					clump,
					point: [
						clump.centre[0] + inner * size * ring * Math.cos(angle),
						clump.centre[1] + inner * DEPTH_SHARE * 2 * size * y,
						clump.centre[2] + inner * size * ring * Math.sin(angle),
					],
					rank: 0,
					place: clump.id * SOCKETS_MOST + Math.min(SOCKETS_MOST - 1, local++),
				});
			}
		});
	});
	// The sockets kept at this sparseness stand spread through the crown.
	const ranks = thinningRanks(goals.map((goal) => goal.point));
	goals.forEach((goal, k) => {
		(goal as { rank: number }).rank = ranks[k] as number;
	});
	const most = Math.max(1, Math.round(goals.length * Math.min(1, Math.max(0, leaves))));
	const kept = goals
		.map((goal, k) => ({ goal, k }))
		.sort((a, b) => (a.goal.rank as number) - (b.goal.rank as number) || a.k - b.k)
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
			pieceScale,
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
		order: clump.order + 1,
		kind: AXIS_LIMB,
		fine: true,
	});
	// The twig grows from the wood at the clump's middle out to its point.
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
		const share = (from: number, step: number): number =>
			((from + turning.socket * step) % 1) * 2 - 1;
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
