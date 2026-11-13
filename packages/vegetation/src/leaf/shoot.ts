// The shoot prototypes: small real shoots grown once per species from the record. A prototype is a
// current-year shoot with older years below it: each year a growth unit of nodes spaced by the
// class's internode curve, its stem bending by the twig's zigzag and droop. Older units end in the
// cluster of buds that last year's laterals grew from, so a prototype of two or three orders
// branches where a year ended. Leaves (or needles, or fascicles) stand on the newest years' nodes by
// the phyllotaxis, scaled and angled by position, each with a bud in its axil, and each axis ends in
// its bud cluster.
//
// A prototype is planned once from the record and the integer hash, then meshed at every tier from
// that plan, so a tier changes triangles and never the shoot's shape. Each vertex then gets its
// shade inside the shoot from rays cast against the plan's high-tier triangles.
//
// Prototype space: the attach point at the origin, the shoot leaving along +Y, +Z toward the sky
// side of the bud it grows from.
import type { PrototypeArrays, ShootPrototype } from '../asset';
import { hashAt, unitAt } from '../core/hash';
import {
	acos,
	atan2,
	cos,
	cross3,
	length3,
	normalize3,
	PI,
	quatAxisAngle,
	quatFromFrame,
	quatRotate,
	radians,
	sin,
	type Vector3,
} from '../core/math';
import type { Phyllotaxis, ShootClass, ShootSpec, Species } from '../core/record';
import type { TextureManifest } from '../core/textures';
import {
	BEND_PIECE_LEAST,
	type Curve,
	curveAt,
	DETAILS,
	type Detail,
	LATERAL_GAP_MOST,
	SIDE_SHOOTS_MOST,
	type Spread,
	spreadAt,
	spreadMean,
} from '../core/types';
import { WOOD_RADIUS_RANGE } from '../wood/wood-mesh';
import { shootOcclusion } from './occlusion';
import { hasBareTwins } from './season';
import { lathe, MeshWriter, SURFACE_BUD, SURFACE_STEM, type TubePoint, tube } from './writer';

/**
 * A shoot prototype before the card bake gives it its atlas cells.
 *
 * @category api/vegetation
 */
export type UncardedPrototype = Omit<ShootPrototype, 'card'> & {
	/**
	 * The brush cards a piece draws below its finest tier, which the card bake pictures and then
	 * lays over the tiers' dense runs of leaves. Absent on a prototype that draws its leaves whole.
	 */
	readonly brushes?: PrototypeBrushes;
};

/**
 * One dense run of a piece's leaves that draws as a brush card: its picture by index, the run's
 * start on its stem and its own frame (along the stem, toward the sky, and the side square to both),
 * its length, and the bend weight and flutter phase its card takes.
 */
export interface BrushRun {
	readonly picture: number;
	readonly start: Vector3;
	readonly along: Vector3;
	readonly sky: Vector3;
	readonly side: Vector3;
	readonly length: number;
	readonly bend: number;
	readonly phase: number;
}

/**
 * The leaves of one dense run in the run's own frame, which the card bake pictures: x along its
 * side, y along its stem from the run's start, z toward its sky. Its length is the run's.
 */
export interface BrushPicture {
	readonly mesh: PrototypeArrays;
	readonly length: number;
}

/** A piece's brush runs and the pictures they draw from. */
export interface PrototypeBrushes {
	readonly runs: readonly BrushRun[];
	readonly pictures: readonly BrushPicture[];
}

/** The golden angle in degrees. */
const GOLDEN = 137.50776405;
/** The shoot's own line in its space: its first axis leaves the attach point along it. */
const SHOOT_LINE: Readonly<Vector3> = [0, 1, 0];
/** Degrees between a lateral shoot of the prototype and its parent. */
const LATERAL_ANGLE = 42;
/** Degrees an axillary bud leans from its stem. */
const BUD_LEAN = 28;
/** Degrees the buds of a tip cluster lean from the terminal bud, where the record names none. */
const CLUSTER_LEAN = 32;
/**
 * The share of a bud's length that each bud of a tip cluster stands below the last along the twig,
 * where the record names none.
 */
const CLUSTER_STEP = 0.4;
/** How far inside a twig's surface a crowded node's leaves root, so their blades meet the wood. */
const CROWDED_ROOT = 1;
/** The crowding at which a node joins a plate run, from 0 at an even spacing to 1 at a point. */
const PLATE_CROWDED = 0.25;

/** Purposes of the prototypes' hash keys, so no two draws share one. */
const Purpose = {
	Length: 1,
	Unit: 2,
	Nodes: 3,
	Start: 4,
	Wander: 5,
	Laterals: 6,
	LateralTurn: 7,
	LeafSize: 8,
	LeafMesh: 9,
	Phase: 10,
	Spur: 11,
	LeafAngle: 12,
	Joint: 13,
	LeafAzimuth: 14,
} as const;

/** A bud's mesh at a tier: faces around, and whether its profile is rounded or a plain cone. */
export interface BudShape {
	readonly sides: number;
	readonly round: boolean;
}

/** How a tier meshes a shoot's wood and buds. */
export interface ShootCut {
	/** Sides of the stem tubes. */
	readonly stemSides: number;
	/** Whether a tube keeps only the rings at each year's end. */
	readonly yearRings?: boolean;
	/** A tip cluster's buds; absent, the cluster draws none. */
	readonly cluster?: BudShape;
	/** Whether a tip cluster is drawn as one cone over its stack, in the cluster's shape. */
	readonly clusterCone?: boolean;
	/** An axil's bud; absent, the axils draw none. */
	readonly axil?: BudShape;
	/**
	 * Metres below which an axil's bud is left out: a smaller one hides under its leaf and spans a
	 * pixel or two at the distances the tier draws. Absent, every axil's bud is drawn.
	 */
	readonly axilLeast?: number;
	/** A thorn's and a fruiting body's shapes; absent, a thorn takes the axil's and a body the cluster's. */
	readonly thorn?: BudShape;
	readonly body?: BudShape;
	/** Whether a stem run that its leaves hide takes rings far apart, since no ring of it shows. */
	readonly thinHidden?: boolean;
	/**
	 * Whether a tube of few sides stands wider than its stem's radius, so its outline is as wide as
	 * the round stem's when averaged over a turn: a three-sided tube on the radius reads a sixth thin.
	 */
	readonly meanWidth?: boolean;
	/**
	 * Degrees a stem turns between two rings. Set, a ring stands only where the run from the last ring
	 * meets the next run at that angle or more, so a straight run takes no rings between its ends.
	 */
	readonly ringTurn?: number;
}

/**
 * The crown's shoots at each tier. The buds of a tip cluster, which a close view reads, are rounder
 * than those in the leaf axils. The medium tier draws a whole cluster as one cone, and the low tier,
 * whose shoots stand a few pixels long, keeps one ring a year and draws no buds.
 */
export const SHOOT_CUTS: Readonly<Record<Detail, ShootCut>> = {
	low: { stemSides: 3, yearRings: true },
	medium: {
		stemSides: 4,
		cluster: { sides: 3, round: false },
		clusterCone: true,
		axil: { sides: 3, round: false },
	},
	high: { stemSides: 5, cluster: { sides: 5, round: true }, axil: { sides: 4, round: false } },
	ultra: { stemSides: 6, cluster: { sides: 6, round: true }, axil: { sides: 5, round: true } },
};
/** The tier whose vertices cast the shoot's shade rays. */
const SHADE_TIER = DETAILS.indexOf('medium');

/** One point along an axis of the plan. */
export interface AxisPoint {
	readonly at: Vector3;
	readonly radius: number;
	/** Metres along the shoot from the attach point. */
	readonly along: number;
	/** Whether a year's growth unit ends here, where the low tier keeps a ring. */
	readonly unitEnd?: boolean;
}

