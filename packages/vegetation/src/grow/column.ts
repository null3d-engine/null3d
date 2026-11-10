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
	BUD_DORMANT,
	BUD_TERMINAL,
	type MacroSkeleton,
	SkeletonBuilder,
} from '../core/graph';
import { unitAt } from '../core/hash';
import {
	cos,
	length3,
	normalize3,
	PI,
	quatFromFrame,
	radians,
	sin,
	type Vector3,
} from '../core/math';
import type { Column, Species } from '../core/record';
import { curveAt, type Spread, spreadAt } from '../core/types';
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
	ArmElbow: 9,
	Lean: 6,
	LeanTurn: 7,
	Flowers: 8,
	Nest: 10,
} as const;

/** Metres between the stem's nodes. */
const STEM_NODE = 0.2;
/** Metres between an arm's nodes along its bend and its rise. */
const ARM_NODE = 0.12;
/** Degrees the stem may lean from upright, least and most. */
const LEAN = [0, 1.5] as const;

/** The share of the stem's height where its flower ring stands. */
const FLOWER_RING = 0.97;
/** Nest holes on the upper stem, and the band of the height they stand in. */
const NEST_HOLES = 30;
const NEST_BAND = [0.5, 0.85] as const;
/** Metres a nest hole's site is set inside the skin, so its socket sits flush. */
const NEST_INSET = 0.012;
/** Metres an arm climbs over its run out, so its crotch leaves the stem on a curve. */
const ARM_CROTCH = 0.14;

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
	const length = length3(out[0], out[1], out[2]);
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

/** One tier of arms: where its arms leave the stem and how far they rise after the elbow. */
interface ArmTier {
	readonly from: number;
	readonly rise: Spread;
}

/**
 * The record's arm tiers, lowest first. A record that names one starting share and one rise has one
 * tier, so every arm leaves and rises as it did before tiers were named.
 */
function armTiers(arms: Column['arms']): ArmTier[] {
	const froms: readonly number[] = typeof arms.from === 'number' ? [arms.from] : arms.from;
	const rises: readonly Spread[] = Array.isArray(arms.rise) ? arms.rise : [arms.rise as Spread];
	if (froms.length === 0 || rises.length === 0)
		throw new Error(
			'@null3d/vegetation: the column record names an arm tier with no share or rise',
		);
	const tiers = Math.max(froms.length, rises.length);
	return Array.from({ length: tiers }, (_, i) => ({
		from: froms[Math.min(i, froms.length - 1)] as number,
		rise: rises[Math.min(i, rises.length - 1)] as Spread,
	}));
}

