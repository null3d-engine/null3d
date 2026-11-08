// The crown-rosette grower: palms and tree ferns. One stem rises as a column, leaning and curving
// by the record, and carries a golden-angle spiral of fronds at its top. Each frond is a rachis the
// wood mesher draws as a thin limb, and one bud site at its base carries the blade, its vigor the
// frond's age. The youngest fronds stand upright and the oldest arch out and down; dead fronds hang
// below them as a skirt. A date palm also carries suckers: young stems from the foot, each with a
// crown of its own.
//
// The foliage reads only the skeleton, so a cut frond keeps its blade. The merged foliage builder
// draws the leaflets along each rachis.
import {
	AXIS_RACHIS,
	AXIS_STEM,
	BUD_FLOWER,
	BUD_TERMINAL,
	type MacroSkeleton,
	SkeletonBuilder,
} from '../core/graph';
import { unitAt } from '../core/hash';
import {
	cos,
	cross3,
	normalize3,
	PI,
	quatAxisAngle,
	quatFromFrame,
	quatRotate,
	radians,
	sin,
	type Vector3,
} from '../core/math';
import type { CrownRosette, FrondShape, Species } from '../core/record';
import { curveAt, spreadAt } from '../core/types';
import { MATURE_AGE } from '../leaf/frond';
import { palmFoliage } from '../leaf/palm-frond';
import type { GrowInput } from '../stages';
import type { Grower } from './models';

/** Draw purposes, so no two draws share a key. */
const DRAW = {
	height: 1,
	lean: 2,
	leanTurn: 3,
	curve: 4,
	suckers: 5,
	suckerHeight: 6,
	suckerTurn: 7,
	suckerLean: 8,
	fronds: 9,
	frondTurn: 10,
	frondLength: 11,
	frondTilt: 12,
	frondAzimuth: 13,
	dead: 14,
	deadLength: 15,
	deadHang: 16,
	deadTurn: 17,
	spine: 18,
	croziers: 19,
	crozierTurn: 20,
	crozierLength: 21,
	crozierLean: 22,
} as const;

/** Metres between the stem's nodes. */
const STEM_NODE = 0.35;
/** The most a stem's radius may narrow over one node, so the wood mesher keeps its rings even. */
const RADIUS_FALL = 0.96;
/** The thinnest a rachis gets, in metres of radius. */
const RACHIS_TIP = 0.003;
/** Metres between a rachis's nodes: enough for the wood mesher to follow the arch. */
const RACHIS_NODE = 0.4;
/** The most a rachis turns over one node, in radians, so a curve keeps its samples. */
const RACHIS_TURN = 0.25;
/** Metres of stem over which the frond bases clasp it, where the record names none. */
const CROWN_DEPTH = 0.7;
/** Metres that a frond's base stands out from the stem's surface. */
const FROND_STAND = 0.08;
/** Metres between a crozier's nodes: fine enough that the wood mesher follows its coil. */
const CROZIER_NODE = 0.03;
/** Degrees a crozier's head turns through where the record names none. */
const CROZIER_COIL = 540;
/** The share of a crozier's length that its straight stalk takes before the head curls. */
const CROZIER_STALK = 0.5;
/** The head's first radius as a share of the crozier's length, and how far it shrinks by its tip. */
const CROZIER_HEAD = 0.13;
const CROZIER_TIGHTEN = 0.8;
/** The least radius a crozier keeps, in metres of the wood mesh's ring. */
const CROZIER_TIP = 0.004;
/** Metres a crozier's foot stands out from the stem's axis: it rises from the growing point. */
const CROZIER_STAND = 0.03;
/** The share of a living frond's length that a dead frond keeps. */
const DEAD_SHARE = 0.72;
/** The least height of a sucker's stem, and the most, in metres. */
const SUCKER_HEIGHT = [0.6, 2.6] as const;
/** The share of the crown's living fronds a sucker carries. */
const SUCKER_FRONDS = 0.45;
/** Metres a sucker's foot stands from the main stem's axis. */
const SUCKER_RING = [0.45, 0.9] as const;
/** The azimuth spread of the date bunches, in degrees, round the crown. */
const BUNCH_TURNS = [0, 90, 180, 270] as const;
/** How far below the crown's origin the date bunches hang from, in metres. */
const BUNCH_DROP = 0.5;
/** Metres the date bunch stalks stand out from the stem's surface. */
const BUNCH_OUT = 0.05;