/** One leaf of the plan. */
export interface PlannedLeaf {
	/** Where its stalk joins the stem. */
	readonly at: Vector3;
	/** Its turn from leaf space, x, y, z, w: +Y along the midrib, +Z the upper face. */
	readonly rotation: readonly number[];
	/** Its size over the leaf mesh's. */
	readonly scale: number;
	/** The leaf mesh it draws, by index. */
	readonly mesh: number;
	/** Its flutter phase, 0 to 255. */
	readonly phase: number;
	/** Metres along the shoot from the attach point. */
	readonly along: number;
	/** The axis it stands on, and its node's index along that axis. */
	readonly axis: number;
	readonly node: number;
	/** The stem's direction at its node. */
	readonly stem: Vector3;
	/** The sky side at its node, square to the stem. */
	readonly sky: Vector3;
	/** The way its stalk leaves the stem, square to the stem. */
	readonly radial: Vector3;
	/** The direction the leaf leaves in. */
	readonly direction: Vector3;
	/** How much its internode shrinks below the shoot's own spacing, 0 at an even spacing and 1 in a tip rosette. */
	readonly crowded: number;
}

/** One bud of the plan. */
export interface PlannedBud {
	readonly at: Vector3;
	readonly direction: Vector3;
	readonly length: number;
	readonly width: number;
	readonly along: number;
	/** Whether it belongs to a tip cluster, not to a leaf axil. */
	readonly cluster: boolean;
	/**
	 * For a cluster's first bud, the tip one, metres from the foot of the cluster's lowest bud to the
	 * tip, along which the medium tier draws the whole cluster as one cone.
	 */
	readonly stack?: number;
	/** The species' mark it draws, a thorn or a fruiting body, where it is one and not a bud. */
	readonly mark?: 'thorn' | 'body';
}

/**
 * A prototype's plan: its axes, leaves and buds, which every tier meshes.
 *
 * @category api/vegetation
 */
export interface ShootPlan {
	/** Each axis as points from base to tip; axis 0 is the shoot itself. */
	readonly axes: readonly (readonly AxisPoint[])[];
	readonly leaves: readonly PlannedLeaf[];
	readonly buds: readonly PlannedBud[];
	/** Metres from the attach point to the farthest point of any axis. */
	readonly reach: number;
	/** Metres along the longest path, for the bend weight. */
	readonly span: number;
}

/** A point of an axis with its frame: where a side shoot may leave it. */
interface StemFrame {
	readonly at: Vector3;
	/** The stem's direction over the internode that ends here. */
	readonly direction: Vector3;
	readonly sky: Vector3;
	readonly along: number;
	readonly radius: number;
}

/**
 * The stem's point and frame `along` metres from the shoot's attach point, within one growth unit:
 * a node's own frame where it stands on one, else a point on the straight internode that holds it,
 * between the unit's start and its nodes.
 */
function frameAt(start: StemFrame, nodes: readonly StemFrame[], along: number): StemFrame {
	let previous = start;
	for (const node of nodes) {
		if (along >= node.along) {
			previous = node;
			continue;
		}
		const step = along - previous.along;
		const share = step / Math.max(1e-9, node.along - previous.along);
		return {
			at: [
				previous.at[0] + node.direction[0] * step,
				previous.at[1] + node.direction[1] * step,
				previous.at[2] + node.direction[2] * step,
			],
			direction: node.direction,
			sky: node.sky,
			along,
			radius: previous.radius + (node.radius - previous.radius) * share,
		};
	}
	return previous;
}

/** What one axis grows from. */
interface AxisStart {
	readonly at: Vector3;
	readonly direction: Vector3;
	/** The sky side, square or nearly square to the direction. */
	readonly sky: Vector3;
	readonly order: number;
	/** Growth units still to grow: the newest is the last. */
	readonly units: number;
	/** Metres of one unit. */
	readonly unitLength: number;
	readonly radius: number;
	readonly along: number;
}

/** Projects `v` square to the unit `axis`, then scales it to unit length; `fallback` when it vanishes. */
export function square(
	v: Readonly<Vector3>,
	axis: Readonly<Vector3>,
	fallback: Readonly<Vector3>,
): Vector3 {
	const d = v[0] * axis[0] + v[1] * axis[1] + v[2] * axis[2];
	const out: Vector3 = [v[0] - d * axis[0], v[1] - d * axis[1], v[2] - d * axis[2]];
	if (length3(out[0], out[1], out[2]) < 1e-6) return square(fallback, axis, [1, 0, 0]);
	return normalize3(out);
}

/** Turns `v` about the unit `axis` by `degrees`. */
export function turn(v: Readonly<Vector3>, axis: Readonly<Vector3>, degrees: number): Vector3 {
	const q = [0, 0, 0, 1];
	quatAxisAngle(axis, radians(degrees), q);
	return quatRotate(q, 0, v, [0, 0, 0]);
}

/**
 * The unit `v` turned toward the unit `line` until it stands at most `degrees` from it, keeping the
 * side of the line it leans to; `v` itself where it already stands that close. A `v` that points
 * straight back along the line turns toward `fallback`'s side.
 */
function within(
	v: Readonly<Vector3>,
	line: Readonly<Vector3>,
	degrees: number,
	fallback: Readonly<Vector3>,
): Vector3 {
	const along = Math.min(1, Math.max(-1, v[0] * line[0] + v[1] * line[1] + v[2] * line[2]));
	const off = (acos(along) * 180) / PI;
	if (off <= degrees) return [...v];
	const axis = cross3(v, line, [0, 0, 0]);
	const pivot =
		length3(axis[0], axis[1], axis[2]) < 1e-6
			? normalize3(cross3(v, square(fallback, v, [1, 0, 0]), [0, 0, 0]))
			: normalize3(axis);
	return normalize3(turn(v, pivot, off - degrees));
}

/** The leaves standing at one node: their azimuths in degrees about the stem. */
function nodeAzimuths(
	phyllotaxis: Phyllotaxis,
	node: number,
	start: number,
	count: (key: number) => number,
): number[] {
	switch (phyllotaxis.kind) {
		case 'spiral':
			return [start + node * phyllotaxis.divergence];
		case 'fascicle':
			return [start + node * GOLDEN];
		case 'distichous':
			// Each node's leaf stands past the opposite rank by the class's turn, so the two ranks
			// advance round the stem rather than lying in one plane.
			return [start + node * (180 + (phyllotaxis.turn ?? 0))];
		case 'opposite': {
			const a = start + (phyllotaxis.decussate ? node * 90 : 0);
			return [a, a + 180];
		}
		case 'whorled': {
			const n = Math.max(2, Math.round(phyllotaxis.count));
			const a = start + (node * 180) / n;
			const out: number[] = [];
			for (let k = 0; k < n; k++) out.push(a + (k * 360) / n);
			return out;
		}
		case 'rosette-spur': {
			const n = Math.max(1, Math.round(count(node)));
			const out: number[] = [];
			for (let k = 0; k < n; k++) out.push(start + k * GOLDEN);
			return out;
		}
	}
}

/** The class each prototype belongs to: classes take prototypes by share, in vigor order. */
function classOf(classes: readonly ShootClass[], index: number, count: number): ShootClass {
	const share = (index + 0.5) / count;
	let sum = 0;
	for (const candidate of classes) {
		sum += candidate.share;
		if (share <= sum) return candidate;
	}
	return classes[classes.length - 1] as ShootClass;
}

/** How many leaves (or needles, or fascicles) a growth unit of this length carries. */
function unitNodes(
	record: Species,
	shootClass: ShootClass,
	unitLength: number,
	unit: number,
): number {
	const foliage = record.foliage;
	// A spur carries its whole rosette at its one node.
	if ((shootClass.phyllotaxis ?? record.shoots?.phyllotaxis)?.kind === 'rosette-spur') return 1;
	if (foliage.kind === 'needle')
		return Math.max(1, Math.round(foliage.needle.density * unitLength * 100));
	return Math.max(1, Math.round(spreadAt(shootClass.nodes, unit)));
}

