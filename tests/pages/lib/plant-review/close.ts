// The cameras of the close and partial views, each placed the way its reference photograph frames
// its subject. A view first finds its subject in the plant: the stem's first fork seen from its foot,
// a great limb leaving the stem at a wide angle, a limb dividing into two arms, a limb of the crown's
// outer surface, a branch with its side branches, or a twig with its end clusters. It then frames
// the subject at the share of the picture that the photograph gives it, and stands on the side from
// which the least of the rest of the plant comes between the lens and the subject, so one subject
// shows clear as the photograph shows it. It reads only the skeleton, the shoot rows and the shoot
// prototypes, so it holds for every species.

import {
	type AxisPoint,
	chainOf,
	cross,
	dot,
	facing,
	firstForkHeight,
	lengthOf,
	mainStem,
	nodeAt,
	normalize,
	pointAlong,
	stemAt,
	stemFoot,
	turnedAbout,
	type V3,
} from './anatomy';
import { LEAST_ROW_GAP, rowAngle } from './framing';
import type { MacroSkeleton, ShootPrototype, ShootRows } from './plant-types';
import {
	type Clutter,
	clearest,
	lensAxes,
	plantSpheres,
	type Shot,
	type SubjectMark,
	type Weighing,
} from './sight';

/** What a close view reads of the grown plant. */
export interface ClosePlant {
	readonly skeleton: MacroSkeleton;
	readonly shoots: ShootRows;
	readonly prototypes: readonly ShootPrototype[];
	/** A leaf's length in metres, when the species' leaves are blades, which sets a twig's frame. */
	readonly leafLength?: number;
	/** 3 per point: the places the plant's foliage cards draw, for a view that frames a fringe. */
	readonly foliage?: Float32Array;
}

/** A close view's camera and what it framed. */
export interface CloseView extends Shot {
	/** Radians the camera turns about its line of sight, the picture turning counterclockwise. */
	readonly roll?: number;
	/** What the view chose and why, for the page's facts. */
	readonly subject: Readonly<Record<string, unknown>>;
	/** The clutter of the chosen frame, when the view weighed its sides. */
	readonly clutter?: Clutter;
}

/** The frame a close view draws: its vertical field of view in degrees and its width over height. */
export interface Lens {
	readonly fov: number;
	readonly aspect: number;
}

const DEG = Math.PI / 180;
/** The height of a standing person's eye, in metres. */
const EYE = 1.6;
/** Metres a camera that looks up the stem stands from the bark: a step back, as a person stands. */
const BELOW_STANDOFF = 1;
/** The lowest a view up a plant shorter than a person drops its lens, in metres above the ground. */
const BELOW_LOWEST_EYE = 0.2;
/**
 * The highest a camera that looks up a stemless plant stands, as a share of the plant's height: a
 * tuft or a rosette has no stem at eye height, so its photograph is taken from near its foot.
 */
const STEMLESS_EYE = 0.3;
/** How far beyond its widest radius a stemless plant's camera stands, as a multiple of that radius. */
const STEMLESS_STAND = 1.05;
/**
 * The least height of a crown's base, in a person's eye heights, at which a view up the stem
 * frames the bole from its foot to the crown's base; under it, the bole is too short for that.
 */
const CLEAN_BOLE_EYES = 2;
/** The steepest a camera that looks up the stem pitches, in degrees, short of straight up. */
const STEEPEST = 85;
/** Metres a camera keeps clear of the wood and the leaves round it where it stands. */
const CLEARANCE = 0.25;
/** Degrees a view up the stem walks round it at a time, to find a stand clear of low branches. */
const WALK_STEP = 15;
/**
 * The stretch of a great limb, as shares of its length, within which the view from inside the
 * crown stands by its most level point, and the step it searches that stretch in.
 */
const INSIDE_STRETCH = [0.15, 0.6, 0.05] as const;
/**
 * Degrees more steeply than the most level great limb that the view from inside the crown still
 * weighs a limb at, each degree of tilt costing it a little against a clearer view.
 */
const INSIDE_TILT = 10;
/** The share of the frame's height that the great limb's thickness fills from inside the crown. */
const INSIDE_LIMB_SHARE = 0.25;
/** Degrees a close camera may look down on its subject: the photographs look level or up. */
const LOOK_DOWN = 12;
/**
 * The share of the frame's height that a limb's thickness fills where it leaves the stem: the
 * photograph stands close on the crotch, so the stem fills one side and the other limbs fall out.
 */
const JUNCTION_LIMB_SHARE = 0.55;
/** The least radius, against the thickest limb that leaves the stem, of a limb a junction view takes. */
const JUNCTION_THICK = 0.5;
/**
 * The share of the thickest limb's radius down to which a thinner limb still joins the candidates,
 * so a crown-rosette's dead skirt, whose stipes leave the trunk below the living crown, can give a
 * junction whose crotch stands clear of the fronds. The thickness bonus ranks it below a thick limb.
 *
 * The premise that a thin limb means a dead skirt fails where a species' dead fronds leave at the
 * stem top: the tree fern has no stipe below its crown, and its only clear thin crotch is a living
 * frond this rule excludes. Its picture 07 is a stated subject limit with three measured attempts,
 * and no per-species admission. A species whose thin living limb should stand needs its own record.
 */
const JUNCTION_SKIRT_THICK = 0.2;
/** Degrees within which a limb that leaves the stem carries the stem's own line on. */
const LEADER_ANGLE = 45;
/** The share of the frame's height that the limb below a fork fills with its thickness. */
const FORK_LIMB_SHARE = 0.28;
/**
 * How many times the reach of a fork's arms the frame's height spans: the photograph shows both arms
 * and the twigs they carry, with the limb coming up to the joint from below.
 */
const FORK_ARM_SPAN = 2.2;
/**
 * The limb's diameters that the arms' reach may pull the frame out to, so a fork inside a crown does
 * not frame the crown above it. The photograph's frame spans about twenty of them.
 */
const FORK_REACH_DIAMETERS = 20;
/** The least radius of an arm, against its limb's radius at the fork, for a division to be a fork. */
const FORK_ARM = 0.5;
/** The radius a fork's limb is sought at, against the stem's radius at breast height. */
const FORK_STEM_SHARE = 0.27;
/** The row share at which the photograph's fork stands, a little under the middle of the frame. */
const FORK_ROW = 0.6;
/** The least radius of each arm against its limb's for the photograph's fork of two even arms. */
const FORK_EVEN = 0.65;
/** The least sine of the angle the photograph's fork opens at. */
const FORK_OPEN = 0.55;
/** How many times thicker or thinner than the sought limb a fork's limb may be. */
const FORK_SIZE = 2;
/** The most forks or limbs a view weighs, nearest its sought thickness first. */
const MOST_SUBJECTS = 24;
/** The share of the frame's height that a twig fills from its base to its farthest cluster. */
const TWIG_FILL = 0.85;
/** Leaf lengths that the frame of a twig view spans. */
const TWIG_LEAVES = 4.5;
/** The most twigs a twig view weighs, the best lit first. */
const MOST_TWIGS = 48;
/** The share of the frame left clear round a framed piece. */
const MARGIN = 0.08;
/**
 * The share of the frame's height that a view of the bole keeps above where the bole first
 * divides, where its photograph shows the limbs leaving the fork; its foot stands on the frame's
 * lower margin.
 */
const BOLE_TOP = 0.2;
/**
 * The share of its height by which a view of the crown's outer surface frames above its limb, so
 * the limb runs low across the frame and its shoots rise above it, as the photograph shows them.
 */
const SURFACE_LIFT = 0.3;

/**
 * How each view weighs a frame, from its photograph: how much of the frame its subject fills, and
 * how plain the ground behind it is. A junction stands before a busy wood; a fork, a cut branch and
 * a twig before a plain ground; the crown's outside is a surface whose depth is its subject.
 */