/** The record's crown-rosette growth, or a fault for another model. */
function rosetteOf(record: Species): CrownRosette {
	if (record.growth.model !== 'crown-rosette')
		throw new Error(
			`@null3d/vegetation: the crown-rosette grower got a '${record.growth.model}' record`,
		);
	return record.growth;
}

/** A stem's plan before its nodes are laid. */
interface StemPlan {
	/** The foot on the ground. */
	readonly x: number;
	readonly z: number;
	/** Stem height in metres. */
	readonly height: number;
	/** Degrees the stem leans from vertical. */
	readonly lean: number;
	/** Degrees the stem bends over its height. */
	readonly curve: number;
	/** The azimuth the stem leans toward. */
	readonly turn: number;
	/** The radius at the foot, in metres. */
	readonly radius: number;
	/** Fronds its crown carries. */
	readonly fronds: number;
	/** Whether its crown carries dead fronds. */
	readonly dead: number;
	/** Share of the crown's height over which its frond bases clasp it. */
	readonly crownDepth: number;
	/** The scale a crown's fronds take. */
	readonly scale: number;
}

/** The stem a grower laid: the axis, its nodes, its top point and the direction it ends in. */
interface LaidStem {
	readonly axis: number;
	/** Its first node. */
	readonly first: number;
	/** Its top node. */
	readonly top: number;
	readonly topPoint: Vector3;
	readonly topDirection: Vector3;
	readonly plan: StemPlan;
}

/** The radius of a stem at a share of its height. */
function stemRadius(growth: CrownRosette, plan: StemPlan, share: number): number {
	return Math.max(
		RACHIS_TIP,
		curveAt(growth.stem.radius, Math.max(0, Math.min(1, share))) *
			(plan.radius / baseRadius(growth)),
	);
}

/** The radius the record's curve gives at the foot, so a stem's own foot radius scales it. */
function baseRadius(growth: CrownRosette): number {
	return Math.max(curveAt(growth.stem.radius, 0), 1e-4);
}

/**
 * Lays one stem as a column of nodes: a lean and a bend over its height, the radius the record's
 * curve gives, wider at the foot.
 */
function layStem(builder: SkeletonBuilder, growth: CrownRosette, plan: StemPlan): LaidStem {
	const axis = builder.addAxis({ parent: -1, parentNode: -1, order: 0, kind: AXIS_STEM });
	const lean = radians(plan.lean);
	const curve = radians(plan.curve);
	const turn = plan.turn;
	const nodes = Math.max(2, Math.ceil(plan.height / STEM_NODE));
	let x = plan.x;
	let y = 0;
	let z = plan.z;
	let node = builder.addNode({
		x,
		y,
		z,
		radius: stemRadius(growth, plan, 0),
		parent: -1,
		axis,
	});
	const first = node;
	let previous = stemRadius(growth, plan, 0);
	for (let n = 1; n <= nodes; n++) {
		const share = n / nodes;
		// The lean grows toward the stem's bend over its height, so a curving stem turns over as it
		// rises.
		const angle = lean + curve * share * share;
		const step = plan.height / nodes;
		x += sin(angle) * cos(turn) * step;
		y += cos(angle) * step;
		z += sin(angle) * sin(turn) * step;
		const radius = Math.max(previous * RADIUS_FALL, stemRadius(growth, plan, share));
		previous = radius;
		node = builder.addNode({ x, y, z, radius, parent: node, axis });
	}
	return {
		axis,
		first,
		top: node,
		topPoint: [x, y, z],
		topDirection: normalize3([
			sin(lean + curve) * cos(turn),
			cos(lean + curve),
			sin(lean + curve) * sin(turn),
		]),
		plan,
	};
}