/**
 * Opens a lit shoot's leaves into a mosaic, by the skyward share: each leaf swings out of the sky
 * side into the plane of its stem and the stem's side, so the sky looks down on a fan. Leaves that
 * crowd on one axis at a tip form a rosette instead: each keeps its own opening angle and the
 * leaves stand evenly round the stem, so the cluster reads the same from every side and its blades
 * fill the gaps rather than lie on each other. A species whose rosettes are one flat fan of blades
 * asks for the fan here, and then a crowded tip spreads in the stem's plane like any other group.
 *
 * @param leaves The plan's leaves, rewritten in place.
 * @param share The skyward share, 0 to 1.
 * @param leafLength The species' leaf length, which sets how close leaves must stand to crowd.
 * @param round Whether a crowded tip stands its leaves evenly round the stem.
 * @param rotate A leaf's turn from its direction and its node's frame.
 */
function openMosaic(
	leaves: PlannedLeaf[],
	share: number,
	leafLength: number,
	round: boolean,
	rotate: (direction: Vector3, stem: Vector3, sky: Vector3, radial: Vector3) => number[],
): void {
	// Groups of leaves on one axis that stand within a third of a leaf's length of the next.
	const groups: number[][] = [];
	for (let i = 0; i < leaves.length; i++) {
		const leaf = leaves[i] as PlannedLeaf;
		const group = groups[groups.length - 1];
		const last = group ? (leaves[group[group.length - 1] as number] as PlannedLeaf) : undefined;
		if (group && last && last.axis === leaf.axis && leaf.along - last.along < leafLength / 3)
			group.push(i);
		else groups.push([i]);
	}
	for (const group of groups) {
		// A rosette: the leaves of a shoot's crowded tip keep their opening angles and divide the
		// turn round the stem evenly. A group of one, of leaves at the shoot's own spacing, or of a
		// species whose rosette is one flat fan, takes the fan instead.
		const crowded = group.filter((i) => (leaves[i] as PlannedLeaf).crowded > 0.4).length;
		if (round && group.length > 1 && crowded * 2 > group.length) {
			spreadRound(leaves, group, share * ROSETTE_SKY_SHARE, rotate);
			continue;
		}
		// Each leaf's angle in its fan plane, from the stem toward the stem's side.
		const angles = group.map((i) => {
			const leaf = leaves[i] as PlannedLeaf;
			const side = normalize3(cross3(leaf.stem, leaf.sky, [0, 0, 0]));
			const d = leaf.direction;
			return atan2(
				d[0] * side[0] + d[1] * side[1] + d[2] * side[2],
				d[0] * leaf.stem[0] + d[1] * leaf.stem[1] + d[2] * leaf.stem[2],
			);
		});
		// A crowd spreads evenly over the widest angle its leaves stand at, either side of the stem.
		let widest = 0;
		for (const i of group) {
			const leaf = leaves[i] as PlannedLeaf;
			const d = leaf.direction;
			widest = Math.max(
				widest,
				acos(
					Math.max(
						-1,
						Math.min(1, d[0] * leaf.stem[0] + d[1] * leaf.stem[1] + d[2] * leaf.stem[2]),
					),
				),
			);
		}
		const order = group
			.map((_, k) => k)
			.sort((a, b) => (angles[a] as number) - (angles[b] as number) || a - b);
		const targets = new Array<number>(group.length);
		order.forEach((k, rank) => {
			targets[k] =
				group.length > 1
					? -widest + (2 * widest * (rank + 0.5)) / group.length
					: (angles[k] as number);
		});
		group.forEach((i, k) => {
			const leaf = leaves[i] as PlannedLeaf;
			const side = normalize3(cross3(leaf.stem, leaf.sky, [0, 0, 0]));
			const d = leaf.direction;
			const angle =
				(angles[k] as number) + ((targets[k] as number) - (angles[k] as number)) * share;
			// What remains of the leaf's lean toward the sky side or away from it.
			const lift = (d[0] * leaf.sky[0] + d[1] * leaf.sky[1] + d[2] * leaf.sky[2]) * (1 - share);
			const flat = Math.sqrt(Math.max(0, 1 - lift * lift));
			const direction = normalize3([
				(leaf.stem[0] * cos(angle) + side[0] * sin(angle)) * flat + leaf.sky[0] * lift,
				(leaf.stem[1] * cos(angle) + side[1] * sin(angle)) * flat + leaf.sky[1] * lift,
				(leaf.stem[2] * cos(angle) + side[2] * sin(angle)) * flat + leaf.sky[2] * lift,
			]);
			leaves[i] = {
				...leaf,
				direction,
				rotation: rotate(direction, leaf.stem, leaf.sky, leaf.radial),
			};
		});
	}
}

/**
 * The share of the species' skyward turn a rosette's blades keep. Squared right across the shoot, every
 * lamina faces a camera looking down the twig, and the cluster then shows more sky than the photographs
 * do; keeping half of the turn squares them without opening the blades past their neighbours.
 */
const ROSETTE_SKY_SHARE = 0.5;

/** How many prototypes a cutting class gives, so its pieces still draw different shoots. */
const CUTTING_PROTOTYPES = 2;

/** A leaf's frame in a rosette: where it turns round the stem and how far it opens from it. */
interface LeafRound {
	readonly side: Vector3;
	readonly opening: number;
	readonly azimuth: number;
}

/**
 * Spreads the leaves of a crowded tip evenly round the stem, in the order the spiral gave them: each
 * keeps the angle it opens from the stem and gains an equal share of the turn. A real tip rosette is
 * round, so a camera at any side sees the same cluster rather than a fan seen edge-on.
 */
function spreadRound(
	leaves: PlannedLeaf[],
	group: readonly number[],
	skyShare: number,
	rotate: (
		direction: Vector3,
		stem: Vector3,
		sky: Vector3,
		radial: Vector3,
		skyShare?: number,
	) => number[],
): void {
	const frames: LeafRound[] = group.map((i) => {
		const leaf = leaves[i] as PlannedLeaf;
		const side = normalize3(cross3(leaf.stem, leaf.sky, [0, 0, 0]));
		const d = leaf.direction;
		return {
			side,
			opening: acos(
				Math.max(-1, Math.min(1, d[0] * leaf.stem[0] + d[1] * leaf.stem[1] + d[2] * leaf.stem[2])),
			),
			azimuth: atan2(
				d[0] * leaf.sky[0] + d[1] * leaf.sky[1] + d[2] * leaf.sky[2],
				d[0] * side[0] + d[1] * side[1] + d[2] * side[2],
			),
		};
	});
	// The spiral's own sequence, spaced to fill the whole turn: the first leaf sets where it starts.
	const order = group
		.map((_, k) => k)
		.sort((a, b) => (frames[a] as LeafRound).azimuth - (frames[b] as LeafRound).azimuth || a - b);
	const start = (frames[order[0] as number] as LeafRound).azimuth;
	const turn = (2 * Math.PI) / group.length;
	order.forEach((k, rank) => {
		const leaf = leaves[group[k] as number] as PlannedLeaf;
		const frame = frames[k] as LeafRound;
		const azimuth = start + turn * rank;
		const radial = normalize3([
			frame.side[0] * cos(azimuth) + leaf.sky[0] * sin(azimuth),
			frame.side[1] * cos(azimuth) + leaf.sky[1] * sin(azimuth),
			frame.side[2] * cos(azimuth) + leaf.sky[2] * sin(azimuth),
		]);
		const direction = normalize3([
			leaf.stem[0] * cos(frame.opening) + radial[0] * sin(frame.opening),
			leaf.stem[1] * cos(frame.opening) + radial[1] * sin(frame.opening),
			leaf.stem[2] * cos(frame.opening) + radial[2] * sin(frame.opening),
		]);
		leaves[group[k] as number] = {
			...leaf,
			direction,
			rotation: rotate(direction, leaf.stem, leaf.sky, radial, skyShare),
		};
	});
}

/**
 * A leaf's turn from leaf space: the upper face looks toward the shoot's tip, turned toward the sky
 * side by `share`. At a share of 1 the lamina squares across the shoot, which is how a rosette's
 * blades stand: a camera looking down the twig sees every one of them face on.
 *
 * @param direction The way the leaf leaves, a unit vector.
 * @param stem The stem's direction at the leaf's node.
 * @param sky The sky side at the node.
 * @param radial The way the stalk leaves the stem.
 * @param share The share of the turn toward the sky side, 0 to 1.
 * @returns The turn, x, y, z, w.
 */
