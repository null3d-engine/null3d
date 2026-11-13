// The branch pieces: what a plant's sockets carry. A piece is a shoot plan of several orders, laid
// out by a measured rule instead of grown year by year: a stem of a stated length and curve, leaves
// at a stated spacing along it, and side stems at a stated spacing, angle and arrangement, each a
// stem of the same kind. The rule's numbers are read from the species' cut-branch photographs.
//
// A piece is planned in its own rest frame and is turned when it is placed. Its attach point is the
// origin, its line is +Y and +Z is its sky side. A hanging piece's line is the way it hangs, so its
// ground side is +Y; every other piece's ground side is -Z.
//
// The plan is a shoot plan, so the shoot mesher draws it at every tier and the same vertex limit
// holds. Each stem ends in the species' bud or in a leaf, so no stem of a piece ends bare.
import type { PrototypeArrays } from '../asset';
import { unitAt } from '../core/hash';
import {
	acos,
	cos,
	cross3,
	length3,
	normalize3,
	PI,
	quatFromFrame,
	quatRotate,
	radians,
	sin,
	type Vector3,
} from '../core/math';
import type { LeafShape, Phyllotaxis, Species } from '../core/record';
import {
	type Curve,
	curveAt,
	DETAILS,
	type Detail,
	type Spread,
	spreadAt,
	spreadMean,
	type Vec3,
} from '../core/types';
import {
	type AxisPoint,
	addBudCluster,
	type BrushPicture,
	brushPicture,
	type LeafRule,
	leafTurn,
	meshedPlan,
	meshShoot,
	type PlannedBrush,
	type PlannedBud,
	type PlannedLeaf,
	placeNodeLeaves,
	plannedBrushes,
	SHOOT_CUTS,
	type ShootCut,
	type ShootPlan,
	square,
	turn,
	type UncardedPrototype,
} from './shoot';

/**
 * How each tier meshes a piece's wood and buds. A tree carries thousands of pieces, so a piece's
 * wood has the fewest sides a twig needs, three, widened to the round stem's mean width, with a ring
 * only where the stem bends: 8 degrees at the high tier and 15 at the medium. Where a piece's leaves
 * close round its stem, at every tier, no ring of the wood they hide shows, so its rings stand far
 * apart. An axil's bud hides under its leaf, so the medium tier draws none and the high tier only
 * one long enough to show, as the beech's long buds are. The tip clusters, which mark a species, are
 * separate three-sided buds at the high tier and one cone at the medium. Thorns are three-sided at
 * both, and a fruiting body is round at the high tier. The ultra tier keeps the crown's finest cut.
 */
export const PIECE_CUTS: Readonly<Record<Detail, ShootCut>> = {
	low: { ...SHOOT_CUTS.low, thinHidden: true },
	medium: {
		stemSides: 3,
		thinHidden: true,
		meanWidth: true,
		ringTurn: 15,
		cluster: { sides: 3, round: false },
		clusterCone: true,
		thorn: { sides: 3, round: false },
	},
	high: {
		stemSides: 3,
		thinHidden: true,
		meanWidth: true,
		ringTurn: 8,
		cluster: { sides: 3, round: false },
		axil: { sides: 3, round: false },
		axilLeast: 0.015,
		thorn: { sides: 3, round: false },
		body: { sides: 4, round: true },
	},
	ultra: { ...SHOOT_CUTS.ultra, thinHidden: true },
};

/**
 * How a piece is turned where a socket carries it: along the socket's own direction, hanging plumb,
 * standing upright, with its plane level, or with its tip turned up. A hanging piece's ground side
 * is the way its line runs and an upright piece's is the way back along its line, so their stems
 * droop in the piece's own length; every other piece's ground side is opposite its sky side.
 *
 * @category api/vegetation
 */
export type PieceAttitude = 'along' | 'plumb' | 'upright' | 'level' | 'up';

/**
 * The leaves along one stem of a piece.
 *
 * @category api/vegetation
 */
export interface PieceLeaves {
	/** Metres between one node and the next. */
	readonly gap: number;
	/** The share of the stem's length below which no leaf stands. */
	readonly from?: number;
	/** The share of the stem's length above which no leaf stands; its tip where absent. */
	readonly to?: number;
	/** The leaf arrangement; the species' own where absent. */
	readonly phyllotaxis?: Phyllotaxis;
	/**
	 * Degrees round the stem at which its first leaf stands, counted from the stem's side in the
	 * piece's own plane toward its sky side: at 0 an opposite pair lies in that plane, at 90 it points
	 * to the sky side and away from it. A drawn place where absent.
	 */
	readonly heading?: number;
	/** Degrees a leaf stands from the stem, foot to tip. */
	readonly angle: Curve;
	/** The half-width of an even spread on that angle, in degrees. */
	readonly angleSpread?: number;
	/** A leaf's size over the species' own leaf, foot to tip. */
	readonly scale?: Curve;
	/** The share a leaf's upper face turns toward the sky side; the species' own where absent. */
	readonly skyward?: number;
	/**
	 * The share by which a leaf hangs: 0 leaves it at its angle from the stem, 1 turns it straight
	 * toward the ground side, whichever way its stem runs. A leaf on a long stalk hangs this way.
	 */
	readonly hang?: number;
	/**
	 * How a blade is rolled about its own midrib: degrees from facing its stem, and the half-width
	 * of an even spread on them. A hanging leaf faces away from its twig, at 180. Where this or
	 * `hang` is named, the leaf takes no turn toward the sky side.
	 */
	readonly face?: {
		readonly turn: number;
		readonly spread: number;
		/**
		 * Whether the blade lies in the piece's own plane, so that it shows its whole face from the
		 * side the piece is wide to: a hanging piece's flank, to one side or the other, and any other
		 * piece's sky side. The turn and its spread then count from that plane, the turn to one side
		 * or the other. A hanging strand's leaves lie this way: the strand is flat.
		 */
		readonly inPlane?: boolean;
	};
	/**
	 * The share by which a leaf is laid into the piece's own plane: at 1 its midrib lies in that
	 * plane and its blade faces out of it. A hanging piece's plane holds its line and its sky side,
	 * the plane its hook turns in; any other piece's plane faces its sky side. The share is set from
	 * the depth the species' turning video shows, never from one face-on view.
	 */
	readonly flat?: number;
	/**
	 * Leaves in two ranks along the stem's two sides, as a frond's leaflets or pinnae stand: every
	 * node holds one group a side, a leaf at each lift, in degrees out of the plane of the two sides
	 * toward the sky side (below 0 away from it). A frond whose pinnae lie in its plane names one
	 * lift of 0; a date palm's leaflets leave in threes at -30, 0 and 30. At most four lifts. Where
	 * this is named, the arrangement's own places round the stem are not used.
	 */
	readonly ranked?: readonly number[];
	/**
	 * A flat rosette: the stem's leaves fan out in the plane that faces the piece's sky side, spread
	 * evenly to `reach` degrees either side of the stem, the lowest leaf the widest, and each blade
	 * faces the sky side within `tilt` degrees. Each leaf also rises or falls out of that plane by up
	 * to `cone` degrees, so the rosette has depth. An oak's end tuft stands this way.
	 */
	readonly fan?: { readonly reach: number; readonly tilt: number; readonly cone?: number };
}

/**
 * The side stems along one stem of a piece.
 *
 * @category api/vegetation
 */
export interface PieceSides {
	/** The side stem's own rule. */
	readonly stem: PieceStem;
	/** Metres along the parent between one side stem, or one pair, and the next. */
	readonly gap: number;
	/** The share of the parent's length below which no side stem leaves. */
	readonly from?: number;
	/** The share of the parent's length past which no side stem leaves. */
	readonly to?: number;
	/**
	 * Where each side stem stands round its parent: `alternate` to one side and the other in turn, in
	 * the parent's own plane; `paired` in pairs that lie in that plane; `opposite` in pairs, each
	 * pair a quarter turn from the last; `spiral` by the golden angle.
	 */
	readonly arrangement: 'alternate' | 'paired' | 'opposite' | 'spiral';
	/** Degrees a side stem leaves at from its parent. */
	readonly angle: Spread;
	/** A side stem's length over its rule's, by its place along the parent, foot to tip. */
	readonly lengthAlong?: Curve;
	/**
	 * Degrees an `alternate` side stem stands out of its parent's plane: one pair toward the sky
	 * side, the next pair away from it. It gives a flattened fan its measured depth.
	 */
	readonly out?: number;
	/** Degrees added to every side stem's place round the parent; 180 starts on the other side. */
	readonly turn?: number;
	/**
	 * Degrees either side of its arrangement's own place within which a side stem stands round its
	 * parent; the piece's own depth where absent.
	 */
	readonly spread?: number;
}