/** The arms' plans: each at its own height, spread round the stem and dealt among the tiers. */
function armPlans(input: GrowInput, growth: Column, height: number): ArmPlan[] {
	const count = Math.max(0, Math.round(spreadAt(growth.arms.count, draw(input, Purpose.Arms))));
	const turn = draw(input, Purpose.ArmAzimuth) * 2 * Math.PI;
	const tiers = armTiers(growth.arms);
	const plans: ArmPlan[] = [];
	for (let k = 0; k < count; k++) {
		const jitter = draw(input, Purpose.ArmHeight, k) * 2 - 1;
		const tier = tiers[k % tiers.length] as ArmTier;
		plans.push({
			// Arms stand across the middle of the stem, give or take a tenth of its height.
			height: height * Math.min(0.66, Math.max(0.3, tier.from + jitter * 0.1)),
			heading:
				turn + (2 * PI * k) / Math.max(1, count) + (draw(input, Purpose.ArmAzimuth, k) - 0.5) * 0.7,
			// Each arm runs out its own distance before it turns up, so the elbows stand at different
			// heights and the arms do not read as fingers from one point.
			elbow: Math.max(0.1, growth.arms.elbow * (0.65 + 0.7 * draw(input, Purpose.ArmElbow, k))),
			rise: Math.max(0.2, spreadAt(tier.rise, draw(input, Purpose.ArmRise, k))),
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
		const runLength = length3(dx, dy, dz);
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
		// The arm starts clear of the stem's skin, by most of its own radius, so the weld meets a
		// ring that stands outside the parent rather than buried in it.
		const start = radiusAt(at[1]) + armBase * 0.6;
		let px = at[0] + heading[0] * start;
		let py = at[1];
		let pz = at[2] + heading[2] * start;
		// The arm is pinched where it leaves the stem, as the junction photograph shows, so its first
		// ring is a share of its own girth and it swells back over its run.
		const pinch = armBase * 0.55;
		let previous = builder.addNode({
			x: px,
			y: py,
			z: pz,
			radius: pinch,
			parent: (trunk[fromNode] as Laid).node,
			axis: armAxis,
			light: 1,
		});
		arm.push({ at: [px, py, pz], node: previous, radius: pinch });
		// The arm runs out to its elbow, climbing a little at first so the crotch is not a right angle,
		// as the junction photograph's own underside curve shows.
		const runNodes = Math.max(2, Math.ceil(plan.elbow / ARM_NODE));
		for (let n = 1; n <= runNodes; n++) {
			const share = n / runNodes;
			px = at[0] + heading[0] * (start + plan.elbow * share);
			pz = at[2] + heading[2] * (start + plan.elbow * share);
			py = at[1] + ARM_CROTCH * (1 - (share - 1) * (share - 1));
			const radius =
				pinch + (armBase - pinch) * Math.min(1, share * 2) + (armTip - armBase) * 0.2 * share;
			previous = builder.addNode({
				x: px,
				y: py,
				z: pz,
				radius,
				parent: previous,
				axis: armAxis,
				light: 1,
			});
			arm.push({ at: [px, py, pz], node: previous, radius });
		}
		// The turn: a quarter circle of a few arm girths across, from level to upright, so the elbow
		// reads as the photograph's rounded U rather than a corner.
		const turnRadius = Math.max(0.24, armBase * 1.6);
		const turnNodes = Math.max(3, Math.ceil((turnRadius * (PI / 2)) / ARM_NODE));
		const runOut = start + plan.elbow;
		for (let n = 1; n <= turnNodes; n++) {
			const t = (n / turnNodes) * (PI / 2);
			px = at[0] + heading[0] * (runOut + turnRadius * sin(t));
			py = at[1] + turnRadius * (1 - cos(t));
			pz = at[2] + heading[2] * (runOut + turnRadius * sin(t));
			const radius = armBase + (armTip - armBase) * (0.2 + 0.2 * (n / turnNodes));
			previous = builder.addNode({
				x: px,
				y: py,
				z: pz,
				radius,
				parent: previous,
				axis: armAxis,
				light: 1,
			});
			arm.push({ at: [px, py, pz], node: previous, radius });
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
	// Woodpecker holes on the upper stem, as nearly every old saguaro carries. Each is a dormant
	// site set a little inside the skin, so the extra's dark socket sits flush with it.
	for (let h = 0; h < NEST_HOLES; h++) {
		const y =
			height * (NEST_BAND[0] + (NEST_BAND[1] - NEST_BAND[0]) * draw(input, Purpose.Nest, h));
		let near = trunk[0] as Laid;
		for (const point of trunk)
			if (Math.abs(point.at[1] - y) < Math.abs(near.at[1] - y)) near = point;
		const theta = draw(input, Purpose.Nest, h, 1) * 2 * Math.PI;
		const radial: Vector3 = [cos(theta), 0, sin(theta)];
		const stand = near.radius - NEST_INSET;
		quatFromFrame(radial, normalize3([0, 1, 0]), frame);
		builder.addBud({
			node: near.node,
			x: near.at[0] + radial[0] * stand,
			y: near.at[1],
			z: near.at[2] + radial[2] * stand,
			frame,
			kind: BUD_DORMANT,
			vigor: 0.5,
			light: 1,
			axis: stemAxis,
			woodRadius: near.radius,
		});
	}
	placeAreoles(input, builder, growth, stemAxis, stem, radiusAt(0), frame);
	return builder.finish(0);
}

/** The column grower: the stem, its arms and their areoles. */
export const grower: Grower = {
	grow: growColumn,
};