export function leafTurn(
	direction: Vector3,
	stem: Vector3,
	sky: Vector3,
	radial: Vector3,
	share: number,
): number[] {
	const adaxial = square(stem, direction, radial);
	const skyward = square(sky, direction, adaxial);
	const w = share;
	const face = normalize3([
		adaxial[0] * (1 - w) + skyward[0] * w,
		adaxial[1] * (1 - w) + skyward[1] * w,
		adaxial[2] * (1 - w) + skyward[2] * w,
	]);
	const rotation = [0, 0, 0, 1];
	quatFromFrame(direction, face, rotation);
	return rotation;
}

/** What a node's leaves are placed by: the species' leaf measures and the stem's own rule. */
export interface LeafRule {
	/** The species' salt and the hash key of the prototype the leaves belong to. */
	readonly salt: number;
	readonly key: number;
	readonly phyllotaxis: Phyllotaxis;
	/** Degrees a leaf stands from its stem, base to tip, and the half-width of its spread. */
	readonly leafAngle: Curve;
	readonly leafAngleSpread: number;
	/** Degrees each leaf's azimuth varies from the arrangement's own, 0 for none. */
	readonly leafAzimuthSpread: number;
	/** The angle a needle stands at, which replaces the leaf angle. */
	readonly needleAngle: number | undefined;
	/** The share by which needles turn toward the shoot's two sides. */
	readonly ranks: number;
	/** A leaf's size along the stem, base to tip, over the species' own spread of sizes. */
	readonly leafScale: Curve;
	readonly leafSpread: Spread;
	readonly leafMean: number;
	/** The blade's length in metres, 0 for a leaf that carries no axil bud. */
	readonly leafLength: number;
	/** The leaf meshes a leaf may draw. */
	readonly leafMeshes: number;
	readonly budLength: number;
	readonly budWidth: number;
	/** A leaf's turn from its direction and its node's frame. */
	readonly rotate: (direction: Vector3, stem: Vector3, sky: Vector3, radial: Vector3) => number[];
}

/**
 * Places the leaves of one node, each with its axillary bud.
 *
 * @param rule The leaf rule.
 * @param leaves The plan's leaves, which gain the node's.
 * @param buds The plan's buds, which gain the node's axil buds.
 * @param axis The axis the node stands on.
 * @param node The node's index along its axis.
 * @param at The node's place.
 * @param stem The stem's direction at the node.
 * @param sky The sky side at the node.
 * @param radius The stem's radius at the node.
 * @param along Metres along the shoot from the attach point.
 * @param t The node's share of its growth unit, 0 at its foot and 1 at its tip.
 * @param azimuthStart Degrees about the stem where the axis's first leaf stands.
 * @param crowded How much the node's internode shrinks below the shoot's own spacing, 0 to 1.
 * @param plateFace The face a plate run holds its blades to, where the node belongs to one.
 */
export function placeNodeLeaves(
	rule: LeafRule,
	leaves: PlannedLeaf[],
	buds: PlannedBud[],
	axis: number,
	node: number,
	at: Vector3,
	stem: Vector3,
	sky: Vector3,
	radius: number,
	along: number,
	t: number,
	azimuthStart: number,
	crowded: number,
	plateFace?: Vector3,
): void {
	const { phyllotaxis, ranks, leafMean, leafSpread } = rule;
	const draw = (purpose: number, a = 0, b = 0) => unitAt(rule.salt, rule.key, purpose, a, b);
	// A plate run holds every blade to its own face, so the run reads as one shingle rather than
	// a tuft that turns with the stem.
	const face = plateFace ?? sky;
	const side = normalize3(cross3(stem, face, [0, 0, 0]));
	const azimuths = nodeAzimuths(phyllotaxis, node, azimuthStart, (key) =>
		phyllotaxis.kind === 'rosette-spur'
			? spreadAt(phyllotaxis.leaves, draw(Purpose.Spur, axis, key))
			: 1,
	);
	const spread = rule.leafAngleSpread;
	const leafAngle =
		rule.needleAngle ??
		curveAt(rule.leafAngle, t) +
			(spread > 0 ? (draw(Purpose.LeafAngle, axis, node) * 2 - 1) * spread : 0);
	for (let k = 0; k < azimuths.length; k++) {
		let azimuth = radians(azimuths[k] as number);
		// Two-ranked needles turn toward the shoot's two sides.
		if (ranks > 0) {
			const toward = cos(azimuth) >= 0 ? 0 : Math.PI;
			let gap = toward - azimuth;
			gap -= 2 * Math.PI * Math.round(gap / (2 * Math.PI));
			azimuth += gap * ranks;
		} else if (rule.leafAzimuthSpread > 0) {
			// A two-ranked shoot's leaves turn a little out of its plane, so its fan keeps a width
			// as the shoot turns edge-on.
			const wobble =
				(draw(Purpose.LeafAzimuth, axis, node * 8 + k) * 2 - 1) * rule.leafAzimuthSpread;
			azimuth += radians(wobble);
		}
		const radial = normalize3([
			side[0] * cos(azimuth) + face[0] * sin(azimuth),
			side[1] * cos(azimuth) + face[1] * sin(azimuth),
			side[2] * cos(azimuth) + face[2] * sin(azimuth),
		]);
		const a = radians(leafAngle);
		const direction = normalize3([
			stem[0] * cos(a) + radial[0] * sin(a),
			stem[1] * cos(a) + radial[1] * sin(a),
			stem[2] * cos(a) + radial[2] * sin(a),
		]);
		const rotation = rule.rotate(direction, stem, face, radial);
		const key = node * 8 + k;
		const size =
			curveAt(rule.leafScale, t) *
			(leafMean > 0 ? spreadAt(leafSpread, draw(Purpose.LeafSize, axis, key)) / leafMean : 1);
		// A crowded node's leaves root inside the twig's own surface, so a rosette's inner blades
		// meet the wood they stand on instead of stopping a hairline short of it.
		const out = radius * (1 - CROWDED_ROOT * crowded);
		leaves.push({
			at: [at[0] + radial[0] * out, at[1] + radial[1] * out, at[2] + radial[2] * out],
			rotation,
			scale: Math.max(0.05, size),
			mesh: hashAt(rule.salt, rule.key, Purpose.LeafMesh, axis, key) % rule.leafMeshes,
			phase: hashAt(rule.salt, rule.key, Purpose.Phase, axis, key) & 255,
			along,
			axis,
			node,
			stem: [...stem],
			sky: [...face],
			radial,
			direction,
			crowded,
		});
		if (rule.leafLength > 0 && rule.budLength > 0) {
			const lean = radians(BUD_LEAN);
			buds.push({
				at: [at[0] + radial[0] * radius, at[1] + radial[1] * radius, at[2] + radial[2] * radius],
				direction: normalize3([
					stem[0] * cos(lean) + radial[0] * sin(lean),
					stem[1] * cos(lean) + radial[1] * sin(lean),
					stem[2] * cos(lean) + radial[2] * sin(lean),
				]),
				cluster: false,
				// Axil buds grow toward the tip cluster's size where the nodes crowd into a rosette.
				length: rule.budLength * (0.55 + 0.35 * crowded),
				width: rule.budWidth * (0.55 + 0.35 * crowded),
				along,
			});
		}
	}
}

/**
 * Adds the bud cluster at an axis's tip: the terminal bud and the buds stacked below it.
 *
 * @param buds The plan's buds, which gain the cluster.
 * @param bud The species' bud measures.
 * @param tipRadius The twig's radius at its tip.
 * @param at The tip.
 * @param direction The twig's direction at its tip.
 * @param sky The sky side at the tip.
 * @param along Metres along the shoot from the attach point.
 */