const WEIGHINGS = {
	junction: { behind: 0.15, fill: 0.7, short: 1 },
	inside: { behind: 0, fill: 0.5, short: 1, behindFills: true },
	bark: { behind: 0.25, fill: 0.3, short: 1 },
	bole: { behind: 0.1, fill: 0.3, short: 1 },
	fork: { behind: 0.5, fill: 0.3, short: 1 },
	surface: { behind: 0, fill: 0.55, short: 1, behindFills: true },
	branch: { behind: 1, fill: 0.3, short: 1 },
	twig: { behind: 1, fill: 0.45, short: 1 },
} as const satisfies Record<string, Weighing>;

/**
 * The height of a view's cameras over their subject, as the angle up from the subject, in degrees:
 * as far as each photograph looks up at its subject or down on it. The crown's outside is seen from
 * under its lower rim, looking up past its edge. Inside the crown, under its rim and at a fork, the
 * camera looks up far enough that the meadow stays out of the frame, as those photographs show only
 * sky and crown behind their subject.
 */
const RISE = {
	junction: [-25, -5],
	inside: [-50, -32],
	bark: [-20, LOOK_DOWN],
	fork: [-60, -12],
	surface: [-32, -23],
	twig: [-30, LOOK_DOWN],
} as const satisfies Record<string, readonly [number, number]>;
/** Tips that stand a camera under the crown's rim, looking up at it. */
const SURFACE_TIPS = [25, 28, 31] as const;
/** Tips that stand a camera under a great limb inside the crown, looking up along it. */
const INSIDE_TIPS = [35, 40, 45] as const;

/** A vector turned about the vertical axis by an angle in radians. */
function yawed(v: readonly number[], angle: number): V3 {
	const c = Math.cos(angle);
	const s = Math.sin(angle);
	return [
		(v[0] as number) * c + (v[2] as number) * s,
		v[1] as number,
		-(v[0] as number) * s + (v[2] as number) * c,
	];
}

/** The point `metres` from `at` along a direction. */
function step(at: readonly number[], direction: readonly number[], metres: number): V3 {
	return [
		(at[0] as number) + (direction[0] as number) * metres,
		(at[1] as number) + (direction[1] as number) * metres,
		(at[2] as number) + (direction[2] as number) * metres,
	];
}

/** The camera distance at which a frame `height` metres tall at the target fills a lens. */
function distanceFor(height: number, fov: number): number {
	return height / 2 / Math.tan((fov * DEG) / 2);
}

/** The direction from node `a` to node `b`. */
function between(skeleton: MacroSkeleton, a: number, b: number): V3 {
	const p = nodeAt(skeleton, a);
	const q = nodeAt(skeleton, b);
	return normalize([q[0] - p[0], q[1] - p[1], q[2] - p[2]]);
}

/** A unit vector square to `v`, level where it can be: across a direction's run. */
function across(v: V3): V3 {
	const level = cross([0, 1, 0], v);
	return Math.hypot(...level) > 1e-3 ? normalize(level) : [1, 0, 0];
}

/**
 * An axis's own direction where it leaves its parent: from the junction to the first of its nodes
 * that stands `clear` metres or more away, so the blend into the parent does not set it.
 */
function departure(skeleton: MacroSkeleton, axis: number, clear: number): V3 {
	const chain = chainOf(skeleton, axis);
	const from = nodeAt(skeleton, chain[0] as number);
	for (const n of chain.slice(1)) {
		const p = nodeAt(skeleton, n);
		if (Math.hypot(p[0] - from[0], p[1] - from[1], p[2] - from[2]) >= clear)
			return normalize([p[0] - from[0], p[1] - from[1], p[2] - from[2]]);
	}
	return between(skeleton, chain[0] as number, chain[chain.length - 1] as number);
}

/** The node that carries an axis on past `node`, or -1 when the axis ends there. */
function nextOnAxis(skeleton: MacroSkeleton, axis: number, node: number): number {
	const first = skeleton.axes.first[axis] as number;
	const last = skeleton.axes.last[axis] as number;
	for (let n = Math.max(first, node + 1); n <= last; n++)
		if ((skeleton.parent[n] as number) === node) return n;
	return -1;
}

/** A mark of the axes in `alone`, and of those in `grown` with every axis that grows from them. */
function markAxes(
	skeleton: MacroSkeleton,
	alone: readonly number[],
	grown: readonly number[] = [],
): Uint8Array {
	const marked = new Uint8Array(skeleton.axes.count);
	for (const a of grown) if (a >= 0) marked[a] = 1;
	// Parents come before their children in the axis table, so one pass carries the mark out.
	if (grown.length > 0)
		for (let a = 0; a < skeleton.axes.count; a++) {
			const parent = skeleton.axes.parent[a] as number;
			if (parent >= 0 && marked[parent] === 1) marked[a] = 1;
		}
	for (const a of alone) if (a >= 0) marked[a] = 1;
	return marked;
}

/** One subject a view may frame, with the cameras it weighs round it. */
interface Subject<T> {
	readonly target: V3;
	/** The direction the camera looks along, from either side. */
	readonly normal: V3;
	/** The axis the cameras turn about, off the normal. */
	readonly spin: V3;
	readonly distance: number;
	/** What counts as the subject in its frame. */
	readonly mark: SubjectMark;
	/** What the view prefers in a camera of this subject, taken off its score. */
	readonly bonus: (shot: Shot) => number;
	/** The sides of the normal the cameras stand on: both by default. */
	readonly sides?: readonly number[];
	readonly facts: T;
}

/**
 * What a camera that looks square to its subject's normal is worth beside a clear frame: the
 * photographs see a limb, a fork or a twig across its run, not end on.
 */
const SQUARE = 0.25;

/** The turns and tips of a camera that keeps near square to its subject. */
const SQUARE_TURNS = [0, -15, 15] as const;

/** The degrees the cameras round a subject turn about its spin, and tip up or down. */
const TURNS = [0, -25, 25, -50, 50] as const;
const TIPS = [0, -15, 15, -30] as const;

/**
 * The cameras round a subject: on both sides of its normal, turned about its spin and tipped up or
 * down, each standing within `rise` degrees over or under the subject, as its photograph stands.
 */
function shotsRound<T>(
	subject: Subject<T>,
	turns: readonly number[],
	tips: readonly number[],
	rise: readonly [number, number],
): Shot[] {
	const out: Shot[] = [];
	for (const side of subject.sides ?? [1, -1])
		for (const turn of turns)
			for (const tip of tips) {
				const turned = turnedAbout(
					[subject.normal[0] * side, subject.normal[1] * side, subject.normal[2] * side],
					subject.spin,
					turn * DEG,
				);
				const direction = normalize(
					turnedAbout(turned, across(normalize([turned[0], 0, turned[2]])), tip * DEG),
				);
				// The camera's height over the subject, as an angle: up is looking down on it.
				const over = Math.asin(Math.max(-1, Math.min(1, direction[1]))) / DEG;
				if (over < rise[0] || over > rise[1]) continue;
				out.push({
					position: step(subject.target, direction, subject.distance),
					target: subject.target,
				});
			}
	return out;
}

/** The subject and camera that frame the clearest, each subject judged against the plant round it. */
function bestOf<T>(
	plant: ClosePlant,
	subjects: readonly Subject<T>[],
	lens: Lens,
	weighing: Weighing,
	rise: readonly [number, number],
	turns: readonly number[] = TURNS,
	tips: readonly number[] = TIPS,
): { readonly subject: Subject<T>; readonly shot: Shot; readonly clutter: Clutter } | undefined {
	let best:
		| {
				readonly subject: Subject<T>;
				readonly shot: Shot;
				readonly clutter: Clutter;
				readonly score: number;
		  }
		| undefined;
	for (const subject of subjects) {
		const reach = subject.distance * (1 + Math.tan((lens.fov * DEG) / 2) * lens.aspect);
		const spheres = plantSpheres(
			plant.skeleton,
			plant.shoots,
			plant.prototypes,
			subject.target,
			reach,
		);
		const candidates = shotsRound(subject, turns, tips, rise).map((shot) => {
			const back = normalize([
				shot.position[0] - shot.target[0],
				shot.position[1] - shot.target[1],
				shot.position[2] - shot.target[2],
			]);
			return { ...shot, bonus: subject.bonus(shot) + SQUARE * Math.abs(dot(back, subject.normal)) };
		});
		const choice = clearest(candidates, spheres, lens.fov, lens.aspect, subject.mark, weighing);
		if (choice && (!best || choice.score < best.score))
			best = { subject, shot: choice.candidate, clutter: choice.clutter, score: choice.score };
	}
	return best && { subject: best.subject, shot: best.shot, clutter: best.clutter };
}

