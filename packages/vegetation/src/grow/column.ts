// The column grower: a saguaro. One ribbed stem rises plumb from the ground, hardly tapering, and
// ends in a rounded top. A few arms leave its side, each on one path: out from a pinched joint,
// through one smooth elbow, then up beside the stem to a rounded tip below the stem's own. The arms
// are dealt among the record's tiers and stand round the stem through the full circle, or in one
// upright plane in the variants the record names.
//
// Every rib crest carries a line of areoles: one bud site each, which the species' single shoot
// class draws as a spine-cluster card. The ribs are the section the wood mesher draws. The sites
// are laid on the mesher's own frames along each axis (wood/frames.ts), at the crest angles its rib
// section gives (wood/ribs.ts), so an areole, a flower or a nest hole stands in the skin it grows
// from and never over a groove.
import { type Arch, archPath } from '../core/arch';
import {
	AXIS_ARM,
	AXIS_STEM,
	BUD_AREOLE,
	BUD_DORMANT,
	BUD_FLOWER,
	type MacroSkeleton,
	SkeletonBuilder,
} from '../core/graph';
import { unitAt } from '../core/hash';
import { asin, cos, normalize3, PI, quatFromFrame, radians, sin, type Vector3 } from '../core/math';
import type { Column, ColumnArmTier, Species } from '../core/record';
import { curveAt, spreadAt } from '../core/types';
import type { GrowInput } from '../stages';
import {
	type AxisPath,
	axisPath,
	emptyFrame,
	frameAt,
	KINK_BEND,
	nearestArc,
	type PathFrame,
	roundKinks,
} from '../wood/frames';
import { crestAngle, type RibPlan, ribPlan, ribSection } from '../wood/ribs';
import type { Grower } from './models';

/** Purposes of the grower's hash keys, so no two draws share one. */
const Purpose = {
	Height: 1,
	Arms: 2,
	ArmHeight: 3,
	ArmAzimuth: 4,
	ArmTop: 5,
	Lean: 6,
	LeanTurn: 7,
	ArmReach: 9,
	Nest: 10,
} as const;

/** Metres between the stem's nodes below its rounded top. */
const STEM_NODE = 0.2;
/** Degrees the stem may lean from upright, least and most. */
const LEAN = [0, 1.5] as const;
/** Nodes that carry a rounded end, and the share of its height the last of them stands at. */
const DOME_NODES = 6;
const DOME_LAST = 0.995;
/** The share of a rounded end's height where its flower ring stands. */
const FLOWER_RING = 0.5;
/** Nest holes on the upper stem, and the band of the height they stand in. */
const NEST_HOLES = 30;
const NEST_BAND = [0.5, 0.85] as const;
/** Metres a nest hole's site is set inside the skin, so its socket sits flush. */
const NEST_INSET = 0.012;
/** Metres an areole's or a flower's site is set inside the skin, so its base is hidden in it. */
const SITE_INSET = 0.008;
/** The share of its own radius that an arm's first ring stands outside the stem's skin. */
const ARM_START = 0.6;
/**
 * The tightest an elbow turns at its centre line, in arm widths: a bend tighter than the arm's own
 * width reads as a square corner.
 */
const LEAST_ELBOW = 1;
/** How far through its bend an arm is stoutest, as a share of the bend. */
const SWELL_AT = 0.4;
/** The shortest upright part an arm keeps above its elbow, in metres. */
const LEAST_RISE = 0.2;
/** The most an arm's heading strays from its even place round the stem, in radians either way. */
const HEADING_STRAY = 0.2;
/** Areoles stop where a rounded end has narrowed to this share of the wood below it. */
const AREOLE_LEAST = 0.3;

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

/** An axis as laid: its points, and the mesher's path and ribs along it. */
interface Run {
	readonly axis: number;
	readonly points: readonly Laid[];
	readonly path: AxisPath;
	/** The arc length of the path at the axis's first own point. */
	readonly start: number;
	/** The arc length where the rounded end starts, and the end's height. */
	readonly domeAt: number;
	readonly domeHeight: number;
	/** The radius of the wood just below the rounded end. */
	readonly domeRadius: number;
	readonly ribs: RibPlan;
}