/**
 * One stem of a piece.
 *
 * @category api/vegetation
 */
export interface PieceStem {
	/** Metres from its foot to its tip. */
	readonly length: Spread;
	/** Its radius in metres at its foot and at its tip. */
	readonly radius: readonly [foot: number, tip: number];
	/**
	 * A hook at its foot: degrees it starts off its line, toward the sky side, the metres it runs
	 * that way, and the metres over which it then turns onto the line. A hanging twig leaves its
	 * branch this way.
	 */
	readonly hook?: { readonly angle: number; readonly length: number; readonly rise?: number };
	/** Degrees it turns toward the ground side over the stretch `droopOver` names; below 0 it lifts. */
	readonly droop?: number;
	/** The shares of its length between which it droops; its whole length where absent. */
	readonly droopOver?: readonly [from: number, to: number];
	/**
	 * Degrees it turns away from the piece's own line over its length, in the plane it shares with
	 * that line; below 0 it turns toward the line. A limb that leaves steeply and levels out arcs
	 * this way.
	 */
	readonly arc?: number;
	/** Degrees it turns at each node, to one side and the other in turn. */
	readonly zigzag?: number;
	/**
	 * Bends along it: the metres between one and the next, and the degrees it turns at each, to one
	 * side and the other in turn. Each bend is taken over a few short runs, so the stem curves
	 * through it and shows no corner.
	 */
	readonly kink?: { readonly length: number; readonly angle: number };
	/**
	 * The most degrees the stem turns between two of its rings, at every tier: a ring stands at its
	 * ends and wherever it has turned this far since the last. A long arched stem, such as a palm
	 * frond's rachis, keeps its arch at the low tier, which otherwise draws its foot and its tip
	 * alone, and a long thin straight one, such as a fern's pinna midrib, keeps a few rings at every
	 * tier rather than one at each of its nodes. Absent, each tier keeps the rings its own spacing
	 * gives.
	 */
	readonly rings?: number;
	/** Its leaves, where it carries any. */
	readonly leaves?: PieceLeaves;
	/** Its side stems, one rule for each kind. */
	readonly sides?: readonly PieceSides[];
	/** Whether it ends in the species' bud; it does where this is absent. */
	readonly bud?: boolean;
	/** The thorns, fruits, cones or catkins that stand along it. */
	readonly marks?: readonly PieceMark[];
}

/**
 * A species' mark along a stem: a thorn that stands off the wood, or a body, such as a fruit, a
 * cone or a catkin, that hangs from it on a stalk. It is part of the piece's own mesh, so the piece
 * carries it wherever a socket holds it. Its length and width are the mark's real size in metres,
 * as the species' bud is; its gap and stalk are lengths of the rule.
 *
 * @category api/vegetation
 */
export interface PieceMark {
	/** A thorn that stands off the wood, or a body that hangs on a stalk. */
	readonly kind: 'thorn' | 'body';
	/** Metres along the stem between one place for a mark and the next. */
	readonly gap: number;
	/** The share of the stem's length where the marks begin. */
	readonly from?: number;
	/** The share of the stem's length where the marks end. */
	readonly to?: number;
	/** The share of those places that carry one. */
	readonly share: number;
	/** Its length in metres. */
	readonly length: Spread;
	/** Its width across, in metres. */
	readonly width: number;
	/** Degrees a thorn stands from its stem. */
	readonly angle?: number;
	/** Metres of stalk a body hangs on. */
	readonly stalk?: number;
	/** Bodies at one place, each on a stalk of its own. */
	readonly count?: Spread;
}

/**
 * One kind of piece of a species.
 *
 * @category api/vegetation
 */
export interface PieceRule {
	/** The piece's name, unique in its species. */
	readonly name: string;
	/** How a socket turns it. */
	readonly attitude: PieceAttitude;
	/** How many variants the kit holds, each with its own draws. */
	readonly variants: number;
	/**
	 * The piece's flat plane, where it has one: the unit normal of that plane in the piece's rest
	 * frame. A flattened fan names it, so its far form may be one card in that plane.
	 */
	readonly plane?: Vec3;
	/**
	 * Whether the piece's cards keep only the two planes that run along its line, its face and its
	 * edge. A long narrow piece, such as a frond, seen end on piles all its leaves into one solid
	 * patch, which the plane across its line would draw halfway along it. Absent, its cards keep all
	 * three planes.
	 */
	readonly lengthwise?: boolean;
	/**
	 * The main stem that the low and medium tiers draw in place of `stem`: a coarser plan of the same
	 * piece, such as a fern frond whose pinnae are one leaf each far off where its near tiers draw
	 * each pinnule. It holds the same variant's draws and must split into as many parts. Absent,
	 * every tier draws `stem`.
	 */
	readonly far?: PieceStem;
	/**
	 * Degrees the piece is turned about its own line at every socket, from its sky side up toward its
	 * right. A living fern frond's flat blade stands rolled on the plant, so a frond seen from the
	 * crown's side shows its face rather than its edge. Absent, 0.
	 */
	readonly roll?: number;
	/**
	 * The ground side in the piece's frame, where it is not its attitude's own: a piece that stands
	 * upright on its socket names the way back along its line, so its side stems lift toward its tip.
	 */
	readonly ground?: Vec3;
	/**
	 * The piece's real size over the lengths its rule states. A rule's lengths are read from a
	 * photograph whose caption gives the piece's length, and the leaf is the ruler: where the
	 * photograph's leaf is some share of the species' own, the rule draws its leaves at that share
	 * and names the inverse here, so the piece is built with the species' own leaf and every length
	 * and thickness of its wood grows with it. Buds keep the species' own size.
	 */
	readonly scale?: number;
	/** Its main stem. */
	readonly stem: PieceStem;
	/**
	 * Degrees either side of the piece's plane within which its side stems stand. It sets how deep
	 * the piece is against its width, which the species' turning video of its cut branch measures:
	 * a piece that is a third as deep as it is wide stands its side stems within about 20 degrees.
	 */
	readonly depth?: number;
	/**
	 * How the piece's blades bend at their stalks. Where absent a blade bends out of its own face,
	 * as the species' leaf does. With `plane` the piece's leaves are built with no bend at the stalk,
	 * and each blade turns about its own normal instead, toward the ground side, by the species' own
	 * degrees and no farther than the ground side. A hanging blade then stays in the plane it lies in.
	 */
	readonly leafDroop?: 'plane';
	/**
	 * Whether each dense run of the piece's leaves draws as a brush card below the finest tier:
	 * three crossed quads that carry a picture of a run's own leaves, which the card bake draws into
	 * the card atlas. The finest tier keeps every leaf. Absent, every tier draws its leaves.
	 */
	readonly brushCards?: boolean;
}

/**
 * The leaf a species' pieces wear where it differs from the record's: the record's blade with these
 * fields over it. A species states one while its record's leaf also grows the crown it ships, which
 * keeps its own leaf until a plant built of pieces replaces it.
 */
export interface PieceLeaf extends Partial<Pick<LeafShape, 'length' | 'breadth'>> {
	/** Metres of stalk from the stem to the blade's base. */
	readonly stalk?: number;
}

/**
 * The record a species' pieces are built by: the species' own, its blade taking the pieces' leaf.
 * The pieces' leaf meshes and their plans both read it, so a plan sizes its leaves by the meshes it
 * places.
 *
 * @param record The species record.
 * @param leaf The pieces' leaf, or nothing where the pieces wear the record's.
 * @returns The record to build the pieces by.
 */