/** Where one frond's rachis is laid: its base, its first direction and the azimuth it reaches. */
interface FrondPlan {
	/** The stem node the frond clasps. */
	readonly node: number;
	/** The point the rachis starts from. */
	readonly base: Vector3;
	/** Its first direction, a unit vector. */
	readonly direction: Vector3;
	/** Its side axis, square to the direction and to the frond's plane. */
	readonly side: Vector3;
	/** The frond's upper face, a unit vector square to the direction and the side. */
	readonly upper: Vector3;
	/** Its blade length in metres. */
	readonly length: number;
	/** The age its bud carries: a mature living frond, or a dead one. */
	readonly age: number;
	/** Its base radius in metres. */
	readonly radius: number;
}

/**
 * The fronds of one crown, laid in a golden-angle spiral. The date palm's tilt climbs with a
 * frond's place in the spiral, so the youngest stand upright at the middle and the oldest arch
 * farthest out. Dead fronds hang below them.
 */
function frondPlans(
	builder: SkeletonBuilder,
	growth: CrownRosette,
	stem: LaidStem,
	draw: (purpose: number, index: number) => number,
	first: number,
	count: number,
	dead: number,
	scale: number,
): FrondPlan[] {
	const shape: FrondShape = growth.frond;
	const crown = growth.crown;
	const plans: FrondPlan[] = [];
	const baseRadiusOf = Math.max(shape.petiole.width / 2, RACHIS_TIP);
	const start = draw(DRAW.frondTurn, first) * 2 * PI;
	const spiral = count > 0 ? radians(crown.divergence) : 0;
	const total = count + dead;
	for (let i = 0; i < total; i++) {
		const deadFrond = i >= count;
		const living = deadFrond ? 0 : i;
		const share = count > 0 ? living / Math.max(1, count - 1) : 0;
		// The frond bases stand in a spiral down the crown's depth, newest lowest.
		const depth = stem.plan.crownDepth * (1 - (deadFrond ? 1 : share));
		const want = stem.plan.height - depth;
		const node = nodeNear(builder, stem, want);
		const p = builder.position;
		const azimuth = deadFrond
			? start + spiral * (first + i) + radians(draw(DRAW.deadTurn, first + i) * 12 - 6)
			: start + spiral * (first + i) + radians(draw(DRAW.frondAzimuth, first + i) * 16 - 8);
		// The record gives the tilt by frond age; the draw spreads fronds of one age so a crown
		// reads round rather than as rings.
		const tilt = deadFrond
			? radians(crown.dead.hang + draw(DRAW.deadHang, first + i) * 20 - 10)
			: radians(curveAt(crown.tilt, share) + draw(DRAW.frondTilt, first + i) * 10 - 5);
		const horizontal: Vector3 = [cos(azimuth), 0, sin(azimuth)];
		const direction = normalize3([horizontal[0] * sin(tilt), cos(tilt), horizontal[2] * sin(tilt)]);
		const side = normalize3([-horizontal[2], 0, horizontal[0]]);
		const upper = normalize3(cross3(direction, side, [0, 0, 0]));
		const nodePoint: Vector3 = [
			p[node * 3] as number,
			p[node * 3 + 1] as number,
			p[node * 3 + 2] as number,
		];
		const stand = stemRadius(
			growth,
			stem.plan,
			(nodePoint[1] as number) / Math.max(stem.plan.height, 1e-4),
		);
		const base: Vector3 = [
			(nodePoint[0] as number) + horizontal[0] * (stand + FROND_STAND),
			nodePoint[1] as number,
			(nodePoint[2] as number) + horizontal[2] * (stand + FROND_STAND),
		];
		const drawn = spreadAt(shape.length, draw(DRAW.frondLength, first + i));
		const length = Math.max(
			0.4,
			drawn * scale * (deadFrond ? DEAD_SHARE - 0.2 * crown.dead.skirt : 0.75 + 0.25 * share),
		);
		plans.push({
			node,
			base,
			direction,
			side,
			upper,
			length: Math.max(shape.petiole.length + length * 0.2, length),
			age: deadFrond ? 1 : MATURE_AGE,
			radius: baseRadiusOf * (deadFrond ? 0.75 : 1) * scale,
		});
	}
	return plans;
}

/** The stem node nearest a height, so a frond clasps the stem where its base stands. */
function nodeNear(builder: SkeletonBuilder, stem: LaidStem, height: number): number {
	const p = builder.position;
	let best = stem.first;
	let bestGap = Number.POSITIVE_INFINITY;
	for (let n = stem.first; n <= stem.top; n++) {
		const gap = Math.abs((p[n * 3 + 1] as number) - height);
		if (gap < bestGap) {
			bestGap = gap;
			best = n;
		}
	}
	return best;
}

