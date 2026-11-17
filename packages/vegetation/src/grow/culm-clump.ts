// The culm-clump grower: a bamboo on the directed design. A clump of jointed culms rises from one
// shared foot, the rim's culms leaning out at the foot and bowing further out toward their tips, the
// middle ones near plumb, so the clump opens from a tight bundle into a plume. Each culm is one
// axis whose nodes are its joints, spaced by the culm's own width, each a raised ring. Above the
// branching height every joint holds one socket, on the side opposite the joint below it, and the
// socket carries a branch pair from the kit (a piece: two branches with their twigs and leaf fans),
// chosen by the joint's place up the branching zone. A culm's tip holds one more socket. The joints
// below the sheath height hold dormant buds, which carry the culm sheaths, and every joint above the
// foot holds a joint bud, where the record's extras stand the node ring.
//
// Every socket carries a rank, ranked once across the plant. Within each culm the sockets take
// their ranks in radical-inverse order up the culm, and the culms interleave, so any leading run of
// the ranks holds a share of every culm spread along its height.
import {
	AXIS_CULM,
	BUD_DORMANT,
	BUD_JOINT,
	BUD_TERMINAL,
	type MacroSkeleton,
	SkeletonBuilder,
} from '../core/graph';
import { unitAt } from '../core/hash';
import {
	cos,
	exp,
	normalize3,
	PI,
	pow,
	quatFromFrame,
	radians,
	sin,
	type Vector3,
} from '../core/math';
import { thinningRanks } from '../core/rank';
import type { CulmClump, Planned as PlannedGrowth, Species } from '../core/record';
import { curveAt, spreadAt, spreadMean, type Vec3 } from '../core/types';
import type { DetailPlan, GrowInput, GrowRequest } from '../stages';
import { type FrameAxis, type FramePatch, planFrame } from './frame';
import { targetHeight } from './height';
import {
	crownOf,
	type ModelAxis,
	type ModelPiece,
	type ModelSocket,
	type PlantModel,
} from './model';
import { growPlantModel } from './model-grow';
import type { Grower } from './models';
import { clumpCounts, planTree } from './planned';
import { pieceNamed, radicalInverse } from './ranked';
import { FOLIAGE_FLOOR } from './sparse';

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
	const jointSites: {
		node: number;
		axis: number;
		at: Vector3;
		direction: Vector3;
		radius: number;
	}[] = [];
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
		// Every joint above the foot carries the ring where its node stands, and the culm's own
		// tangent at the joint is the way the ring turns about.
		for (let j = 1; j < nodes.length - 1; j++) {
			const node = nodes[j] as number;
			const below = nodes[j - 1] as number;
			const at: Vector3 = [
				builder.position[node * 3] as number,
				builder.position[node * 3 + 1] as number,
				builder.position[node * 3 + 2] as number,
			];
			jointSites.push({
				node,
				axis,
				at,
				direction: normalize3([
					at[0] - (builder.position[below * 3] as number),
					at[1] - (builder.position[below * 3 + 1] as number),
					at[2] - (builder.position[below * 3 + 2] as number),
				]),
				radius: builder.radius[node] as number,
			});
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
	for (const joint of jointSites) {
		quatFromFrame(joint.direction, sky, frame);
		builder.addBud({
			node: joint.node,
			x: joint.at[0],
			y: joint.at[1],
			z: joint.at[2],
			frame,
			kind: BUD_JOINT,
			vigor: 0,
			light: 1,
			axis: joint.axis,
			woodRadius: joint.radius,
		});
	}
	return builder.finish(crownBase);
}

/** The culm-clump grower. */
export const grower: Grower = { grow: growCulmClump };

/** Sockets a square metre of a patch's own width carries, as the planned fill states it. */
const PATCH_SOCKETS_PER_AREA = 8.5;

/** How deep inside its patch a socket point stands, as a keyed draw, and the patch's flattening. */
const DEPTH_FROM = 0.41;
const DEPTH_TO = 0.89;
const DEPTH_SHARE = 0.7;

/** The slots one patch may carry, which fix each point's place in its patch. */
const SLOTS = 320;

/** The exponent that slims a young plant's wood against its height. */
const SLIM = 2.5;

/** The record's planned culm growth, or an error for a record of another adult. */
function plannedCulmOf(record: Species): PlannedGrowth {
	const growth = record.growth as PlannedGrowth;
	if (growth.model !== 'planned' || growth.adult !== 'culm' || growth.frame === undefined)
		throw new Error(`@null3d/vegetation: '${record.id}' is not a planned culm clump`);
	return growth;
}

/** The share of the adult height the asked maturity stands at. */
function reachOf(growth: PlannedGrowth, maturity: number): number {
	const top = Math.max(1e-9, curveAt(growth.height, 1));
	const at = curveAt(growth.height, Math.max(0, Math.min(1, maturity)));
	return Math.max(0, Math.min(1, at / top));
}