/** A smooth step from 0 to 1 over a share from 0 to 1. */
function eased(share: number): number {
	const t = Math.min(1, Math.max(0, share));
	return t * t * (3 - 2 * t);
}

/**
 * The mesher's path along an axis's points. A stem's frame starts from +X; a child's starts from the
 * side that faces away from where its parent runs on, with the junction on the parent as the path's
 * first point; and each kink between points is rounded as the mesher rounds it. These are the wood
 * mesher's own rules and functions, so the frames here are the frames it draws.
 */
function pathOf(
	points: readonly Laid[],
	junction?: Readonly<Vector3>,
	parentTangent?: Readonly<Vector3>,
): { readonly path: AxisPath; readonly start: number } {
	const lead = junction ? 1 : 0;
	const count = points.length + lead;
	const at = new Float64Array(count * 3);
	const radii = new Float64Array(count);
	const first = points[0] as Laid;
	if (junction) {
		at.set(junction, 0);
		radii[0] = first.radius;
	}
	points.forEach((point, i) => {
		at.set(point.at, (i + lead) * 3);
		radii[i + lead] = point.radius;
	});
	let normal0: Vector3 = [1, 0, 0];
	if (junction && parentTangent) {
		const d = normalize3([
			first.at[0] - junction[0],
			first.at[1] - junction[1],
			first.at[2] - junction[2],
		]);
		const dot = parentTangent[0] * d[0] + parentTangent[1] * d[1] + parentTangent[2] * d[2];
		normal0 = [
			-(parentTangent[0] - dot * d[0]),
			-(parentTangent[1] - dot * d[1]),
			-(parentTangent[2] - dot * d[2]),
		];
	}
	const rounded = roundKinks(at, radii, count, KINK_BEND);
	const path = axisPath(rounded.points, rounded.radii, rounded.count, normal0);
	return { path, start: lead ? arcAt(path, first.at) : 0 };
}

/** The arc length on a path nearest a point. */
function arcAt(path: AxisPath, at: Readonly<Vector3>): number {
	return nearestArc(path, at[0], at[1], at[2]);
}

/** The direction out from an axis's centre line at an angle round the mesher's frame. */
function radialOf(frame: PathFrame, angle: number, out: Vector3): Vector3 {
	const c = cos(angle);
	const s = sin(angle);
	out[0] = c * (frame.normal[0] as number) + s * (frame.binormal[0] as number);
	out[1] = c * (frame.normal[1] as number) + s * (frame.binormal[1] as number);
	out[2] = c * (frame.normal[2] as number) + s * (frame.binormal[2] as number);
	return out;
}

/** The point of a run nearest a place, searched on from the point a place before it was nearest. */
function nearestPoint(points: readonly Laid[], place: Float64Array, from: number): number {
	const gap = (i: number): number => {
		const at = (points[i] as Laid).at;
		return (
			(at[0] - (place[0] as number)) ** 2 +
			(at[1] - (place[1] as number)) ** 2 +
			(at[2] - (place[2] as number)) ** 2
		);
	};
	let i = from;
	while (i + 1 < points.length && gap(i + 1) <= gap(i)) i++;
	return i;
}

/**
 * Lays the nodes of a rounded end on an axis: a half ellipsoid `height` tall above `from`, along
 * `dir`, its radius falling from `radius` as a circle's does.
 */
function layDome(
	builder: SkeletonBuilder,
	axis: number,
	points: Laid[],
	dir: Readonly<Vector3>,
	radius: number,
	height: number,
): void {
	const from = points[points.length - 1] as Laid;
	let previous = from.node;
	for (let k = 1; k <= DOME_NODES; k++) {
		// Even steps of the end's own curve, so the rings crowd where it closes.
		const share = Math.min(DOME_LAST, sin(((k / DOME_NODES) * PI) / 2));
		const r = radius * Math.sqrt(1 - share * share);
		const at: Vector3 = [
			from.at[0] + dir[0] * height * share,
			from.at[1] + dir[1] * height * share,
			from.at[2] + dir[2] * height * share,
		];
		previous = builder.addNode({
			x: at[0],
			y: at[1],
			z: at[2],
			radius: r,
			parent: previous,
			axis,
			light: 1,
		});
		points.push({ at, node: previous, radius: r });
	}
}

