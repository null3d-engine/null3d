// The culm grower: bamboo. A clump of jointed culms rises from one shared foot, each culm nearly
// straight and barely tapering, its nodes a ringed bead along the green surface. Above the first
// branching height each node carries a branch complement: one branch larger than the rest, each
// leaving steeply upward, running out and flattening, and carrying the leafy branchlets that the
// species' shoot prototypes draw. A culm's tip and every branch's tip end in a fan of leaves.
//
// The record's branch orders count the wood between a culm and a leafy shoot: one order gives the
// culm its branch complement, and a second splits each branch into branchlets. The leafy shoots
// themselves are the species' prototypes, dressed by the shoot instancer as for every other model.
import {
	AXIS_CULM,
	AXIS_LIMB,
	BUD_DORMANT,
	BUD_LATERAL,
	BUD_TERMINAL,
	type MacroSkeleton,
	SkeletonBuilder,
} from '../core/graph';
import { unitAt } from '../core/hash';
import { cos, normalize3, PI, pow, quatFromFrame, radians, sin, type Vector3 } from '../core/math';
import type { Culm, Species } from '../core/record';
import { type Curve, curveAt, spreadAt } from '../core/types';
import type { GrowInput } from '../stages';
import type { Grower } from './models';

/** The golden angle in radians, which spreads the culms over the clump's foot. */
const GOLDEN = radians(137.50776405);
/** Internodes a culm's height is cut into, before the record's curve sets each one's length. */
const CULM_STEPS = 28;
/** Points along one branch, from its node to its tip. */
const BRANCH_STEPS = 5;
/** Points along one branchlet of a second branch order. */
const SECONDARY_STEPS = 3;

/** Purposes of the grower's hash keys, so no two draws share one. */
const Purpose = {
	Culms: 1,
	Culm: 2,
	Height: 3,
	Girth: 4,
	Lean: 5,
	Branch: 6,
	Buds: 7,
	Length: 8,
} as const;

/** A unit draw for one purpose of one variant. */
function draw(input: GrowInput, purpose: number, a = 0, b = 0, c = 0): number {
	return unitAt(input.seed, input.record.seedSalt, input.variant * 256 + purpose, a, b * 4096 + c);
}

/** The record's culm growth, or an error for a record of another model. */
function culmOf(record: Species): Culm {
	if (record.growth.model !== 'culm')
		throw new Error(`@null3d/vegetation: '${record.id}' is not a culm model`);
	return record.growth;
}

/** A direction in the vertical plane of a heading: `elevation` radians above the horizontal. */
function inPlane(heading: number, elevation: number): Vector3 {
	const c = cos(elevation);
	return [cos(heading) * c, sin(elevation), sin(heading) * c];
}

/** The upper face of a direction in its vertical plane: square to it, toward the sky. */
function faceOf(heading: number, elevation: number): Vector3 {
	const s = sin(elevation);
	return [-cos(heading) * s, cos(elevation), -sin(heading) * s];
}

/** A frame quaternion from a direction and its upper face. */
function frameOf(along: Readonly<Vector3>, face: Readonly<Vector3>): number[] {
	const q = [0, 0, 0, 1];
	quatFromFrame(along, face, q);
	return q;
}

/** A point in plant space, from a node's three coordinates. */
function pointAt(builder: SkeletonBuilder, node: number): Vector3 {
	return [
		builder.position[node * 3] as number,
		builder.position[node * 3 + 1] as number,
		builder.position[node * 3 + 2] as number,
	];
}

/** The unit direction from one point to another, or +Y for a zero step. */
function directionOf(from: Readonly<Vector3>, to: Readonly<Vector3>): Vector3 {
	return normalize3([to[0] - from[0], to[1] - from[1], to[2] - from[2]]);
}