/**
 * The frame axes a triangle maximum leaves: the shared clump rule's culm and pair counts, each
 * order ranked over the plant, and every axis under a dropped one dropped with it.
 */
function cappedAxes(
	axes: readonly FrameAxis[],
	counts: { readonly culms: number; readonly pairs: number } | undefined,
): Set<number> {
	const kept = new Set<number>(axes.map((_, index) => index));
	if (counts === undefined) return kept;
	const limits: readonly (readonly [number, number])[] = [
		[0, counts.culms],
		[1, counts.pairs],
	];
	for (const [order, cap] of limits) {
		const list = axes
			.map((axis, index) => ({ axis, index }))
			.filter((one) => one.axis.order === order);
		if (list.length <= cap) continue;
		const ranks = thinningRanks(
			list.map((one) => {
				const node = one.axis.nodes[0];
				return [node?.x ?? 0, node?.y ?? 0, node?.z ?? 0];
			}),
		);
		const ranked = list
			.map((one, at) => ({ index: one.index, rank: ranks[at] as number }))
			.sort((a, b) => a.rank - b.rank);
		for (const one of ranked.slice(cap)) kept.delete(one.index);
	}
	axes.forEach((axis, index) => {
		if (axis.parent >= 0 && !kept.has(axis.parent)) kept.delete(index);
	});
	return kept;
}

/** A frame axis's parent, as a share along the parent's nodes where its first node stands. */
function parentShareOf(axis: FrameAxis, parent: FrameAxis | undefined): number {
	if (parent === undefined || parent.nodes.length < 2) return 0;
	return Math.max(0, Math.min(1, axis.parentNode / (parent.nodes.length - 1)));
}

/** A piece's measured figures, from the rule the record names. */
function fanPiece(record: Species, name: string): ModelPiece {
	const rule = record.pieces?.find((piece) => piece.name === name) ?? record.pieces?.[0];
	if (rule === undefined)
		throw new Error(`@null3d/vegetation: '${record.id}' names a piece it does not hold`);
	const stem = spreadMean(rule.stem.length);
	const leaf = record.foliage.kind === 'blade' ? spreadMean(record.foliage.leaf.length) : 0.1;
	// The fan lies out along its twig: its leaves rise about half a leaf's length above the socket
	// and reach about four fifths of one out from it.
	const top = leaf * 0.5;
	const reach = leaf * 0.8;
	return {
		name: rule.name,
		length: stem,
		width: reach * 2,
		depth: leaf,
		top,
		reach,
		figures: { stem, leaf, top, reach },
	};
}

/**
 * Writes the bamboo's culm adult as the shared intermediate model: one axis a culm of the frame,
 * the branch axes that leave it, a socket a fan at each patch's fill points, the fan piece from the
 * record's measured figures, and the crown box read from the pieces. The clump cap's counts come
 * from the shared allocator's rule.
 *
 * @param input The record, the seed, the variant, the season and the request.
 * @returns The model.
 * @category api/vegetation
 */