export function addBudCluster(
	buds: PlannedBud[],
	bud: ShootSpec['bud'],
	tipRadius: number,
	at: Vector3,
	direction: Vector3,
	sky: Vector3,
	along: number,
): void {
	const budLength = bud.length;
	const budWidth = bud.width;
	if (budLength <= 0) return;
	const count = Math.max(0, Math.round(bud.tipCluster) - 1);
	const step = bud.cluster?.step ?? CLUSTER_STEP;
	const lean = radians(bud.cluster?.lean ?? CLUSTER_LEAN);
	buds.push({
		at: [...at],
		direction: [...direction],
		length: budLength,
		width: budWidth,
		along,
		cluster: true,
		stack: budLength * (count > 0 ? 0.35 + step * (count - 1) + 1 : 1),
	});
	for (let k = 0; k < count; k++) {
		const outward = turn(sky, direction, k * GOLDEN);
		// The cluster stacks down the twig's last centimetres, each bud a step below the last on a
		// spiral, standing on the bark and leaning out from the terminal bud.
		const back = budLength * (0.35 + step * k);
		const out = tipRadius + budWidth * 0.2;
		buds.push({
			at: [
				at[0] - direction[0] * back + outward[0] * out,
				at[1] - direction[1] * back + outward[1] * out,
				at[2] - direction[2] * back + outward[2] * out,
			],
			direction: normalize3([
				direction[0] * cos(lean) + outward[0] * sin(lean),
				direction[1] * cos(lean) + outward[1] * sin(lean),
				direction[2] * cos(lean) + outward[2] * sin(lean),
			]),
			cluster: true,
			length: budLength * 0.8,
			width: budWidth * 0.85,
			along: along - back,
		});
	}
}

/**
 * Plans one prototype from the record: its axes, its leaves and its buds.
 *
 * @param record The species record.
 * @param index The prototype's index.
 * @param leafMeshes The leaf meshes it may place.
 * @param only The class to plan, where a prototype belongs to a cutting class rather than the crown's.
 * @returns The plan.
 * @category api/vegetation
 */