/** One arm's plan: its tier, where it leaves, which way it runs, how far out and how high. */
interface ArmPlan {
	readonly tier: ColumnArmTier;
	readonly height: number;
	readonly heading: number;
	readonly reach: number;
	readonly top: number;
}

/**
 * The arms' plans. The arms are dealt among the tiers in turn. Round the stem they stand at even
 * places through the full circle, so neighbours belong to different tiers and each tier's arms
 * balance each other. A variant the record stands in one plane has a tier's worth to one side and
 * the next to the other.
 */
function armPlans(input: GrowInput, growth: Column, height: number): ArmPlan[] {
	const arms = growth.arms;
	const tiers = arms.tiers;
	const count = Math.max(0, Math.round(spreadAt(arms.count, draw(input, Purpose.Arms))));
	if (tiers.length === 0) return [];
	const planar = input.variant < arms.plane;
	// A plane of arms stands across the view from +Z, the side a whole picture of the plant is
	// taken from, so the picture shows every arm clear of the stem. Arms round the stem start at a
	// turn of their own.
	const turn = planar ? 0 : draw(input, Purpose.ArmAzimuth) * 2 * PI;
	const plans: ArmPlan[] = [];
	for (let k = 0; k < count; k++) {
		const tier = tiers[k % tiers.length] as ColumnArmTier;
		const heading = planar
			? turn + PI * (Math.floor(k / tiers.length) % 2)
			: turn +
				(2 * PI * k) / count +
				(draw(input, Purpose.ArmAzimuth, k + 1) * 2 - 1) * HEADING_STRAY;
		plans.push({
			tier,
			height: height * spreadAt(tier.at, draw(input, Purpose.ArmHeight, k)),
			heading,
			reach: spreadAt(tier.reach, draw(input, Purpose.ArmReach, k)),
			top: height * spreadAt(tier.top, draw(input, Purpose.ArmTop, k)),
		});
	}
	return plans;
}

/**
 * An arm's centre line from its first ring to the foot of its rounded tip: out at the record's
 * leaving angle, through one arc to plumb, then straight up. The arc takes the record's radius
 * where the arm's reach leaves room for it and is tighter where it does not.
 */
function armArch(
	growth: Column,
	plan: ArmPlan,
	room: number,
	baseY: number,
): { readonly arch: Arch; readonly bendEnd: number; readonly domeHeight: number } {
	const [radius, tipRadius] = plan.tier.radius;
	const least = LEAST_ELBOW * 2 * radius;
	let leave = radians(growth.arms.leave);
	let across = 1 - sin(leave);
	// An arm close beside the stem has no room to turn from the record's angle on an elbow of its
	// own width, so it leaves rising, at the angle that turns it on that elbow within its reach.
	if (room < least * across) {
		leave = asin(Math.min(1, Math.max(-1, 1 - room / least)));
		across = 1 - sin(leave);
	}
	const elbow = Math.max(least, Math.min(growth.arms.elbow * 2 * radius, room / across));
	const run = Math.max(0, room - elbow * across) / cos(leave);
	const bend = elbow * (PI / 2 - leave);
	const domeHeight = growth.dome * tipRadius;
	const rise = Math.max(
		LEAST_RISE,
		plan.top - domeHeight - (baseY + run * sin(leave) + elbow * cos(leave)),
	);
	const length = run + bend + rise;
	return {
		arch: {
			length,
			leave: (leave * 180) / PI,
			turn: (leave * 180) / PI - 90,
			from: run / length,
			to: (run + bend) / length,
		},
		bendEnd: run + bend,
		domeHeight,
	};
}

/**
 * The shares of an arm's length where its nodes stand: the cuts of its path, and one more node a
 * bend segment's length into each straight run beside the bend. The wood's curve passes through
 * the nodes, and a long segment next to a short one would let it swing wide of the straight run.
 */