export function pieceRecord(record: Species, leaf: PieceLeaf | undefined): Species {
	if (!leaf) return record;
	const foliage = record.foliage;
	if (foliage.kind !== 'blade')
		throw new Error(
			`@null3d/vegetation: '${record.id}' states a leaf for its pieces, and its foliage is '${foliage.kind}', not a blade`,
		);
	if (leaf.breadth !== undefined && !(leaf.breadth > 0 && leaf.breadth <= 2))
		throw new Error(
			`@null3d/vegetation: the pieces' leaf breadth of '${record.id}' is ${leaf.breadth}; it is a share of the outline's width, above 0 and at most 2`,
		);
	if (leaf.stalk !== undefined && !(leaf.stalk > 0))
		throw new Error(
			`@null3d/vegetation: the pieces' leaf stalk of '${record.id}' is ${leaf.stalk}; it is metres and must be above 0`,
		);
	const own = foliage.leaf;
	return {
		...record,
		foliage: {
			...foliage,
			leaf: {
				...own,
				length: leaf.length ?? own.length,
				...(leaf.breadth === undefined ? {} : { breadth: leaf.breadth }),
				petiole: { ...own.petiole, length: leaf.stalk ?? own.petiole.length },
			},
		},
	};
}

/** A piece's prototype: its meshes at every tier, with how a socket holds it. */
export interface PiecePrototype
	extends Pick<UncardedPrototype, 'length' | 'radius' | 'leaves' | 'tiers' | 'brushes'> {
	/** The rule it was planned by, and which of the rule's variants it is. */
	readonly piece: string;
	readonly variant: number;
	readonly attitude: PieceAttitude;
	/**
	 * Which part of its variant this is, and how many parts the variant has. A variant too large for
	 * one prototype is split into parts. A socket carries every part of a variant at one place, with
	 * one turn, one wind record and one phase, so the parts move as one body.
	 */
	readonly part: number;
	readonly parts: number;
	/** The unit normal of the piece's flat plane in its rest frame, where its rule names one. */
	readonly plane?: Vec3;
	/** Whether its cards keep only the planes along its line, where its rule says so. */
	readonly lengthwise?: boolean;
	/** Degrees it is turned about its own line at every socket, where its rule says so. */
	readonly roll?: number;
	/** Where the part may carry an extra, in the piece's rest frame, in rank order. */
	readonly sites: readonly PieceSite[];
}

/**
 * A place on a piece where an extra may stand: a thorn, a fruit, a cone or a catkin. It is given in
 * the piece's rest frame, so a socket's turn and place carry it into the plant with the piece.
 */
export interface PieceSite {
	/** A stem's end, or a node where a leaf stands. */
	readonly kind: 'tip' | 'node';
	readonly at: Vector3;
	/** The stem's run at the site. */
	readonly direction: Vector3;
	/** The way a leaf's stalk leaves the stem at a node; the stem's run at a tip. */
	readonly out: Vector3;
	/** Metres along the piece from its attach point, which the bend weight reads. */
	readonly along: number;
	/**
	 * The site's place in its kind's order, 0 first. A share of a kind's sites taken from the front
	 * of the order is spread evenly along every stem.
	 */
	readonly rank: number;
}

/** The golden angle in degrees. */
const GOLDEN = 137.50776405;
/** The golden ratio's fraction, whose multiples fill a unit range evenly. */
const GOLDEN_SHARE = 0.6180339887;
/** The longest straight run of a stem in metres, so a curve reads as a curve. */
const STEP_MOST = 0.025;
/** The fewest straight runs of a stem. */
const STEPS_LEAST = 6;
/** Degrees either side of its arrangement's place a side stem stands, where no rule names a depth. */
const SIDE_SPREAD = 7;
/** The most degrees a hook turns in one straight run. */
const HOOK_TURN_MOST = 12;
/** The straight runs a bend's turn is spread over, so a stem curves and never kinks. */
const BEND_RUNS = 3;
/** The share of a kink's angle by which it also turns out of the stem's plane. */
const KINK_OUT = 0.4;
/** The radius in metres of the stalk a body hangs on. */
const MARK_STALK = 0.0007;
/** The most stems a plan may hold, which guards a rule that would never end. */
const STEMS_MOST = 4096;
/** The hash key of the first piece, clear of the shoot prototypes' keys. */
const PIECE_KEY = 0x6400;

/** Purposes of the pieces' hash keys, apart from the shoot prototypes'. */
const Purpose = {
	Length: 0x41,
	Start: 0x42,
	SideAngle: 0x43,
	SideTurn: 0x44,
	SideStart: 0x45,
	Roll: 0x46,
	Kink: 0x47,
	Fan: 0x48,
	Mark: 0x49,
	MarkTurn: 0x4a,
	MarkSize: 0x4b,
} as const;

/**
 * The unit `v` turned toward the unit `target` by `degrees`, and no farther than `target` itself.
 * Below 0 it turns away, and no farther than the opposite of `target`.
 */
function toward(v: Readonly<Vector3>, target: Readonly<Vector3>, degrees: number): Vector3 {
	const aim: Readonly<Vector3> = degrees >= 0 ? target : [-target[0], -target[1], -target[2]];
	const along = Math.min(1, Math.max(-1, v[0] * aim[0] + v[1] * aim[1] + v[2] * aim[2]));
	const off = (acos(along) * 180) / PI;
	const step = Math.min(Math.abs(degrees), off);
	if (step < 1e-6) return [...v];
	const axis = cross3(v, aim, [0, 0, 0]);
	// A vector that points straight away from its aim turns about its own sky side.
	if (length3(axis[0], axis[1], axis[2]) < 1e-6) cross3(v, square([0, 0, 1], v, [1, 0, 0]), axis);
	return normalize3(turn(v, normalize3(axis), step));
}

/** What one stem of a plan grows from. */
interface StemStart {
	readonly at: Vector3;
	/** The stem's line, which a hook turns onto. */
	readonly line: Vector3;
	readonly sky: Vector3;
	readonly along: number;
	/** The stem's length over its rule's. */
	readonly scale: number;
}

/**
 * Plans one variant of a piece: its axes, its leaves and its buds.
 *
 * @param record The species record.
 * @param rule The piece's rule.
 * @param key The variant's hash key, unique among the species' pieces.
 * @param leafMeshes The leaf meshes it may place.
 * @param ground The ground side in the piece's frame, for a piece that stands another way than
 * its attitude holds it, as a cut branch in a clamp does.
 * @param lean Degrees the piece's line leans from +Y toward +X, for a cut that leans in its clamp.
 * @returns The plan.
 */
