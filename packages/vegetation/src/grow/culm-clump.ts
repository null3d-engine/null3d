// The culm-clump grower: a bamboo on the directed design. A clump of jointed culms rises from one
// shared foot, the rim's culms leaning out at the foot and bowing further out toward their tips, the
// middle ones near plumb, so the clump opens from a tight bundle into a plume. Each culm is one
// axis whose nodes are its joints, spaced by the culm's own width, each a raised ring. Above the
// branching height every joint holds one socket, on the side opposite the joint below it, and the
// socket carries a branch pair from the kit (a piece: two branches with their twigs and leaf fans),
// chosen by the joint's place up the branching zone. A culm's tip holds one more socket. The joints
// below the sheath height hold dormant buds, which carry the culm sheaths.
//
// Every socket carries a rank, ranked once across the plant. Within each culm the sockets take
// their ranks in radical-inverse order up the culm, and the culms interleave, so any leading run of
// the ranks holds a share of every culm spread along its height.
import {
	AXIS_CULM,
	BUD_DORMANT,
	BUD_TERMINAL,
	type MacroSkeleton,
	SkeletonBuilder,
} from '../core/graph';
import { unitAt } from '../core/hash';
import { cos, exp, PI, pow, quatFromFrame, radians, sin, type Vector3 } from '../core/math';
import type { CulmClump, Species } from '../core/record';
import { curveAt, spreadAt } from '../core/types';
import type { GrowInput } from '../stages';
import { targetHeight } from './height';
import type { Grower } from './models';
import { pieceNamed, radicalInverse } from './ranked';

/** The golden angle in radians, which spreads the culms' feet over the clump's foot. */
const GOLDEN = radians(137.50776405);

/** Degrees either side of the side opposite the joint below within which a branch pair stands. */
const PAIR_JITTER = 25;

/** The share of a culm's height over which its foot swells against the soil. */
const SWELL_OVER = 0.12;

/** How much wider than its body a culm's foot stands. */
const SWELL = 0.35;

/** The share of its foot's radius a culm keeps at its tip. */
const TIP_RADIUS = 0.45;

/** Purposes of the grower's hash keys, so no two draws share one. */
const DRAW = {
	culms: 1,
	turn: 2,
	foot: 3,
	height: 4,
	girth: 5,
	thin: 6,
	pair: 7,
	leave: 8,
} as const;

/** The record's culm clump, or an error for a record of another model. */
function clumpOf(record: Species): CulmClump {
	if (record.growth.model !== 'culm-clump')
		throw new Error(`@null3d/vegetation: '${record.id}' is not a culm-clump model`);
	return record.growth;
}

/** A direction in the vertical plane of a heading, `elevation` radians above level. */
function inPlane(heading: number, elevation: number): Vector3 {
	const c = cos(elevation);
	return [cos(heading) * c, sin(elevation), sin(heading) * c];
}

/** A culm's radius at a share of its height: a swollen foot and a slow taper to its tip. */
function culmRadius(base: number, share: number): number {
	const swell = 1 + SWELL * exp(-share / SWELL_OVER);
	return base * swell * (1 - (1 - TIP_RADIUS) * pow(share, 1.5));
}

/** One culm's joints: their heights up the culm, from its foot to its tip, in metres. */
function jointHeights(growth: CulmClump, height: number, diameter: number): number[] {
	const heights = [0];
	let up = 0;
	while (up < height) {
		const spacing = curveAt(growth.joints, up / height) * diameter;
		up += Math.max(1e-3, spacing);
		heights.push(Math.min(up, height));
	}
	// The last joint stands at the tip; a stub shorter than half a joint joins the one below.
	if (heights.length > 2) {
		const last = heights.length - 1;
		const stub = (heights[last] as number) - (heights[last - 1] as number);
		if (stub < 0.5 * curveAt(growth.joints, 1) * diameter) heights.splice(last - 1, 1);
	}
	return heights;
}