/**
 * Lays one frond's rachis from its base along its plan, turning toward its lower face by the
 * record's droop curve, and adds the bud site that carries its blade.
 */
function layFrond(
	builder: SkeletonBuilder,
	growth: CrownRosette,
	stem: LaidStem,
	plan: FrondPlan,
): number {
	const shape = growth.frond;
	const axis = builder.addAxis({
		parent: stem.axis,
		parentNode: plan.node,
		parentT: 0,
		order: 1,
		kind: AXIS_RACHIS,
	});
	const points = Math.max(2, Math.ceil(plan.length / RACHIS_NODE));
	const step = plan.length / points;
	let point = plan.base;
	let direction = plan.direction;
	const q = [0, 0, 0, 1];
	let node = builder.addNode({
		x: point[0],
		y: point[1],
		z: point[2],
		radius: plan.radius,
		parent: plan.node,
		axis,
	});
	const first = node;
	for (let i = 1; i <= points; i++) {
		const share = i / points;
		// A positive droop bends the rachis toward its lower face, so the frond's tip falls below
		// its middle; the cap keeps a steep droop sampled rather than turned in one step.
		const turn = radians(curveAt(shape.droop, share));
		quatAxisAngle(plan.side, -Math.max(-RACHIS_TURN, Math.min(RACHIS_TURN, turn / points)), q);
		direction = normalize3(quatRotate(q, 0, direction, [0, 0, 0]));
		point = [
			(point[0] as number) + direction[0] * step,
			(point[1] as number) + direction[1] * step,
			(point[2] as number) + direction[2] * step,
		];
		const radius = Math.max(RACHIS_TIP, plan.radius + (RACHIS_TIP - plan.radius) * share);
		node = builder.addNode({
			x: point[0],
			y: point[1],
			z: point[2],
			radius,
			parent: node,
			axis,
		});
	}
	// The bud at the blade's base: +Y along the rachis, +Z its upper face. The petiole's own length
	// is the bare stalk before the leaflets begin, so the bud sits at the base where the blade's
	// path starts.
	const frame = new Float32Array(4);
	quatFromFrame(plan.direction, plan.upper, frame);
	builder.addBud({
		node: first,
		x: plan.base[0],
		y: plan.base[1],
		z: plan.base[2],
		frame,
		kind: BUD_TERMINAL,
		vigor: plan.age,
		light: 1,
		axis,
		woodRadius: plan.radius,
	});
	return point[1];
}

/**
 * Lays one crozier: a young frond still rolled at its tip. Its stalk rises from the crown at the
 * youngest fronds' tilt, then its head curls in the vertical plane through its azimuth, tightening
 * as it goes. The wood mesher draws the roll as a thick young stalk; no bud carries a blade, so the
 * crozier is the roll itself.
 */