export function planPiece(
	record: Species,
	rule: PieceRule,
	key: number,
	leafMeshes: number,
	ground?: Readonly<Vector3>,
	lean = 0,
): ShootPlan {
	const shoots = record.shoots;
	if (!shoots)
		throw new Error(`@null3d/vegetation: '${record.id}' has no shoots to build pieces of`);
	const foliage = record.foliage;
	if (foliage.kind !== 'blade' && foliage.kind !== 'fascicle' && foliage.kind !== 'needle')
		throw new Error(
			`@null3d/vegetation: '${record.id}' has '${foliage.kind}' foliage; a piece carries blades, needles or needle bundles`,
		);
	const salt = record.seedSalt;
	const draw = (purpose: number, a = 0, b = 0) => unitAt(salt, PIECE_KEY + key, purpose, a, b);
	const down: Readonly<Vector3> =
		ground ??
		rule.ground ??
		(rule.attitude === 'plumb' ? [0, 1, 0] : rule.attitude === 'upright' ? [0, -1, 0] : [0, 0, -1]);
	const leafSpread = foliage.kind === 'blade' ? foliage.leaf.length : foliage.needle.length;
	const leafMean = spreadMean(leafSpread);
	/** The piece's own line. */
	const line: Readonly<Vector3> = [sin(radians(lean)), cos(radians(lean)), 0];
	const axes: AxisPoint[][] = [];
	const leaves: PlannedLeaf[] = [];
	const buds: PlannedBud[] = [];
	let span = 0;

	const leafRule = (stem: PieceStem): LeafRule | undefined => {
		const own = stem.leaves;
		if (!own || leafMeshes <= 0) return undefined;
		const phyllotaxis = own.phyllotaxis ?? shoots.phyllotaxis;
		const skyTurn = Math.min(1, Math.max(0, own.skyward ?? shoots.placement.skyward));
		const flatten = phyllotaxis.kind === 'distichous' ? phyllotaxis.flatten : 0;
		const share = Math.min(1, skyTurn + flatten * (1 - skyTurn));
		// Two ranks: the first side's leaves rise toward the sky side by their lift, and the second
		// side's mirror them, so both sides stand alike.
		const azimuths = own.ranked?.flatMap((lift) => [lift, 180 - lift]);
		return {
			salt,
			key: PIECE_KEY + key,
			phyllotaxis,
			...(azimuths ? { azimuths } : {}),
			leafAngle: own.angle,
			leafAngleSpread: own.angleSpread ?? 0,
			leafAzimuthSpread: 0,
			needleAngle: undefined,
			ranks: 0,
			leafScale: own.scale ?? 1,
			leafSpread,
			leafMean,
			// Only a blade carries a bud in its axil.
			leafLength: foliage.kind === 'blade' ? leafMean : 0,
			leafMeshes,
			budLength: shoots.bud.length,
			budWidth: shoots.bud.width,
			rotate: (direction, stemLine, sky, radial) =>
				leafTurn(direction, stemLine, sky, radial, share),
		};
	};

	/** A leaf turned as it hangs: toward the ground side by its share, and rolled about its midrib. */
	const hung = (leaf: PlannedLeaf, own: PieceLeaves, axis: number, index: number): PlannedLeaf => {
		const share = Math.min(1, Math.max(0, own.hang ?? 0));
		const mixed: Vector3 = [
			leaf.direction[0] * (1 - share) + down[0] * share,
			leaf.direction[1] * (1 - share) + down[1] * share,
			leaf.direction[2] * (1 - share) + down[2] * share,
		];
		const direction =
			length3(mixed[0], mixed[1], mixed[2]) < 1e-6 ? leaf.direction : normalize3(mixed);
		const roll =
			(own.face?.turn ?? 0) + (draw(Purpose.Roll, axis, index) * 2 - 1) * (own.face?.spread ?? 0);
		// A blade in a hanging piece's plane faces the piece's flank, to one side or the other; in
		// any other piece's plane it faces the sky side.
		const flank: Vector3 =
			rule.attitude === 'plumb'
				? [draw(Purpose.Roll, axis, index + 4096) < 0.5 ? 1 : -1, 0, 0]
				: [0, 0, 1];
		// An in-plane blade's own turn rolls it off the plane to one side or the other.
		const side = draw(Purpose.Roll, axis, index + 8192) < 0.5 ? 1 : -1;
		const face = own.face?.inPlane
			? turn(
					square(flank, direction, leaf.radial),
					direction,
					roll + (side - 1) * (own.face?.turn ?? 0),
				)
			: turn(square(leaf.stem, direction, leaf.radial), direction, roll);
		const rotation = [0, 0, 0, 1];
		quatFromFrame(direction, face, rotation);
		return { ...leaf, direction, rotation };
	};

	/** The way out of the piece's own plane: its flank for a hanging piece, else its sky side. */
	const outOfPlane: Readonly<Vector3> = rule.attitude === 'plumb' ? [1, 0, 0] : [0, 0, 1];

	/** The way a leaf's upper face looks. */
	const normalOf = (leaf: PlannedLeaf): Vector3 =>
		quatRotate(leaf.rotation, 0, [0, 0, 1], [0, 0, 0]);

	/**
	 * A leaf turned at its stalk about its own normal, toward the ground side, by the species' stalk
	 * droop and no farther than the ground side as it lies in the blade's plane.
	 */
	const drooped = (leaf: PlannedLeaf): PlannedLeaf => {
		const normal = normalOf(leaf);
		const direction = toward(
			leaf.direction,
			square(down, normal, leaf.direction),
			// Only a blade hangs on a stalk; a needle keeps the line it leaves its twig on.
			foliage.kind === 'blade' ? foliage.leaf.petiole.droop : 0,
		);
		const rotation = [0, 0, 0, 1];
		quatFromFrame(direction, normal, rotation);
		return { ...leaf, direction, rotation };
	};

	/**
	 * A leaf laid into the piece's own plane, by a share. A blade whose rule names its face keeps
	 * that face's roll and only its midrib is laid in.
	 */
	const flattened = (leaf: PlannedLeaf, share: number, keep = false): PlannedLeaf => {
		const s = Math.min(1, Math.max(0, share));
		const d = leaf.direction;
		const out = d[0] * outOfPlane[0] + d[1] * outOfPlane[1] + d[2] * outOfPlane[2];
		const laid: Vector3 = [
			d[0] - outOfPlane[0] * out * s,
			d[1] - outOfPlane[1] * out * s,
			d[2] - outOfPlane[2] * out * s,
		];
		// A leaf that pointed straight out of the plane lies along its stem.
		const direction =
			length3(laid[0], laid[1], laid[2]) < 1e-3
				? square(leaf.stem, outOfPlane, [0, 1, 0])
				: normalize3(laid);
		const before = square(keep ? normalOf(leaf) : leaf.stem, direction, leaf.radial);
		const facing = square(outOfPlane, direction, before);
		const face = keep
			? before
			: normalize3([
					before[0] * (1 - s) + facing[0] * s,
					before[1] * (1 - s) + facing[1] * s,
					before[2] * (1 - s) + facing[2] * s,
				]);
		const rotation = [0, 0, 0, 1];
		quatFromFrame(direction, face, rotation);
		return { ...leaf, direction, rotation };
	};

	/**
	 * Lays the leaves from `first` on into a flat rosette: evenly through the fan either side of
	 * their stem, in the plane that faces the sky side, the lowest leaf the widest.
	 */
	const fanned = (first: number, fan: NonNullable<PieceLeaves['fan']>, axis: number): void => {
		const count = leaves.length - first;
		const up: Vector3 = [-down[0], -down[1], -down[2]];
		for (let k = 0; k < count; k++) {
			const leaf = leaves[first + k] as PlannedLeaf;
			// The stem's own run laid in the rosette's plane, and the plane's other axis.
			const ahead = square(leaf.stem, up, [0, 1, 0]);
			const side = normalize3(cross3(up, ahead, [0, 0, 0]));
			// The lowest leaf stands widest, to one side and the other in turn.
			const angle = radians(fan.reach) * (1 - (k + 0.5) / count) * (k % 2 === 0 ? 1 : -1);
			const lift = radians((draw(Purpose.Fan, axis, k + 256) * 2 - 1) * (fan.cone ?? 0));
			const direction = normalize3([
				(ahead[0] * cos(angle) + side[0] * sin(angle)) * cos(lift) + up[0] * sin(lift),
				(ahead[1] * cos(angle) + side[1] * sin(angle)) * cos(lift) + up[1] * sin(lift),
				(ahead[2] * cos(angle) + side[2] * sin(angle)) * cos(lift) + up[2] * sin(lift),
			]);
			const tilt = (draw(Purpose.Fan, axis, k) * 2 - 1) * fan.tilt;
			const rotation = [0, 0, 0, 1];
			quatFromFrame(direction, turn(square(up, direction, [0, 0, 1]), direction, tilt), rotation);
			leaves[first + k] = { ...leaf, direction, rotation };
		}
	};

	const grow = (stem: PieceStem, start: StemStart): void => {
		if (axes.length >= STEMS_MOST)
			throw new Error(`@null3d/vegetation: the piece '${rule.name}' passed ${STEMS_MOST} stems`);
		const axis = axes.length;
		const [footRadius, tipRadius] = stem.radius;
		const length = Math.max(0.005, spreadAt(stem.length, draw(Purpose.Length, axis)) * start.scale);
		const points: AxisPoint[] = [{ at: [...start.at], radius: footRadius, along: start.along }];
		axes.push(points);
		const leavesBy = leafRule(stem);
		const gap = stem.leaves ? Math.max(0.002, stem.leaves.gap) : 0;
		// A stem runs in straight steps short enough to read as a curve, and a node falls on a step's end.
		// A hook turns at most a few degrees a step, so a strand leaves its branch on a curve.
		const most = stem.hook
			? Math.min(STEP_MOST, (stem.hook.length * HOOK_TURN_MOST) / Math.max(1, stem.hook.angle))
			: STEP_MOST;
		const perNode = gap > 0 ? Math.max(1, Math.ceil(gap / most)) : 1;
		const step = gap > 0 ? gap / perNode : Math.min(most, length / STEPS_LEAST);
		const steps = Math.max(1, Math.round(length / step));
		const run = length / steps;
		const leafFrom = (stem.leaves?.from ?? 0) * length;
		const leafTo = (stem.leaves?.to ?? 1) * length;
		const [droopFrom, droopTo] = stem.droopOver ?? [0, 1];
		const droopSpan = Math.max(1e-6, (droopTo - droopFrom) * length);
		const hook = stem.hook;
		let direction: Vector3 = [...start.line];
		let sky = square(start.sky, direction, [0, 0, 1]);
		let ringDirection: Vector3 = [...direction];
		if (hook) {
			const a = radians(hook.angle);
			direction = normalize3([
				start.line[0] * cos(a) + sky[0] * sin(a),
				start.line[1] * cos(a) + sky[1] * sin(a),
				start.line[2] * cos(a) + sky[2] * sin(a),
			]);
			sky = square(sky, direction, [0, 0, 1]);
		}
		let at: Vector3 = [...start.at];
		let along = start.along;
		let zig = 1;
		let node = 0;
		// Nodes that carry leaves so far: a stem with a stated heading counts its nodes from the
		// first that does, so the heading is that node's own.
		let leafNode = 0;
		const headed = stem.leaves?.heading !== undefined;
		let kinks = 0;
		// The turn still owed from the last bend, in and out of the stem's plane, and the runs left.
		let bendIn = 0;
		let bendOut = 0;
		let bendRuns = 0;
		const ownLeaves = leaves.length;
		// Leaves that stand closer than a third of a leaf's length crowd into a tuft at the stem's end.
		const crowded = gap > 0 ? Math.min(1, Math.max(0, 1 - gap / (leafMean / 3))) : 0;
		const azimuthStart = stem.leaves?.heading ?? draw(Purpose.Start, axis) * 360;
		// Each step's end with its frame, where a side stem may leave.
		const frames: { at: Vector3; direction: Vector3; sky: Vector3; along: number }[] = [];
		for (let k = 0; k < steps; k++) {
			const from = k * run;
			const rise = hook?.rise ?? 0;
			if (hook && from >= rise && from < rise + hook.length)
				direction = toward(direction, start.line, (hook.angle * run) / hook.length);
			const mid = from + run / 2;
			if (stem.droop && mid >= droopFrom * length && mid <= droopTo * length)
				direction = toward(direction, down, (stem.droop * run) / droopSpan);
			if (stem.arc) direction = toward(direction, line, (-stem.arc * run) / length);
			const atNode = gap > 0 && (k + 1) % perNode === 0;
			if (atNode && stem.zigzag) {
				// A zigzag is a bend at each node, owed over the runs to the next node.
				bendIn += zig * stem.zigzag;
				zig = -zig;
				bendRuns = Math.max(bendRuns, Math.min(BEND_RUNS, perNode));
			}
			const kink = stem.kink;
			if (
				kink &&
				k > 0 &&
				Math.floor(from / kink.length) > Math.floor((from - run) / kink.length)
			) {
				// A bend turns the stem in its own plane, and a little out of it, so no two lie alike.
				// It is owed over the next few runs, not taken at once, so the stem curves through it.
				const turned = kinks++;
				bendIn +=
					(turned % 2 === 0 ? 1 : -1) * kink.angle * (0.6 + 0.8 * draw(Purpose.Kink, axis, turned));
				bendOut += (draw(Purpose.Kink, axis, turned + 512) - 0.5) * kink.angle * KINK_OUT;
				bendRuns = BEND_RUNS;
			}
			if (bendRuns > 0) {
				direction = turn(direction, sky, bendIn / bendRuns);
				direction = turn(
					direction,
					normalize3(cross3(direction, sky, [0, 0, 0])),
					bendOut / bendRuns,
				);
				bendIn -= bendIn / bendRuns;
				bendOut -= bendOut / bendRuns;
				bendRuns--;
			}
			normalize3(direction);
			sky = square(sky, direction, [0, 0, 1]);
			at = [at[0] + direction[0] * run, at[1] + direction[1] * run, at[2] + direction[2] * run];
			along += run;
			const share = (k + 1) / steps;
			const radius = footRadius + (tipRadius - footRadius) * share;
			// The low tier keeps a ring wherever the stem has turned its rule's bend since the last.
			const ring =
				stem.rings !== undefined &&
				k < steps - 1 &&
				(acos(
					Math.min(
						1,
						Math.max(
							-1,
							direction[0] * ringDirection[0] +
								direction[1] * ringDirection[1] +
								direction[2] * ringDirection[2],
						),
					),
				) *
					180) /
					PI >=
					stem.rings;
			if (ring) ringDirection = [...direction];
			points.push(
				ring
					? { at: [...at], radius, along, unitEnd: true }
					: stem.rings !== undefined
						? { at: [...at], radius, along, plain: true }
						: { at: [...at], radius, along },
			);
			frames.push({ at: [...at], direction: [...direction], sky: [...sky], along });
			if (atNode && leavesBy && from + run >= leafFrom - 1e-9 && from + run <= leafTo + 1e-9) {
				const first = leaves.length;
				placeNodeLeaves(
					leavesBy,
					leaves,
					buds,
					axis,
					headed ? leafNode++ : node,
					at,
					direction,
					sky,
					radius,
					along,
					share,
					azimuthStart,
					crowded,
				);
				const own = stem.leaves;
				if (own && (own.hang !== undefined || own.face))
					for (let i = first; i < leaves.length; i++)
						leaves[i] = hung(leaves[i] as PlannedLeaf, own, axis, i);
				if (own?.flat)
					for (let i = first; i < leaves.length; i++)
						leaves[i] = flattened(leaves[i] as PlannedLeaf, own.flat, own.face !== undefined);
				if (rule.leafDroop === 'plane')
					for (let i = first; i < leaves.length; i++) leaves[i] = drooped(leaves[i] as PlannedLeaf);
			}
			if (atNode) node++;
		}
		span = Math.max(span, along);
		if (stem.leaves?.fan) fanned(ownLeaves, stem.leaves.fan, axis);
		points[points.length - 1] = { ...(points[points.length - 1] as AxisPoint), unitEnd: true };
		if (stem.bud !== false) addBudCluster(buds, shoots.bud, tipRadius, at, direction, sky, along);
		for (const [m, mark] of (stem.marks ?? []).entries()) {
			const first = (mark.from ?? 0) * length;
			const last = (mark.to ?? 1) * length;
			for (let n = 0; first + (n + 0.5) * mark.gap <= last + 1e-9; n++) {
				const key = m * 4096 + n;
				if (draw(Purpose.Mark, axis, key) >= mark.share) continue;
				const place = first + (n + 0.5) * mark.gap;
				const frame = frames[Math.min(steps - 1, Math.max(0, Math.round(place / run) - 1))];
				if (!frame) continue;
				// To one side of the stem and the other in turn, within 40 degrees of its plane.
				const out = turn(
					frame.sky,
					frame.direction,
					90 + (n % 2) * 180 + (draw(Purpose.MarkTurn, axis, key) - 0.5) * 80,
				);
				const size = spreadAt(mark.length, draw(Purpose.MarkSize, axis, key));
				if (mark.kind === 'thorn') {
					const a = radians(mark.angle ?? 80);
					buds.push({
						at: [...frame.at],
						direction: normalize3([
							frame.direction[0] * cos(a) + out[0] * sin(a),
							frame.direction[1] * cos(a) + out[1] * sin(a),
							frame.direction[2] * cos(a) + out[2] * sin(a),
						]),
						length: size,
						width: mark.width,
						along: frame.along,
						cluster: false,
						mark: 'thorn',
					});
					continue;
				}
				const count = Math.max(
					1,
					Math.round(spreadAt(mark.count ?? 1, draw(Purpose.MarkSize, axis, key + 2048))),
				);
				const stalk = mark.stalk ?? 0;
				for (let c = 0; c < count; c++) {
					// Each body hangs toward the ground side, a little out from the stem and apart
					// from its neighbours.
					const apart = turn(out, down, c * GOLDEN);
					const way = normalize3([
						down[0] + apart[0] * 0.4,
						down[1] + apart[1] * 0.4,
						down[2] + apart[2] * 0.4,
					]);
					const end: Vector3 = [
						frame.at[0] + way[0] * stalk,
						frame.at[1] + way[1] * stalk,
						frame.at[2] + way[2] * stalk,
					];
					if (stalk > 0)
						axes.push([
							{ at: [...frame.at], radius: MARK_STALK, along: frame.along },
							{ at: end, radius: MARK_STALK, along: frame.along + stalk, unitEnd: true },
						]);
					buds.push({
						at: end,
						direction: way,
						length: size,
						width: mark.width,
						along: frame.along + stalk,
						cluster: true,
						stack: size,
						mark: 'body',
					});
				}
			}
		}
		for (const [s, sides] of (stem.sides ?? []).entries()) {
			const first = (sides.from ?? 0) * length;
			const last = (sides.to ?? 1) * length;
			const sideStart = draw(Purpose.SideStart, axis, s) * 360;
			for (let n = 0; first + (n + 0.5) * sides.gap <= last + 1e-9; n++) {
				const place = first + (n + 0.5) * sides.gap;
				const frame = frames[Math.min(steps - 1, Math.max(0, Math.round(place / run) - 1))];
				if (!frame) continue;
				const t = place / length;
				// Each side stem's place off its arrangement's own: to the piece's front and its back
				// in turn, by half to all of the depth, so a piece of a few side stems is never flat
				// and never lopsided, whatever its draws.
				const front = (n + (sideStart < 180 ? 0 : 1)) % 2 === 0 ? 1 : -1;
				const reach = 0.5 + 0.5 * ((sideStart / 360 + n * GOLDEN_SHARE) % 1);
				const wander =
					front * reach * (sides.spread ?? rule.depth ?? SIDE_SPREAD) + (sides.turn ?? 0);
				const azimuths =
					sides.arrangement === 'alternate'
						? [
								90 +
									(n % 2) * 180 +
									wander +
									(sides.out ?? 0) * (n % 4 < 2 ? 1 : -1) * (n % 2 === 0 ? 1 : -1),
							]
						: sides.arrangement === 'paired'
							? [90 + wander, 270 - wander]
							: sides.arrangement === 'opposite'
								? [sideStart + (n % 2) * 90 + wander, sideStart + (n % 2) * 90 + 180 + wander]
								: [sideStart + n * GOLDEN + wander];
				for (const [k, azimuth] of azimuths.entries()) {
					const outward = turn(frame.sky, frame.direction, azimuth);
					const lean = radians(
						spreadAt(sides.angle, draw(Purpose.SideAngle, axis, s * 4096 + n * 2 + k)),
					);
					grow(sides.stem, {
						at: [...frame.at],
						line: normalize3([
							frame.direction[0] * cos(lean) + outward[0] * sin(lean),
							frame.direction[1] * cos(lean) + outward[1] * sin(lean),
							frame.direction[2] * cos(lean) + outward[2] * sin(lean),
						]),
						sky: frame.sky,
						along: frame.along,
						scale: start.scale * curveAt(sides.lengthAlong ?? 1, t),
					});
				}
			}
		}
	};

	grow(rule.stem, {
		at: [0, 0, 0],
		line: [...line],
		sky: [0, 0, 1],
		along: 0,
		scale: 1,
	});
	let reach = 0;
	for (const points of axes)
		for (const point of points)
			reach = Math.max(reach, length3(point.at[0], point.at[1], point.at[2]));
	const size = rule.scale ?? 1;
	if (size === 1) return { axes, leaves, buds, reach, span: Math.max(span, 1e-6) };
	const sized = (v: Readonly<Vector3>): Vector3 => [v[0] * size, v[1] * size, v[2] * size];
	return {
		axes: axes.map((points) =>
			points.map((point) => ({
				...point,
				at: sized(point.at),
				radius: point.radius * size,
				along: point.along * size,
			})),
		),
		leaves: leaves.map((leaf) => ({
			...leaf,
			at: sized(leaf.at),
			scale: leaf.scale * size,
			along: leaf.along * size,
		})),
		buds: buds.map((bud) => ({ ...bud, at: sized(bud.at), along: bud.along * size })),
		reach: reach * size,
		span: Math.max(span, 1e-6) * size,
	};
}