/** The piece a socket at a share up the branching zone carries: the last band that starts below it. */
function pieceAt(growth: CulmClump, share: number): string {
	let piece = (growth.branches.pieces[0] as { piece: string }).piece;
	for (const band of growth.branches.pieces) if (share >= band.from) piece = band.piece;
	return piece;
}

/** One socket as planned, before its rank. */
interface Planned {
	readonly node: number;
	readonly axis: number;
	readonly at: Vector3;
	readonly direction: Vector3;
	readonly radius: number;
	/** The piece's place among the record's pieces. */
	readonly piece: number;
	readonly scale: number;
	/** Its culm, the group it is ranked in. */
	readonly culm: number;
	/** Its place in its culm's order. */
	readonly share: number;
}

/**
 * Grows a bamboo clump on the directed design: its culms and their joints, a ranked socket at each
 * branching joint and at each tip, and the dormant buds that carry the sheaths.
 *
 * @param input The record, the seed, the variant and the season.
 * @returns The skeleton.
 */
export function growCulmClump(input: GrowInput): MacroSkeleton {
	const { record, seed, variant } = input;
	const growth = clumpOf(record);
	const draw = (purpose: number, a = 0, b = 0) =>
		unitAt(seed, record.seedSalt, variant * 256 + purpose, a, b);
	const height = targetHeight(record, seed, variant);
	const builder = new SkeletonBuilder();
	const culms = Math.max(1, Math.round(spreadAt(growth.culms, draw(DRAW.culms))));
	const turn = draw(DRAW.turn) * 2 * PI;
	const planned: Planned[] = [];
	const sheathed: { node: number; axis: number; at: Vector3; heading: number; radius: number }[] =
		[];
	const sky: Vector3 = [0, 1, 0];
	for (let c = 0; c < culms; c++) {
		// The culms' feet stand on a sunflower spiral over the foot, so the foot is evenly full.
		const out = Math.sqrt((c + 0.5) / culms);
		const heading = turn + c * GOLDEN + (draw(DRAW.foot, c) - 0.5) * 0.3;
		const foot: Vector3 = [cos(heading) * out * growth.foot, 0, sin(heading) * out * growth.foot];
		// A third of the culms, most of them at the rim, are thin and short.
		const thin = draw(DRAW.thin, c) < growth.thin.share * (0.4 + 1.2 * out);
		const [low, high] = thin ? growth.thin.height : growth.height;
		const culmHeight = height * (low + (high - low) * draw(DRAW.height, c));
		const diameter =
			spreadAt(growth.diameter, draw(DRAW.girth, c)) * (thin ? growth.thin.diameter : 1);
		const base = diameter / 2;
		// A culm leans out by its distance from the centre, the plume's narrow side by less.
		const across = growth.depth * sin(heading);
		const depth = Math.sqrt(cos(heading) * cos(heading) + across * across);
		const leanFoot = radians(growth.lean.foot) * out * depth;
		const leanTip = radians(growth.lean.tip) * out * depth;
		const axis = builder.addAxis({ parent: -1, parentNode: -1, order: 0, kind: AXIS_CULM });
		const joints = jointHeights(growth, culmHeight, diameter);
		const p: Vector3 = [foot[0], foot[1], foot[2]];
		let previous = -1;
		const nodes: number[] = [];
		const lean: number[] = [];
		for (let j = 0; j < joints.length; j++) {
			const share = (joints[j] as number) / culmHeight;
			const tilt = leanFoot + (leanTip - leanFoot) * pow(share, 1.5);
			if (j > 0) {
				const step = (joints[j] as number) - (joints[j - 1] as number);
				const d = inPlane(heading, PI / 2 - tilt);
				p[0] += d[0] * step;
				p[1] += d[1] * step;
				p[2] += d[2] * step;
			}
			previous = builder.addNode({
				x: p[0],
				y: p[1],
				z: p[2],
				radius: culmRadius(base, share) + (j > 0 && j < joints.length - 1 ? growth.ridge : 0),
				parent: previous,
				axis,
				light: 1,
			});
			nodes.push(previous);
			lean.push(tilt);
		}
		// The branching zone starts higher on a culm nearer the clump's middle.
		const from =
			growth.branches.from.centre + (growth.branches.from.rim - growth.branches.from.centre) * out;
		const zone: number[] = [];
		for (let j = 1; j < joints.length - 1; j++) {
			const share = (joints[j] as number) / culmHeight;
			const at: Vector3 = [
				builder.position[(nodes[j] as number) * 3] as number,
				builder.position[(nodes[j] as number) * 3 + 1] as number,
				builder.position[(nodes[j] as number) * 3 + 2] as number,
			];
			if (growth.sheaths && share < growth.sheaths.upTo)
				sheathed.push({
					node: nodes[j] as number,
					axis,
					at,
					heading,
					radius: culmRadius(base, share),
				});
			if (share >= from) zone.push(j);
		}
		const scale = thin ? growth.thin.scale : 1;
		zone.forEach((j, k) => {
			const share = (joints[j] as number) / culmHeight;
			const along = (share - from) / Math.max(1e-6, 1 - from);
			// Branch pairs leave on alternate sides of the culm, joint by joint.
			const side =
				heading + (k % 2 === 0 ? 0 : PI) + radians((draw(DRAW.pair, c, j) * 2 - 1) * PAIR_JITTER);
			const leave = radians(spreadAt(growth.branches.leave, draw(DRAW.leave, c, j)));
			const radius = culmRadius(base, share);
			const centre: Vector3 = [
				builder.position[(nodes[j] as number) * 3] as number,
				builder.position[(nodes[j] as number) * 3 + 1] as number,
				builder.position[(nodes[j] as number) * 3 + 2] as number,
			];
			planned.push({
				node: nodes[j] as number,
				axis,
				at: [centre[0] + cos(side) * radius, centre[1], centre[2] + sin(side) * radius],
				direction: inPlane(side, leave - (lean[j] as number) * cos(side - heading)),
				radius,
				piece: pieceNamed(record, pieceAt(growth, along)).index,
				scale,
				culm: c,
				share: radicalInverse(k),
			});
		});
		// The tip's own socket carries the culm's last fan along its line.
		const last = nodes.length - 1;
		if (growth.tip) {
			const tip = nodes[last] as number;
			planned.push({
				node: tip,
				axis,
				at: [
					builder.position[tip * 3] as number,
					builder.position[tip * 3 + 1] as number,
					builder.position[tip * 3 + 2] as number,
				],
				direction: inPlane(heading, PI / 2 - (lean[last] as number)),
				radius: culmRadius(base, 1),
				piece: pieceNamed(record, growth.tip).index,
				scale,
				culm: c,
				share: radicalInverse(zone.length),
			});
		}
	}

	// Each socket's rank, once across the plant: by its share in its culm, then by its culm.
	const ranked = planned
		.map((socket, i) => ({ socket, i }))
		.sort((a, b) => a.socket.share - b.socket.share || a.socket.culm - b.socket.culm || a.i - b.i);
	const frame = [0, 0, 0, 1];
	let crownBase = height;
	ranked.forEach(({ socket }, rank) => {
		quatFromFrame(socket.direction, sky, frame);
		builder.addBud({
			node: socket.node,
			x: socket.at[0],
			y: socket.at[1],
			z: socket.at[2],
			frame,
			kind: BUD_TERMINAL,
			vigor: 1,
			light: 1,
			axis: socket.axis,
			woodRadius: socket.radius,
			socket: { scale: socket.scale, rank, lobe: socket.culm, piece: socket.piece },
		});
		crownBase = Math.min(crownBase, socket.at[1]);
	});
	for (const bud of sheathed) {
		quatFromFrame([0, 1, 0], [cos(bud.heading), 0, sin(bud.heading)], frame);
		builder.addBud({
			node: bud.node,
			x: bud.at[0],
			y: bud.at[1],
			z: bud.at[2],
			frame,
			kind: BUD_DORMANT,
			vigor: 0,
			light: 1,
			axis: bud.axis,
			woodRadius: bud.radius,
		});
	}
	return builder.finish(crownBase);
}

/** The culm-clump grower. */
export const grower: Grower = { grow: growCulmClump };