export function planShoot(
	record: Species,
	index: number,
	leafMeshes: number,
	only?: ShootClass,
): ShootPlan {
	const shoots = record.shoots;
	if (!shoots) throw new Error(`@null3d/vegetation: '${record.id}' has no shoots to plan`);
	const salt = record.seedSalt;
	const draw = (purpose: number, a = 0, b = 0) => unitAt(salt, 0x5400 + index, purpose, a, b);
	const shootClass = only ?? classOf(shoots.classes, index, shoots.prototypes);
	const total = Math.max(0.005, spreadAt(shootClass.length, draw(Purpose.Length)));
	const years = Math.max(1, Math.round(shootClass.years ?? shoots.years));
	const leafYears = Math.max(
		0,
		Math.min(years, Math.round(shootClass.leafYears ?? shoots.leafYears)),
	);
	// How far a leaf turns its upper face from the shoot's tip toward the sky side: the species'
	// skyward share, all the way for flattened two-ranked sprays, or the class's own where it names
	// one: a cut piece's photograph shows its blades face on.
	const skyTurn = Math.min(1, Math.max(0, shootClass.skyward ?? shoots.placement.skyward));
	const phyllotaxis = shootClass.phyllotaxis ?? shoots.phyllotaxis;
	const foliage = record.foliage;
	const leafLength = foliage.kind === 'blade' ? spreadMean(foliage.leaf.length) : 0;
	const leafSpread =
		foliage.kind === 'blade'
			? foliage.leaf.length
			: foliage.kind === 'needle' || foliage.kind === 'fascicle'
				? foliage.needle.length
				: 1;
	const leafMean = spreadMean(leafSpread);
	const needleAngle =
		foliage.kind === 'needle' || foliage.kind === 'fascicle' ? foliage.needle.angle : undefined;
	const ranks = foliage.kind === 'needle' ? foliage.needle.ranks : 0;
	const flatten = phyllotaxis.kind === 'distichous' ? phyllotaxis.flatten : 0;
	/** A two-ranked shoot keeps its laterals in the plane of its leaf ranks. */
	const twoRanked = phyllotaxis.kind === 'distichous';
	// A leaf's upper face looks toward the shoot's tip, turned toward the sky side by the species'
	// share. A rosette names its own share, which squares the lamina across the shoot.
	const leafRotation = (
		direction: Vector3,
		stem: Vector3,
		sky: Vector3,
		radial: Vector3,
		skyShare?: number,
	): number[] =>
		leafTurn(
			direction,
			stem,
			sky,
			radial,
			skyShare ?? Math.min(1, skyTurn + flatten * (1 - skyTurn)),
		);
	const [baseRadius, tipRadius] = shootClass.stem?.radius ?? shoots.stem.radius;
	// Degrees a lateral of this class leans from its parent.
	const leanAngle = shootClass.lateral ?? LATERAL_ANGLE;
	// Side shoots at each joint, where the class names them, and the share of a unit between them.
	const jointCount = shootClass.laterals;
	const jointGap = Math.min(LATERAL_GAP_MOST, Math.max(0, shootClass.lateralGap ?? 0));
	// The most degrees a side shoot may leave at from the shoot's own line, where the class names it.
	const lateralMost = shootClass.lateralMost;
	// The straight pieces a long internode breaks into, where the class names them.
	const bend = shootClass.bend;
	const bendPiece = Math.max(BEND_PIECE_LEAST, bend?.length ?? 0);
	const axes: AxisPoint[][] = [];
	const leaves: PlannedLeaf[] = [];
	const buds: PlannedBud[] = [];
	const budLength = shoots.bud.length;
	const budWidth = shoots.bud.width;
	let span = 0;

	const grow = (start: AxisStart): void => {
		const axis = axes.length;
		const points: AxisPoint[] = [{ at: start.at, radius: start.radius, along: start.along }];
		axes.push(points);
		let at: Vector3 = [...start.at];
		let direction: Vector3 = [...start.direction];
		let sky = square(start.sky, direction, [0, 0, 1]);
		let along = start.along;
		let node = 0;
		const azimuthStart = shootClass.azimuth ?? draw(Purpose.Start, axis) * 360;
		const axisLength = start.unitLength * start.units;
		// A plate run holds one face; it starts at the run's first crowded node and ends when the
		// internodes open out again. A new growth unit starts a new run.
		const plated = shoots.placement.plate === true;
		let plateFace: Vector3 | undefined;
		let zig = 1;
		// Side shoots this axis has put out so far.
		let placed = 0;
		for (let unit = 0; unit < start.units; unit++) {
			const length = start.unitLength * (0.85 + 0.3 * draw(Purpose.Unit, axis, unit));
			const newest = unit === start.units - 1;
			const leafy = unit >= start.units - leafYears;
			plateFace = undefined;
			const nodes = unitNodes(record, shootClass, length, draw(Purpose.Nodes, axis, unit));
			// The unit's start and each of its nodes, along which its joint's side shoots may leave.
			const unitStart: StemFrame = {
				at: [...at],
				direction: [...direction],
				sky: [...sky],
				along,
				radius: (points[points.length - 1] as AxisPoint).radius,
			};
			const frames: StemFrame[] = [];
			// Internodes by the class's curve along the unit, scaled to the unit's length.
			const weights: number[] = [];
			let weightSum = 0;
			for (let k = 0; k < nodes; k++) {
				const w = Math.max(0.02, curveAt(shootClass.internode, (k + 0.5) / nodes));
				weights.push(w);
				weightSum += w;
			}
			for (let k = 0; k < nodes; k++) {
				const step = (length * (weights[k] as number)) / weightSum;
				// How crowded the node stands: 0 at an even spacing, toward 1 where internodes shrink (a tip rosette).
				const crowded = 1 - Math.min(1, step / (length / nodes));
				// Zigzag in the shoot's own plane at each node, droop toward the ground side, a small wander.
				direction = turn(direction, sky, zig * shoots.stem.zigzag);
				zig = -zig;
				const side = normalize3(cross3(direction, sky, [0, 0, 0]));
				direction = turn(direction, side, (shootClass.droop * step) / Math.max(total, 1e-6));
				direction = turn(direction, sky, (draw(Purpose.Wander, axis, node) - 0.5) * 6);
				normalize3(direction);
				sky = square(sky, direction, [0, 0, 1]);
				if (plated) {
					if (crowded >= PLATE_CROWDED) plateFace ??= [...sky];
					else plateFace = undefined;
				}
				// A long internode breaks into an even number of straight pieces that turn back and forth
				// about its line, by half the bend each way, so it ends on its line and the next node keeps
				// its frame.
				const whole = bend ? Math.floor(step / bendPiece) : 1;
				const pieces = whole >= 2 ? whole - (whole % 2) : 1;
				let radius = 0;
				for (let p = 0; p < pieces; p++) {
					const run =
						pieces > 1
							? turn(direction, sky, ((p % 2 === 0 ? 1 : -1) * (bend?.angle ?? 0)) / 2)
							: direction;
					at = [
						at[0] + run[0] * (step / pieces),
						at[1] + run[1] * (step / pieces),
						at[2] + run[2] * (step / pieces),
					];
					along += step / pieces;
					const share = Math.min(1, (along - start.along) / Math.max(axisLength, 1e-6));
					radius = start.radius + (tipRadius - start.radius) * share;
					points.push({ at: [...at], radius, along });
					frames.push({ at: [...at], direction: [...run], sky: [...sky], along, radius });
				}
				span = Math.max(span, along);
				const t = nodes === 1 ? 1 : k / (nodes - 1);
				if (leafy && leafMeshes > 0)
					placeLeaves(
						axis,
						node,
						at,
						direction,
						sky,
						radius,
						along,
						t,
						azimuthStart,
						crowded,
						plateFace,
					);
				node++;
			}
			points[points.length - 1] = { ...(points[points.length - 1] as AxisPoint), unitEnd: true };
			// The end of a unit: the newest ends in its bud cluster; an older one in last year's
			// cluster, from which this year's laterals grew.
			if (newest) addCluster(at, direction, sky, along);
			else if (start.order + 1 < shoots.orders) {
				const pick = draw(Purpose.Laterals, axis, unit);
				const count =
					jointCount !== undefined
						? Math.max(0, Math.min(SIDE_SHOOTS_MOST, Math.round(spreadAt(jointCount, pick))))
						: Math.max(
								1,
								Math.min(
									SIDE_SHOOTS_MOST,
									Math.round(shoots.bud.tipCluster * 0.45 * (0.6 + 0.8 * pick)),
								),
							);
				for (let k = 0; k < count; k++) {
					// A class that names its count numbers its side shoots along the whole axis, each with
					// draws of its own, so a joint's shoot turns on from the last joint's and the shoots
					// alternate along the stem. Otherwise every joint fans from the same azimuth.
					const n = jointCount !== undefined ? placed++ : k;
					const [turnDraw, leanDraw, lengthDraw] =
						jointCount !== undefined
							? [
									draw(Purpose.Joint, axis, n * 3),
									draw(Purpose.Joint, axis, n * 3 + 1),
									draw(Purpose.Joint, axis, n * 3 + 2),
								]
							: [
									draw(Purpose.LateralTurn, axis, k),
									draw(Purpose.LateralTurn, axis, k + 8),
									draw(Purpose.Laterals, axis, k + 16),
								];
					// The first side shoot leaves the joint itself, each further one the gap below the last.
					const from = frameAt(unitStart, frames, along - k * jointGap * (along - unitStart.along));
					// A two-ranked shoot keeps its laterals in the plane of its two leaf ranks, as a
					// flat-sprayed species grows; a spiral shoot turns them by the golden angle.
					const azimuth = twoRanked
						? azimuthStart + 90 + n * 180 + (turnDraw - 0.5) * 6
						: azimuthStart + n * GOLDEN + turnDraw * 40;
					const outward = turn(from.sky, from.direction, azimuth);
					const lean = leanAngle * (0.75 + 0.5 * leanDraw);
					const lateral = normalize3([
						from.direction[0] * cos(radians(lean)) + outward[0] * sin(radians(lean)),
						from.direction[1] * cos(radians(lean)) + outward[1] * sin(radians(lean)),
						from.direction[2] * cos(radians(lean)) + outward[2] * sin(radians(lean)),
					]);
					grow({
						at: [...from.at],
						direction:
							lateralMost === undefined
								? lateral
								: within(lateral, SHOOT_LINE, lateralMost, from.sky),
						sky: from.sky,
						order: start.order + 1,
						// A two-ranked shoot's lateral is one long side shoot in the axis's own plane; a
						// spiral shoot's is a shorter side twig that may branch again.
						units: twoRanked ? 1 : start.units - unit - 1,
						unitLength:
							start.unitLength * (twoRanked ? 2 + 0.4 * lengthDraw : 0.6 + 0.25 * lengthDraw),
						radius: Math.max(tipRadius, from.radius * 0.75),
						along: from.along,
					});
				}
			}
		}
	};

	const leafRule: LeafRule = {
		salt,
		key: 0x5400 + index,
		phyllotaxis,
		leafAngle: shootClass.leafAngle,
		leafAngleSpread: shootClass.leafAngleSpread ?? 0,
		leafAzimuthSpread: shootClass.leafAzimuthSpread ?? 0,
		needleAngle,
		ranks,
		leafScale: shootClass.leafScale,
		leafSpread,
		leafMean,
		leafLength,
		leafMeshes,
		budLength,
		budWidth,
		rotate: leafRotation,
	};
	/** The leaves of one node, each with its axillary bud. */
	const placeLeaves = (
		axis: number,
		node: number,
		at: Vector3,
		stem: Vector3,
		sky: Vector3,
		radius: number,
		along: number,
		t: number,
		azimuthStart: number,
		crowded: number,
		plateFace?: Vector3,
	): void =>
		placeNodeLeaves(
			leafRule,
			leaves,
			buds,
			axis,
			node,
			at,
			stem,
			sky,
			radius,
			along,
			t,
			azimuthStart,
			crowded,
			plateFace,
		);

	/** The bud cluster at an axis's tip. */
	const addCluster = (at: Vector3, direction: Vector3, sky: Vector3, along: number): void =>
		addBudCluster(buds, shoots.bud, tipRadius, at, direction, sky, along);

	const units = years;
	grow({
		at: [0, 0, 0],
		direction: [...SHOOT_LINE],
		sky: [0, 0, 1],
		order: 0,
		units,
		unitLength: total / units,
		radius: baseRadius,
		along: 0,
	});
	if (foliage.kind === 'blade')
		openMosaic(leaves, skyTurn, leafLength, shoots.placement.rosette !== 'fan', leafRotation);
	let reach = 0;
	for (const points of axes)
		for (const point of points)
			reach = Math.max(reach, length3(point.at[0], point.at[1], point.at[2]));
	return { axes, leaves, buds, reach, span: Math.max(span, 1e-6) };
}

/** The longest run between two rings of a cut that names a turn, in metres. */
const RING_RUN_MOST = 0.08;

/** Whether the run from `from` to `at` meets the run from `at` to `to` at `degrees` or more. */
function turnsPast(
	from: Readonly<Vector3>,
	at: Readonly<Vector3>,
	to: Readonly<Vector3>,
	degrees: number,
): boolean {
	const ax = at[0] - from[0];
	const ay = at[1] - from[1];
	const az = at[2] - from[2];
	const bx = to[0] - at[0];
	const by = to[1] - at[1];
	const bz = to[2] - at[2];
	const lengths = length3(ax, ay, az) * length3(bx, by, bz);
	if (lengths <= 0) return false;
	return (ax * bx + ay * by + az * bz) / lengths <= cos(radians(degrees));
}

/** The bend weight byte of a point along the shoot. */
function bendByte(along: number, span: number): number {
	return Math.min(255, Math.max(0, Math.round((along / span) * 255)));
}

/** Metres between the rings of a stem run that its leaves hide. */
const HIDDEN_RING_GAP = 0.04;

/**
 * The runs of each axis that its leaves hide, as metres along the shoot from and to: where one leaf
 * stands within two of the stem's radii of the next, the leaves close round the stem between them.
 */