/** How a view up the stem stands and looks. */
export interface BelowFraming {
	/** Degrees the camera pitches up, at most. */
	readonly elevation: number;
	/** The row share on which the bark where the stem first divides lands. */
	readonly forkRow?: number;
	/**
	 * The row shares on which the ground at the stem's bark and the crown's base land: with both,
	 * the camera stands as far back and pitches up as far as puts each where it is asked.
	 */
	readonly footRow?: number;
	readonly crownRow?: number;
	/** Degrees the look turns to the right of the stem. */
	readonly aside?: number;
	/** Stem radii from the stem's axis at which the camera stands, in place of a step back. */
	readonly stand?: number;
}

/** Where a camera at eye height stands and how far it looks up, to see a bole from foot to fork. */
interface BoleStand {
	/** Metres up the camera stands. */
	readonly eye: number;
	/** Metres the camera stands back from the bark, level. */
	readonly bark: number;
	/** Radians the camera looks up. */
	readonly pitch: number;
}

/**
 * The stand from which a bole `top` metres tall shows from its foot to its top: a person's eye
 * height, or half the bole's height on a bole too low for that, so far back and pitched up so far
 * that the ground at the bark lands on `footRow` and the bole's top on `topRow`.
 */
function boleStand(top: number, lens: Lens, topRow: number, footRow: number): BoleStand {
	const eye = Math.min(EYE, top / 2);
	const above = rowAngle(topRow, lens.fov);
	const below = -rowAngle(footRow, lens.fov);
	const bark = distanceSpanning(top, eye, above + below);
	return { eye, bark, pitch: Math.atan2(top - eye, bark) - above };
}

/**
 * The view up the stem from its foot. The camera stands at a person's eye height, `stand` stem
 * radii from the stem's axis as the photograph's camera stands, or else a step back from the bark.
 * With `forkRow`, it pitches up until the bark where the stem first divides lands on that row of
 * the frame, as a photograph that looks up the whole height frames where the bole divides; without
 * it, or where that would look steeper than `elevation`, it pitches by `elevation`. With `footRow`
 * and `crownRow`, it stands as far back and pitches up as far as puts the ground at the bark and the
 * crown's base on those rows, as a photograph that looks up a tall clean bole from a few steps away
 * frames it. `aside` turns the look to the right
 * of the stem by that many degrees, so the stem enters the frame from its lower left, as a
 * photograph of the crown's underside shows it.
 */
export function belowView(
	plant: ClosePlant,
	turn: number,
	lens: Lens,
	framing: BelowFraming,
): CloseView {
	const { elevation, forkRow, footRow, crownRow, aside = 0, stand } = framing;
	const { skeleton } = plant;
	const foot = stemFoot(skeleton);
	const fork = firstForkHeight(skeleton);
	// A bole framed from its foot to its crown's base needs the base above the foot in the frame
	// and well above the eye; otherwise the camera takes the plain view up the stem, and says so.
	const warnings: string[] = [];
	let bole: BoleStand | undefined;
	if (footRow !== undefined && crownRow !== undefined) {
		if (footRow - crownRow < LEAST_ROW_GAP - 1e-9)
			warnings.push(
				"the crown's row does not stand well above the foot's row, so the camera takes the plain view up the stem",
			);
		else if (skeleton.crownBase < CLEAN_BOLE_EYES * EYE)
			warnings.push(
				"the crown's base stands under twice a person's eye height, so the camera takes the plain view up the stem",
			);
		else bole = boleStand(skeleton.crownBase, lens, crownRow, footRow);
	}

	// A plant taller than a person is looked up at from a person's eye height. A shorter plant
	// stands under the eye entirely, so the camera drops to a height within it: a few steps back
	// at that height the crown still stands above the lens and the view reads up through the plant.
	const eye = bole?.eye ?? Math.min(EYE, Math.max(BELOW_LOWEST_EYE, skeleton.height * 0.35));
	// A plant with no stem at eye height, such as a tuft or a rosette, has no bark to look up: its
	// camera stands low at the rim of its own spread and looks up through the leaves, as a photograph
	// taken from the plant's foot does. A stem's radius would put it inside the plant.
	// A short plant has no stem at a person's eye height whatever kind it is, so the test looks for
	// one within the plant: a fern's stipes are a stem to look up, a tuft has none at any height.
	const stemless = stemAt(skeleton, Math.min(EYE, skeleton.height * 0.5)) === undefined;
	const spread =
		Math.max(
			(skeleton.bounds.max[0] as number) - (skeleton.bounds.min[0] as number),
			(skeleton.bounds.max[2] as number) - (skeleton.bounds.min[2] as number),
		) / 2;
	const height = stemless ? Math.max(0.1, Math.min(EYE, skeleton.height * STEMLESS_EYE)) : eye;
	const radius = stemAt(skeleton, height)?.radius ?? stemAt(skeleton, 1)?.radius ?? 0.1;
	const reach = bole
		? bole.bark + radius
		: stemless
			? spread * STEMLESS_STAND
			: stand !== undefined
				? stand * radius
				: radius + BELOW_STANDOFF;
	const standAt = (t: number): V3 => {
		const o = facing(t);
		return [foot[0] + o[0] * reach, height, foot[2] + o[2] * reach];
	};
	// A low branch or its leaves may stand where the photographer would: the camera walks round the
	// stem, a step to either side in turn, to the nearest stand clear of the plant.
	let walked: number | undefined;
	for (let k = 0; k <= 180 / WALK_STEP && walked === undefined; k++) {
		const offsets = k === 0 ? [0] : [k * WALK_STEP, -k * WALK_STEP];
		walked = offsets.find((o) => standsClear(plant, standAt(turn + o * DEG)));
	}
	if (walked === undefined)
		warnings.push(
			'no stand round the stem is clear of the plant, so the camera keeps the one its turn asks',
		);
	const out = facing(turn + (walked ?? 0) * DEG);
	const position = standAt(turn + (walked ?? 0) * DEG);
	let pitch = bole ? bole.pitch / DEG : Math.min(STEEPEST, elevation);
	if (!bole && forkRow !== undefined && fork !== undefined && fork > height) {
		// The fork shows where the bark nearest the camera divides, a radius nearer than the axis.
		const near = reach - (stemAt(skeleton, fork)?.radius ?? 0);
		const forkAngle = Math.atan2(fork - height, Math.max(0.1, near)) / DEG;
		pitch = Math.max(0, Math.min(pitch, forkAngle - rowAngle(forkRow, lens.fov) / DEG));
	}
	const level = yawed([-out[0], 0, -out[2]], -aside * DEG);
	const look: V3 = [
		level[0] * Math.cos(pitch * DEG),
		Math.sin(pitch * DEG),
		level[2] * Math.cos(pitch * DEG),
	];
	return {
		position,
		target: step(position, look, 1),
		subject: {
			kind: stemless ? 'the plant from its foot' : 'the stem from its foot',
			...(bole && { crownBase: skeleton.crownBase }),
			standoff: stemless ? reach : reach - radius,
			stemRadius: radius,
			fork: fork ?? null,
			pitch,
			aside,
			walked: walked ?? 0,
			...(warnings.length > 0 && { warning: warnings.join('; ') }),
		},
	};
}

/** Whether a camera at `position` stands clear of the plant's wood and leaves by `CLEARANCE`. */
function standsClear(plant: ClosePlant, position: V3): boolean {
	const spheres = plantSpheres(plant.skeleton, plant.shoots, plant.prototypes, position, 1);
	const d = spheres.data;
	for (let i = 0; i < spheres.count; i++) {
		const gap =
			Math.hypot(
				(d[i * 4] as number) - position[0],
				(d[i * 4 + 1] as number) - position[1],
				(d[i * 4 + 2] as number) - position[2],
			) - (d[i * 4 + 3] as number);
		if (gap < CLEARANCE) return false;
	}
	return true;
}

