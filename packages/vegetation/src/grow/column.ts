// The column grower: a saguaro. One ribbed stem rises straight from the ground, hardly tapering,
// and rounds over at its top. Arms leave its side from a pinched junction, run out nearly level,
// bend at an elbow and rise parallel to the stem, each to a rounded tip below the stem's own. Every
// rib crest carries a line of areoles: one bud site each, which the species' single shoot class
// draws as a spine-cluster card. The ribs are the section the wood mesher draws, so the areoles
// stand on the surface they grow from.
import {
	AXIS_ARM,
	AXIS_STEM,
	BUD_AREOLE,
	BUD_TERMINAL,
	type MacroSkeleton,
	SkeletonBuilder,
} from '../core/graph';
import { unitAt } from '../core/hash';
import { cos, normalize3, PI, quatFromFrame, radians, sin, type Vector3 } from '../core/math';
import type { Column, Species } from '../core/record';
import { curveAt, spreadAt } from '../core/types';
import type { GrowInput } from '../stages';
import { ribPlan } from '../wood/ribs';
import type { Grower } from './models';

/** Purposes of the grower's hash keys, so no two draws share one. */
const Purpose = {
	Height: 1,
	Arms: 2,
	ArmHeight: 3,
	ArmAzimuth: 4,
	ArmRise: 5,
	Lean: 6,
	LeanTurn: 7,
	Flowers: 8,
} as const;

/** Metres between the stem's nodes. */
const STEM_NODE = 0.2;
/** Metres between an arm's nodes along its bend and its rise. */
const ARM_NODE = 0.12;
/** Degrees the stem may lean from upright, least and most. */
const LEAN = [0, 1.5] as const;
/** The share of the stem's height where its flower ring stands. */
const FLOWER_RING = 0.97;

/** A unit draw for one purpose of one variant. */
function draw(input: GrowInput, purpose: number, a = 0, b = 0): number {
	return unitAt(input.seed, input.record.seedSalt >>> 0, input.variant, purpose, a * 4096 + b);
}

/** The record's column growth, or a fault for another model. */
function columnOf(record: Species): Column {
	if (record.growth.model !== 'column')
		throw new Error(`@null3d/vegetation: the column grower got a '${record.growth.model}' record`);
	return record.growth;
}

/** One point laid along an axis, with the node it stands at. */
interface Laid {
	readonly at: Vector3;
	readonly node: number;
	readonly radius: number;
}

/** The run of an axis: its points, its radii and its nodes. */
interface Run {
	readonly points: Laid[];
}

/** The world up, made square to a direction. */
function skyOf(direction: Vector3): Vector3 {
	const up: Vector3 = [0, 1, 0];
	const dot = direction[0] * up[0] + direction[1] * up[1] + direction[2] * up[2];
	const out: Vector3 = [
		up[0] - dot * direction[0],
		up[1] - dot * direction[1],
		up[2] - dot * direction[2],
	];
	const length = Math.hypot(out[0], out[1], out[2]);
	// A vertical axis has no sky side square to it; any side will do.
	return length > 1e-6 ? [out[0] / length, out[1] / length, out[2] / length] : [1, 0, 0];
}

/** A horizontal direction square to a heading. */
function acrossOf(heading: number): Vector3 {
	return [cos(heading), 0, sin(heading)];
}

/** One arm's plan: where it leaves, which way it runs, and how far it rises. */
interface ArmPlan {
	readonly height: number;
	readonly heading: number;
	readonly elbow: number;
	readonly rise: number;
}

/** The arms' plans: each at its own height, spread round the stem. */
function armPlans(input: GrowInput, growth: Column, height: number): ArmPlan[] {
	const count = Math.max(0, Math.round(spreadAt(growth.arms.count, draw(input, Purpose.Arms))));
	const turn = draw(input, Purpose.ArmAzimuth) * 2 * Math.PI;
	const plans: ArmPlan[] = [];
	for (let k = 0; k < count; k++) {
		const jitter = draw(input, Purpose.ArmHeight, k) * 2 - 1;
		plans.push({
			// Arms stand across the middle of the stem, give or take a tenth of its height.
			height: height * Math.min(0.66, Math.max(0.3, growth.arms.from + jitter * 0.08)),
			heading:
				turn + (2 * PI * k) / Math.max(1, count) + (draw(input, Purpose.ArmAzimuth, k) - 0.5) * 0.7,
			elbow: Math.max(0.1, growth.arms.elbow),
			rise: Math.max(0.2, spreadAt(growth.arms.rise, draw(input, Purpose.ArmRise, k))),
		});
	}
	return plans;
}