function hiddenRuns(plan: ShootPlan): (readonly [number, number])[][] {
	const alongs: number[][] = plan.axes.map(() => []);
	for (const leaf of plan.leaves) alongs[leaf.axis]?.push(leaf.along);
	return plan.axes.map((points, axis) => {
		const runs: [number, number][] = [];
		const leaves = (alongs[axis] as number[]).sort((a, b) => a - b);
		let k = 0;
		for (let i = 1; i < leaves.length; i++) {
			const from = leaves[i - 1] as number;
			const to = leaves[i] as number;
			while (k < points.length - 1 && (points[k + 1] as AxisPoint).along <= from) k++;
			if (to - from > 2 * ((points[k] as AxisPoint | undefined)?.radius ?? 0)) continue;
			const last = runs[runs.length - 1];
			if (last && last[1] >= from) last[1] = to;
			else runs.push([from, to]);
		}
		return runs;
	});
}

/** A plan's dense runs of leaves, each in its own frame, with the run's leaves by index into the plan. */
export interface PlannedBrush extends Omit<BrushRun, 'picture'> {
	/** The run's axis: 0 for the piece's own stem, and its side stems after it. */
	readonly axis: number;
	readonly leaves: readonly number[];
}

/**
 * The dense runs of a plan's leaves, each with its frame. A run starts where its first leaf stands
 * on its stem and ends at its last, runs along the straight way between them, and faces the mean
 * sky of its leaves.
 *
 * @param plan The plan.
 * @returns The runs, axis by axis.
 */