/**
 * A mark that stands at one place on a stem, between two shares of its length.
 *
 * @param mark The mark, without its spacing.
 * @param length The stem's length in metres.
 * @param from The share of the stem's length where the mark's stretch starts.
 * @param to The share where it ends.
 * @returns The mark, spaced so that one stands on that stretch.
 */
export function oneMark(
	mark: Omit<PieceMark, 'gap' | 'from' | 'to'>,
	length: Spread,
	from: number,
	to: number,
): PieceMark {
	return { ...mark, gap: 0.9 * (to - from) * spreadMean(length), from, to };
}

/**
 * A rule with marks added to its stems: the same piece in fruit or in catkin.
 *
 * @param rule The piece's rule.
 * @param marksOf The marks a stem gains, by its rule and its order, 0 for the piece's main stem;
 * none where it returns nothing.
 * @returns The rule, each stem with its own marks and the added ones.
 */
export function withMarks(
	rule: PieceRule,
	marksOf: (stem: PieceStem, order: number) => readonly PieceMark[] | undefined,
): PieceRule {
	const marked = (stem: PieceStem, order: number): PieceStem => {
		const added = marksOf(stem, order) ?? [];
		return {
			...stem,
			...(added.length > 0 ? { marks: [...(stem.marks ?? []), ...added] } : {}),
			...(stem.sides
				? { sides: stem.sides.map((side) => ({ ...side, stem: marked(side.stem, order + 1) })) }
				: {}),
		};
	};
	return { ...rule, stem: marked(rule.stem, 0) };
}