/**
 * Places an areole at every rib crest along an axis, one bud site each, standing on the crest.
 *
 * @param input The growth input.
 * @param builder The skeleton under construction.
 * @param growth The record's column growth.
 * @param axis The skeleton axis.
 * @param run The axis's points and nodes.
 * @param baseRadius The axis's radius at its base.
 */
function placeAreoles(
	input: GrowInput,
	builder: SkeletonBuilder,
	growth: Column,
	axis: number,
	run: Run,
	baseRadius: number,
	frame: Float32Array,
	turn = 0,
): void {
	const plan = ribPlan(
		growth,
		input.seed,
		input.record.seedSalt >>> 0,
		input.variant,
		axis,
		baseRadius,
	);
	const step = Math.max(0.005, growth.areoles);
	const points = run.points;
	let previousPlace = 0;
	for (let i = 1; i < points.length; i++) {
		const a = points[i - 1] as Laid;
		const b = points[i] as Laid;
		const dx = b.at[0] - a.at[0];
		const dy = b.at[1] - a.at[1];
		const dz = b.at[2] - a.at[2];
		const runLength = Math.hypot(dx, dy, dz);
		if (runLength <= 1e-6) continue;
		const dir: Vector3 = [dx / runLength, dy / runLength, dz / runLength];
		const side = skyOf(dir);
		const other: Vector3 = normalize3([
			dir[1] * side[2] - dir[2] * side[1],
			dir[2] * side[0] - dir[0] * side[2],
			dir[0] * side[1] - dir[1] * side[0],
		]);
		let along = previousPlace;
		for (;;) {
			along += step;
			if (along > runLength) break;
			const t = along / runLength;
			const cx = a.at[0] + dx * t;
			const cy = a.at[1] + dy * t;
			const cz = a.at[2] + dz * t;
			const r = a.radius + (b.radius - a.radius) * t;
			const stand = r - plan.depth * 0.5;
			for (let k = 0; k < plan.count; k++) {
				const theta = turn + plan.phase + (2 * Math.PI * k) / plan.count;
				const radial: Vector3 = normalize3([
					side[0] * cos(theta) + other[0] * sin(theta),
					side[1] * cos(theta) + other[1] * sin(theta),
					side[2] * cos(theta) + other[2] * sin(theta),
				]);
				// +Y leaves the skin, +Z runs on up the axis, so the leaf's azimuth of a quarter turn
				// lays its midrib along the stem and its face outward.
				quatFromFrame(radial, dir, frame);
				builder.addBud({
					node: b.node,
					x: cx + radial[0] * stand,
					y: cy + radial[1] * stand,
					z: cz + radial[2] * stand,
					frame,
					kind: BUD_AREOLE,
					vigor: 0.5,
					light: 1,
					axis,
					woodRadius: r,
				});
			}
		}
		previousPlace = along - runLength;
	}
}

/**
 * Grows a column: its stem, its arms and the areoles along every rib crest.
 *
 * @param input The record, the seed, the variant and the season.
 * @returns The skeleton.
 * @category api/vegetation
 */