export function plannedBrushes(plan: ShootPlan): PlannedBrush[] {
	const runs = hiddenRuns(plan);
	const out: PlannedBrush[] = [];
	plan.axes.forEach((points, axis) => {
		/** The stem's point `along` metres from the attach point. */
		const pointAt = (along: number): Vector3 => {
			for (let k = 1; k < points.length; k++) {
				const a = points[k - 1] as AxisPoint;
				const b = points[k] as AxisPoint;
				if (along > b.along && k < points.length - 1) continue;
				const t = Math.max(0, Math.min(1, (along - a.along) / Math.max(1e-9, b.along - a.along)));
				return [
					a.at[0] + (b.at[0] - a.at[0]) * t,
					a.at[1] + (b.at[1] - a.at[1]) * t,
					a.at[2] + (b.at[2] - a.at[2]) * t,
				];
			}
			const only = points[0] as AxisPoint;
			return [only.at[0], only.at[1], only.at[2]];
		};
		for (const [from, to] of runs[axis] ?? []) {
			const leaves: number[] = [];
			plan.leaves.forEach((leaf, i) => {
				if (leaf.axis === axis && leaf.along >= from - 1e-9 && leaf.along <= to + 1e-9)
					leaves.push(i);
			});
			if (leaves.length === 0) continue;
			const start = pointAt(from);
			const end = pointAt(to);
			const length = length3(end[0] - start[0], end[1] - start[1], end[2] - start[2]);
			if (length < 1e-6) continue;
			const along = normalize3([end[0] - start[0], end[1] - start[1], end[2] - start[2]]);
			const mean: Vector3 = [0, 0, 0];
			for (const i of leaves) {
				const sky = (plan.leaves[i] as PlannedLeaf).sky;
				mean[0] += sky[0];
				mean[1] += sky[1];
				mean[2] += sky[2];
			}
			const lean = mean[0] * along[0] + mean[1] * along[1] + mean[2] * along[2];
			let sky: Vector3 = [
				mean[0] - along[0] * lean,
				mean[1] - along[1] * lean,
				mean[2] - along[2] * lean,
			];
			if (length3(sky[0], sky[1], sky[2]) < 1e-6) {
				const up: Vector3 = Math.abs(along[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
				const tilt = up[0] * along[0] + up[1] * along[1] + up[2] * along[2];
				sky = [up[0] - along[0] * tilt, up[1] - along[1] * tilt, up[2] - along[2] * tilt];
			}
			sky = normalize3(sky);
			const middle = plan.leaves[leaves[leaves.length >> 1] as number] as PlannedLeaf;
			out.push({
				axis,
				leaves,
				start,
				along,
				sky,
				side: cross3(along, sky, [0, 0, 0]),
				length,
				bend: bendByte((from + to) / 2, plan.span),
				phase: middle.phase,
			});
		}
	});
	return out;
}

/**
 * One run's leaves meshed at a tier and laid in the run's own frame, for the card bake to picture.
 *
 * @param plan The plan the run belongs to.
 * @param brush The run.
 * @param leafMeshes The leaf meshes at the tier.
 * @param detail The tier.
 * @returns The picture.
 */
export function brushPicture(
	plan: ShootPlan,
	brush: PlannedBrush,
	leafMeshes: readonly PrototypeArrays[],
	detail: Detail,
): BrushPicture {
	const leaves = brush.leaves.map((i) => plan.leaves[i] as PlannedLeaf);
	const mesh = meshShoot(
		{ ...plan, axes: [], buds: [], leaves },
		leafMeshes,
		detail,
	).finishPrototype();
	const positions = new Float32Array(mesh.positions.length);
	const normals = new Float32Array(mesh.normals.length);
	const { start, along, sky, side } = brush;
	for (let i = 0; i < mesh.positions.length; i += 3) {
		const x = (mesh.positions[i] as number) - start[0];
		const y = (mesh.positions[i + 1] as number) - start[1];
		const z = (mesh.positions[i + 2] as number) - start[2];
		positions[i] = x * side[0] + y * side[1] + z * side[2];
		positions[i + 1] = x * along[0] + y * along[1] + z * along[2];
		positions[i + 2] = x * sky[0] + y * sky[1] + z * sky[2];
		const nx = mesh.normals[i] as number;
		const ny = mesh.normals[i + 1] as number;
		const nz = mesh.normals[i + 2] as number;
		normals[i] = nx * side[0] + ny * side[1] + nz * side[2];
		normals[i + 1] = nx * along[0] + ny * along[1] + nz * along[2];
		normals[i + 2] = nx * sky[0] + ny * sky[1] + nz * sky[2];
	}
	return { mesh: { ...mesh, positions, normals }, length: brush.length };
}

/**
 * Meshes a prototype's plan at one tier, every vertex unoccluded.
 *
 * @param plan The plan.
 * @param leafMeshes The leaf meshes at this tier.
 * @param detail The tier.
 * @param cut How the tier meshes the wood and buds; the crown's own cut by default.
 * @returns The mesh.
 * @category api/vegetation
 */
export function meshShoot(
	plan: ShootPlan,
	leafMeshes: readonly PrototypeArrays[],
	detail: Detail,
	cut: ShootCut = SHOOT_CUTS[detail],
): MeshWriter {
	const mesh = new MeshWriter();
	const sides = cut.stemSides;
	// A regular polygon on a radius is, averaged over a turn, as wide as a circle that much smaller.
	const widen = cut.meanWidth ? PI / (sides * sin(PI / sides)) : 1;
	const hidden = cut.thinHidden ? hiddenRuns(plan) : undefined;
	plan.axes.forEach((points, axis) => {
		const runs = hidden?.[axis] ?? [];
		/** Whether the stem between two places along the shoot lies inside one hidden run. */
		const covered = (from: number, to: number): boolean =>
			runs.some(([start, end]) => from >= start && to <= end);
		// Rings no closer than twice the stem's radius, and far apart where leaves hide the stem. A cut
		// of year rings keeps one at each year's end, and a cut that names a turn keeps one only where
		// the stem bends that far from its last ring, or where the run from it grows long enough that
		// wind would bend the stem between two rings.
		const path: TubePoint[] = [];
		for (let k = 0; k < points.length; k++) {
			const point = points[k] as AxisPoint;
			const last = path[path.length - 1];
			const end = k === points.length - 1;
			if (last && !end) {
				const gap = point.along - last.along;
				const least = covered(last.along, point.along)
					? Math.max(HIDDEN_RING_GAP, point.radius * 2)
					: point.radius * 2;
				if (gap < least || (cut.yearRings && !point.unitEnd)) continue;
				if (
					cut.ringTurn !== undefined &&
					gap < RING_RUN_MOST &&
					!turnsPast(last.at, point.at, (points[k + 1] as AxisPoint).at, cut.ringTurn)
				)
					continue;
			}
			path.push(widen === 1 ? point : { ...point, radius: point.radius * widen });
		}
		mesh.mark();
		tube(
			mesh,
			path,
			sides,
			(ring) => [bendByte((path[ring] as TubePoint).along, plan.span), 0, SURFACE_STEM, 255],
			false,
			undefined,
			// The stem's radius in the wood's own units, so the shader can widen a stem thinner than
			// the least drawn width, as it widens the wood.
			(_ring, radius) => [Math.min(1, radius / WOOD_RADIUS_RANGE), 0],
		);
	});
	for (const bud of plan.buds) {
		const shape =
			bud.mark === 'thorn'
				? (cut.thorn ?? cut.axil)
				: bud.mark === 'body'
					? (cut.body ?? cut.cluster)
					: bud.cluster
						? cut.cluster
						: cut.axil;
		mesh.mark();
		if (!shape) continue;
		if (!bud.cluster && !bud.mark && bud.length < (cut.axilLeast ?? 0)) continue;
		if (bud.cluster && cut.clusterCone) {
			// The whole cluster as one cone over its stack, drawn on its tip bud's part.
			if (bud.stack === undefined) continue;
			const foot = bud.stack - bud.length;
			lathe(
				mesh,
				[
					[bud.width, 0],
					[bud.width, bud.stack * 0.55],
					[0, bud.stack],
				],
				[
					bud.at[0] - bud.direction[0] * foot,
					bud.at[1] - bud.direction[1] * foot,
					bud.at[2] - bud.direction[2] * foot,
				],
				bud.direction,
				shape.sides,
				[bendByte(bud.along, plan.span), 0, SURFACE_BUD, 255],
			);
			continue;
		}
		const w = bud.width / 2;
		const l = bud.length;
		const profile: [number, number][] = shape.round
			? [
					[w * 0.6, 0],
					[w, l * 0.35],
					[w * 0.7, l * 0.72],
					[0, l],
				]
			: [
					[w * 0.5, 0],
					[w, l * 0.4],
					[0, l],
				];
		lathe(mesh, profile, bud.at, bud.direction, shape.sides, [
			bendByte(bud.along, plan.span),
			0,
			SURFACE_BUD,
			255,
		]);
	}
	for (const leaf of plan.leaves) {
		const source = leafMeshes[leaf.mesh];
		mesh.mark();
		if (!source) continue;
		const bend = bendByte(leaf.along, plan.span);
		mesh.append(
			source,
			(p, n) => {
				p[0] *= leaf.scale;
				p[1] *= leaf.scale;
				p[2] *= leaf.scale;
				quatRotate(leaf.rotation, 0, p, p);
				p[0] += leaf.at[0];
				p[1] += leaf.at[1];
				p[2] += leaf.at[2];
				quatRotate(leaf.rotation, 0, n, n);
			},
			(bytes) => {
				bytes[0] = bend;
				bytes[1] = leaf.phase;
			},
			(uv1) => {
				uv1[0] = (uv1[0] as number) * leaf.scale;
				uv1[1] = (uv1[1] as number) * leaf.scale;
			},
		);
	}
	return mesh;
}

/**
 * A plan meshed at every tier and shaded, with its reach and its bounding radius measured.
 *
 * @param plan The plan.
 * @param leaves The species' leaf meshes at every tier, low first.
 * @param cuts How each tier meshes the wood and buds; the crown's own cuts by default.
 * @returns The meshes and the measures.
 */
export function meshedPlan(
	plan: ShootPlan,
	leaves: readonly (readonly PrototypeArrays[])[],
	cuts: Readonly<Record<Detail, ShootCut>> = SHOOT_CUTS,
): Pick<UncardedPrototype, 'length' | 'radius' | 'leaves' | 'tiers'> {
	const writers = DETAILS.map((detail, tier) =>
		meshShoot(plan, leaves[tier] ?? [], detail, cuts[detail]),
	);
	shootOcclusion(writers, SHADE_TIER);
	const tiers = writers.map((writer) =>
		writer.finishPrototype(),
	) as unknown as UncardedPrototype['tiers'];
	let radius = 0;
	const positions = (tiers[DETAILS.indexOf('high')] as PrototypeArrays).positions;
	for (let i = 0; i < positions.length; i += 3)
		radius = Math.max(
			radius,
			length3(positions[i] as number, positions[i + 1] as number, positions[i + 2] as number),
		);
	return { length: plan.reach, radius, leaves: plan.leaves.length, tiers };
}

/** One prototype from a plan: its tiers meshed and shaded, its reach and bounds measured. */
function prototypeOf(
	plan: ShootPlan,
	leaves: readonly (readonly PrototypeArrays[])[],
	index: number,
	shootClass: ShootClass,
	cutting = false,
): UncardedPrototype {
	// A class of cards draws its leaves alone, each as the low tier's cut-out card at every tier.
	const cards = shootClass.cards === true;
	const drawn = cards ? { ...plan, axes: [], buds: [] } : plan;
	const meshes = cards ? leaves.map(() => leaves[0] ?? []) : leaves;
	return {
		index,
		class: shootClass.name,
		...(cutting ? { cutting: true as const } : {}),
		vigor: shootClass.vigor,
		...meshedPlan(drawn, meshes),
	};
}

/**
 * Grows a species' shoot prototypes, each at every detail tier, from its leaf meshes. A deciduous
 * species' kit holds the record's prototypes, then a leafless twin of each in the same order (its
 * `leaves` is 0), which rows draw where the season leaves the shoot bare.
 *
 * @param record The species record.
 * @param manifest The texture manifest.
 * @param leaves The species' leaf meshes at every tier, low first.
 * @param cutting Build only the classes a cut piece draws, which the crown's kit then leaves out.
 * @returns The prototypes.
 */
export function shootPrototypes(
	record: Species,
	manifest: TextureManifest,
	leaves: readonly (readonly PrototypeArrays[])[],
	cutting = false,
): UncardedPrototype[] {
	void manifest;
	const shoots = record.shoots;
	if (!shoots) return [];
	const leafMeshes = Math.min(...leaves.map((tier) => tier.length));
	const plans = Array.from({ length: shoots.prototypes }, (_, index) =>
		planShoot(record, index, leafMeshes),
	);
	const classes = plans.map((_, index) => classOf(shoots.classes, index, shoots.prototypes));
	// A cutting's kit holds only the classes a cut piece draws, so the plant's own prototypes stay
	// out of it: a kit carrying both roughly doubles, and the cap it must fit is the cut piece's own.
	const out = cutting
		? []
		: plans.map((plan, index) =>
				prototypeOf(
					leafMeshes > 0 ? plan : { ...plan, leaves: [] },
					leaves,
					index,
					classes[index] as ShootClass,
				),
			);
	if (!cutting && leafMeshes > 0 && hasBareTwins(record))
		for (const [index, plan] of plans.entries())
			out.push(
				prototypeOf({ ...plan, leaves: [] }, leaves, out.length, classes[index] as ShootClass),
			);
	// A cutting class is planned last and marked as a cutting's, so the crown never offers one however
	// its variants fall. It keeps a leafless twin beside it where the species has them, so a winter
	// cutting of it still finds a piece. A kit of a kind holds only the classes of its kind: the
	// plant's kit the crown's and the cutting classes both are drawn from, the cutting kit the classes
	// that only a cut piece draws. Each prototype's seed is its place in this list, so the classes
	// after a new one are redrawn: a new class belongs after every existing class.
	for (const shootClass of (shoots.cuttingClasses ?? []).filter(
		(shoot) => (shoot.cutOnly === true) === cutting,
	))
		for (let k = 0; k < CUTTING_PROTOTYPES; k++) {
			const plan = planShoot(record, out.length, leafMeshes, shootClass);
			out.push(
				prototypeOf(
					leafMeshes > 0 ? plan : { ...plan, leaves: [] },
					leaves,
					out.length,
					shootClass,
					true,
				),
			);
			if (leafMeshes > 0 && hasBareTwins(record))
				out.push(prototypeOf({ ...plan, leaves: [] }, leaves, out.length, shootClass, true));
		}
	return out;
}