/**
 * The hash key of one variant of one of a species' pieces.
 *
 * @param rule The rule's index among the species' pieces.
 * @param variant The variant.
 * @returns The key.
 */
export function pieceKey(rule: number, variant: number): number {
	return rule * 16 + variant;
}

/** The bits of `value` below `bits`, reversed: the order that spreads a count evenly. */
function reversed(value: number, bits: number): number {
	let out = 0;
	for (let k = 0; k < bits; k++) if (value & (1 << k)) out |= 1 << (bits - 1 - k);
	return out;
}

/**
 * The sites of a plan: one at every stem's end and one at every node that carries a leaf, each kind
 * ranked so that a share taken from the front of its order is spread evenly over the piece.
 *
 * @param plan The plan, or one part of a split plan.
 * @returns The sites, the tips first, each kind in rank order.
 */
export function pieceSites(plan: ShootPlan): PieceSite[] {
	const tips: Omit<PieceSite, 'rank'>[] = [];
	for (const points of plan.axes) {
		const tip = points[points.length - 1] as AxisPoint;
		const before = (points[points.length - 2] ?? points[0]) as AxisPoint;
		const run: Vector3 = [
			tip.at[0] - before.at[0],
			tip.at[1] - before.at[1],
			tip.at[2] - before.at[2],
		];
		const direction: Vector3 = length3(run[0], run[1], run[2]) < 1e-9 ? [0, 1, 0] : normalize3(run);
		tips.push({ kind: 'tip', at: [...tip.at], direction, out: [...direction], along: tip.along });
	}
	// One site for a node, whatever number of leaves stand at it.
	const nodes: Omit<PieceSite, 'rank'>[] = [];
	const seen = new Set<string>();
	for (const leaf of plan.leaves) {
		const key = `${leaf.axis}:${leaf.node}`;
		if (seen.has(key)) continue;
		seen.add(key);
		nodes.push({
			kind: 'node',
			at: [...leaf.at],
			direction: [...leaf.stem],
			out: [...leaf.radial],
			along: leaf.along,
		});
	}
	const ranked = (sites: Omit<PieceSite, 'rank'>[]): PieceSite[] => {
		// The bits that count the sites, found by doubling: a whole number, the same on every engine.
		let bits = 1;
		while (1 << bits < sites.length) bits++;
		return sites
			.map((site, index) => ({ site, order: reversed(index, bits) }))
			.sort((a, b) => a.order - b.order)
			.map(({ site }, rank) => ({ ...site, rank }));
	};
	return [...ranked(tips), ...ranked(nodes)];
}