function layCrozier(
	builder: SkeletonBuilder,
	growth: CrownRosette,
	stem: LaidStem,
	draw: (purpose: number, index: number) => number,
	first: number,
	index: number,
): void {
	const croziers = growth.crown.croziers as NonNullable<CrownRosette['crown']['croziers']>;
	const crown = growth.crown;
	const length = Math.max(0.15, spreadAt(croziers.length, draw(DRAW.crozierLength, first + index)));
	const coil = radians(croziers.coil ?? CROZIER_COIL);
	const azimuth =
		draw(DRAW.crozierTurn, first + index) * 2 * PI + radians(crown.divergence) * (first + index);
	const lean = radians(
		Math.max(4, curveAt(crown.tilt, 0) + draw(DRAW.crozierLean, first + index) * 8 - 4),
	);
	const horizontal: Vector3 = [cos(azimuth), 0, sin(azimuth)];
	const side: Vector3 = [-horizontal[2], 0, horizontal[0]];
	const stalk = normalize3([horizontal[0] * sin(lean), cos(lean), horizontal[2] * sin(lean)]);
	// The head turns in the plane the stalk and the crown's side span, curling out over the top.
	const turned = cross3(side, stalk, [0, 0, 0]);
	const across = normalize3([-turned[0], -turned[1], -turned[2]]);
	const p = builder.position;
	const crownPoint: Vector3 = [
		p[stem.top * 3] as number,
		p[stem.top * 3 + 1] as number,
		p[stem.top * 3 + 2] as number,
	];
	const base: Vector3 = [
		crownPoint[0] + horizontal[0] * CROZIER_STAND,
		crownPoint[1],
		crownPoint[2] + horizontal[2] * CROZIER_STAND,
	];
	const radius = Math.max(croziers.radius ?? growth.frond.petiole.width / 2, 0.008);
	const axis = builder.addAxis({
		parent: stem.axis,
		parentNode: stem.top,
		parentT: 0,
		order: 1,
		kind: AXIS_RACHIS,
		grownBark: croziers.bark === 'grown',
	});
	const stalkLength = length * CROZIER_STALK;
	const headRadius = length * CROZIER_HEAD;
	// The head's own length along the coil, with its radius tightening as it turns.
	const coilLength = 0.5 * (1 + (1 - CROZIER_TIGHTEN)) * coil * headRadius;
	const stalkCount = Math.max(2, Math.ceil(stalkLength / CROZIER_NODE));
	const coilCount = Math.max(6, Math.ceil(coil / radians(18)));
	let previous = -1;
	const addPoint = (point: Vector3, share: number): void => {
		// The head swells where the blade is rolled, then closes to a point.
		const swell = 0.5 * radius * sin(PI * Math.min(1, Math.max(0, share)));
		const width = Math.max(CROZIER_TIP, radius * (1 - 0.6 * share) + swell);
		previous = builder.addNode({
			x: point[0],
			y: point[1],
			z: point[2],
			radius: width,
			parent: previous,
			axis,
			light: 1,
			age: 0,
		});
	};
	for (let i = 0; i <= stalkCount; i++) {
		const t = i / stalkCount;
		const run = stalkLength * t;
		addPoint(
			[base[0] + stalk[0] * run, base[1] + stalk[1] * run, base[2] + stalk[2] * run],
			run / length,
		);
	}
	const head: Vector3 = [
		base[0] + stalk[0] * stalkLength + across[0] * headRadius,
		base[1] + stalk[1] * stalkLength + across[1] * headRadius,
		base[2] + stalk[2] * stalkLength + across[2] * headRadius,
	];
	for (let i = 1; i <= coilCount; i++) {
		const t = i / coilCount;
		const angle = coil * t;
		const r = headRadius * (1 - CROZIER_TIGHTEN * t);
		addPoint(
			[
				head[0] - across[0] * r * cos(angle) - stalk[0] * r * sin(angle),
				head[1] - across[1] * r * cos(angle) - stalk[1] * r * sin(angle),
				head[2] - across[2] * r * cos(angle) - stalk[2] * r * sin(angle),
			],
			(stalkLength + coilLength * t) / length,
		);
	}
}

/**
 * Adds the date bunches' sites: a few flower buds at the crown, below the youngest fronds, where the
 * species' extras hang their stalked fruit.
 */
function addBunches(builder: SkeletonBuilder, growth: CrownRosette, stem: LaidStem): void {
	const frame = new Float32Array([0, 0, 0, 1]);
	// The bunches hang from the stem's own crown, so their stalks meet the wood.
	const surface = stemRadius(growth, stem.plan, 1) + BUNCH_OUT;
	for (const turn of BUNCH_TURNS) {
		const azimuth = radians(turn) + stem.plan.turn;
		const y = stem.plan.height - BUNCH_DROP;
		builder.addBud({
			node: stem.top,
			x: (stem.topPoint[0] as number) + cos(azimuth) * surface,
			y,
			z: (stem.topPoint[2] as number) + sin(azimuth) * surface,
			frame,
			kind: BUD_FLOWER,
			vigor: 0.5,
			light: 1,
			axis: stem.axis,
			woodRadius: stemRadius(growth, stem.plan, 1),
		});
	}
}

/**
 * Grows one crown-rosette plant: its stem, its fronds and their blades, and any suckers at its
 * foot.
 *
 * @param input The record, the seed, the variant and the season.
 * @returns The skeleton.
 * @category api/vegetation
 */