/** The lengths of the internodes of one culm, from the record's curve, scaled to its height. */
function internodes(curve: Curve, height: number): number[] {
	const lengths: number[] = [];
	let total = 0;
	for (let s = 0; s < CULM_STEPS; s++) {
		const length = curveAt(curve, (s + 0.5) / CULM_STEPS);
		lengths.push(length);
		total += length;
	}
	const scale = total > 1e-6 ? height / total : 1;
	for (let s = 0; s < lengths.length; s++) lengths[s] = (lengths[s] as number) * scale;
	return lengths;
}

/**
 * The radius of a culm at a height: a swollen foot, a gentle taper, and a raised ring at each node.
 *
 * @param base The radius at the foot.
 * @param height The culm's height in metres.
 * @param node The node's height in metres.
 * @param ridge The ring's height over the culm's surface, in metres.
 * @param onNode Whether this sample stands on a node.
 */
function culmRadius(
	base: number,
	height: number,
	node: number,
	ridge: number,
	onNode: boolean,
): number {
	const share = Math.min(1, Math.max(0, node / Math.max(1e-6, height)));
	// The foot swells over the lowest eighth of the culm, as a new cane's base does against the soil.
	const swell = 1 + 0.5 * Math.exp(-share * 8);
	return base * swell * (1 - 0.58 * share) + (onNode ? ridge : 0);
}

/** One bud site's place on its wood. */
interface BudPlace {
	readonly node: number;
	readonly at: Vector3;
	readonly along: Vector3;
	readonly heading: number;
	readonly elevation: number;
	readonly vigor: number;
	readonly axis: number;
	readonly woodRadius: number;
	/** Whether the bud ends its axis, where the shoot carries on the wood's own line. */
	readonly terminal: boolean;
	/** Whether the bud carries a sheath at a culm node rather than a leafy shoot. */
	readonly dormant?: boolean;
}

/** Adds a branch axis from a node, and returns its node indices and the bud sites along it. */
function growBranch(
	input: GrowInput,
	builder: SkeletonBuilder,
	parentAxis: number,
	parentNode: number,
	order: number,
	start: Readonly<Vector3>,
	heading: number,
	angle: number,
	length: number,
	radius0: number,
	heightShare: number,
	branchIndex: number,
	buds: BudPlace[],
): number {
	const axis = builder.addAxis({
		parent: parentAxis,
		parentNode,
		parentT: 0,
		order,
		kind: AXIS_LIMB,
	});
	const steps = order === 1 ? BRANCH_STEPS : SECONDARY_STEPS;
	// The branch leaves the culm steeply and flattens over its run, its tip a little above level.
	const ease = order === 1 ? 1 : 0.7;
	const p: Vector3 = [start[0], start[1], start[2]];
	let previous = parentNode;
	let last = parentNode;
	const nodes: number[] = [];
	const step = length / steps;
	for (let i = 0; i < steps; i++) {
		if (i > 0) {
			const share = (i - 0.5) / steps;
			const elevation = angle - radians(branchFlatten(heightShare) * ease * pow(share, 0.8));
			const d = inPlane(heading, elevation);
			p[0] += d[0] * step;
			p[1] += d[1] * step;
			p[2] += d[2] * step;
		}
		const share = i / steps;
		last = builder.addNode({
			x: p[0],
			y: p[1],
			z: p[2],
			radius: radius0 * (1 - 0.82 * share),
			parent: previous,
			axis,
			light: 1,
		});
		previous = last;
		nodes.push(last);
	}
	// Each joint carries a leafy branchlet, and the tip carries the last fan.
	for (let i = 0; i < nodes.length; i++) {
		const node = nodes[i] as number;
		const at = pointAt(builder, node);
		const previousNode = nodes[Math.max(0, i - 1)] as number;
		const nextNode = nodes[Math.min(nodes.length - 1, i + 1)] as number;
		const along =
			i === nodes.length - 1
				? directionOf(pointAt(builder, previousNode), at)
				: directionOf(at, pointAt(builder, nextNode));
		const azimuth = Math.atan2(along[2], along[0]);
		const elevation = Math.asin(Math.min(1, Math.max(-1, along[1])));
		const vigor = Math.min(
			1,
			0.25 + 0.55 * heightShare + 0.2 * draw(input, Purpose.Buds, branchIndex, i, order),
		);
		buds.push({
			node,
			at,
			along,
			heading: azimuth,
			elevation,
			vigor,
			axis,
			woodRadius: radius0 * (1 - 0.82 * (i / Math.max(1, nodes.length - 1))),
			terminal: i === nodes.length - 1,
		});
	}
	return axis;
}