/** A limb that leaves the main stem: where, the stem's radius and direction there, and its own. */
export interface Departure {
	readonly axis: number;
	readonly at: V3;
	readonly stem: AxisPoint;
	readonly direction: V3;
	readonly radius: number;
	/** Metres the limb runs from where it leaves. */
	readonly length: number;
	/** Degrees between the stem's line and the limb's. */
	readonly angle: number;
}

/**
 * The limbs that leave the main stem, thickest first, and the one among them that carries the
 * stem's own line on past its fork, if one does.
 */
export function departures(skeleton: MacroSkeleton): {
	readonly limbs: Departure[];
	readonly leader?: Departure;
} {
	const stem = mainStem(skeleton);
	if (stem < 0) return { limbs: [] };
	const { axes } = skeleton;
	const list: Departure[] = [];
	for (let a = 0; a < axes.count; a++) {
		if ((axes.parent[a] as number) !== stem) continue;
		const node = axes.parentNode[a] as number;
		if (node < 0) continue;
		const before = skeleton.parent[node] as number;
		const stemDirection = before >= 0 ? between(skeleton, before, node) : ([0, 1, 0] as V3);
		const stemRadius = skeleton.radius[node] as number;
		const radius = skeleton.radius[axes.first[a] as number] as number;
		const direction = departure(skeleton, a, stemRadius + 2 * radius);
		const angle = Math.acos(Math.max(-1, Math.min(1, dot(direction, stemDirection)))) / DEG;
		const at = nodeAt(skeleton, node);
		list.push({
			axis: a,
			at,
			stem: { at, direction: stemDirection, radius: stemRadius },
			direction,
			radius,
			length: lengthOf(skeleton, a),
			angle,
		});
	}
	// The stem runs on into its thickest child near its own line.
	const leader = list.reduce<Departure | undefined>(
		(best, d) => (d.angle < LEADER_ANGLE && (!best || d.radius > best.radius) ? d : best),
		undefined,
	);
	return {
		limbs: list.filter((d) => d !== leader).sort((a, b) => b.radius - a.radius),
		...(leader && { leader }),
	};
}

/** The share of its picture's frame that a close view's subject box takes across and down. */
export interface SubjectBoxShare {
	readonly width: number;
	readonly height: number;
}

/**
 * The frame's height that a junction view takes: the limb's thickness must not outgrow the
 * photograph's subject box height share, and the stem's width must not outgrow its width share, so
 * the frame takes whichever need is the larger. Without the shares, the limb's diameter fills its
 * own share of the frame, as the view did before a picture's box was measured.
 */
export function junctionFrameHeight(
	limbDiameter: number,
	stemDiameter: number,
	shares: SubjectBoxShare | undefined,
	aspect: number,
): number {
	if (!shares) return limbDiameter / JUNCTION_LIMB_SHARE;
	return Math.max(limbDiameter / shares.height, stemDiameter / (shares.width * aspect));
}

/**
 * The limbs a junction view takes as its candidates: a great limb, or a thinner stipe of the dead
 * skirt whose crotch stands below the living crown, and each running out of the frame as the
 * photograph's limb does.
 */
export function junctionCandidates(
	limbs: readonly Departure[],
	thickest: number,
	lens: Lens,
	crownBase: number,
): readonly Departure[] {
	return limbs.filter(
		(d) =>
			(d.radius >= JUNCTION_THICK * thickest ||
				(d.radius >= JUNCTION_SKIRT_THICK * thickest && d.at[1] < crownBase)) &&
			d.length >= ((2 * d.radius) / JUNCTION_LIMB_SHARE) * lens.aspect,
	);
}

/**
 * The view of a great limb leaving the stem. It takes the thick limbs that leave the stem and run
 * on past the frame, each seen side on across the plane of the stem and the limb so its angle of
 * departure shows at its true size, framed so the limb's thickness and the stem's width take the
 * shares of the frame that the photograph's subject box gives them, and stands where the fewest
 * other limbs come between the lens and the junction. The stem and the limb that carries it on
 * stand in as the photograph's trunk.
 */
export function junctionView(
	plant: ClosePlant,
	lens: Lens,
	shares?: SubjectBoxShare,
): CloseView | undefined {
	const { skeleton } = plant;
	const { limbs, leader } = departures(skeleton);
	const thickest = limbs[0]?.radius ?? 0;
	const stem = mainStem(skeleton);
	// A thick limb that runs out of the frame, as the photograph's does, rather than ending in it.
	const thick = junctionCandidates(limbs, thickest, lens, skeleton.crownBase);
	// A limb leaves level where it stands square to the stem's line, rising or drooping alike. Every
	// thick limb is a candidate: the near-level departure is a bonus, so a crotch that stands clear
	// of the crown can win over a level one buried behind it.
	const off = (d: Departure) => Math.abs(90 - d.angle);
	const subjects: Subject<Departure>[] = thick.flatMap((limb) => {
		const height = junctionFrameHeight(2 * limb.radius, 2 * limb.stem.radius, shares, lens.aspect);
		return [
			{
				// The crotch: where the limb's underside leaves the stem's surface.
				target: step(
					step(limb.at, limb.direction, limb.stem.radius),
					[0, -1, 0],
					limb.radius * 0.5,
				),
				normal: normalize(cross(limb.stem.direction, limb.direction)),
				spin: limb.stem.direction,
				distance: distanceFor(height, lens.fov),
				mark: {
					axes: markAxes(skeleton, [stem, leader?.axis ?? -1], [limb.axis]),
					band: limb.stem.radius + height / 2,
				},
				// A thick limb and a wide departure are what the photograph shows, and a limb
				// running to the right reads as its limb does.
				bonus: (shot: Shot) =>
					0.1 * (limb.radius / thickest) +
					0.1 * Math.sin(Math.min(90, limb.angle) * DEG) +
					0.1 * (1 - Math.min(off(limb), 90) / 90) +
					(dot(limb.direction, lensAxes(shot).right) > 0 ? 0.03 : 0),
				facts: limb,
			},
		];
	});
	// The limbs of a whorl stand round the junction, so its cameras walk further round the stem.
	const found = bestOf(
		plant,
		subjects,
		lens,
		WEIGHINGS.junction,
		RISE.junction,
		[0, -25, 25, -50, 50, -75, 75],
	);
	if (!found) return undefined;
	const limb = found.subject.facts;
	return {
		...found.shot,
		clutter: found.clutter,
		subject: {
			kind: 'a limb leaving the stem',
			axis: limb.axis,
			radius: limb.radius,
			stemRadius: limb.stem.radius,
			angle: limb.angle,
			length: limb.length,
			height: limb.at[1],
		},
	};
}

/** The great limbs that leave the stem and run out of a frame `height` metres tall. */
function greatLimbs(skeleton: MacroSkeleton, frame: (limb: Departure) => number): Departure[] {
	const { limbs } = departures(skeleton);
	const thickest = limbs[0]?.radius ?? 0;
	return limbs.filter((d) => d.radius >= JUNCTION_THICK * thickest && d.length >= frame(d));
}

/** A point on a limb and how level the limb runs there, in degrees above or below level. */
interface LevelPoint {
	readonly limb: Departure;
	readonly at: AxisPoint;
	readonly tilt: number;
}

/** The most level point of a limb within the stretch the view from inside the crown searches. */
function levelPoint(skeleton: MacroSkeleton, limb: Departure): LevelPoint {
	const [from, to, by] = INSIDE_STRETCH;
	let best: LevelPoint | undefined;
	for (let share = from; share <= to + 1e-9; share += by) {
		const at = pointAlong(skeleton, limb.axis, share);
		const tilt = Math.abs(Math.asin(Math.max(-1, Math.min(1, at.direction[1])))) / DEG;
		if (!best || tilt < best.tilt) best = { limb, at, tilt };
	}
	return best as LevelPoint;
}