function armNodes(along: Float64Array, elevation: Float64Array): number[] {
	const shares: number[] = [];
	const count = along.length;
	for (let i = 0; i < count; i++) {
		shares.push(along[i] as number);
		if (i + 1 >= count) break;
		const span = (along[i + 1] as number) - (along[i] as number);
		if (elevation[i] !== elevation[i + 1]) continue;
		// A straight run: guard the end that meets the bend.
		const before = i > 0 ? (along[i] as number) - (along[i - 1] as number) : 0;
		const after = i + 2 < count ? (along[i + 2] as number) - (along[i + 1] as number) : 0;
		const bentBefore = i > 0 && elevation[i - 1] !== elevation[i];
		const bentAfter = i + 2 < count && elevation[i + 1] !== elevation[i + 2];
		if (bentBefore && bentAfter) {
			if (span > 2.5 * (before + after)) {
				shares.push((along[i] as number) + before);
				shares.push((along[i + 1] as number) - after);
			}
		} else if (bentBefore && span > 2.5 * before) shares.push((along[i] as number) + before);
		else if (bentAfter && span > 2.5 * after) shares.push((along[i + 1] as number) - after);
	}
	return shares;
}

/**
 * Places an areole at every rib crest along an axis, one bud site each, set in the crest's skin.
 * The sites stop where the rounded end has closed to a small share of the wood below it.
 */
function placeAreoles(
	builder: SkeletonBuilder,
	growth: Column,
	run: Run,
	skip: number,
	frame: Float32Array,
): void {
	const step = Math.max(0.005, growth.areoles);
	const place = emptyFrame();
	const radial: Vector3 = [0, 0, 0];
	const along: Vector3 = [0, 0, 0];
	let node = 0;
	for (let s = run.start + skip + step; s < run.path.length; s += step) {
		frameAt(run.path, s, place);
		if (place.radius < AREOLE_LEAST * run.domeRadius) break;
		node = nearestPoint(run.points, place.position, node);
		along[0] = place.tangent[0] as number;
		along[1] = place.tangent[1] as number;
		along[2] = place.tangent[2] as number;
		const stand = Math.max(0, place.radius - SITE_INSET);
		for (let k = 0; k < run.ribs.count; k++) {
			radialOf(place, crestAngle(run.ribs, k), radial);
			// +Y leaves the skin, +Z runs on up the axis, so the leaf's azimuth of a quarter turn
			// lays its midrib along the stem and its face outward.
			quatFromFrame(radial, along, frame);
			builder.addBud({
				node: (run.points[node] as Laid).node,
				x: (place.position[0] as number) + radial[0] * stand,
				y: (place.position[1] as number) + radial[1] * stand,
				z: (place.position[2] as number) + radial[2] * stand,
				frame,
				kind: BUD_AREOLE,
				vigor: 0.5,
				light: 1,
				axis: run.axis,
				woodRadius: place.radius,
			});
		}
	}
}

/**
 * Places a ring of flower sites on an axis's rounded end, one on each rib crest, set in the skin at
 * the ring's own height and facing square out of the end's curve.
 */
function placeFlowerRing(builder: SkeletonBuilder, run: Run, frame: Float32Array): void {
	if (run.domeHeight <= 0) return;
	const place = frameAt(run.path, run.domeAt + run.domeHeight * FLOWER_RING, emptyFrame());
	const tip = run.points[run.points.length - 1] as Laid;
	// The end's skin leans in toward its top by the slope of its own curve at the ring.
	const lean =
		(run.domeRadius * FLOWER_RING) / (run.domeHeight * Math.sqrt(1 - FLOWER_RING * FLOWER_RING));
	const radial: Vector3 = [0, 0, 0];
	const stand = Math.max(0, place.radius - SITE_INSET);
	for (let k = 0; k < run.ribs.count; k++) {
		radialOf(place, crestAngle(run.ribs, k), radial);
		const out = normalize3([
			radial[0] + lean * (place.tangent[0] as number),
			radial[1] + lean * (place.tangent[1] as number),
			radial[2] + lean * (place.tangent[2] as number),
		]);
		quatFromFrame(out, radial, frame);
		builder.addBud({
			node: tip.node,
			x: (place.position[0] as number) + radial[0] * stand,
			y: (place.position[1] as number) + radial[1] * stand,
			z: (place.position[2] as number) + radial[2] * stand,
			frame,
			kind: BUD_FLOWER,
			vigor: 1,
			light: 1,
			axis: run.axis,
			woodRadius: place.radius,
		});
	}
}