/** Degrees a branch flattens from its leaving angle over its run. */
function branchFlatten(heightShare: number): number {
	// A lower branch runs out more level than a branch at the crown's top.
	return Math.max(12, 55 - 25 * heightShare);
}

/**
 * Grows a bamboo clump: its culms, the branch complement at each node, and the leafy branchlet
 * sites that the shoot prototypes fill.
 *
 * @param input The record, the seed, the variant and the season.
 * @returns The skeleton.
 */
export function growCulm(input: GrowInput): MacroSkeleton {
	const growth = culmOf(input.record);
	const builder = new SkeletonBuilder();
	const culms = Math.max(1, Math.round(spreadAt(growth.culms, draw(input, Purpose.Culms))));
	const turn = draw(input, Purpose.Culms, 1) * 2 * PI;
	const buds: BudPlace[] = [];
	for (let c = 0; c < culms; c++) {
		const unit = (k: number) => draw(input, Purpose.Culm, c, k);
		const height =
			spreadAt(growth.height, draw(input, Purpose.Height, c)) * (1 + 0.06 * (unit(0) - 0.5));
		const diameter = spreadAt(growth.diameter, draw(input, Purpose.Girth, c));
		const base = diameter / 2;
		// The culms stand on a spiral over the clump's foot, the outer ones leaning out.
		const distance =
			growth.layout === 'running'
				? growth.spacing * (c - (culms - 1) / 2)
				: growth.spacing * Math.sqrt((c + 0.5) / culms) * (0.82 + 0.36 * unit(1));
		const heading = turn + c * GOLDEN + (unit(2) - 0.5) * 0.35;
		const start: Vector3 =
			growth.layout === 'running'
				? [cos(heading) * distance, 0, sin(heading) * distance]
				: [cos(heading) * distance, 0, sin(heading) * distance];
		const lean = radians(
			spreadAt(growth.arch, draw(input, Purpose.Lean, c)) *
				(0.6 +
					0.8 * (growth.layout === 'running' ? 0.2 : distance / Math.max(1e-6, growth.spacing))),
		);
		const axis = builder.addAxis({ parent: -1, parentNode: -1, order: 0, kind: AXIS_CULM });
		const lengths = internodes(growth.internode, height);
		const p: Vector3 = [start[0], start[1], start[2]];
		let previous = -1;
		let nodeIndex = 0;
		let up = 0;
		const nodes: number[] = [];
		for (let s = 0; s <= lengths.length; s++) {
			if (s > 0) up += lengths[s - 1] as number;
			// The culm's line turns outward with height, so its top leans over the clump's rim.
			const share = up / Math.max(1e-6, height);
			const elevation = PI / 2 - lean * pow(share, 1.5);
			const d = inPlane(heading, elevation);
			if (s > 0) {
				p[0] += d[0] * (lengths[s - 1] as number);
				p[1] += d[1] * (lengths[s - 1] as number);
				p[2] += d[2] * (lengths[s - 1] as number);
			}
			nodeIndex = builder.addNode({
				x: p[0],
				y: p[1],
				z: p[2],
				radius: culmRadius(base, height, p[1], growth.node.ridge, true),
				parent: previous,
				axis,
				light: 1,
			});
			previous = nodeIndex;
			nodes.push(nodeIndex);
		}
		// The branch complement at each node above the first branching height, and a sheath at each
		// node below the height the record gives sheaths to.
		let branchCount = 0;
		for (let s = 1; s < nodes.length; s++) {
			const node = nodes[s] as number;
			const at = pointAt(builder, node);
			const heightShare = at[1] / Math.max(1e-6, height);
			if (heightShare < growth.sheaths.upTo) {
				buds.push({
					node,
					at,
					along: [0, 1, 0],
					heading: Math.atan2(at[2], at[0]),
					elevation: PI / 2,
					vigor: 0,
					axis,
					woodRadius: culmRadius(base, height, at[1], growth.node.ridge, true),
					terminal: false,
					dormant: true,
				});
			}
			if (heightShare < growth.branches.from) continue;
			const perNode = Math.max(
				1,
				Math.round(spreadAt(growth.branches.perNode, draw(input, Purpose.Branch, c, s))),
			);
			const length = Math.max(
				0.05,
				curveAt(growth.branches.length, heightShare) *
					(0.85 + 0.3 * draw(input, Purpose.Length, c, node)),
			);
			const heading0 =
				Math.atan2(at[2], at[0]) + (draw(input, Purpose.Branch, c, s, 1) - 0.5) * 0.3;
			for (let k = 0; k < perNode; k++) {
				// A dominant branch runs longer and a little thicker than the rest, as a bamboo's
				// complement carries one branch that takes the node's lead.
				const dominant = growth.branches.dominant && k === 0;
				const heading = heading0 + (k * 2 * PI) / perNode;
				// A branch high on the culm leaves more level than one lower down, so the plume's
				// upper branches spread rather than climb past the culm's tip.
				const angle =
					(PI / 2 -
						radians(
							growth.branches.angle * (dominant ? 1 : 1.25) +
								(draw(input, Purpose.Branch, c, s * 8 + k, 2) - 0.5) * 8,
						)) *
					(1 - 0.5 * heightShare);
				const radius0 = base * 0.3 * (dominant ? 1 : 0.65) * (1 + 0.1 * unit(3));
				growBranch(
					input,
					builder,
					axis,
					node,
					1,
					at,
					heading,
					angle,
					length * (dominant ? 1 : 0.7),
					radius0,
					heightShare,
					c * 64 + branchCount,
					buds,
				);
				branchCount++;
			}
		}
		// The culm's tip carries its own fan, at the tallest point of the clump.
		const tip = nodes[nodes.length - 1] as number;
		const tipAt = pointAt(builder, tip);
		buds.push({
			node: tip,
			at: tipAt,
			along: directionOf(pointAt(builder, nodes[nodes.length - 2] ?? tip), tipAt),
			heading,
			elevation: PI / 2 - lean,
			vigor: 1,
			axis,
			woodRadius: base * 0.42,
			terminal: true,
		});
	}
	let crownBase = Number.POSITIVE_INFINITY;
	// A sheath's dormant bud is not foliage, so it does not set the crown's base.
	for (const bud of buds) if (!bud.dormant && bud.at[1] < crownBase) crownBase = bud.at[1];
	for (const bud of buds) {
		const face =
			Math.abs(bud.along[1]) > 0.95
				? faceOf(bud.heading, PI / 2)
				: normalize3([
						-bud.along[0] * bud.along[1],
						1 - bud.along[1] * bud.along[1],
						-bud.along[2] * bud.along[1],
					]);
		builder.addBud({
			node: bud.node,
			x: bud.at[0],
			y: bud.at[1],
			z: bud.at[2],
			frame: frameOf(bud.along, face),
			kind: bud.dormant ? BUD_DORMANT : bud.terminal ? BUD_TERMINAL : BUD_LATERAL,
			vigor: bud.vigor,
			light: 1,
			axis: bud.axis,
			woodRadius: bud.woodRadius,
		});
	}
	return builder.finish(Number.isFinite(crownBase) ? crownBase : 0);
}

/** The culm grower. */
export const grower: Grower = {
	grow: growCulm,
};