/**
 * The view from inside the crown beside a great limb, as its photograph stands: under the limb and
 * beside it, near enough that the limb's thickness fills a share of the frame, looking up across
 * it into the crown, so the limb crosses the lower part of the frame and the crown's underside
 * fills the rest. It takes the great limb that runs most nearly level, at its most level stretch,
 * as the photograph's limb is carried almost level.
 */
export function insideView(plant: ClosePlant, lens: Lens): CloseView | undefined {
	const { skeleton } = plant;
	const tall = (p: LevelPoint) => (2 * p.at.radius) / INSIDE_LIMB_SHARE;
	const points = greatLimbs(skeleton, () => 0)
		.map((limb) => levelPoint(skeleton, limb))
		.filter((p) => p.limb.length >= tall(p) * lens.aspect);
	const flattest = points.reduce((least, p) => Math.min(least, p.tilt), 90);
	const subjects: Subject<LevelPoint>[] = points
		.filter((p) => p.tilt <= flattest + INSIDE_TILT)
		.map((point) => {
			const height = tall(point);
			return {
				// The limb runs low in the frame, the crown above it.
				target: step(point.at.at, [0, 1, 0], SURFACE_LIFT * height),
				normal: across(point.at.direction),
				spin: point.at.direction,
				distance: distanceFor(height, lens.fov),
				mark: { axes: markAxes(skeleton, [], [point.limb.axis]), band: height / 2 },
				bonus: () => 0.01 * (INSIDE_TILT - (point.tilt - flattest)),
				facts: point,
			};
		});
	// The camera keeps near square to the limb, so the limb crosses the frame as the photograph's does.
	const found = bestOf(
		plant,
		subjects,
		lens,
		WEIGHINGS.inside,
		RISE.inside,
		[0, -20, 20],
		INSIDE_TIPS,
	);
	if (!found) return undefined;
	const point = found.subject.facts;
	return {
		...found.shot,
		clutter: found.clutter,
		subject: {
			kind: 'a great limb from inside the crown',
			axis: point.limb.axis,
			radius: point.at.radius,
			tilt: point.tilt,
		},
	};
}

/**
 * The view of the bark on a great limb, as its photograph shows it: the limb crossing the frame,
 * its thickness filling `girth` of the frame's height, `share` of the way along it, seen across its
 * run from the side where the least of the rest of the plant stands in front of it.
 */
export function barkLimbView(
	plant: ClosePlant,
	lens: Lens,
	girth: number,
	share: number,
): CloseView | undefined {
	const { skeleton } = plant;
	const tall = (d: Departure) => (2 * pointAlong(skeleton, d.axis, share).radius) / girth;
	const subjects: Subject<Departure>[] = greatLimbs(skeleton, (d) => tall(d) * lens.aspect).map(
		(limb) => {
			const at = pointAlong(skeleton, limb.axis, share);
			const height = tall(limb);
			return {
				target: at.at,
				normal: across(at.direction),
				spin: at.direction,
				distance: distanceFor(height, lens.fov),
				mark: { axes: markAxes(skeleton, [limb.axis]), band: height / 2 },
				bonus: () => 0,
				facts: limb,
			};
		},
	);
	const found = bestOf(plant, subjects, lens, WEIGHINGS.bark, RISE.bark);
	if (!found) return undefined;
	const limb = found.subject.facts;
	return {
		...found.shot,
		clutter: found.clutter,
		subject: {
			kind: 'the bark on a great limb',
			axis: limb.axis,
			radius: pointAlong(skeleton, limb.axis, share).radius,
			share,
		},
	};
}

/**
 * The level distance from the bark at which a run of bark from the ground up to `top`, seen from
 * an eye `eye` metres up, spans `angle` radians of the frame's height. The eye stands no higher
 * than the run's middle, so the span shrinks as the eye steps back and one distance gives it.
 */
function distanceSpanning(top: number, eye: number, angle: number): number {
	let near = 1e-3;
	let far = 1e4;
	for (let k = 0; k < 60; k++) {
		const middle = Math.sqrt(near * far);
		if (Math.atan2(top - eye, middle) + Math.atan2(eye, middle) > angle) near = middle;
		else far = middle;
	}
	return Math.sqrt(near * far);
}

/**
 * The view of the bole from its foot to where it first divides, as its photograph frames it: from
 * a person's eye height, or from half the bole's height on a bole too low for that, so far back and
 * pitched up so far that the ground at the bark lands on the frame's lower margin and the first
 * division lands a set share of the frame below its top, with the limbs leaving it above. It stands
 * on the side of the stem where the least of the plant crosses in front of the bole; the turns nearest
 * `turn` win a tie, so a plant with nothing in the way keeps the view its query asks.
 */
export function trunkView(plant: ClosePlant, lens: Lens, turn: number): CloseView | undefined {
	const { skeleton } = plant;
	const stem = mainStem(skeleton);
	if (stem < 0) return undefined;
	const foot = stemFoot(skeleton);
	const fork = firstForkHeight(skeleton) ?? Math.max(skeleton.crownBase, skeleton.height * 0.3);
	const { eye, bark, pitch } = boleStand(fork, lens, BOLE_TOP, 1 - MARGIN);
	const back = bark + (stemAt(skeleton, eye)?.radius ?? 0);
	const target: V3 = [foot[0], eye + back * Math.tan(pitch), foot[2]];
	const out = facing(turn);
	const normal: V3 = [out[0] * Math.cos(pitch), -Math.sin(pitch), out[2] * Math.cos(pitch)];
	const distance = back / Math.cos(pitch);
	const { leader } = departures(skeleton);
	const subjects: Subject<number>[] = [
		{
			target,
			normal,
			spin: [0, 1, 0],
			distance,
			// The bole and what carries it on are the subject; the limbs that leave it count as
			// what stands round it.
			mark: { axes: markAxes(skeleton, [stem, leader?.axis ?? -1]), band: distance },
			bonus: (shot: Shot) => {
				const away = normalize([shot.position[0] - target[0], 0, shot.position[2] - target[2]]);
				return 0.02 * dot(away, out);
			},
			sides: [1],
			facts: stem,
		},
	];
	// Turning about the upright keeps each camera at the eye's height and pitch.
	const turns = Array.from({ length: 360 / WALK_STEP }, (_, k) => k * WALK_STEP - 180 + WALK_STEP);
	const found = bestOf(plant, subjects, lens, WEIGHINGS.bole, [-90, 90], turns, [0]);
	const shot = found?.shot ?? { position: step(target, normal, distance), target };
	return {
		...shot,
		...(found && { clutter: found.clutter }),
		subject: {
			kind: 'the bole to its first division',
			turned: (Math.atan2(shot.position[0] - target[0], shot.position[2] - target[2]) - turn) / DEG,
			fork,
			eye,
			pitch: pitch / DEG,
			stand: back,
		},
	};
}

/** A limb dividing into two arms. */
export interface Fork {
	readonly node: number;
	readonly at: V3;
	/** The limb that divides and the arm that leaves it. */
	readonly limb: number;
	readonly arm: number;
	/** The limb's radius at the fork, and the radius of the arm. */
	readonly radius: number;
	readonly armRadius: number;
	/** The limb's direction into the fork and on past it, and the arm's. */
	readonly into: V3;
	readonly on: V3;
	readonly out: V3;
	/** Metres from the stem's axis to the fork. */
	readonly reach: number;
}

/**
 * The places where a limb divides into two arms of a size: an axis leaves a limb, not the main
 * stem, at no less than `FORK_ARM` of the limb's radius there, and the limb runs on past it.
 */
export function forks(skeleton: MacroSkeleton): Fork[] {
	const stem = mainStem(skeleton);
	const foot = stemFoot(skeleton);
	const { axes } = skeleton;
	const out: Fork[] = [];
	for (let a = 0; a < axes.count; a++) {
		const parent = axes.parent[a] as number;
		if (parent < 0 || parent === stem) continue;
		const node = axes.parentNode[a] as number;
		if (node < 0) continue;
		const radius = skeleton.radius[node] as number;
		const armRadius = skeleton.radius[axes.first[a] as number] as number;
		if (armRadius < FORK_ARM * radius) continue;
		const next = nextOnAxis(skeleton, parent, node);
		const before = skeleton.parent[node] as number;
		if (next < 0 || before < 0) continue;
		const at = nodeAt(skeleton, node);
		out.push({
			node,
			at,
			limb: parent,
			arm: a,
			radius,
			armRadius,
			into: between(skeleton, before, node),
			on: between(skeleton, node, next),
			out: departure(skeleton, a, 2 * radius),
			reach: Math.hypot(at[0] - foot[0], at[2] - foot[2]),
		});
	}
	return out;
}