export function growColumn(input: GrowInput): MacroSkeleton {
	const growth = columnOf(input.record);
	const builder = new SkeletonBuilder();
	const frame = new Float32Array(4);
	const height = Math.max(0.5, spreadAt(growth.height, draw(input, Purpose.Height)));
	const lean = radians(LEAN[0] + draw(input, Purpose.Lean) * (LEAN[1] - LEAN[0]));
	const leanTurn = draw(input, Purpose.LeanTurn) * 2 * Math.PI;
	const trunkDir = normalize3([sin(lean) * cos(leanTurn), cos(lean), sin(lean) * sin(leanTurn)]);
	const radiusAt = (y: number): number =>
		Math.max(0.02, curveAt(growth.radius, Math.min(1, Math.max(0, y / height))));
	const stemAxis = builder.addAxis({ parent: -1, parentNode: -1, order: 0, kind: AXIS_STEM });
	const trunk: Laid[] = [];
	let node = -1;
	const steps = Math.max(2, Math.ceil(height / STEM_NODE));
	for (let n = 0; n <= steps; n++) {
		const along = (n / steps) * height;
		const x = trunkDir[0] * along;
		const y = trunkDir[1] * along;
		const z = trunkDir[2] * along;
		node = builder.addNode({
			x,
			y,
			z,
			radius: radiusAt(y),
			parent: node,
			axis: stemAxis,
			light: 1,
		});
		trunk.push({ at: [x, y, z], node, radius: radiusAt(y) });
	}
	const stem: Run = { points: trunk };
	// The flower ring: terminal sites at the stem's crown, round its crests, where the blossom stands.
	const ringPlan = ribPlan(
		growth,
		input.seed,
		input.record.seedSalt >>> 0,
		input.variant,
		stemAxis,
		radiusAt(height),
	);
	const ring = trunk[trunk.length - 1] as Laid;
	const ringY = height * FLOWER_RING;
	for (let k = 0; k < ringPlan.count; k++) {
		const theta = ringPlan.phase + (2 * Math.PI * k) / ringPlan.count;
		const radial: Vector3 = [cos(theta), 0, sin(theta)];
		quatFromFrame([0, 1, 0], radial, frame);
		builder.addBud({
			node: ring.node,
			x: ring.at[0] + radial[0] * ring.radius,
			y: ringY,
			z: ring.at[2] + radial[2] * ring.radius,
			frame,
			kind: BUD_TERMINAL,
			vigor: 1,
			light: 1,
			axis: stemAxis,
			woodRadius: ring.radius,
		});
	}
	// Arms leave the stem, each on an axis of its own from the node nearest its height.
	const armBase = Math.max(0.05, growth.arms.radius);
	const armTip = Math.max(0.03, armBase * 0.82);
	for (const plan of armPlans(input, growth, height)) {
		let fromNode = 0;
		let best = Number.POSITIVE_INFINITY;
		for (let n = 0; n < trunk.length; n++) {
			const gap = Math.abs((trunk[n] as Laid).at[1] - plan.height);
			if (gap < best) {
				best = gap;
				fromNode = n;
			}
		}
		const at = (trunk[fromNode] as Laid).at;
		const heading = acrossOf(plan.heading);
		const armAxis = builder.addAxis({
			parent: stemAxis,
			parentNode: (trunk[fromNode] as Laid).node,
			parentT: 0,
			order: 1,
			kind: AXIS_ARM,
		});
		const arm: Laid[] = [];
		// The arm starts just clear of the stem's skin, so the weld has a ring to meet.
		const start = radiusAt(at[1]) + ARM_NODE * 0.5;
		const firstX = at[0] + heading[0] * start;
		const firstZ = at[2] + heading[2] * start;
		let previous = builder.addNode({
			x: firstX,
			y: at[1],
			z: firstZ,
			radius: armBase,
			parent: (trunk[fromNode] as Laid).node,
			axis: armAxis,
			light: 1,
		});
		arm.push({ at: [firstX, at[1], firstZ], node: previous, radius: armBase });
		// A quarter turn from level to upright: the arm runs out and rises together.
		const elbowNodes = Math.max(2, Math.ceil((plan.elbow * (PI / 2)) / ARM_NODE));
		for (let n = 1; n <= elbowNodes; n++) {
			const t = (n / elbowNodes) * (PI / 2);
			const x = at[0] + heading[0] * (start + plan.elbow * sin(t));
			const y = at[1] + plan.elbow * (1 - cos(t));
			const z = at[2] + heading[2] * (start + plan.elbow * sin(t));
			const radius = armBase + (armTip - armBase) * 0.4 * (n / elbowNodes);
			previous = builder.addNode({ x, y, z, radius, parent: previous, axis: armAxis, light: 1 });
			arm.push({ at: [x, y, z], node: previous, radius });
		}
		const base = arm[arm.length - 1] as Laid;
		// The rise stands the arm parallel to the stem, to a rounded tip below its top.
		const riseNodes = Math.max(2, Math.ceil(plan.rise / ARM_NODE));
		for (let n = 1; n <= riseNodes; n++) {
			const share = n / riseNodes;
			const y = base.at[1] + plan.rise * share;
			const radius = armBase + (armTip - armBase) * (0.4 + 0.6 * share);
			previous = builder.addNode({
				x: base.at[0],
				y,
				z: base.at[2],
				radius,
				parent: previous,
				axis: armAxis,
				light: 1,
			});
			arm.push({ at: [base.at[0], y, base.at[2]], node: previous, radius });
		}
		const tipAt = (arm[arm.length - 1] as Laid).at;
		quatFromFrame([0, 1, 0], normalize3([heading[0], 0, heading[2]]), frame);
		builder.addBud({
			node: previous,
			x: tipAt[0],
			y: tipAt[1],
			z: tipAt[2],
			frame,
			kind: BUD_TERMINAL,
			vigor: 1,
			light: 1,
			axis: armAxis,
			woodRadius: armTip,
		});
		placeAreoles(input, builder, growth, armAxis, { points: arm }, armBase, frame, Math.PI);
	}
	placeAreoles(input, builder, growth, stemAxis, stem, radiusAt(0), frame);
	return builder.finish(0);
}

/** The column grower: the stem, its arms and their areoles. */
export const grower: Grower = {
	grow: growColumn,
};