/** The most vertices a part may hold at the finest tier, under the prototype's own limit. */
export const PART_VERTICES_MOST = 60_000;

/**
 * Splits a plan into parts that each fit one prototype. The first part holds the main stem. A side
 * stem of the main stem stays whole with everything that grows from it, and joins the current part
 * while the part's mesh at the finest tier stays under the limit. Every part keeps the whole plan's
 * span, so the parts bend as one body.
 *
 * @param plan The plan.
 * @param leaves The leaf meshes at the finest tier.
 * @param most The most vertices a part may hold at that tier.
 * @returns The parts, the main stem's first; the plan itself where it fits one prototype.
 */
export function splitPlan(
	plan: ShootPlan,
	leaves: readonly PrototypeArrays[],
	most = PART_VERTICES_MOST,
): ShootPlan[] {
	const vertices = (part: ShootPlan): number =>
		meshShoot(part, leaves, 'ultra', PIECE_CUTS.ultra).vertices;
	if (vertices(plan) <= most) return [plan];
	const near = (a: readonly number[], b: readonly number[]): number =>
		length3(
			(a[0] as number) - (b[0] as number),
			(a[1] as number) - (b[1] as number),
			(a[2] as number) - (b[2] as number),
		);
	// Each stem's parent: the earliest stem that holds the point its foot stands on.
	const parent = plan.axes.map((points, a) => {
		const foot = (points[0] as AxisPoint).at;
		for (let b = 0; b < a; b++)
			if ((plan.axes[b] as readonly AxisPoint[]).some((point) => near(point.at, foot) < 1e-5))
				return b;
		return -1;
	});
	// The side stem of the main stem that each stem grows from, itself included; -1 for the main stem.
	const limb = plan.axes.map((_, a) => {
		let at = a;
		while (at > 0 && (parent[at] as number) > 0) at = parent[at] as number;
		return at === 0 ? -1 : at;
	});
	// Each bud's stem: the one that passes nearest to it.
	const budStem = plan.buds.map((bud) => {
		let best = 0;
		let least = Infinity;
		for (const [a, points] of plan.axes.entries())
			for (const point of points) {
				const d = near(point.at, bud.at);
				if (d < least - 1e-9) {
					least = d;
					best = a;
				}
			}
		return best;
	});
	const partOf = (stems: ReadonlySet<number>): ShootPlan => {
		const index = new Map<number, number>();
		const axes: (readonly AxisPoint[])[] = [];
		for (const [a, points] of plan.axes.entries())
			if (stems.has(a)) {
				index.set(a, axes.length);
				axes.push(points);
			}
		return {
			axes,
			leaves: plan.leaves
				.filter((leaf) => stems.has(leaf.axis))
				.map((leaf) => ({ ...leaf, axis: index.get(leaf.axis) as number })),
			buds: plan.buds.filter((_, b) => stems.has(budStem[b] as number)),
			reach: plan.reach,
			span: plan.span,
		};
	};
	const limbs = [...new Set(limb.filter((a) => a > 0))];
	const parts: ShootPlan[] = [];
	let current = new Set<number>([0]);
	for (const root of limbs) {
		const own = plan.axes.flatMap((_, a) => (limb[a] === root ? [a] : []));
		const grown = new Set([...current, ...own]);
		if (vertices(partOf(grown)) <= most) {
			current = grown;
			continue;
		}
		if (vertices(partOf(new Set(own))) > most)
			throw new Error(
				'@null3d/vegetation: one side stem of a piece passes the prototype vertex limit; give the piece fewer leaves on a side stem',
			);
		parts.push(partOf(current));
		current = new Set(own);
	}
	parts.push(partOf(current));
	return parts;
}

/**
 * Builds a species' pieces, each variant at every detail tier, from its leaf meshes. A variant too
 * large for one prototype comes as several parts.
 *
 * @param record The species record.
 * @param rules The species' piece rules.
 * @param leaves The species' leaf meshes at every tier, low first.
 * @param straight The same meshes built with no bend at the stalk, for the rules whose blades bend
 * in their own plane; the species' own where absent.
 * @returns The prototypes, each rule's variants together and each variant's parts together, in the
 * rules' order.
 */
export function piecePrototypes(
	record: Species,
	rules: readonly PieceRule[],
	leaves: readonly (readonly PrototypeArrays[])[],
	straight: readonly (readonly PrototypeArrays[])[] = leaves,
): PiecePrototype[] {
	const pictureTier = DETAILS.indexOf(BRUSH_PICTURE_TIER);
	const out: PiecePrototype[] = [];
	for (const [r, rule] of rules.entries()) {
		const own = rule.leafDroop === 'plane' ? straight : leaves;
		const leafMeshes = Math.min(...own.map((tier) => tier.length));
		const finest = own[own.length - 1] ?? [];
		// A piece that draws brush cards pictures two runs of its first variant: its own stem's
		// longest, and its side stems' longest. Every run draws from the one of its kind.
		let pictures: BrushPicture[] | undefined;
		for (let variant = 0; variant < Math.min(16, Math.max(1, rule.variants)); variant++) {
			const key = pieceKey(r, variant);
			const whole = planPiece(record, rule, key, leafMeshes);
			if (rule.brushCards && !pictures) {
				const runs = plannedBrushes(whole);
				const longest = (own: boolean) =>
					runs
						.filter((run) => (run.axis === 0) === own)
						.reduce<PlannedBrush | undefined>(
							(best, run) => (!best || run.length > best.length ? run : best),
							undefined,
						);
				pictures = [longest(true), longest(false)]
					.filter((run): run is PlannedBrush => run !== undefined)
					.map((run) => brushPicture(whole, run, own[pictureTier] ?? [], BRUSH_PICTURE_TIER));
			}
			const parts = splitPlan(whole, finest);
			const far = rule.far
				? splitPlan(planPiece(record, { ...rule, stem: rule.far }, key, leafMeshes), finest)
				: undefined;
			if (far && far.length !== parts.length)
				throw new Error(
					`@null3d/vegetation: the piece '${rule.name}' splits into ${parts.length} parts near and ${far.length} far; give its far stem the same parts`,
				);
			for (const [part, plan] of parts.entries()) {
				const drawn = pictures ?? [];
				const brushes =
					drawn.length > 0
						? {
								runs: plannedBrushes(plan).map(({ axis, leaves: _leaves, ...run }) => ({
									...run,
									picture: Math.min(drawn.length - 1, axis === 0 ? 0 : 1),
								})),
								pictures: drawn,
							}
						: undefined;
				const near = meshedPlan(plan, own, PIECE_CUTS);
				// The low and medium tiers take the far plan's meshes, where the rule names one.
				const farPlan = far?.[part];
				const farTiers = farPlan ? meshedPlan(farPlan, own, PIECE_CUTS).tiers : undefined;
				const tiers = farTiers
					? (near.tiers.map((tier, t) =>
							t <= DETAILS.indexOf('medium') ? farTiers[t] : tier,
						) as unknown as typeof near.tiers)
					: near.tiers;
				out.push({
					piece: rule.name,
					variant,
					attitude: rule.attitude,
					part,
					parts: parts.length,
					...(rule.plane ? { plane: rule.plane } : {}),
					...(rule.lengthwise ? { lengthwise: true } : {}),
					...(rule.roll ? { roll: rule.roll } : {}),
					sites: pieceSites(plan),
					...near,
					tiers,
					...(brushes ? { brushes } : {}),
				});
			}
		}
	}
	return out;
}