/**
 * The roll, in radians about a shot's line of sight, that turns the picture until `direction`
 * points up the frame; none where the direction runs along the line of sight.
 */
function rollUpright(shot: Shot, direction: V3): number {
	const { forward, right, up } = lensAxes(shot);
	const across = dot(direction, right);
	const along = dot(direction, up);
	if (Math.hypot(across, along) < 0.2 * Math.hypot(...direction)) return 0;
	const wanted = normalize([
		right[0] * across + up[0] * along,
		right[1] * across + up[1] * along,
		right[2] * across + up[2] * along,
	]);
	return Math.atan2(dot(cross(up, wanted), forward), dot(up, wanted));
}

/**
 * The items that pass each test in turn, a test passed over where nothing would be left, and
 * whether each test held.
 */
function preferring<T>(
	items: readonly T[],
	...tests: readonly ((item: T) => boolean)[]
): { readonly kept: T[]; readonly held: boolean[] } {
	let kept = [...items];
	const held: boolean[] = [];
	for (const test of tests) {
		const passing = kept.filter(test);
		held.push(passing.length > 0);
		if (passing.length > 0) kept = passing;
	}
	return { kept, held };
}

/** The normal of the plane a fork's two arms part in. */
function planeNormal(fork: Fork): V3 {
	const plane = cross(fork.on, fork.out);
	return Math.hypot(...plane) > 1e-3 ? normalize(plane) : across(fork.into);
}

/**
 * How far a fork's arms run from its joint, their twigs included: the farthest node of the two
 * subtrees the joint divides into. The photograph frames both arms and the twigs they carry, so the
 * frame follows this reach rather than the limb's thickness alone.
 */
function armsReach(skeleton: MacroSkeleton, fork: Fork): number {
	const { axes, position } = skeleton;
	// Every axis that descends from the two arms, by walking each one's parents.
	const inside = new Set<number>([fork.arm, fork.limb]);
	for (let a = 0; a < axes.count; a++) {
		let parent = axes.parent[a] as number;
		for (let guard = 0; parent >= 0 && guard <= axes.count; guard++) {
			if (inside.has(parent)) {
				inside.add(a);
				break;
			}
			parent = axes.parent[parent] as number;
		}
	}
	let reach = 0;
	for (const axis of inside)
		for (let n = axes.first[axis] as number; n <= (axes.last[axis] as number); n++) {
			const at = skeleton.position;
			reach = Math.max(
				reach,
				Math.hypot(
					(at[n * 3] as number) - fork.at[0],
					(at[n * 3 + 1] as number) - fork.at[1],
					(at[n * 3 + 2] as number) - fork.at[2],
				),
			);
		}
	return reach;
}

/**
 * The view of a limb dividing into two. It takes the forks whose limb is nearest `thin` metres of
 * radius, or a share of the stem's own radius, away from the stem, seen square to the plane of the
 * two arms so the fork opens at its true angle, from the side where the least of the rest of the
 * plant stands in front of the fork or behind it. The frame spans both arms and the twigs they
 * carry, at least as far as the limb below the joint fills the share of it that the photograph
 * gives, and never out into the crown above them; `span` asks for a frame height in metres instead,
 * as it does for a limb. Arms nearer the limb's own size, and a fork that stands upright so a level
 * camera sees it square, make the likelier subject.
 */
/**
 * What the fork view's wishes keep of a plant's divisions, each count among those left by the wish
 * before it, so a fork view that draws no fork can say which wish emptied it. A count above zero
 * with no subject means the divisions exist but no camera sees one clear.
 */
export function forkCandidates(
	skeleton: MacroSkeleton,
	thin?: number,
): {
	readonly total: number;
	readonly counts: readonly number[];
	readonly kept: number;
	readonly sought: number;
} {
	const stemRadius = stemAt(skeleton, 1.3)?.radius ?? stemAt(skeleton, 0.3)?.radius ?? 0.1;
	const sought = thin ?? FORK_STEM_SHARE * stemRadius;
	const stem = mainStem(skeleton);
	const all = forks(skeleton);
	const outside = all.filter((f) => f.reach > stemRadius + 2 * f.radius);
	const wishes = [
		(f: Fork) => (skeleton.axes.parent[f.limb] as number) === stem,
		(f: Fork) => Math.abs(Math.log(f.radius / sought)) <= Math.log(FORK_SIZE),
		(f: Fork) => f.armRadius >= FORK_EVEN * f.radius,
		(f: Fork) => Math.hypot(...cross(f.on, f.out)) >= FORK_OPEN,
	];
	let kept = outside;
	const counts: number[] = [outside.length];
	for (const wish of wishes) {
		const passing = kept.filter(wish);
		if (passing.length > 0) kept = passing;
		counts.push(passing.length);
	}
	return { total: all.length, counts, kept: kept.length, sought };
}

export function forkView(
	plant: ClosePlant,
	lens: Lens,
	thin?: number,
	span?: number,
): CloseView | undefined {
	const { skeleton } = plant;
	const stemRadius = stemAt(skeleton, 1.3)?.radius ?? stemAt(skeleton, 0.3)?.radius ?? 0.1;
	const sought = thin ?? FORK_STEM_SHARE * stemRadius;
	// The photograph's fork: a great limb, one that leaves the stem, dividing into two even arms that
	// part wide, in an upright plane, on a limb that rises into it, so the limb comes up from the
	// lower edge and both arms leave upward. Each wish in turn narrows the forks that meet the wishes
	// before it, where any of those forks meets it.
	const stem = mainStem(skeleton);
	const { kept, held } = preferring(
		forks(skeleton).filter((f) => f.reach > stemRadius + 2 * f.radius),
		(f) => (skeleton.axes.parent[f.limb] as number) === stem,
		(f) => Math.abs(Math.log(f.radius / sought)) <= Math.log(FORK_SIZE),
		(f) => f.armRadius >= FORK_EVEN * f.radius,
		(f) => Math.hypot(...cross(f.on, f.out)) >= FORK_OPEN,
	);
	const subjects: Subject<Fork>[] = kept
		.sort((a, b) => Math.abs(Math.log(a.radius / sought)) - Math.abs(Math.log(b.radius / sought)))
		.slice(0, MOST_SUBJECTS)
		.map((fork) => {
			// The photograph frames both arms and their twigs with the limb coming up to the joint from
			// below. The frame never runs past the arms' own reach into the crown above them.
			const reach = Math.min(armsReach(skeleton, fork), FORK_REACH_DIAMETERS * 2 * fork.radius);
			const height = span ?? Math.max((2 * fork.radius) / FORK_LIMB_SHARE, FORK_ARM_SPAN * reach);
			const normal = planeNormal(fork);
			const size = Math.max(0, 1 - Math.abs(Math.log(fork.radius / sought)));
			// The photograph's fork opens wide: arms that part at a right angle show it best.
			const opening = Math.hypot(...cross(fork.on, fork.out));
			return {
				// The joint stands a little under the frame's middle, the limb coming up to it from
				// below and both arms above it.
				target: step(fork.at, fork.into, (FORK_ROW - 0.5) * height),
				normal,
				spin: fork.into,
				distance: distanceFor(height, lens.fov),
				mark: { axes: markAxes(skeleton, [fork.limb, fork.arm]), band: height / 2 },
				bonus: () =>
					0.15 * size +
					0.1 * (fork.armRadius / fork.radius) +
					0.1 * opening +
					0.1 * (1 - Math.abs(normal[1])),
				facts: fork,
			};
		});
	// The photograph sees its fork square to the two arms, so every camera keeps near that line.
	const best = bestOf(plant, subjects, lens, WEIGHINGS.fork, RISE.fork, SQUARE_TURNS, SQUARE_TURNS);
	if (!best) return undefined;
	const fork = best.subject.facts;
	return {
		...best.shot,
		// The camera turns about its line of sight until the limb comes up to the fork from the
		// frame's lower edge, as in the photograph, wherever the fork leans.
		roll: rollUpright(best.shot, fork.into),
		clutter: best.clutter,
		subject: {
			kind: 'a limb dividing into two',
			node: fork.node,
			radius: fork.radius,
			armRadius: fork.armRadius,
			sought,
			height: fork.at[1],
			reach: fork.reach,
			// Which of the photograph's wishes were met, each among the forks that meet the wishes
			// before it: a great limb, then a limb near the sought size, then two even arms, then a
			// wide opening. A wish not met says no fork that meets the earlier wishes meets it, not
			// that the plant has no such fork at all.
			wishes: { great: held[0], size: held[1], even: held[2], wide: held[3] },
		},
	};
}