/**
 * Grows a column: its stem, its arms, and the areoles and flower sites along every rib crest.
 *
 * @param input The record, the seed, the variant and the season.
 * @returns The skeleton.
 * @category api/vegetation
 */
export function growColumn(input: GrowInput): MacroSkeleton {
	const growth = columnOf(input.record);
	const builder = new SkeletonBuilder();
	const frame = new Float32Array(4);
	const salt = input.record.seedSalt >>> 0;
	const height = Math.max(0.5, spreadAt(growth.height, draw(input, Purpose.Height)));
	const lean = radians(LEAN[0] + draw(input, Purpose.Lean) * (LEAN[1] - LEAN[0]));
	const leanTurn = draw(input, Purpose.LeanTurn) * 2 * PI;
	const trunkDir = normalize3([sin(lean) * cos(leanTurn), cos(lean), sin(lean) * sin(leanTurn)]);
	const radiusAt = (y: number): number =>
		Math.max(0.02, curveAt(growth.radius, Math.min(1, Math.max(0, y / height))));
	// The stem: a shaft to the foot of its rounded top, then the top.
	const topRadius = radiusAt(height);
	const stemDome = Math.min(height * 0.5, growth.dome * topRadius);
	const shaft = height - stemDome;
	const stemAxis = builder.addAxis({ parent: -1, parentNode: -1, order: 0, kind: AXIS_STEM });
	const trunk: Laid[] = [];
	let node = -1;
	const steps = Math.max(2, Math.ceil(shaft / STEM_NODE));
	for (let n = 0; n <= steps; n++) {
		const y = (n / steps) * shaft;
		const at: Vector3 = [(trunkDir[0] * y) / trunkDir[1], y, (trunkDir[2] * y) / trunkDir[1]];
		node = builder.addNode({
			x: at[0],
			y,
			z: at[2],
			radius: radiusAt(y),
			parent: node,
			axis: stemAxis,
			light: 1,
		});
		trunk.push({ at, node, radius: radiusAt(y) });
	}
	const shaftNodes = trunk.length;
	// The rounded top rises plumb, so the plant's height is the record's whatever the stem's lean.
	layDome(builder, stemAxis, trunk, [0, 1, 0], topRadius, stemDome);
	const stemPath = pathOf(trunk);
	const stem: Run = {
		axis: stemAxis,
		points: trunk,
		...stemPath,
		domeAt: arcAt(stemPath.path, (trunk[shaftNodes - 1] as Laid).at),
		domeHeight: stemDome,
		domeRadius: topRadius,
		ribs: ribPlan(growth, input.seed, salt, input.variant, stemAxis, false),
	};
	placeFlowerRing(builder, stem, frame);
	// Arms leave the stem, each on an axis of its own from the node nearest its height.
	const up: Vector3 = [0, 1, 0];
	for (const plan of armPlans(input, growth, height)) {
		let fromNode = 0;
		for (let n = 1; n < shaftNodes; n++)
			if (
				Math.abs((trunk[n] as Laid).at[1] - plan.height) <
				Math.abs((trunk[fromNode] as Laid).at[1] - plan.height)
			)
				fromNode = n;
		const joint = trunk[fromNode] as Laid;
		const heading: Vector3 = [cos(plan.heading), 0, sin(plan.heading)];
		const [radius, tipRadius] = plan.tier.radius;
		// The arm's first ring stands clear of the stem's skin by most of its own radius, so the
		// weld meets a ring that stands outside the parent.
		const start = joint.radius + radius * ARM_START;
		const { arch, bendEnd, domeHeight } = armArch(
			growth,
			plan,
			Math.max(0, plan.reach - start),
			joint.at[1],
		);
		const path = archPath(arch, 0);
		const armAxis = builder.addAxis({
			parent: stemAxis,
			parentNode: joint.node,
			parentT: 0,
			order: 1,
			kind: AXIS_ARM,
		});
		// The arm is pinched where it leaves the stem, stoutest part way through its bend, and
		// thins from the bend's end to its tip.
		const swellAt = bendEnd * SWELL_AT;
		const pinched = radius * growth.arms.pinch;
		const swollen = radius * growth.arms.swell;
		const radiusOf = (s: number): number =>
			s <= swellAt
				? pinched + (swollen - pinched) * eased(s / Math.max(1e-6, swellAt))
				: s <= bendEnd
					? swollen + (radius - swollen) * eased((s - swellAt) / (bendEnd - swellAt))
					: radius + ((tipRadius - radius) * (s - bendEnd)) / (arch.length - bendEnd);
		const arm: Laid[] = [];
		let previous = joint.node;
		let segment = 0;
		for (const share of armNodes(path.along, path.elevation)) {
			// The node's place on the path: on a cut, or along the straight segment it guards.
			while (segment + 1 < path.segments && (path.along[segment + 1] as number) <= share) segment++;
			const a = path.along[segment] as number;
			const b = path.along[segment + 1] as number;
			const t = b > a ? (share - a) / (b - a) : 0;
			const out =
				(path.out[segment] as number) +
				t * ((path.out[segment + 1] as number) - (path.out[segment] as number));
			const rise =
				(path.up[segment] as number) +
				t * ((path.up[segment + 1] as number) - (path.up[segment] as number));
			const at: Vector3 = [
				joint.at[0] + heading[0] * (start + out),
				joint.at[1] + rise,
				joint.at[2] + heading[2] * (start + out),
			];
			const r = radiusOf(share * arch.length);
			previous = builder.addNode({
				x: at[0],
				y: at[1],
				z: at[2],
				radius: r,
				parent: previous,
				axis: armAxis,
				light: 1,
			});
			arm.push({ at, node: previous, radius: r });
		}
		const shaftCount = arm.length;
		layDome(builder, armAxis, arm, up, tipRadius, domeHeight);
		const armPath = pathOf(arm, joint.at, trunkDir);
		const run: Run = {
			axis: armAxis,
			points: arm,
			...armPath,
			domeAt: arcAt(armPath.path, (arm[shaftCount - 1] as Laid).at),
			domeHeight,
			domeRadius: tipRadius,
			ribs: ribPlan(growth, input.seed, salt, input.variant, armAxis, true),
		};
		placeFlowerRing(builder, run, frame);
		// The arm's first stretch stands inside the weld to the stem, so its areoles start past it.
		placeAreoles(builder, growth, run, radius, frame);
	}
	// Woodpecker holes on the upper stem, as nearly every old saguaro carries. Each is a dormant
	// site set a little inside the skin where it stands, crest or groove, so the extra's dark socket
	// sits flush with it.
	const section = ribSection(stem.ribs);
	const place = emptyFrame();
	const radial: Vector3 = [0, 0, 0];
	for (let h = 0; h < NEST_HOLES; h++) {
		const y =
			height * (NEST_BAND[0] + (NEST_BAND[1] - NEST_BAND[0]) * draw(input, Purpose.Nest, h));
		const s = Math.min(stem.domeAt, y / trunkDir[1]);
		frameAt(stem.path, s, place);
		const theta = draw(input, Purpose.Nest, h, 1) * 2 * PI;
		radialOf(place, theta, radial);
		const stand = section.radius(0, theta, place.radius) - NEST_INSET;
		const nestNode = nearestPoint(trunk, place.position, 0);
		quatFromFrame(radial, [0, 1, 0], frame);
		builder.addBud({
			node: (trunk[nestNode] as Laid).node,
			x: (place.position[0] as number) + radial[0] * stand,
			y: (place.position[1] as number) + radial[1] * stand,
			z: (place.position[2] as number) + radial[2] * stand,
			frame,
			kind: BUD_DORMANT,
			vigor: 0.5,
			light: 1,
			axis: stemAxis,
			woodRadius: place.radius,
		});
	}
	placeAreoles(builder, growth, stem, 0, frame);
	return builder.finish(0);
}

/** The column grower: the stem, its arms and their areoles. */
export const grower: Grower = {
	grow: growColumn,
};