export function emitCulm(input: GrowInput): PlantModel {
	const growth = plannedCulmOf(input.record);
	const request = input.request ?? { maturity: 1, sparse: 0 };
	const reach = reachOf(growth, request.maturity);
	const frame = planFrame(growth.frame as NonNullable<PlannedGrowth['frame']>, input, false);
	const kept = cappedAxes(frame.axes, clumpCounts(input.record, request));
	const slim = pow(reach, SLIM);
	const axes: ModelAxis[] = [];
	const built = new Map<number, number>();
	frame.axes.forEach((axis, index) => {
		if (!kept.has(index)) return;
		const parentAxis = axis.parent < 0 ? undefined : frame.axes[axis.parent];
		const parent = axis.parent < 0 ? -1 : (built.get(axis.parent) ?? -1);
		const nodes = axis.nodes.map((node) => ({
			at: [node.x * reach, node.y * reach, node.z * reach] as Vec3,
			radius: node.radius * slim,
		}));
		const first = nodes[0];
		const last = nodes[nodes.length - 1];
		if (first === undefined || last === undefined) return;
		built.set(index, axes.length);
		axes.push({
			order: axis.order,
			parent,
			parentShare: parentShareOf(axis, parentAxis),
			from: first.at,
			to: last.at,
			nodes,
			radius: [first.radius, last.radius],
			body: axis.role === 'stem',
		});
	});
	// The sockets: the socket at each patch's own end, then the points its fill spreads over it.
	// They stand in the order the fill hung them, so a plant that keeps them all draws the same
	// pieces it drew before any maximum was asked for.
	const orderDensity = growth.orders[0]?.density;
	const density = typeof orderDensity === 'number' ? orderDensity : 8;
	const points: {
		readonly frameAxis: number;
		readonly at: Vec3;
		readonly direction: Vec3;
	}[] = [];
	// The lowest foliage the pieces stand, as the planned fill reads a patch: its middle less half
	// its width, which is the clump's radius there.
	let base = Number.POSITIVE_INFINITY;
	frame.patches.forEach((patch: FramePatch) => {
		if (!kept.has(patch.axis)) return;
		base = Math.min(base, (patch.centre[1] - patch.width / 2) * reach);
		if (patch.fill === undefined) return;
		const radius = (patch.width / 2) * reach;
		if (!(radius > 1e-6)) return;
		// The socket at the patch's own end, which every patch carries before any other.
		points.push({
			frameAxis: patch.axis,
			at: [patch.centre[0] * reach, patch.centre[1] * reach, patch.centre[2] * reach],
			direction: [0, 1, 0],
		});
		const variety = 1 + 0.6 * (unitAt(input.seed, patch.axis, input.variant, 2) - 0.5);
		const count = Math.round(PATCH_SOCKETS_PER_AREA * (density / 8) * (2 * radius) ** 2 * variety);
		const filled = Math.min(1, count / SLOTS);
		const spin = unitAt(input.seed, patch.axis, input.variant, 1) * 2 * PI;
		for (let k = 0; k < SLOTS; k++) {
			if ((k + 0.5) / SLOTS > filled) continue;
			const y = 1 - (2 * (k + 0.5)) / SLOTS;
			const ring = Math.sqrt(Math.max(0, 1 - y * y));
			const angle = spin + k * radians(137.507);
			const deep = DEPTH_FROM + (DEPTH_TO - DEPTH_FROM) * unitAt(input.seed, patch.axis, k, 1);
			const offset: Vec3 = [
				radius * deep * ring * cos(angle),
				radius * DEPTH_SHARE * deep * y,
				radius * deep * ring * sin(angle),
			];
			const length = Math.sqrt(offset[0] ** 2 + offset[1] ** 2 + offset[2] ** 2) || 1;
			const direction: Vec3 = [offset[0] / length, offset[1] / length, offset[2] / length];
			points.push({
				frameAxis: patch.axis,
				at: [
					patch.centre[0] * reach + offset[0],
					patch.centre[1] * reach + offset[1],
					patch.centre[2] * reach + offset[2],
				],
				direction,
			});
		}
	});
	const pieceScale = frame.scale / Math.max(1e-9, spreadMean(input.record.size.height));
	const piece = growth.piece ?? input.record.pieces?.[0]?.name ?? '';
	const pieceIndex = pieceNamed(input.record, piece).index;
	const sockets: ModelSocket[] = [];
	points.forEach((point, at) => {
		const axis = built.get(point.frameAxis);
		if (axis === undefined) return;
		const carrier = frame.axes[point.frameAxis] as FrameAxis;
		sockets.push({
			axis,
			order: carrier.order + 1,
			share: 1,
			at: point.at,
			direction: point.direction,
			piece: pieceIndex,
			scale: pieceScale,
			// The sockets keep the order they were placed in, so a plant that keeps them all draws
			// each piece where it stood before any maximum was asked for.
			keep: points.length > 1 ? at / (points.length - 1) : 0,
			group: axis,
		});
	});
	const pieces = [fanPiece(input.record, piece)];
	const crown = crownOf(sockets, pieces);
	const sparse = Math.max(0, Math.min(1, request.sparse));
	const floor = input.record.sparse?.foliage ?? FOLIAGE_FLOOR;
	return {
		species: input.record.id,
		axes,
		sockets,
		pieces,
		least: 0,
		scale: reach,
		// The sparseness keeps its share of the crown's sockets; a triangle maximum's share belongs
		// to the shared allocator, which draws the pieces and cards the level can afford.
		keepShare: Math.max(0, Math.min(1, 1 - sparse * (1 - floor))),
		crown: {
			top: crown.top,
			base: Number.isFinite(base) ? Math.max(0, base) : crown.base,
			reach: crown.reach,
		},
	};
}

/**
 * Grows the bamboo from its culm adult's model at the asked state.
 *
 * @param input The record, the seed, the variant, the season and the request.
 * @returns The skeleton.
 * @category api/vegetation
 */
export function growPlannedCulm(input: GrowInput): MacroSkeleton {
	const model = emitCulm(input);
	const grown = growPlantModel(model, {
		// A culm is wood of the plant's own, never a root: the model's body axes are its stems.
		kind: (axis) => (axis.body ? 'stem' : 'limb'),
		beside: (model.pieces[0]?.width ?? 0) / 2,
		crownBase: model.crown.base,
	});
	return {
		...grown,
		crownBase: model.crown.base,
		made: model.axes.length + model.sockets.length,
		shed: 0,
	};
}

/**
 * What the bamboo's culm adult costs at the asked state, read by the shared planned allocator.
 *
 * @param record The species record.
 * @param request The asked maturity, sparseness and maximum.
 * @returns The plan.
 * @category api/vegetation
 */
export function planCulm(record: Species, request: GrowRequest): DetailPlan {
	return planTree(record, request);
}

/** The culm adult of the planned model: the same culm numbers, grown to its state. */
export const plannedGrower: Grower = {
	grow: growPlannedCulm,
	plan: planCulm,
};