/** What a limb view frames: where along the limb, the wood's radius, and the frame's metres. */
export interface LimbFraming {
	/** The share of the way along the limb that the view looks at. */
	readonly share: number;
	/** The radius of the wood it frames, in metres. */
	readonly thin: number;
	/** The metres the frame's height covers. */
	readonly span: number;
	/** The most degrees the camera stands below the limb, looking up at it. */
	readonly lookUp: number;
}

/** A piece of wood a limb view may frame: its axis, the point it looks at, and its reach. */
interface Piece {
	readonly axis: number;
	readonly point: AxisPoint;
	/** Metres from the stem's axis, across the ground. */
	readonly reach: number;
}

/** The pieces of wood whose radius `share` of the way along stands nearest `thin`, furthest first. */
function limbPieces(skeleton: MacroSkeleton, share: number, thin: number): Piece[] {
	const { axes } = skeleton;
	const foot = stemFoot(skeleton);
	const tolerance = Math.max(0.005, thin * 0.25);
	const pieces: Piece[] = [];
	for (let a = 0; a < axes.count; a++) {
		if ((axes.parent[a] as number) < 0) continue;
		const point = pointAlong(skeleton, a, share);
		if (point.at[1] < 0.5 || Math.abs(point.radius - thin) > tolerance) continue;
		pieces.push({
			axis: a,
			point,
			reach: Math.hypot(point.at[0] - foot[0], point.at[2] - foot[2]),
		});
	}
	return pieces.sort((a, b) => b.reach - a.reach);
}

/** The camera distance at which `span` metres fill a lens with a margin, beside wood of a radius. */
function spanDistance(span: number, radius: number, fov: number): number {
	return distanceFor(span / (1 - 2 * MARGIN), fov) + radius;
}

/**
 * The view of a limb seen across its own run: one branch with its side branches and their shoots,
 * against as plain a ground as the plant gives. It takes the pieces of wood whose radius `share` of
 * the way along stands nearest `thin` metres, the furthest from the stem first, and frames `span`
 * metres of each from the side where the least of the rest of the plant stands in front of it.
 */
export function limbView(
	plant: ClosePlant,
	lens: Lens,
	framing: LimbFraming,
): CloseView | undefined {
	const { skeleton } = plant;
	const foot = stemFoot(skeleton);
	const pieces = limbPieces(skeleton, framing.share, framing.thin);
	const outermost = pieces[0]?.reach ?? 1;
	const distance = spanDistance(framing.span, framing.thin, lens.fov);
	// A branch's photograph stands it against a plain ground, which the crown gives in few places,
	// so the view weighs twice as many pieces as the others weigh subjects.
	const subjects: Subject<Piece>[] = pieces.slice(0, MOST_SUBJECTS * 2).map((piece) => ({
		target: piece.point.at,
		normal: across(piece.point.direction),
		spin: piece.point.direction,
		distance,
		mark: { axes: markAxes(skeleton, [], [piece.axis]), shoots: true, band: framing.span / 2 },
		// The outer crown, and a camera outside it, give the plainest ground.
		bonus: (shot: Shot) =>
			0.05 * (piece.reach / outermost) +
			(Math.hypot(shot.position[0] - foot[0], shot.position[2] - foot[2]) > piece.reach ? 0.03 : 0),
		facts: piece,
	}));
	const found = bestOf(plant, subjects, lens, WEIGHINGS.branch, [-framing.lookUp, LOOK_DOWN]);
	if (!found) return undefined;
	const piece = found.subject.facts;
	return {
		...found.shot,
		clutter: found.clutter,
		subject: {
			kind: 'a branch with its side branches',
			axis: piece.axis,
			radius: piece.point.radius,
			reach: piece.reach,
			height: piece.point.at[1],
			span: framing.span,
		},
	};
}

/**
 * The view of the crown's outer surface as its photograph shows it: from under the crown's lower
 * rim, looking up past its edge. It takes the pieces of wood whose radius `share` of the way along
 * stands nearest `thin` metres, the furthest out first and the lowest preferred, and stands inside
 * the rim and under it, looking out and up at the photograph's angle, so the rim's shoots stand
 * against what lies beyond the crown. It frames `span` metres above the limb, so the limb runs low
 * across the frame and its shoots rise above it.
 */
export function surfaceView(
	plant: ClosePlant,
	lens: Lens,
	framing: Omit<LimbFraming, 'lookUp'>,
): CloseView | undefined {
	const { skeleton } = plant;
	const foot = stemFoot(skeleton);
	const pieces = limbPieces(skeleton, framing.share, framing.thin);
	const outermost = pieces[0]?.reach ?? 1;
	const base = skeleton.crownBase;
	const top = Math.max(base + 0.1, skeleton.height);
	const distance = spanDistance(framing.span, framing.thin, lens.fov);
	const lift = framing.span * SURFACE_LIFT;
	const subjects: Subject<Piece>[] = pieces.slice(0, MOST_SUBJECTS).map((piece) => {
		const outward = normalize([piece.point.at[0] - foot[0], 0, piece.point.at[2] - foot[2]]);
		const low = 1 - Math.min(1, Math.max(0, (piece.point.at[1] - base) / (top - base)));
		return {
			target: [piece.point.at[0], piece.point.at[1] + lift, piece.point.at[2]],
			// The camera stands on the stem's side of the rim, looking out past it.
			normal: [-outward[0], 0, -outward[2]],
			spin: [0, 1, 0],
			sides: [1],
			distance,
			mark: { band: framing.span * 0.25 },
			bonus: () => 0.05 * (piece.reach / outermost) + 0.1 * low,
			facts: piece,
		};
	});
	const found = bestOf(
		plant,
		subjects,
		lens,
		WEIGHINGS.surface,
		RISE.surface,
		[0, -30, 30, -60, 60],
		SURFACE_TIPS,
	);
	if (!found) return undefined;
	const piece = found.subject.facts;
	return {
		...found.shot,
		clutter: found.clutter,
		subject: {
			kind: "the crown's outer rim from under it",
			axis: piece.axis,
			radius: piece.point.radius,
			reach: piece.reach,
			height: piece.point.at[1],
			span: framing.span,
		},
	};
}

/** The direction a shoot row grows: its frame's +Y. */
function shootDirection(rows: ShootRows, row: number): V3 {
	const x = rows.rotation[row * 4] as number;
	const y = rows.rotation[row * 4 + 1] as number;
	const z = rows.rotation[row * 4 + 2] as number;
	const w = rows.rotation[row * 4 + 3] as number;
	return normalize([2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)]);
}

/**
 * The view of a twig with its end clusters. The frame spans a set number of leaf lengths, as the
 * photograph's does, or the plant's middle shoot where its leaves have no length. It takes the
 * best-lit shoots whose length is nearest what the frame holds, and stands across the shoot on the
 * side where nothing stands in front of it and the least stands behind it, so the twig shows
 * against a plain ground.
 */