export function growCrownRosette(input: GrowInput): MacroSkeleton {
	const { record, seed, variant } = input;
	const growth = rosetteOf(record);
	const salt = record.seedSalt >>> 0;
	const draw = (purpose: number, index = 0) => unitAt(seed, salt, variant, purpose, index);
	const builder = new SkeletonBuilder();
	const height = Math.max(1, spreadAt(growth.stem.height, draw(DRAW.height)));
	const lean = Math.max(0, spreadAt(growth.stem.lean, draw(DRAW.lean)));
	const curve = spreadAt(growth.stem.curve, draw(DRAW.curve));
	const turn = draw(DRAW.leanTurn) * 2 * PI;
	const fronds = Math.max(3, Math.round(spreadAt(growth.crown.fronds, draw(DRAW.fronds))));
	const dead = Math.max(0, Math.round(spreadAt(growth.crown.dead.count, draw(DRAW.dead))));
	const radius = Math.max(curveAt(growth.stem.radius, 0), 1e-3);
	const crownDepth = Math.max(0, growth.crown.depth ?? CROWN_DEPTH);
	const main: StemPlan = {
		x: 0,
		z: 0,
		height,
		lean,
		curve,
		turn,
		radius,
		fronds,
		dead,
		crownDepth,
		scale: 1,
	};
	const stem = layStem(builder, growth, main);
	// The crown begins where the main stem's foliage reaches lowest, not where its suckers do.
	let lowest = Number.POSITIVE_INFINITY;
	const layCrown = (laid: LaidStem, first: number) => {
		const plans = frondPlans(
			builder,
			growth,
			laid,
			draw,
			first,
			laid.plan.fronds,
			laid.plan.dead,
			laid.plan.scale,
		);
		plans.forEach((plan) => {
			const reach = layFrond(builder, growth, laid, plan);
			if (first === 0) lowest = Math.min(lowest, reach);
		});
		// A fern's crown also carries its young fronds, still rolled.
		const croziers = Math.max(
			0,
			Math.round(spreadAt(growth.crown.croziers?.count ?? 0, draw(DRAW.croziers, first))),
		);
		for (let i = 0; i < croziers; i++) layCrozier(builder, growth, laid, draw, first, i);
	};
	layCrown(stem, 0);
	addBunches(builder, growth, stem);
	const suckers = Math.max(0, Math.round(spreadAt(growth.stem.suckers ?? 0, draw(DRAW.suckers))));
	let first = 1000;
	for (let s = 0; s < suckers; s++) {
		const ring = SUCKER_RING[0] + draw(DRAW.suckerTurn, s) * (SUCKER_RING[1] - SUCKER_RING[0]);
		const azimuth = 2 * PI * (s / Math.max(1, suckers)) + draw(DRAW.suckerTurn, s + 32) * 0.6;
		const suckerHeight =
			SUCKER_HEIGHT[0] + draw(DRAW.suckerHeight, s) * (SUCKER_HEIGHT[1] - SUCKER_HEIGHT[0]);
		const sucker: StemPlan = {
			x: cos(azimuth) * ring,
			z: sin(azimuth) * ring,
			height: suckerHeight,
			lean: 2 + draw(DRAW.suckerLean, s) * 6,
			curve: 2 * draw(DRAW.suckerLean, s + 16),
			turn: azimuth,
			radius: Math.max(0.02, radius * (0.25 + 0.2 * (suckerHeight / SUCKER_HEIGHT[1]))),
			fronds: Math.max(
				3,
				Math.round(fronds * SUCKER_FRONDS * (0.5 + suckerHeight / SUCKER_HEIGHT[1] / 2)),
			),
			dead: 0,
			crownDepth: crownDepth * 0.5,
			scale: 0.35 + 0.4 * (suckerHeight / SUCKER_HEIGHT[1]),
		};
		const laid = layStem(builder, growth, sucker);
		layCrown(laid, first);
		first += 200;
	}
	return builder.finish(Number.isFinite(lowest) ? lowest : height * 0.5);
}

/** The crown-rosette grower: the stem and its fronds, drawn as the variant's own foliage. */
export const grower: Grower = {
	grow: growCrownRosette,
	foliage: palmFoliage,
};