/**
 * How a studio photograph of cut wood is laid out from a species' pieces: one piece alone, or the
 * bare wood of the cut standing in its clamp with pieces at its sockets.
 */
export interface PieceStudio {
	/** The reference still's number. */
	readonly still: number;
	/**
	 * The piece drawn alone, or the piece at the tip of each stem of the stand. A stand with no
	 * piece is drawn as its own wood, each stem ending in the species' buds.
	 */
	readonly piece?: string;
	/** The cut's bare wood, standing upright from its foot, where the photograph shows it. */
	readonly stand?: {
		readonly stem: PieceStem;
		/** Degrees the cut leans from plumb in its clamp, toward the picture's right. */
		readonly lean?: number;
		/**
		 * Pieces along the stand's side stems: metres between sockets, where on a stem they start, and
		 * the degrees a piece leaves at from the stem's own run, square to it where absent.
		 */
		readonly along?: {
			readonly piece: string;
			readonly gap: number;
			readonly from: number;
			readonly angle?: number;
		};
	};
	/** Degrees the camera stands round the layout; at 0 it looks along -Z. */
	readonly turn?: number;
	/** The stand's real size over the lengths it states, as a piece rule's `scale` is. */
	readonly scale?: number;
	/** Degrees either side of the stand's plane its arms stand, as a piece rule's `depth` is. */
	readonly depth?: number;
}

/** One piece of a layout: which piece, and where it stands in the layout's space, +Y up. */
export interface PlacedPiece {
	readonly piece: string;
	/** A number that picks among the piece's variants. */
	readonly pick: number;
	readonly position: Vector3;
	/** Its turn from the piece's rest frame, x, y, z, w. */
	readonly rotation: number[];
}

/** A studio layout: the stand's plan, where the photograph shows one, and the placed pieces. */
export interface StudioLayout {
	readonly stand?: ShootPlan;
	readonly placed: readonly PlacedPiece[];
}

/** The tier whose leaf meshes a brush card pictures: the finest a kit below ultra builds. */
const BRUSH_PICTURE_TIER: Detail = 'high';
/** Degrees a piece that turns up stands above its socket's own direction. */
const UP_LIFT = 30;
/** The most metres from a stem's tip within which another stem's foot means the tip forks and carries no piece. */
const FORK_REACH = 0.05;
const WORLD_UP: Readonly<Vector3> = [0, 1, 0];

/** `v` laid level: its part square to the world's up, or `fallback` where it stands plumb. */
function level(v: Readonly<Vector3>, fallback: Readonly<Vector3>): Vector3 {
	const flat: Vector3 = [v[0], 0, v[2]];
	return length3(flat[0], flat[1], flat[2]) < 1e-4 ? [...fallback] : normalize3(flat);
}

/**
 * The turn that holds a piece at a socket, from the piece's rest frame to the layout's space.
 *
 * @param attitude How the piece is held.
 * @param heading The socket's direction: the way its wood runs, or the way the piece leaves it.
 * @returns The turn, x, y, z, w.
 */
export function pieceTurn(attitude: PieceAttitude, heading: Readonly<Vector3>): number[] {
	const out = [0, 0, 0, 1];
	const flat = level(heading, [1, 0, 0]);
	if (attitude === 'plumb') quatFromFrame([0, -1, 0], flat, out);
	else if (attitude === 'upright') quatFromFrame(WORLD_UP, flat, out);
	else if (attitude === 'level') quatFromFrame(flat, WORLD_UP, out);
	else if (attitude === 'up')
		quatFromFrame(toward(normalize3([...heading]), WORLD_UP, UP_LIFT), WORLD_UP, out);
	else quatFromFrame(normalize3([...heading]), WORLD_UP, out);
	return out;
}

/**
 * Lays out a studio photograph's cut from a species' pieces.
 *
 * @param record The species record.
 * @param rules The species' piece rules.
 * @param studio The photograph's layout.
 * @returns The stand's plan and the placed pieces.
 */
export function layStudio(
	record: Species,
	rules: readonly PieceRule[],
	studio: PieceStudio,
): StudioLayout {
	const attitudeOf = (name: string): PieceAttitude => {
		const rule = rules.find((candidate) => candidate.name === name);
		if (!rule) throw new Error(`@null3d/vegetation: '${record.id}' has no piece named '${name}'`);
		return rule.attitude;
	};
	const piece = studio.piece;
	if (!studio.stand) {
		if (piece === undefined)
			throw new Error(
				`@null3d/vegetation: the layout of still ${studio.still} of '${record.id}' names no piece and no stand`,
			);
		return {
			placed: [
				{
					piece,
					pick: 0,
					position: [0, 0, 0],
					// A hanging piece hangs with its hook to the picture's right; any other stands on
					// its cut, its sky side toward the camera.
					rotation: attitudeOf(piece) === 'plumb' ? pieceTurn('plumb', [1, 0, 0]) : [0, 0, 0, 1],
				},
			],
		};
	}
	// The cut stands in its clamp: its line is up, and the ground is below it.
	const stand = planPiece(
		record,
		{
			name: `stand-${studio.still}`,
			attitude: 'along',
			variants: 1,
			stem: studio.stand.stem,
			...(studio.scale === undefined ? {} : { scale: studio.scale }),
			...(studio.depth === undefined ? {} : { depth: studio.depth }),
		},
		pieceKey(15, studio.still % 16),
		0,
		[0, -1, 0],
		studio.stand.lean ?? 0,
	);
	const placed: PlacedPiece[] = [];
	const along = studio.stand.along;
	for (const [a, points] of stand.axes.entries()) {
		const tip = points[points.length - 1] as AxisPoint;
		const before = points[points.length - 2] as AxisPoint;
		const heading = normalize3([
			tip.at[0] - before.at[0],
			tip.at[1] - before.at[1],
			tip.at[2] - before.at[2],
		]);
		// A short stem's tip stands near its own parent's other forks, so its reach is its own share.
		const reach = Math.min(FORK_REACH, (tip.along - (points[0] as AxisPoint).along) / 2);
		const forks = stand.axes.some((other, b) => {
			const foot = (other[0] as AxisPoint).at;
			return (
				b !== a && length3(foot[0] - tip.at[0], foot[1] - tip.at[1], foot[2] - tip.at[2]) < reach
			);
		});
		if (!forks && piece !== undefined)
			placed.push({
				piece,
				pick: a,
				position: [...tip.at],
				rotation: pieceTurn(attitudeOf(piece), heading),
			});
		// A stand of one stem carries its side pieces on that stem; a forked stand on its arms.
		if (!along || (a === 0 && stand.axes.length > 1)) continue;
		const foot = (points[0] as AxisPoint).along;
		const length = tip.along - foot;
		const gap = along.gap * (studio.scale ?? 1);
		let next = along.from * length;
		let side = 1;
		for (let k = 1; k < points.length; k++) {
			const point = points[k] as AxisPoint;
			if (point.along - foot < next || point.along - foot > length - gap / 2) continue;
			const last = points[k - 1] as AxisPoint;
			const run = normalize3([
				point.at[0] - last.at[0],
				point.at[1] - last.at[1],
				point.at[2] - last.at[2],
			]);
			// A hanging piece hangs in the plane of its branch, so it heads the way the branch runs.
			if (attitudeOf(along.piece) === 'plumb') {
				placed.push({
					piece: along.piece,
					pick: a * 64 + k,
					position: [...point.at],
					rotation: pieceTurn('plumb', run),
				});
				next += gap;
				continue;
			}
			// A side piece leaves to one side of its stem and the other in turn, level with the ground.
			const flat = level(run, [0, 0, 1]);
			const across: Vector3 = [-flat[2] * side, 0, flat[0] * side];
			const lean = radians(along.angle ?? 90);
			const out: Vector3 = [
				run[0] * cos(lean) + across[0] * sin(lean),
				run[1] * cos(lean) + across[1] * sin(lean),
				run[2] * cos(lean) + across[2] * sin(lean),
			];
			placed.push({
				piece: along.piece,
				pick: a * 64 + k,
				position: [...point.at],
				rotation: pieceTurn(attitudeOf(along.piece), out),
			});
			side = -side;
			next += gap;
		}
	}
	return { stand, placed };
}