export function twigView(plant: ClosePlant, lens: Lens): CloseView | undefined {
	const { shoots: rows, prototypes } = plant;
	if (rows.count === 0) return undefined;
	const shootLength = (row: number) =>
		(prototypes[rows.prototype[row] as number]?.length ?? 0) * (rows.scale[row] as number);
	let height: number;
	if (plant.leafLength !== undefined) height = TWIG_LEAVES * plant.leafLength;
	else {
		const lengths = Array.from({ length: rows.count }, (_, r) => shootLength(r)).sort(
			(a, b) => a - b,
		);
		height = (lengths[Math.floor(lengths.length / 2)] ?? 0.3) / TWIG_FILL;
	}
	const sought = height * TWIG_FILL;
	const misfit = (row: number) => Math.abs(Math.log(shootLength(row) / sought));
	const chosen = Array.from({ length: rows.count }, (_, r) => r)
		.filter((r) => shootLength(r) > 0)
		.sort((a, b) => misfit(a) - misfit(b))
		.slice(0, MOST_TWIGS * 4)
		.sort((a, b) => (rows.sky[b] as number) - (rows.sky[a] as number))
		.slice(0, MOST_TWIGS);
	const distance = distanceFor(height, lens.fov);
	const subjects: Subject<{ readonly row: number; readonly length: number }>[] = chosen.map(
		(row) => {
			const length = shootLength(row);
			const grows = shootDirection(rows, row);
			const base: V3 = [
				rows.position[row * 3] as number,
				rows.position[row * 3 + 1] as number,
				rows.position[row * 3 + 2] as number,
			];
			return {
				target: step(base, grows, length / 2),
				normal: across(grows),
				spin: grows,
				distance,
				mark: { row, band: length * 0.6 },
				bonus: () => 0,
				facts: { row, length },
			};
		},
	);
	const found = bestOf(plant, subjects, lens, WEIGHINGS.twig, RISE.twig, [0, -45, 45, 90]);
	if (!found) return undefined;
	return {
		...found.shot,
		clutter: found.clutter,
		subject: {
			kind: 'a twig with its end clusters',
			row: found.subject.facts.row,
			length: found.subject.facts.length,
			frame: height,
		},
	};
}

/** The frame's height that the strands view covers, in metres: a stretch of drooping shoots. */
const STRANDS_SPAN = 1.4;
/** Metres the carrying limb stands above the frame's middle: the top quarter's lower edge. */
const STRANDS_LIMB_ABOVE = STRANDS_SPAN / 4;
/** The mid-crown band, as shares of the crown's own height above its base. */
const STRANDS_BAND = [0.18, 0.45] as const;
/** The fewest hanging shoots a stretch must carry to be the subject. */
const STRANDS_LEAST = 3;
/** Metres about the carrying limb within which a shoot counts as hanging from the stretch. */
const STRANDS_REACH = 0.3;
/** The most metres below the limb a hanging shoot may stand and still be in the frame. */
const STRANDS_BELOW = 1.0;
/** The shares of a carrying limb that the view weighs as the stretch's middle. */
const STRANDS_SHARES = [0.2, 0.35, 0.5, 0.65, 0.8] as const;
/** What one shoot in the sight line beyond the strand costs a stretch's score. */
const STRANDS_OCCLUDED = 1.5;

/** A stretch of limb that carries hanging shoots, as the strands view finds it. */
interface StrandStretch {
	readonly axis: number;
	readonly point: AxisPoint;
	/** Shoots hanging below the limb within the frame. */
	readonly hanging: number;
	/** Shoots standing in the frame's sight line, before or beyond the strand. */
	readonly occluded: number;
}

/**
 * The view of a limb's hanging shoots: a level camera at mid-crown height at the crown's outer rim,
 * framing about a metre and a half of strand with the carrying limb across the top quarter and the
 * sky behind it, as a drooping-twig photograph shows them. It takes the stretches of limb from
 * which several shoots hang free below the limb and along which the least of the crown stands in
 * the frame, and looks outward from just inside the rim, so the strands hang against the sky.
 */
export function strandsView(plant: ClosePlant, lens: Lens): CloseView | undefined {
	const { skeleton } = plant;
	const tall = skeleton.height - skeleton.crownBase;
	if (tall <= 0) return undefined;
	const low = skeleton.crownBase + tall * STRANDS_BAND[0];
	const high = skeleton.crownBase + tall * STRANDS_BAND[1];
	const p = skeleton.position;
	let radius = 0;
	for (let n = 0; n < skeleton.nodeCount; n++) {
		const y = p[n * 3 + 1] as number;
		if (y < low || y > high) continue;
		radius = Math.max(radius, Math.hypot(p[n * 3] as number, p[n * 3 + 2] as number));
	}
	if (radius <= 0) return undefined;
	const rows = plant.shoots;
	const distance = distanceFor(STRANDS_SPAN, lens.fov);
	const halfHeight = Math.tan((lens.fov * DEG) / 2);
	const halfWidth = halfHeight * lens.aspect;
	// The shoots a frame of this stretch would hold: below the limb as its fringe, and in the sight
	// line either side of the strand, which should stand against the sky.
	const weigh = (point: AxisPoint): { hanging: number; occluded: number } | undefined => {
		const outward = normalize([point.at[0], 0, point.at[2]]);
		if (!Number.isFinite(outward[0])) return undefined;
		const cards = plant.foliage;
		const count = cards ? cards.length / 3 : rows.count;
		const stride = cards ? 12 : 1;
		const at = (i: number, k: number) =>
			(cards ? (cards[i * 3 + k] as number) : (rows.position[i * 3 + k] as number)) -
			(point.at[k] as number);
		let hanging = 0;
		let occluded = 0;
		for (let i = 0; i < count; i += stride) {
			const dx = at(i, 0);
			const dy = at(i, 1);
			const dz = at(i, 2);
			const along = dx * outward[0] + dz * outward[2];
			const lateral = Math.abs(dx * outward[2] - dz * outward[0]);
			if (lateral <= STRANDS_REACH && -dy > 0.05 && -dy <= STRANDS_BELOW) hanging++;
			if (along + distance <= 0) continue;
			const span = along + distance;
			if (Math.abs(dy) > span * halfHeight || lateral > span * halfWidth) continue;
			occluded++;
		}
		return { hanging, occluded };
	};
	let best: StrandStretch | undefined;
	for (let axis = 0; axis < skeleton.axes.count; axis++) {
		for (const share of STRANDS_SHARES) {
			const point = pointAlong(skeleton, axis, share);
			if (point.at[1] < low || point.at[1] > high) continue;
			if (Math.hypot(point.at[0], point.at[2]) < radius * 0.82) continue;
			if (Math.abs(point.direction[1]) > 0.45) continue;
			const weighed = weigh(point);
			if (!weighed || weighed.hanging < STRANDS_LEAST) continue;
			if (
				!best ||
				weighed.hanging - weighed.occluded * STRANDS_OCCLUDED >
					best.hanging - best.occluded * STRANDS_OCCLUDED
			)
				best = { axis, point, hanging: weighed.hanging, occluded: weighed.occluded };
		}
	}
	if (!best) return undefined;
	const outward = normalize([best.point.at[0], 0, best.point.at[2]]);
	if (!Number.isFinite(outward[0])) return undefined;
	const target: V3 = [best.point.at[0], best.point.at[1] - STRANDS_LIMB_ABOVE, best.point.at[2]];
	// The camera stands level at the rim, looking outward past the strand to the sky.
	const position: V3 = [
		target[0] - outward[0] * distance,
		target[1],
		target[2] - outward[2] * distance,
	];
	return {
		position,
		target,
		subject: {
			kind: 'a limb stretch with hanging shoots',
			hanging: best.hanging,
			occluded: best.occluded,
			height: best.point.at[1],
			frame: STRANDS_SPAN,
		},
	};
}

/** A close view walked round its target by a turn in radians, as a sheet of turns walks round it. */
export function walkedRound(view: CloseView, turn: number): CloseView {
	if (turn === 0) return view;
	const offset = yawed(
		[
			view.position[0] - view.target[0],
			view.position[1] - view.target[1],
			view.position[2] - view.target[2],
		],
		turn,
	);
	return { ...view, position: step(view.target, offset, 1) };
}
