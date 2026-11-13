// The close cameras of the review, each solved from the subject its photograph shows. A shot names
// its subject's points in the plant, stands a camera so each point lands where the photograph has
// it, and carries that contract with it: the frame box every point must land in, the share of the
// frame its thickness must take, and the parts of the picture that must show plant or open ground.
// `checkShot` projects the points through the solved camera and says whether the subject is in the
// picture. A subject the plant does not have, or one the camera cannot frame, gives no shot: the
// picture is void, with the reason, and nothing is measured on it. The solves read only the
// subjects interface, so they hold for any generator that fills it.

import { across, cross, dot, facing, normalize, step, turnedAbout, type V3 } from './anatomy';
import type { Lens } from './close';
import { rowAngle } from './framing';
import { lensAxes } from './sight';
import {
	type Absent,
	type AxisSample,
	absent,
	type BranchPiece,
	departureAngle,
	type ForkSubject,
	type GreatLimb,
	isAbsent,
	type Lobe,
	lacking,
	type Maybe,
	type PlantSubjects,
	sampleAlong,
	sampleAtHeight,
	type TrunkSubject,
} from './subjects';

const DEG = Math.PI / 180;
/** The height of a standing person's eye, in metres. */
const EYE = 1.6;
/** The lowest a camera stands, in metres above the ground. */
const LOWEST_EYE = 0.05;
/** Metres a camera keeps clear of the wood it stands beside. */
const CLEARANCE = 0.25;
/** Degrees a camera walks round a trunk at a time to a stand clear of the limbs. */
const WALK_STEP = 15;
/** The steepest a camera pitches, in degrees, short of straight up. */
const STEEPEST = 85;

/** A camera: where it stands, what it looks at, and the radians it turns about its line of sight. */
export interface Camera {
	readonly position: V3;
	readonly target: V3;
	readonly roll?: number;
}

/** A box of the frame in shares, from its left and top edges: left, top, right, bottom. */
export type FrameBox = readonly [number, number, number, number];

/** One point of a subject, and where the picture must show it. */
export interface ContractPoint {
	readonly name: string;
	readonly at: V3;
	/** The frame box the point must land in. A box may reach past the frame's edge. */
	readonly within: FrameBox;
	/** The subject's thickness at the point, and the share of the frame it must take. */
	readonly size?: {
		readonly metres: number;
		readonly of: 'width' | 'height';
		readonly min: number;
		readonly max: number;
	};
}

/**
 * A part of the picture and the share of it that the plant, or one kind of its parts, must cover.
 * A region of the whole plant is read from a matte or from the picture of the parts. A region of
 * wood or of foliage is read only from the picture of the parts.
 */
export interface ContractRegion {
	readonly name: string;
	readonly box: FrameBox;
	readonly min?: number;
	readonly max?: number;
	/** The parts whose cover is counted; absent, every part of the plant. */
	readonly of?: 'wood' | 'foliage';
	/** For wood, the least radius in metres that counts, so a twig is not taken for a limb. */
	readonly thick?: number;
	/** For wood, the greatest radius in metres that counts, so a trunk is not taken for a limb. */
	readonly thickMost?: number;
}

/**
 * The shares of a wood subject's own radius between which wood is the subject's: thinner wood
 * across it is a branch, and thicker wood is the trunk or a greater limb. The parts picture reads
 * a radius within a few hundredths, so the bounds allow for the subject's own taper and flare.
 */
const SUBJECT_WOOD = 0.75;
const SUBJECT_WOOD_MOST = 1.4;
/** The most of a whole frame that leaves may cover in a picture of bark. */
const MOST_LEAVES_IN_BARK = 0.5;
/** The most of a frame that wood may cover before it is a wall of bark across the picture. */
const MOST_WOOD = 0.7;
/** The most of a wood subject's part of the picture that leaves may lie over. */
const MOST_LEAVES_OVER = 0.2;

/** A solved shot: the camera, and the contract its picture must meet. */
export interface SubjectShot {
	/** What the picture frames, in words. */
	readonly kind: string;
	readonly camera: Camera;
	/** Metres from the lens between which the plant is drawn, where the shot isolates its subject. */
	readonly near?: number;
	readonly far?: number;
	readonly points: readonly ContractPoint[];
	/**
	 * Pairs of points that must stand apart by a share of the frame: across it, or along either of
	 * its sides for a subject that may run across the frame or up it.
	 */
	readonly apart?: readonly {
		readonly a: string;
		readonly b: string;
		readonly least: number;
		readonly along?: 'across' | 'either';
	}[];
	readonly regions: readonly ContractRegion[];
	/** What the solve chose, for the page's facts. */
	readonly facts: Readonly<Record<string, unknown>>;
}

/** A shot, or why the plant gives none. */
export type Solved = SubjectShot | Absent;

/** The share of a picture's frame that its photograph's subject box takes across and down. */
export interface SubjectBoxShare {
	readonly width: number;
	readonly height: number;
}

/** The tangent of half the lens's vertical field of view. */
function tanHalf(lens: Lens): number {
	return Math.tan((lens.fov * DEG) / 2);
}

/** A camera's axes for a line of sight and a roll: its right and its up turn with the roll. */
function axesOf(
	forward: V3,
	roll = 0,
): { readonly forward: V3; readonly right: V3; readonly up: V3 } {
	const { right, up } = lensAxes({ position: [0, 0, 0], target: forward });
	return roll === 0
		? { forward, right, up }
		: { forward, right: turnedAbout(right, forward, roll), up: turnedAbout(up, forward, roll) };
}

/** A camera's own axes, its roll applied. */
export function cameraAxes(camera: Camera): {
	readonly forward: V3;
	readonly right: V3;
	readonly up: V3;
} {
	return axesOf(
		normalize([
			camera.target[0] - camera.position[0],
			camera.target[1] - camera.position[1],
			camera.target[2] - camera.position[2],
		]),
		camera.roll ?? 0,
	);
}

/**
 * Where a point of the plant lands in a camera's frame: shares from the left and top edges, and
 * the metres it stands in front of the lens. A point behind the lens has no place in the frame.
 */
export function project(
	camera: Camera,
	lens: Lens,
	point: V3,
): { readonly x: number; readonly y: number; readonly depth: number } {
	const { forward, right, up } = cameraAxes(camera);
	const v: V3 = [
		point[0] - camera.position[0],
		point[1] - camera.position[1],
		point[2] - camera.position[2],
	];
	const depth = dot(v, forward);
	const half = tanHalf(lens);
	if (depth <= 0) return { x: Number.NaN, y: Number.NaN, depth };
	return {
		x: 0.5 + dot(v, right) / (2 * depth * half * lens.aspect),
		y: 0.5 - dot(v, up) / (2 * depth * half),
		depth,
	};
}

/** The share of the frame's width or height that `metres` take at a depth in front of the lens. */
function shareAt(metres: number, depth: number, lens: Lens, of: 'width' | 'height'): number {
	return metres / (2 * depth * tanHalf(lens) * (of === 'width' ? lens.aspect : 1));
}

/**
 * The camera that looks along `forward` and shows `point` at the frame shares `x` and `y`, from as
 * far as makes the frame `tall` metres high at the point.
 */
function aim(
	point: V3,
	x: number,
	y: number,
	forward: V3,
	tall: number,
	lens: Lens,
	roll = 0,
): Camera {
	const { right, up } = axesOf(forward, roll);
	const wide = tall * lens.aspect;
	const aside = (x - 0.5) * wide;
	const down = (y - 0.5) * tall;
	const centre: V3 = [
		point[0] - right[0] * aside + up[0] * down,
		point[1] - right[1] * aside + up[1] * down,
		point[2] - right[2] * aside + up[2] * down,
	];
	const distance = tall / 2 / tanHalf(lens);
	return {
		position: [
			centre[0] - forward[0] * distance,
			centre[1] - forward[1] * distance,
			centre[2] - forward[2] * distance,
		],
		target: centre,
		...(roll !== 0 && { roll }),
	};
}

/** The roll about `forward` that turns the picture until `direction` points up the frame. */
function rollUp(forward: V3, direction: V3): number {
	const { right, up } = axesOf(forward);
	const aside = dot(direction, right);
	const along = dot(direction, up);
	if (Math.hypot(aside, along) < 0.2) return 0;
	const wanted = normalize([
		right[0] * aside + up[0] * along,
		right[1] * aside + up[1] * along,
		right[2] * aside + up[2] * along,
	]);
	return Math.atan2(dot(cross(up, wanted), forward), dot(up, wanted));
}

/** The least distance between the segments `p1`–`q1` and `p2`–`q2`. */
function segmentGap(p1: V3, q1: V3, p2: V3, q2: V3): number {
	const d1: V3 = [q1[0] - p1[0], q1[1] - p1[1], q1[2] - p1[2]];
	const d2: V3 = [q2[0] - p2[0], q2[1] - p2[1], q2[2] - p2[2]];
	const r: V3 = [p1[0] - p2[0], p1[1] - p2[1], p1[2] - p2[2]];
	const a = dot(d1, d1);
	const e = dot(d2, d2);
	const f = dot(d2, r);
	let s = 0;
	let t = 0;
	if (a > 1e-12 && e > 1e-12) {
		const b = dot(d1, d2);
		const c = dot(d1, r);
		const denominator = a * e - b * b;
		s = denominator > 1e-12 ? Math.max(0, Math.min(1, (b * f - c * e) / denominator)) : 0;
		t = (b * s + f) / e;
		if (t < 0) {
			t = 0;
			s = Math.max(0, Math.min(1, -c / a));
		} else if (t > 1) {
			t = 1;
			s = Math.max(0, Math.min(1, (b - c) / a));
		}
	} else if (a > 1e-12) s = Math.max(0, Math.min(1, -dot(d1, r) / a));
	else if (e > 1e-12) t = Math.max(0, Math.min(1, f / e));
	return Math.hypot(
		r[0] + d1[0] * s - d2[0] * t,
		r[1] + d1[1] * s - d2[1] * t,
		r[2] + d1[2] * s - d2[2] * t,
	);
}

/** Whether the line from `from` to `to` passes through the wood of an axis, or within `margin` of it. */
function crossesAxis(axis: readonly AxisSample[], from: V3, to: V3, margin: number): boolean {
	for (let k = 1; k < axis.length; k++) {
		const a = axis[k - 1] as AxisSample;
		const b = axis[k] as AxisSample;
		if (segmentGap(from, to, a.at, b.at) < Math.max(a.radius, b.radius) + margin) return true;
	}
	return false;
}

/** The wood a sight line may leave out of its reckoning: the subject's own. */
interface Own {
	readonly trunk?: boolean;
	readonly limbs?: readonly number[];
}

/**
 * What stands on the line from a camera to a point of its subject: the trunk or a great limb whose
 * wood the line passes through, by name, or nothing. The subject's own wood is left out.
 */
export function blockedBy(
	subjects: PlantSubjects,
	from: V3,
	to: V3,
	own: Own = {},
	margin = 0,
): string | undefined {
	if (!own.trunk && !isAbsent(subjects.trunk) && crossesAxis(subjects.trunk.axis, from, to, margin))
		return 'the trunk';
	if (!isAbsent(subjects.limbs))
		for (const limb of subjects.limbs) {
			if (own.limbs?.includes(limb.id)) continue;
			if (crossesAxis(limb.axis, from, to, margin)) return `limb ${limb.id}`;
		}
	return undefined;
}

/**
 * Whether a camera at `position` stands clear of the trunk and the great limbs, less its subject's
 * own wood, by a margin of metres off their bark.
 */
function standsClear(
	subjects: PlantSubjects,
	position: V3,
	own: Own = {},
	margin = CLEARANCE,
): boolean {
	return blockedBy(subjects, position, position, own, margin) === undefined;
}

/**
 * The level distance at which a height from the ground up to `top`, seen from an eye `eye` metres
 * up, spans `angle` radians of the frame. The eye stands no higher than the middle of the height,
 * so the span shrinks as the eye steps back and one distance gives it.
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

/** A camera at `position` that pitches up by `pitch` radians and looks toward `level`. */
function pitched(position: V3, level: V3, pitch: number, reach: number): Camera {
	const look: V3 = [level[0] * Math.cos(pitch), Math.sin(pitch), level[2] * Math.cos(pitch)];
	return { position, target: step(position, look, reach) };
}

/**
 * The turn nearest `turn` from which `clear` holds, walking a step to either side in turn, and the
 * degrees it walked; the asked turn, unwalked, where no turn is clear.
 */
function walkTo(
	turn: number,
	clear: (turn: number) => boolean,
): { readonly turn: number; readonly walked: number; readonly clear: boolean } {
	for (let k = 0; k <= 180 / WALK_STEP; k++)
		for (const offset of k === 0 ? [0] : [k * WALK_STEP, -k * WALK_STEP])
			if (clear(turn + offset * DEG))
				return { turn: turn + offset * DEG, walked: offset, clear: true };
	return { turn, walked: 0, clear: false };
}

/**
 * Where the bole ends, for a view up it or along it: the lowest joint of a great limb, which is
 * where the crown's wood begins on a tree that forks and on one whose leader runs to its top alike.
 * A trunk with no great limb ends at its first fork, and failing that at the crown's base.
 */
function boleTop(subjects: PlantSubjects, trunk: TrunkSubject): Maybe<AxisSample> {
	if (!isAbsent(subjects.limbs) && subjects.limbs.length > 0) {
		const lowest = subjects.limbs.reduce((least, limb) => Math.min(least, limb.joint[1]), Infinity);
		const at = sampleAtHeight(trunk.axis, lowest);
		if (at) return at;
	}
	if (!isAbsent(trunk.firstFork)) return trunk.firstFork;
	const base = isAbsent(subjects.crownBase) ? undefined : subjects.crownBase;
	const at = base === undefined || base <= 0 ? undefined : sampleAtHeight(trunk.axis, base);
	return at ?? lacking('the trunk has no great limb or fork, and no crown base stands on it');
}

/** The point where a limb's centre line comes out of the trunk's surface. */
function limbExit(limb: GreatLimb): V3 {
	const t = limb.trunkDirection;
	const l = limb.direction;
	const along = dot(l, t);
	const off = Math.hypot(l[0] - t[0] * along, l[1] - t[1] * along, l[2] - t[2] * along);
	return step(limb.joint, l, limb.trunkRadius / Math.max(off, 0.3));
}

/**
 * Where the trunk's body parts into its limbs to the eye: the trunk at the height of the lowest
 * point at which a great limb's centre line comes out of the bark. Undefined for a trunk with no
 * great limb, or one whose centre line does not reach that height.
 */
function partingOf(subjects: PlantSubjects, trunk: TrunkSubject): AxisSample | undefined {
	if (isAbsent(subjects.limbs) || subjects.limbs.length === 0) return undefined;
	const lowest = subjects.limbs.reduce(
		(least, limb) => Math.min(least, limbExit(limb)[1]),
		Infinity,
	);
	return sampleAtHeight(trunk.axis, lowest);
}

/** The trunk's radius at a height, or at breast height where its centre line misses that height. */
function trunkRadius(trunk: TrunkSubject, height: number): number {
	return sampleAtHeight(trunk.axis, height)?.radius ?? trunk.breast.radius;
}

/** How far off the horizon's point is taken, in metres. */
const HORIZON = 10_000;

/**
 * The horizon ahead of a camera as a point of a contract: it must land outside the frame, below
 * its lower edge for a view that looks up and above its upper edge for a view that looks down, so
 * the picture holds no line where the ground meets the sky.
 */
function horizonPoint(stand: V3, level: V3, side: 'below' | 'above'): ContractPoint {
	return {
		name: 'the horizon',
		at: [stand[0] + level[0] * HORIZON, stand[1], stand[2] + level[2] * HORIZON],
		within: side === 'below' ? [-1e6, 1, 1e6, 1e6] : [-1e6, -1e6, 1e6, 0],
	};
}

/** How a view up the trunk frames it. */
export interface BelowOptions {
	/** Radians round the plant the camera stands at; 0 stands on the +Z side. */
	readonly turn: number;
	/** The row share the top of the bole lands on. */
	readonly forkRow?: number;
	/** The share of the frame's width the trunk takes at the lower edge. */
	readonly trunkShare?: number;
}

/** The share of the bole's height at which the eye stands, on a bole too low for a person's eye. */
const BELOW_EYE_SHARE = 0.45;
/**
 * The degrees above level that the lower edge of a view up the trunk looks at least. The view
 * looks up, so its photograph holds no ground and no horizon: under this the picture is a view of
 * the bole from the side.
 */
const BELOW_EDGE_ABOVE_LEVEL = 5;
/** The row share, just above the frame's lower edge, on which the trunk's share of the frame is read. */
const BELOW_EDGE_ROW = 0.95;
/** How far the fork may stand off the trunk's line at the eye, against the camera's distance, before the trunk counts as leaning. */
const BELOW_LEAN = 0.1;
/** The steps up the bole at which the trunk's place in the frame is read. */
const BELOW_STEPS = 32;
/** The least height of a bole, in metres, that a camera can look up. */
const LEAST_BOLE = 0.3;

/**
 * The view up the trunk into the crown, as picture 03 shows it. The camera stands at a person's eye
 * height beside the trunk, or at under half the bole's height where the bole is lower than that, so
 * the eye is always below the crown's wood. It pitches up until the top of the bole lands on its
 * row, a little above the frame's middle, and stands as far back as gives the trunk its share of
 * the lower edge, but never so far that the frame's lower edge looks down at the ground. A thick
 * low bole then takes more than its share, as it does to a person who stands under it. A plant
 * with no trunk is seen from a low eye beside it instead.
 */
export function belowShot(subjects: PlantSubjects, lens: Lens, options: BelowOptions): Solved {
	if (isAbsent(subjects.trunk)) return lowShot(subjects, lens, options.turn);
	const trunk = subjects.trunk;
	const ended = boleTop(subjects, trunk);
	if (isAbsent(ended)) return ended;
	// Seen from below, the trunk's body ends where its limbs come out of its bark, which on a
	// thick trunk is well above the joints on its centre line.
	const top = partingOf(subjects, trunk) ?? ended;
	const forkRow = options.forkRow ?? 0.42;
	const trunkShare = options.trunkShare ?? 0.42;
	const ground = trunk.base[1];
	const rise = top.at[1] - ground;
	if (rise < LEAST_BOLE) return lowShot(subjects, lens, options.turn);
	// The eye stays under the joints on the trunk's centre line, so it never stands among the limbs.
	const eye = Math.max(LOWEST_EYE, Math.min(EYE, BELOW_EYE_SHARE * (ended.at[1] - ground)));
	const radius = trunkRadius(trunk, ground + eye);
	const above = rowAngle(forkRow, lens.fov);
	const halfFov = (lens.fov * DEG) / 2;
	const pitchAt = (d: number) => Math.min(STEEPEST * DEG, Math.atan2(rise - eye, d) - above);
	// The height at which the frame's lower edge meets the bark, and the trunk's share of it there.
	const edgeAt = (d: number) => {
		const pitch = pitchAt(d);
		const low = pitch - halfFov;
		const bark = d - radius;
		const height = Math.max(0, eye + bark * Math.tan(Math.max(-89 * DEG, low)));
		const depth = bark * Math.cos(pitch) + (height - eye) * Math.sin(pitch);
		return { height, share: depth > 0 ? shareAt(2 * radius, depth, lens, 'width') : Infinity };
	};
	// The trunk's share of the lower edge falls as the camera steps back.
	let near = radius * 1.01 + 1e-3;
	let far = radius + 200;
	for (let k = 0; k < 60; k++) {
		const middle = Math.sqrt(near * far);
		if (edgeAt(middle).share > trunkShare) near = middle;
		else far = middle;
	}
	const steep = (rise - eye) / Math.tan(halfFov + BELOW_EDGE_ABOVE_LEVEL * DEG + above);
	const distance = Math.max(radius + CLEARANCE, Math.min(Math.sqrt(near * far), steep));
	// The camera stands round the trunk where the trunk is at the eye's height, and looks at the
	// fork, so a trunk that leans still shows its fork on the frame's middle column.
	const beside = sampleAtHeight(trunk.axis, ground + eye)?.at ?? trunk.base;
	const standAt = (turn: number): V3 => {
		const out = facing(turn);
		return [beside[0] + out[0] * distance, ground + eye, beside[2] + out[2] * distance];
	};
	// A trunk that leans is looked up from in the plane of its lean, on the side it leans away
	// from, so the whole of it stands on the frame's middle column and none of it hangs over the lens.
	const lean: V3 = [top.at[0] - beside[0], 0, top.at[2] - beside[2]];
	const asked =
		Math.hypot(lean[0], lean[2]) > BELOW_LEAN * distance
			? Math.atan2(-lean[0], -lean[2])
			: options.turn;
	// The stand already keeps clear of the trunk, so only a limb can be in the camera's way.
	const walk = walkTo(asked, (turn) => standsClear(subjects, standAt(turn), { trunk: true }));
	const stand = standAt(walk.turn);
	const reach = Math.hypot(top.at[0] - stand[0], top.at[2] - stand[2]);
	const out = facing(walk.turn);
	const level: V3 =
		reach > 1e-6
			? [(top.at[0] - stand[0]) / reach, 0, (top.at[2] - stand[2]) / reach]
			: [-out[0], 0, -out[2]];
	const pitch = Math.min(STEEPEST * DEG, Math.atan2(rise - eye, reach) - above);
	const edge = edgeAt(distance);
	const camera = pitched(stand, level, pitch, Math.hypot(reach, rise - eye));
	// The trunk's centre line where it lands nearest the row just above the frame's lower edge.
	let lowest: AxisSample | undefined;
	let lowestAt = 0.5;
	let nearest = Infinity;
	for (let k = 0; k <= BELOW_STEPS; k++) {
		const sample = sampleAtHeight(trunk.axis, ground + (rise * k) / BELOW_STEPS);
		if (!sample) continue;
		const landed = project(camera, lens, sample.at);
		const off = Math.abs(landed.y - BELOW_EDGE_ROW);
		if (landed.depth > 0 && off < nearest) {
			nearest = off;
			lowest = sample;
			lowestAt = landed.x;
		}
	}
	const crown: V3 = [trunk.base[0], ground + subjects.height, trunk.base[2]];
	return {
		kind: 'the trunk from its foot, up into the crown',
		camera,
		points: [
			{
				name: 'the top of the bole',
				at: top.at,
				within: [0.35, forkRow - 0.08, 0.65, forkRow + 0.08],
			},
			horizonPoint(stand, level, 'below'),
			...(lowest
				? [
						{
							name: 'the trunk at the lower edge',
							at: lowest.at,
							within: [0.15, 0.7, 0.85, 1.02] as const,
							size: {
								metres: 2 * lowest.radius,
								of: 'width' as const,
								// A stem too thin to take its share from a hand's width away takes what it can.
								min: Math.min(trunkShare, edge.share) * 0.5,
								max: Infinity,
							},
						},
					]
				: []),
			{ name: "the crown's top", at: crown, within: [-50, -500, 51, forkRow] },
		],
		regions: [
			{
				name: 'the trunk at the lower edge',
				box: [
					lowestAt - Math.min(0.06, edge.share / 4),
					0.88,
					lowestAt + Math.min(0.06, edge.share / 4),
					1,
				],
				min: 0.8,
				of: 'wood',
			},
			// Above the fork stand the crown and the sky. A dense crown may fill it; wood may not.
			{ name: 'the crown above the fork', box: [0, 0, 1, forkRow - 0.1], min: 0.05 },
			{
				name: 'the wood above the fork',
				box: [0, 0, 1, forkRow - 0.1],
				max: MOST_WOOD,
				of: 'wood',
			},
		],
		facts: {
			eye,
			stand: distance,
			standoff: distance - radius,
			pitch: pitch / DEG,
			fork: rise,
			trunkShare: edge.share,
			turn: walk.turn / DEG,
			walked: walk.walked,
			...(!walk.clear && {
				warning: 'no stand round the trunk is clear of the limbs, so the camera keeps its turn',
			}),
		},
	};
}

/** The share of a trunkless plant's height at which the low eye stands. */
const LOW_EYE_SHARE = 0.07;
/** How far from the plant's foot the low eye stands, as a share of its height: inside its rim. */
const LOW_STAND_SHARE = 0.45;
/** The row share on which the plant's foot lands, seen from the low eye. */
const LOW_FOOT_ROW = 0.92;

/**
 * The view of a plant with no trunk from a low eye, as picture 03 of a tuft, a rosette or a mound
 * shows it: the lens just above the ground and inside the plant's rim, pitched up until the plant's
 * foot lands near the frame's lower edge. The shoot bases then stand at the bottom centre, the
 * leaves arch over the lower part of the frame, and the sky stands above them. A camera outside the
 * rim that held the whole plant would look over it at the sky.
 */
export function lowShot(subjects: PlantSubjects, lens: Lens, turn: number): Solved {
	const tall = subjects.height;
	if (!(tall > 0)) return absent('the plant has no height to look up');
	const eye = Math.max(LOWEST_EYE, LOW_EYE_SHARE * tall);
	const distance = LOW_STAND_SHARE * tall;
	// The foot lies below the eye by the angle its row takes below the line of sight.
	const pitch = -Math.atan2(eye, distance) - rowAngle(LOW_FOOT_ROW, lens.fov);
	const out = facing(turn);
	const foot = subjects.foot;
	const position: V3 = [foot[0] + out[0] * distance, foot[1] + eye, foot[2] + out[2] * distance];
	return {
		kind: 'the plant from a low eye inside its rim',
		camera: pitched(position, [-out[0], 0, -out[2]], pitch, distance),
		points: [
			{
				name: "the plant's foot",
				at: foot,
				within: [0.4, LOW_FOOT_ROW - 0.06, 0.6, LOW_FOOT_ROW + 0.06],
			},
			{
				name: "the plant's top",
				at: [foot[0], foot[1] + tall, foot[2]],
				within: [0.3, -50, 0.7, 0.4],
			},
		],
		regions: [{ name: 'the leaves over the lower frame', box: [0.1, 0.4, 0.9, 1], min: 0.2 }],
		facts: {
			// The frame holds the whole plant, so its outline can be compared as a whole view's is.
			whole: true,
			eye,
			stand: distance,
			pitch: pitch / DEG,
		},
	};
}

/** The share of a trunkless plant's height at which the eye stands under its leaves. */
const RIM_EYE_SHARE = 0.12;
/** How far from the plant's foot that eye stands, and how far out it looks, as shares of its reach. */
const RIM_STAND_SHARE = 0.3;
const RIM_AIM_SHARE = 0.8;
/** The height it looks at, as a share of the plant's height: the leaves' arch over the rim. */
const RIM_AIM_HEIGHT = 0.6;

/**
 * The view from under the leaves of a plant with no trunk, as picture 05 of a tuft or a mound shows
 * it: the lens low under the leaves, a third of the way out from the foot, looking outward and up at
 * the leaves' arch over the rim, so the lower faces of the outer leaves fill the frame.
 */
export function underRimShot(subjects: PlantSubjects, turn: number): Solved {
	const tall = subjects.height;
	const reach = subjects.reach;
	if (!(tall > 0) || !(reach > 0)) return absent('the plant has no leaves to stand under');
	const out = facing(turn);
	const foot = subjects.foot;
	const position: V3 = [
		foot[0] + out[0] * RIM_STAND_SHARE * reach,
		foot[1] + Math.max(LOWEST_EYE, RIM_EYE_SHARE * tall),
		foot[2] + out[2] * RIM_STAND_SHARE * reach,
	];
	const arch: V3 = [
		foot[0] + out[0] * RIM_AIM_SHARE * reach,
		foot[1] + RIM_AIM_HEIGHT * tall,
		foot[2] + out[2] * RIM_AIM_SHARE * reach,
	];
	return {
		kind: "the leaves' lower faces from under the plant's rim",
		camera: { position, target: arch },
		points: [{ name: "the leaves' arch over the rim", at: arch, within: [0.4, 0.4, 0.6, 0.6] }],
		regions: [{ name: 'the leaves overhead', box: [0, 0, 1, 1], min: 0.2 }],
		facts: {
			eye: position[1] - foot[1],
			stand: RIM_STAND_SHARE * reach,
			pitch: Math.atan2(arch[1] - position[1], (RIM_AIM_SHARE - RIM_STAND_SHARE) * reach) / DEG,
		},
	};
}

/** How a view of the bole frames it. */
export interface BoleOptions {
	readonly turn: number;
	/** The row shares the trunk's foot and its top land on. */
	readonly footRow?: number;
	readonly topRow?: number;
	/** Whether the bole ends at the crown's base in place of its own top. */
	readonly toCrown?: boolean;
}

/**
 * The view of the bole from its foot to its top, as picture 17 shows it: from a person's eye
 * height, or from half the bole's height on a bole too low for that, so far back and pitched up so
 * far that the foot lands on its row near the lower edge and the bole's top on its row near the
 * upper one. The camera walks round the trunk to the nearest stand from which no great
 * limb crosses the bole.
 */
export function boleShot(subjects: PlantSubjects, lens: Lens, options: BoleOptions): Solved {
	if (isAbsent(subjects.trunk)) return subjects.trunk;
	const trunk = subjects.trunk;
	const crown = isAbsent(subjects.crownBase) ? undefined : subjects.crownBase;
	const top =
		options.toCrown && crown !== undefined
			? (sampleAtHeight(trunk.axis, crown) ?? absent('the trunk does not reach the crown base'))
			: boleTop(subjects, trunk);
	if (isAbsent(top)) return top;
	const footRow = options.footRow ?? 0.92;
	const topRow = options.topRow ?? 0.2;
	const ground = trunk.base[1];
	const rise = top.at[1] - ground;
	if (rise < LEAST_BOLE)
		return lacking('the trunk divides at the ground, so it has no bole to show');
	const eye = Math.min(EYE, rise / 2);
	const above = rowAngle(topRow, lens.fov);
	const below = -rowAngle(footRow, lens.fov);
	const radius = trunkRadius(trunk, ground + eye);
	const distance = Math.max(radius + CLEARANCE, distanceSpanning(rise, eye, above + below));
	const pitch = Math.atan2(rise - eye, distance) - above;
	const standAt = (turn: number): V3 => {
		const out = facing(turn);
		return [trunk.base[0] + out[0] * distance, ground + eye, trunk.base[2] + out[2] * distance];
	};
	const middle = sampleAtHeight(trunk.axis, ground + rise / 2) ?? trunk.breast;
	const walk = walkTo(options.turn, (turn) => {
		const stand = standAt(turn);
		const own = { trunk: true };
		return (
			blockedBy(subjects, stand, middle.at, own) === undefined &&
			blockedBy(subjects, stand, step(trunk.base, [0, 1, 0], 0.1 * rise), own) === undefined
		);
	});
	// The camera looks at the column halfway between the foot and the bole's top, so a bole
	// that leans stands across the frame's middle.
	const stand = standAt(walk.turn);
	const aim: V3 = [(trunk.base[0] + top.at[0]) / 2, 0, (trunk.base[2] + top.at[2]) / 2];
	const reach = Math.hypot(aim[0] - stand[0], aim[2] - stand[2]);
	const out = facing(walk.turn);
	const level: V3 =
		reach > 1e-6
			? [(aim[0] - stand[0]) / reach, 0, (aim[2] - stand[2]) / reach]
			: [-out[0], 0, -out[2]];
	const camera = pitched(stand, level, pitch, distance);
	const middleAt = project(camera, lens, middle.at);
	const half = Math.min(0.03, shareAt(middle.radius, middleAt.depth, lens, 'width') / 2);
	return {
		kind: 'the bole from its foot to its top',
		camera,
		points: [
			{
				name: "the trunk's foot",
				at: trunk.base,
				within: [0.2, footRow - 0.08, 0.8, footRow + 0.08],
			},
			{
				name: 'the top of the bole',
				at: top.at,
				within: [0.2, topRow - 0.08, 0.8, topRow + 0.08],
			},
			{
				name: 'the bole',
				at: middle.at,
				within: [0.3, topRow, 0.7, footRow],
				size: { metres: 2 * middle.radius, of: 'width', min: 0.03, max: 0.8 },
			},
		],
		regions: [
			{
				name: 'the bole',
				box: [middleAt.x - half, middleAt.y - 0.1, middleAt.x + half, middleAt.y + 0.1],
				min: 0.7,
				of: 'wood',
				thick: SUBJECT_WOOD * middle.radius,
				thickMost: SUBJECT_WOOD_MOST * middle.radius,
			},
		],
		facts: {
			eye,
			stand: distance,
			pitch: pitch / DEG,
			top: rise,
			walked: walk.walked,
			...(!walk.clear && {
				warning: 'a great limb crosses the bole from every side, so the camera keeps its turn',
			}),
		},
	};
}

/** How a view of a limb leaving the trunk frames it. */
export interface JunctionOptions {
	/** The great limb to frame, by its id, in place of the solve's own choice. */
	readonly limb?: number;
	/** The shares of the frame that the photograph's own subject box takes. */
	readonly shares?: SubjectBoxShare;
	/**
	 * The share of the frame's height that the photograph's limb takes where it leaves the trunk,
	 * read off the photograph. It sets the frame alone, so a trunk wider than its share of the
	 * frame runs off the frame's left edge, as a close photograph's does.
	 */
	readonly limbShare?: number;
	/** The column share on which the photograph's trunk meets its limb. */
	readonly column?: number;
	/**
	 * The degrees the photograph's limb rises above level where it leaves the trunk. Among the limbs
	 * thick enough to be the photograph's, the one that lies nearest is framed.
	 */
	readonly lie?: number;
	/** Degrees the camera looks up at the joint. */
	readonly lookUp?: number;
}

/** The share of the frame's height that the limb's base takes where it leaves the trunk. */
const JUNCTION_LIMB_SHARE = 0.35;
/** The least height of the junction's frame, in trunk diameters, so the trunk shows its round. */
const JUNCTION_TRUNK_FRAMES = 0.9;
/** The column share on which the trunk's surface meets the limb: the trunk fills the frame's left. */
const JUNCTION_COLUMN = 0.47;
/** The least degrees between a limb and the trunk for the limb to leave across the picture. */
const JUNCTION_LEAST_ANGLE = 25;
/**
 * The least radius of a limb against the trunk's at its joint for the limb to be the subject of a
 * join's or a fork's photograph: a thinner one is a branch, and the picture of it shows another
 * thing than the photograph's limb.
 */
const SUBJECT_LEAST_TRUNK_SHARE = 0.15;
/** The least radius of a limb against the thickest candidate's for its lie to choose it. */
const JUNCTION_LIE_THICK = 0.6;

/** The degrees a limb rises above level where it leaves the trunk. */
function lieOf(limb: GreatLimb): number {
	return Math.asin(Math.max(-1, Math.min(1, normalize(limb.direction)[1]))) / DEG;
}

/**
 * The view of a great limb leaving the trunk, as picture 07 shows it: seen from the side, square to
 * the plane of the trunk and the limb, so the limb leaves at its true angle. The trunk fills the
 * frame's left with its surface meeting the limb just left of the middle, the limb leaves to the
 * right, and the limb's base takes a third of the frame's height, or the shares its photograph
 * gives. The limb is the thickest that leaves at a wide angle and that no other limb hides from the
 * camera; where the photograph's lie is given, it is the limb of the thick ones that lies nearest.
 * A plant whose every wide limb is a small share of its trunk's thickness has no such join.
 */
export function junctionShot(
	subjects: PlantSubjects,
	lens: Lens,
	options: JunctionOptions = {},
): Solved {
	if (isAbsent(subjects.trunk)) return subjects.trunk;
	if (isAbsent(subjects.limbs)) return subjects.limbs;
	const wide = (limb: GreatLimb) => departureAngle(limb) >= JUNCTION_LEAST_ANGLE;
	const leaving = subjects.limbs.filter((limb) => wide(limb) && limb.length >= 3 * limb.radius);
	const thick = leaving.filter(
		(limb) => limb.radius >= SUBJECT_LEAST_TRUNK_SHARE * limb.trunkRadius,
	);
	const worth = (limb: GreatLimb) => limb.radius * Math.sin(departureAngle(limb) * DEG);
	const thickest = thick.reduce((most, limb) => Math.max(most, limb.radius), 0);
	const lie = options.lie;
	// With the photograph's lie, the limbs that could be its limb come first, nearest its lie.
	const near = (limb: GreatLimb) =>
		lie === undefined || limb.radius < JUNCTION_LIE_THICK * thickest
			? Infinity
			: Math.abs(lieOf(limb) - lie);
	const candidates =
		options.limb === undefined
			? thick.slice().sort((a, b) => {
					const [da, db] = [near(a), near(b)];
					return (da === db ? 0 : da - db) || worth(b) - worth(a) || a.id - b.id;
				})
			: subjects.limbs.filter((limb) => limb.id === options.limb);
	if (candidates.length === 0) {
		if (options.limb !== undefined) return absent(`the plant has no great limb ${options.limb}`);
		return lacking(
			leaving.length === 0
				? 'no great limb leaves the trunk at a wide angle'
				: `no limb that leaves the trunk at a wide angle is ${SUBJECT_LEAST_TRUNK_SHARE} of the trunk's thickness there: the thickest is ${Math.max(...leaving.map((limb) => limb.radius / limb.trunkRadius)).toFixed(2)}`,
		);
	}
	const column = options.column ?? JUNCTION_COLUMN;
	const lookUp = (options.lookUp ?? 10) * DEG;
	const solve = (limb: GreatLimb) => {
		const t = limb.trunkDirection;
		const l = limb.direction;
		const limbDiameter = 2 * limb.radius;
		const trunkDiameter = 2 * limb.trunkRadius;
		const tall =
			options.limbShare !== undefined
				? limbDiameter / options.limbShare
				: options.shares
					? Math.max(
							limbDiameter / options.shares.height,
							trunkDiameter / (options.shares.width * lens.aspect),
						)
					: Math.max(limbDiameter / JUNCTION_LIMB_SHARE, JUNCTION_TRUNK_FRAMES * trunkDiameter);
		// The camera stands square to the plane of the trunk and the limb, on the side from which
		// the limb leaves to the right, and a little below the joint.
		const normal = normalize(cross(t, l));
		const side: V3 =
			dot(l, axesOf([-normal[0], -normal[1], -normal[2]]).right) > 0
				? normal
				: [-normal[0], -normal[1], -normal[2]];
		const level = axesOf([-side[0], -side[1], -side[2]]);
		const from = normalize([
			side[0] * Math.cos(lookUp) - level.up[0] * Math.sin(lookUp),
			side[1] * Math.cos(lookUp) - level.up[1] * Math.sin(lookUp),
			side[2] * Math.cos(lookUp) - level.up[2] * Math.sin(lookUp),
		]);
		const forward: V3 = [-from[0], -from[1], -from[2]];
		// Where the limb's centre line comes out of the trunk's surface: along the limb from the
		// joint until it stands the trunk's radius off the trunk's line. The limb's own middle then
		// lands on the frame's middle row, however steeply it rises through the trunk.
		const crotch = limbExit(limb);
		const camera = aim(crotch, column, 0.5, forward, tall, lens);
		const blocked = blockedBy(subjects, camera.position, step(crotch, from, limb.trunkRadius), {
			trunk: true,
			limbs: [limb.id],
		});
		return { limb, tall, camera, crotch, forward, blocked };
	};
	let chosen = solve(candidates[0] as GreatLimb);
	for (let k = 1; k < candidates.length && chosen.blocked !== undefined; k++) {
		const next = solve(candidates[k] as GreatLimb);
		if (next.blocked === undefined) chosen = next;
	}
	const { limb, tall, camera, crotch, forward } = chosen;
	const rises = dot(limb.direction, axesOf(forward).up) >= 0;
	const baseAt = step(crotch, limb.direction, limb.radius);
	const base = project(camera, lens, baseAt);
	const joined = project(camera, lens, step(crotch, limb.direction, 0.5 * limb.radius));
	// The area read on the limb is a quarter of its own thickness each way, so a thin limb that
	// rises across the frame still fills it.
	const within = Math.min(0.05, (0.25 * 2 * limb.radius) / tall);
	return {
		kind: 'a great limb leaving the trunk',
		camera,
		points: [
			{
				name: 'the collar, where the limb meets the trunk',
				at: crotch,
				within: [column - 0.17, 0.3, column + 0.17, 0.7],
			},
			{
				name: "the limb's base",
				at: baseAt,
				within: [0.3, 0.02, 1.1, 0.98],
				size: { metres: 2 * limb.radius, of: 'height', min: 0.1, max: 0.7 },
			},
			{
				name: 'the trunk below the joint',
				at: step(limb.joint, limb.trunkDirection, -0.25 * tall),
				within: [-1.5, 0.5, column, 1.2],
				size: { metres: 2 * limb.trunkRadius, of: 'width', min: 0.2, max: Infinity },
			},
		],
		regions: [
			{
				name: 'the trunk beside the joint',
				box: [column - 0.17, 0.6, column - 0.02, 0.95],
				min: 0.7,
				of: 'wood',
				thick: SUBJECT_WOOD * limb.trunkRadius,
			},
			// The limb itself where it leaves the trunk: thinner wood or leaves across it hide it.
			{
				name: 'the limb where it leaves the trunk',
				box: [base.x - within, base.y - within, base.x + within, base.y + within],
				min: 0.6,
				of: 'wood',
				thick: SUBJECT_WOOD * limb.radius,
				thickMost: SUBJECT_WOOD_MOST * limb.radius,
			},
			// Between the bark and that area the wood runs on unbroken: a limb joins its trunk.
			{
				name: 'the wood between the trunk and the limb',
				box: [joined.x - within, joined.y - within, joined.x + within, joined.y + within],
				min: 0.9,
				of: 'wood',
				thick: SUBJECT_WOOD * limb.radius,
			},
			{
				name: 'the leaves over the join',
				box: [column - 0.15, 0.3, Math.min(1, column + 0.3), 0.7],
				max: MOST_LEAVES_OVER,
				of: 'foliage',
			},
			{
				name: 'the open ground beside the limb',
				box: rises ? [0.75, 0.8, 1, 1] : [0.75, 0, 1, 0.2],
				max: 0.6,
			},
		],
		facts: {
			limb: limb.id,
			radius: limb.radius,
			trunkRadius: limb.trunkRadius,
			angle: departureAngle(limb),
			lie: lieOf(limb),
			height: limb.joint[1],
			frame: tall,
			...(chosen.blocked !== undefined && {
				warning: `${chosen.blocked} stands between the camera and every wide joint`,
			}),
		},
	};
}

/** How a view of a fork frames it. */
export interface ForkOptions {
	/** The fork to frame, by its place in the subjects' list, in place of the solve's own choice. */
	readonly fork?: number;
	/** The share of the frame's width that the limb below the joint takes. */
	readonly limbShare?: number;
	/** The radius of the limb sought, in metres: the fork nearest it is taken first. */
	readonly radius?: number;
	/** The metres the frame's height covers, in place of the limb's share of its width. */
	readonly span?: number;
}

/** The row share on which a fork's joint stands, a little under the frame's middle. */
const FORK_ROW = 0.58;
/** The least radius of a fork's thinner arm against its limb's. */
const FORK_EVEN = 0.5;
/** The least sine of the angle a fork's arms open at. */
const FORK_OPEN = 0.3;
/** The radius of the limb a fork view seeks, against the trunk's radius at breast height. */
const FORK_TRUNK_SHARE = 0.27;
/** Limb radii either side of the joint's depth within which the plant is drawn. */
const FORK_SLAB = 2.5;

/**
 * The view of a limb dividing into two, as picture 08 shows it: seen square to the plane of the two
 * arms, so the fork opens at its true angle, and turned until the limb comes up to the joint from
 * the frame's lower edge. The joint stands a little under the middle, the limb takes a fifth of the
 * frame's width, and both arms leave upward to either side. Only the wood within a few limb radii
 * of the joint's depth is drawn, so the fork stands on a plain ground as the studio photograph's
 * does. The fork is a great limb's before a thinner order's, and among those the one whose limb is
 * nearest a quarter of the trunk's thickness, with arms of like size that open wide.
 */
export function forkShot(subjects: PlantSubjects, lens: Lens, options: ForkOptions = {}): Solved {
	if (isAbsent(subjects.forks)) return subjects.forks;
	const opening = (fork: ForkSubject) => Math.hypot(...cross(fork.arms[0], fork.arms[1]));
	const even = (fork: ForkSubject) => Math.min(1, Math.min(...fork.armRadii) / fork.radius);
	// The photograph's limb is a quarter as thick as the trunk at breast height, or the size a slot
	// names: the fork nearest that size is worth most, and even arms that open wide add to it.
	const sought =
		options.radius ??
		(isAbsent(subjects.trunk) ? undefined : FORK_TRUNK_SHARE * subjects.trunk.breast.radius);
	const worth = (fork: ForkSubject) =>
		(sought === undefined ? Math.log(fork.radius) : -Math.abs(Math.log(fork.radius / sought))) +
		0.5 * even(fork) +
		0.5 * opening(fork);
	const listed = subjects.forks.map((fork, index) => ({ fork, index }));
	// The photograph's fork is a limb's: a division of wood a small share of the trunk's thickness
	// is a twig's, and a picture of it shows another thing.
	const least = isAbsent(subjects.trunk)
		? 0
		: SUBJECT_LEAST_TRUNK_SHARE * subjects.trunk.breast.radius;
	const open = listed.filter(({ fork }) => even(fork) >= FORK_EVEN && opening(fork) >= FORK_OPEN);
	const candidates =
		options.fork === undefined
			? open
					.filter(({ fork }) => fork.radius >= least)
					.sort(
						(a, b) =>
							a.fork.order - b.fork.order || worth(b.fork) - worth(a.fork) || a.index - b.index,
					)
			: listed.filter(({ index }) => index === options.fork);
	if (candidates.length === 0) {
		if (options.fork !== undefined) return absent(`the plant has no fork ${options.fork}`);
		return lacking(
			open.length === 0
				? `no limb divides into two arms of like size: ${subjects.forks.length} divisions, none even and open`
				: `no limb ${SUBJECT_LEAST_TRUNK_SHARE} of the trunk's thickness divides into two arms of like size: the thickest that does is ${(Math.max(...open.map(({ fork }) => fork.radius)) / (least / SUBJECT_LEAST_TRUNK_SHARE)).toFixed(2)} of it`,
		);
	}
	const limbShare = options.limbShare ?? 0.22;
	const solve = ({ fork, index }: { fork: ForkSubject; index: number }) => {
		const tall = options.span ?? (2 * fork.radius) / limbShare / lens.aspect;
		const wide = tall * lens.aspect;
		const normal = normalize(cross(fork.arms[0], fork.arms[1]));
		// A camera below the fork looks up at it against the sky, so that side is tried first.
		const sides: V3[] = [normal, [-normal[0], -normal[1], -normal[2]]];
		if ((sides[0] as V3)[1] > 0) sides.reverse();
		let best: { camera: Camera; blocked: string | undefined } | undefined;
		for (const side of sides) {
			const forward: V3 = [-side[0], -side[1], -side[2]];
			const camera = aim(fork.at, 0.5, FORK_ROW, forward, tall, lens, rollUp(forward, fork.into));
			const blocked = blockedBy(subjects, camera.position, step(fork.at, side, 2 * fork.radius));
			if (!best || (best.blocked !== undefined && blocked === undefined))
				best = { camera, blocked };
		}
		const found = best as { camera: Camera; blocked: string | undefined };
		return { fork, index, wide, tall, ...found };
	};
	let chosen = solve(candidates[0] as (typeof candidates)[number]);
	for (let k = 1; k < candidates.length && chosen.blocked !== undefined; k++) {
		const next = solve(candidates[k] as (typeof candidates)[number]);
		if (next.blocked === undefined) chosen = next;
	}
	const { fork, camera, tall } = chosen;
	const distance = tall / 2 / tanHalf(lens);
	const slab = Math.max(FORK_SLAB * fork.radius, 0.25 * chosen.wide);
	return {
		kind: 'a limb dividing into two arms',
		camera,
		near: Math.max(0.02, distance - slab),
		far: distance + slab,
		points: [
			{ name: 'the joint', at: fork.at, within: [0.38, FORK_ROW - 0.12, 0.62, FORK_ROW + 0.12] },
			{
				name: 'the limb below the joint',
				at: step(fork.at, fork.into, -3 * fork.radius),
				within: [0.25, FORK_ROW, 0.75, 1.1],
				size: { metres: 2 * fork.radius, of: 'width', min: limbShare * 0.6, max: limbShare * 1.6 },
			},
			{
				name: 'one arm',
				at: step(fork.at, fork.arms[0], 4 * fork.radius),
				within: [-0.1, -0.1, 1.1, FORK_ROW],
			},
			{
				name: 'the other arm',
				at: step(fork.at, fork.arms[1], 4 * fork.radius),
				within: [-0.1, -0.1, 1.1, FORK_ROW],
			},
		],
		apart: [{ a: 'one arm', b: 'the other arm', least: 0.12 }],
		regions: [
			{
				name: 'the joint',
				box: [0.44, FORK_ROW - 0.06, 0.56, FORK_ROW + 0.06],
				min: 0.6,
				of: 'wood',
				thick: SUBJECT_WOOD * Math.min(...fork.armRadii, fork.radius),
				thickMost: SUBJECT_WOOD_MOST * fork.radius,
			},
			{ name: 'the plain ground round the fork', box: [0, 0, 1, 1], max: 0.75 },
		],
		facts: {
			fork: chosen.index,
			order: fork.order,
			radius: fork.radius,
			armRadii: fork.armRadii,
			opening: Math.asin(Math.min(1, opening(fork))) / DEG,
			height: fork.at[1],
			frame: tall,
			divisions: subjects.forks.length,
			...(chosen.blocked !== undefined && {
				warning: `${chosen.blocked} stands between the camera and every fork`,
			}),
		},
	};
}

/** The horizontal direction from a plant's foot to a point, or the turn's own where the point stands over the foot. */
function outwardOf(foot: V3, point: V3, turn: number): V3 {
	const x = point[0] - foot[0];
	const z = point[2] - foot[2];
	return Math.hypot(x, z) > 1e-6 ? normalize([x, 0, z]) : facing(turn);
}

/** How a view of the crown's outside frames a lobe. */
export interface CrownOutsideOptions {
	readonly turn: number;
	/** The share of the frame's shorter side that the lobe's width takes. */
	readonly fill?: number;
	/** Degrees the camera looks up at the lobe. */
	readonly lookUp?: number;
}

/** The most of a crown view's frame that the plant may cover: the rest is the sky behind the lobe. */
const CROWN_MOST_COVER = 0.75;
/** The least of a crown view's frame that wood covers: the branch its leaves hang on. */
const CROWN_LEAST_WOOD = 0.01;
/** The most of a strip at a lobe's side that the plant may cover. */
const CROWN_SIDE_MOST = 0.92;

/** The least radius of a lobe a crown view frames, against the plant's largest. */
const LOBE_LEAST = 0.25;

/**
 * The view of the crown's outside, as picture 04 shows it: one foliage mass at the crown's edge
 * against the sky. The camera stands under the crown's rim, nearer the trunk than the lobe, and
 * looks up and outward through it, so what stands behind the lobe is open sky and not the rest of
 * the crown. The lobe is the one that reaches farthest out, low in the crown and on the side the
 * turn asks, and it fills over half the frame.
 */
export function crownOutsideShot(
	subjects: PlantSubjects,
	lens: Lens,
	options: CrownOutsideOptions,
): Solved {
	if (isAbsent(subjects.lobes)) return subjects.lobes;
	const largest = subjects.lobes.reduce((most, lobe) => Math.max(most, lobe.radius), 0);
	const lobes = subjects.lobes.filter(
		(lobe) => lobe.radius >= LOBE_LEAST * largest && lobe.radius > 0,
	);
	if (lobes.length === 0) return lacking('the plant has no foliage mass');
	const foot = subjects.foot;
	const out = (lobe: Lobe) =>
		Math.hypot(lobe.centre[0] - foot[0], lobe.centre[2] - foot[2]) + lobe.radius;
	const farthest = lobes.reduce((most, lobe) => Math.max(most, out(lobe)), 1e-6);
	const base = isAbsent(subjects.crownBase) ? 0 : subjects.crownBase;
	const toward = facing(options.turn);
	const worth = (lobe: Lobe) =>
		out(lobe) / farthest +
		0.3 * dot(outwardOf(foot, lobe.centre, options.turn), toward) +
		0.2 *
			(1 -
				Math.max(0, Math.min(1, (lobe.centre[1] - base) / Math.max(subjects.height - base, 1e-6))));
	const lobe = lobes.reduce((best, next) => (worth(next) > worth(best) ? next : best));
	const fill = options.fill ?? 0.6;
	const tall = (2 * lobe.radius) / fill / Math.min(1, lens.aspect);
	const distance = tall / 2 / tanHalf(lens);
	const outward = outwardOf(foot, lobe.centre, options.turn);
	// The camera stands below the lobe where the ground leaves room, and level with it where not.
	const lookUp = Math.min(
		(options.lookUp ?? 50) * DEG,
		Math.asin(Math.max(0, Math.min(1, (lobe.centre[1] - LOWEST_EYE) / distance))),
	);
	// From the trunk's side of the lobe and below it, looking outward and up.
	const from: V3 = [
		-outward[0] * Math.cos(lookUp),
		-Math.sin(lookUp),
		-outward[2] * Math.cos(lookUp),
	];
	const camera: Camera = { position: step(lobe.centre, from, distance), target: lobe.centre };
	return {
		kind: "one foliage mass at the crown's edge, against the sky",
		camera,
		points: [
			{
				name: 'the lobe',
				at: lobe.centre,
				within: [0.35, 0.35, 0.65, 0.65],
				size: {
					metres: 2 * lobe.radius,
					of: lens.aspect >= 1 ? 'height' : 'width',
					min: fill * 0.7,
					max: Math.min(1, fill * 1.3),
				},
			},
		],
		regions: [
			{ name: 'the foliage mass', box: [0.3, 0.3, 0.7, 0.7], min: 0.25, of: 'foliage' },
			{ name: 'the sky round the lobe', box: [0, 0, 1, 1], max: CROWN_MOST_COVER },
			// A lobe hangs on wood and stands in the open: its branch shows in the frame, and sky
			// shows at both its sides. A wall of leaves under a strip of sky has neither.
			{
				name: 'the branch that carries the leaves',
				box: [0, 0, 1, 1],
				min: CROWN_LEAST_WOOD,
				max: 0.4,
				of: 'wood',
			},
			{ name: "the sky at the lobe's left", box: [0, 0.15, 0.12, 0.85], max: CROWN_SIDE_MOST },
			{ name: "the sky at the lobe's right", box: [0.88, 0.15, 1, 0.85], max: CROWN_SIDE_MOST },
		],
		facts: {
			radius: lobe.radius,
			height: lobe.centre[1],
			...(lobe.limb !== undefined && { limb: lobe.limb }),
			inside:
				Math.hypot(lobe.centre[0] - foot[0], lobe.centre[2] - foot[2]) -
				Math.hypot(camera.position[0] - foot[0], camera.position[2] - foot[2]),
			lookUp: lookUp / DEG,
			lobes: subjects.lobes.length,
		},
	};
}

/** The great limb on the side a turn asks for, among those near the thickest. */
function limbToward(limbs: readonly GreatLimb[], foot: V3, turn: number): GreatLimb | undefined {
	const thickest = limbs.reduce((most, limb) => Math.max(most, limb.radius), 0);
	const toward = facing(turn);
	let best: GreatLimb | undefined;
	let most = Number.NEGATIVE_INFINITY;
	for (const limb of limbs) {
		if (limb.radius < 0.6 * thickest) continue;
		const facingIt = dot(outwardOf(foot, sampleAlong(limb.axis, 0.4).at, turn), toward);
		if (facingIt > most) {
			most = facingIt;
			best = limb;
		}
	}
	return best;
}

/** How a view of the crown's underside frames it. */
export interface CrownUndersideOptions {
	readonly turn: number;
	/** Degrees the camera looks up. */
	readonly pitch?: number;
}

/** The share of the limb's height at its joint at which the eye stands under a limb lower than a person. */
const UNDER_EYE_SHARE = 0.6;
/** The least metres of crown above the eye for a view from under it. */
const UNDER_LEAST_RISE = 0.3;
/** The farthest out from the trunk the camera stands, as a share of the limb's run across the ground. */
const UNDER_REACH = 0.8;
/** How far to the side of the limb's line the camera stands, as a share of its distance from the trunk. */
const UNDER_ASIDE = 0.15;

/**
 * The view of the crown's underside, as picture 05 shows it: from under a great limb, out from the
 * trunk, looking back toward the trunk and steeply up. The limb's joint and the trunk stand low in
 * the frame, the limb runs up the frame to pass over the lens, and the foliage stands above it. The
 * camera stands at a person's eye height, or lower under a low limb, as far out as makes it look
 * up at its pitch at the limb halfway between itself and the trunk, but never out past the limb's
 * own reach. It stands a little to one side of the limb's line, so the trunk stands left of the
 * frame's middle.
 */
export function crownUndersideShot(
	subjects: PlantSubjects,
	lens: Lens,
	options: CrownUndersideOptions,
): Solved {
	if (isAbsent(subjects.trunk)) return subjects.trunk;
	if (isAbsent(subjects.limbs)) return subjects.limbs;
	const trunk = subjects.trunk;
	const limb = limbToward(subjects.limbs, subjects.foot, options.turn);
	if (!limb) return lacking('the plant has no great limb to stand under');
	const ground = trunk.base[1];
	const eye = Math.max(LOWEST_EYE, Math.min(EYE, UNDER_EYE_SHARE * (limb.joint[1] - ground)));
	if (limb.joint[1] - ground - eye < UNDER_LEAST_RISE)
		return lacking('the crown stands at the ground, so no camera stands under it');
	const end = limb.axis[limb.axis.length - 1] as AxisSample;
	const outward = outwardOf(limb.joint, end.at, options.turn);
	const run = Math.hypot(end.at[0] - limb.joint[0], end.at[2] - limb.joint[2]);
	const pitch = (options.pitch ?? 60) * DEG;
	const beside = sampleAtHeight(trunk.axis, ground + eye) ?? {
		at: trunk.base,
		radius: trunk.breast.radius,
	};
	// The limb halfway between the camera and the trunk, and the distance out that looks up at it
	// at the pitch: the limb's own rise moves both, so the stand settles in a few steps. The camera
	// stays under the limb, so a limb that rises steeply is looked up at more steeply than the pitch.
	const least = beside.radius + 2 * CLEARANCE;
	const most = Math.max(least, UNDER_REACH * run);
	const overheadAt = (out: number) =>
		sampleAlong(limb.axis, Math.max(0.05, Math.min(0.9, out / 2 / Math.max(run, 1e-6))));
	let out = least;
	for (let k = 0; k < 6; k++)
		out = Math.min(
			most,
			Math.max(least, (2 * (overheadAt(out).at[1] - ground - eye)) / Math.tan(pitch)),
		);
	const overhead = overheadAt(out);
	const aside = UNDER_ASIDE * out;
	const position: V3 = [
		beside.at[0] + outward[0] * out - outward[2] * aside,
		ground + eye,
		beside.at[2] + outward[2] * out + outward[0] * aside,
	];
	const camera: Camera = { position, target: overhead.at };
	// The foliage mass that stands nearest the frame's middle, above the limb.
	let lobe: Lobe | undefined;
	let nearest = Infinity;
	for (const next of isAbsent(subjects.lobes) ? [] : subjects.lobes) {
		const { x, y, depth } = project(camera, lens, next.centre);
		const off = depth > 0 ? Math.hypot(x - 0.5, y - 0.5) : Infinity;
		if (off < nearest) {
			nearest = off;
			lobe = next;
		}
	}
	return {
		kind: "the crown's underside, up along a great limb",
		camera,
		points: [
			{
				name: 'the limb overhead',
				at: overhead.at,
				within: [0.4, 0.4, 0.6, 0.6],
				size: { metres: 2 * overhead.radius, of: 'height', min: 0.004, max: 0.6 },
			},
			{ name: "the limb's joint", at: limb.joint, within: [-0.25, 0.3, 0.8, 1.2] },
			...(lobe
				? [{ name: 'the foliage over the limb', at: lobe.centre, within: [0, 0, 1, 1] as const }]
				: []),
		],
		regions: [
			{ name: 'the crown against the sky', box: [0, 0, 1, 1], min: 0.15, max: 0.95 },
			// The limb the camera looks up along is in the picture as wood of its own thickness.
			...[0.3, 0.6].map((share) => {
				const sample = sampleAlong(limb.axis, share);
				const at = project(camera, lens, sample.at);
				return {
					name: `the great limb ${share} of the way along it`,
					box: [at.x - 0.04, at.y - 0.04, at.x + 0.04, at.y + 0.04] as const,
					min: 0.5,
					of: 'wood' as const,
					thick: SUBJECT_WOOD * sample.radius,
				};
			}),
		],
		facts: {
			limb: limb.id,
			eye,
			stand: out,
			pitch:
				Math.atan2(
					overhead.at[1] - position[1],
					Math.hypot(overhead.at[0] - position[0], overhead.at[2] - position[2]),
				) / DEG,
		},
	};
}

/** How a view from inside the crown frames the wood it looks along. */
export interface InsideOptions {
	readonly turn: number;
	/** Degrees the camera looks up along the wood. */
	readonly pitch?: number;
	/** The share of the frame's width that the wood ahead takes. */
	readonly share?: number;
}

/** The least metres of trunk inside the crown for the camera to look up it. */
const INSIDE_LEAST_TRUNK = 1;
/** How far up the crown, as a share of its depth, the camera stands. */
const INSIDE_STAND = 0.15;
/** The farthest from the trunk's centre line the camera stands, as a share of the plant's reach. */
const INSIDE_REACH = 0.5;
/** How far along a great limb the camera stands where the trunk does not run on into the crown. */
const INSIDE_LIMB_STAND = 0.2;
/** The most of the frame's width that the trunk beside the camera may take at its nearest. */
const INSIDE_MOST_TRUNK = 0.5;

/**
 * The view from inside the crown, as picture 06 shows it: the camera stands beside the trunk a little
 * above where the bole ends and looks up along it, so the trunk takes a quarter of the frame's width
 * with the limbs leaving round it and the foliage all about. It stands in the widest gap between
 * the limbs that leave near its height. Where the trunk does not run on into the crown, it stands
 * beside and below the thickest great limb and looks out along that.
 */
export function insideShot(subjects: PlantSubjects, lens: Lens, options: InsideOptions): Solved {
	if (isAbsent(subjects.trunk)) return subjects.trunk;
	if (isAbsent(subjects.limbs)) return subjects.limbs;
	const trunk = subjects.trunk;
	const limbs = subjects.limbs;
	const ground = trunk.base[1];
	const pitch = (options.pitch ?? 40) * DEG;
	const share = options.share ?? 0.28;
	// The crown's wood begins where the bole ends: its foliage can hang far below that.
	const boleEnd = boleTop(subjects, trunk);
	if (isAbsent(boleEnd)) return boleEnd;
	const crown = boleEnd.at[1] - ground;
	const trunkTop = (trunk.axis[trunk.axis.length - 1] as AxisSample).at[1] - ground;
	// The camera's distance from the wood's centre line at which the wood ahead takes its share.
	const standOff = (ahead: (d: number) => AxisSample, least: number): number => {
		let d = least;
		for (let k = 0; k < 4; k++) {
			const reach = ahead(d).radius / (share * tanHalf(lens) * lens.aspect);
			d = Math.max(least, reach * Math.cos(pitch));
		}
		return d;
	};
	if (trunkTop - crown >= INSIDE_LEAST_TRUNK) {
		const height = Math.min(crown + INSIDE_STAND * (subjects.height - crown), trunkTop - 0.5);
		const beside = sampleAtHeight(trunk.axis, ground + height) ?? trunk.breast;
		const ahead = (d: number): AxisSample =>
			sampleAtHeight(
				trunk.axis,
				Math.min(ground + trunkTop - 0.05, ground + height + d * Math.tan(pitch)),
			) ?? beside;
		// The trunk is nearest, and so widest, at the camera's own height: the camera stands far
		// enough off that the trunk there takes no more than its part of the frame's width, or a
		// thick bole is a wall of bark across the picture.
		const across = Math.atan(tanHalf(lens) * lens.aspect);
		const clear = Math.max(
			beside.radius + CLEARANCE,
			beside.radius / Math.sin(INSIDE_MOST_TRUNK * across),
		);
		// The camera stays inside the crown, however thick the trunk.
		const distance = Math.min(
			standOff(ahead, clear),
			Math.max(beside.radius + CLEARANCE, INSIDE_REACH * subjects.reach),
		);
		const target = ahead(distance);
		// A stem too thin to take its share from a hand's width away takes what it can.
		const taken = shareAt(
			2 * target.radius,
			Math.hypot(distance, target.at[1] - beside.at[1]),
			lens,
			'width',
		);
		// The limbs that leave near the camera's height, and the widest gap between them.
		const near = limbs.filter(
			(limb) => Math.abs(limb.joint[1] - ground - height) <= Math.max(1.5, distance),
		);
		const turns = near
			.map((limb) => Math.atan2(limb.direction[0], limb.direction[2]))
			.sort((a, b) => a - b);
		let turn = options.turn;
		let widest = 0;
		for (let k = 0; k < turns.length; k++) {
			const from = turns[k] as number;
			const to =
				k + 1 < turns.length ? (turns[k + 1] as number) : (turns[0] as number) + 2 * Math.PI;
			if (to - from > widest) {
				widest = to - from;
				turn = from + (to - from) / 2;
			}
		}
		const standAt = (t: number): V3 => {
			const out = facing(t);
			return [beside.at[0] + out[0] * distance, beside.at[1], beside.at[2] + out[2] * distance];
		};
		// The best stand is a limb's thickness clear of every great limb, with no limb on the line to
		// the trunk ahead: a limb a hand's width from the lens is a wall of bark across the picture.
		// Where the limbs leave no such stand, the camera takes a clear sight line, and failing that
		// a stand clear of the bark.
		const roomy = limbs.reduce((most, limb) => Math.max(most, limb.radius), CLEARANCE);
		const sees = (t: number) =>
			blockedBy(subjects, standAt(t), target.at, { trunk: true }, CLEARANCE) === undefined;
		const stands = (t: number, margin: number) =>
			standsClear(subjects, standAt(t), { trunk: true }, margin);
		const walks = [
			walkTo(turn, (t) => stands(t, roomy) && sees(t)),
			walkTo(turn, (t) => stands(t, CLEARANCE) && sees(t)),
			walkTo(turn, (t) => stands(t, CLEARANCE)),
		];
		const walk = walks.find((found) => found.clear) ?? (walks[2] as (typeof walks)[number]);
		const above = limbs
			.filter((limb) => limb.joint[1] >= beside.at[1])
			.sort((a, b) => a.joint[1] - b.joint[1])[0];
		return {
			kind: 'the trunk from inside the crown, its limbs leaving round it',
			camera: { position: standAt(walk.turn), target: target.at },
			points: [
				{
					name: 'the trunk ahead',
					at: target.at,
					within: [0.35, 0.35, 0.65, 0.65],
					size: {
						metres: 2 * target.radius,
						of: 'width',
						min: Math.min(share * 0.4, taken * 0.9),
						// A trunk too thick for the crown's reach takes what the nearest stand inside gives.
						max: Math.max(0.6, Math.min(0.95, taken * 1.1)),
					},
				},
				...(above
					? [
							{
								name: 'a limb leaving the trunk',
								at: above.joint,
								within: [-0.2, -0.2, 1.2, 1.2] as const,
							},
						]
					: []),
			],
			regions: [
				{ name: 'the trunk ahead', box: [0.45, 0.4, 0.55, 0.6], min: 0.5, of: 'wood' },
				{ name: 'the crown round the trunk', box: [0, 0, 1, 1], min: 0.1 },
				{ name: 'the wood across the picture', box: [0, 0, 1, 1], max: MOST_WOOD, of: 'wood' },
			],
			facts: {
				wood: 'trunk',
				height,
				stand: distance,
				pitch: pitch / DEG,
				gap: widest / DEG,
				walked: walk.walked,
				...(walk !== walks[0] && {
					warning: walk.clear
						? "no stand beside the trunk is a limb's thickness clear of the limbs with the trunk ahead in sight"
						: 'no stand beside the trunk is clear of the limbs',
				}),
			},
		};
	}
	const limb = limbToward(limbs, subjects.foot, options.turn);
	if (!limb) return lacking('the plant has no great limb to stand beside');
	const beside = sampleAlong(limb.axis, INSIDE_LIMB_STAND);
	const ahead = (d: number) =>
		sampleAlong(
			limb.axis,
			Math.min(0.9, INSIDE_LIMB_STAND + (d * Math.tan(pitch)) / Math.max(limb.length, 1e-6)),
		);
	const distance = standOff(ahead, beside.radius + CLEARANCE);
	// Beside the limb and below it, so the limb crosses the frame and the crown stands over it.
	const side = across(beside.direction);
	const off = normalize([side[0], -1, side[2]]);
	return {
		kind: 'a great limb from inside the crown',
		camera: { position: step(beside.at, off, distance), target: ahead(distance).at },
		points: [
			{
				name: 'the limb ahead',
				at: ahead(distance).at,
				within: [0.35, 0.35, 0.65, 0.65],
				size: { metres: 2 * ahead(distance).radius, of: 'width', min: share * 0.4, max: share * 2 },
			},
			{
				name: 'the limb running on',
				at: sampleAlong(limb.axis, 0.9).at,
				within: [-0.5, -0.5, 1.5, 1.5],
			},
		],
		regions: [
			{ name: 'the limb ahead', box: [0.45, 0.4, 0.55, 0.6], min: 0.5, of: 'wood' },
			{ name: 'the crown round the limb', box: [0, 0, 1, 1], min: 0.1 },
			{ name: 'the wood across the picture', box: [0, 0, 1, 1], max: MOST_WOOD, of: 'wood' },
		],
		facts: { wood: 'limb', limb: limb.id, stand: distance, pitch: pitch / DEG },
	};
}

/** How a view of the trunk's foot frames it. */
export interface BarkBaseOptions {
	readonly turn: number;
	/** Degrees the camera looks down on the foot. */
	readonly lookDown?: number;
}

/** The share of the frame's width that the trunk's foot takes. */
const BASE_TRUNK_SHARE = 0.5;
/** The row share on which the ground at the trunk's centre lands. */
const BASE_ROW = 0.72;
/** The degrees below level that the upper edge of a view of the trunk's foot looks at least. */
const BASE_EDGE_BELOW_LEVEL = 3;
/** The height, in metres, up to which the trunk's flare is read. */
const FLARE_HEIGHT = 0.3;

/**
 * The view of the trunk's foot, as picture 14 shows it: the flare and the ground it stands on, seen
 * from above, the trunk's foot taking over half the frame's width with the ground before it in the
 * frame's lower part. The camera looks down far enough that its upper edge stays under the
 * horizon, so the picture holds trunk and ground and no sky. The frame follows the trunk's own
 * thickness, so a thin stem fills its picture as a great bole does.
 */
export function barkBaseShot(
	subjects: PlantSubjects,
	lens: Lens,
	options: BarkBaseOptions,
): Solved {
	if (isAbsent(subjects.trunk)) return subjects.trunk;
	const trunk = subjects.trunk;
	const ground = trunk.base[1];
	const radius = Math.max(
		(trunk.axis[0] as AxisSample).radius,
		trunkRadius(trunk, ground + FLARE_HEIGHT),
	);
	const tall = (2 * radius) / BASE_TRUNK_SHARE / lens.aspect;
	const lookDown = Math.max(options.lookDown ?? 0, lens.fov / 2 + BASE_EDGE_BELOW_LEVEL) * DEG;
	const out = facing(options.turn);
	const forward: V3 = [
		-out[0] * Math.cos(lookDown),
		-Math.sin(lookDown),
		-out[2] * Math.cos(lookDown),
	];
	const above = sampleAtHeight(trunk.axis, ground + 0.3 * tall) ?? trunk.breast;
	const camera = aim(trunk.base, 0.5, BASE_ROW, forward, tall, lens);
	return {
		kind: "the trunk's foot and the ground it stands on",
		camera,
		points: [
			horizonPoint(camera.position, [-out[0], 0, -out[2]], 'above'),
			{
				name: "the trunk's foot",
				at: trunk.base,
				within: [0.35, BASE_ROW - 0.1, 0.65, BASE_ROW + 0.1],
			},
			{
				name: 'the trunk above its flare',
				at: above.at,
				within: [0.3, 0.05, 0.7, BASE_ROW],
				size: { metres: 2 * above.radius, of: 'width', min: 0.15, max: 0.8 },
			},
		],
		regions: [
			{
				name: 'the trunk',
				box: [0.45, 0.3, 0.55, 0.75],
				min: 0.8,
				of: 'wood',
				thick: SUBJECT_WOOD * above.radius,
			},
			{ name: 'the ground and air beside the trunk', box: [0, 0.1, 0.1, 0.6], max: 0.7 },
		],
		facts: { radius, frame: tall, lookDown: lookDown / DEG },
	};
}

/** How a view of the bark at mid-trunk frames it. */
export interface BarkMidOptions {
	readonly turn: number;
	/** The metres the frame's height covers, as the photograph's does. */
	readonly span?: number;
	/** Metres above the ground the camera looks at. */
	readonly height?: number;
}

/** The share of the trunk's diameter that a bark frame may cover across before the backdrop shows. */
const BARK_ACROSS = 0.8;
/** The metres a bark frame covers when nothing names its span. */
const BARK_SPAN = 0.6;

/**
 * The view of the bark at mid-trunk, as picture 15 shows it: square to the trunk's surface, bark
 * from edge to edge. A frame that names no span narrows to what the trunk's own width fills. A
 * frame that names its span keeps it, as a texture source's metres are part of the comparison, and
 * its contract then asks only for the share of the frame that the trunk can fill.
 */
export function barkMidShot(subjects: PlantSubjects, lens: Lens, options: BarkMidOptions): Solved {
	if (isAbsent(subjects.trunk)) return subjects.trunk;
	const trunk = subjects.trunk;
	const ground = trunk.base[1];
	const top = (trunk.axis[trunk.axis.length - 1] as AxisSample).at[1] - ground;
	const height = options.height ?? Math.min(1.5, top * 0.3);
	const at = sampleAtHeight(trunk.axis, ground + height);
	if (!at) return absent(`the trunk does not reach ${height.toFixed(2)} m`);
	const fits = (BARK_ACROSS * 2 * at.radius) / lens.aspect;
	const tall = options.span ?? Math.min(BARK_SPAN, fits);
	const out = facing(options.turn);
	const surface = step(at.at, out, at.radius);
	const covered = Math.min(1, (2 * at.radius) / (tall * lens.aspect));
	return {
		kind: 'the bark at mid-trunk',
		camera: aim(surface, 0.5, 0.5, [-out[0], 0, -out[2]], tall, lens),
		points: [
			{
				name: 'the bark',
				at: surface,
				within: [0.4, 0.4, 0.6, 0.6],
				size: {
					metres: 2 * at.radius,
					of: 'width',
					min: Math.min(1, covered * 0.9),
					max: Infinity,
				},
			},
		],
		regions: [
			{
				name: 'the bark',
				box: [0.5 - 0.4 * covered, 0.1, 0.5 + 0.4 * covered, 0.9],
				min: 0.9,
				of: 'wood',
				thick: SUBJECT_WOOD * at.radius,
				thickMost: SUBJECT_WOOD_MOST * at.radius,
			},
		],
		facts: { height, span: tall, radius: at.radius, barkShare: covered },
	};
}

/** Limb radii in front of a limb's centre line from which a view of its bark draws the plant. */
const BARK_LIMB_CLEAR = 1.5;

/** How a view of the bark on a great limb frames it. */
export interface BarkLimbOptions {
	/** The share of the frame's height that the limb's thickness takes. */
	readonly girth?: number;
	/** The share of the way along the limb that the camera looks at. */
	readonly along?: number;
	/** The great limb to frame, by its id, in place of the solve's own choice. */
	readonly limb?: number;
}

/**
 * The view of the bark on a great limb, as picture 16 shows it: the limb crossing the frame, seen
 * square across its run, its thickness taking the share of the frame's height that the photograph
 * gives it. The limb is the thickest that runs on past both edges of the frame and that nothing
 * hides, seen from its outer side where that is clear.
 */
export function barkLimbShot(
	subjects: PlantSubjects,
	lens: Lens,
	options: BarkLimbOptions = {},
): Solved {
	if (isAbsent(subjects.limbs)) return subjects.limbs;
	const girth = options.girth ?? 0.38;
	const along = options.along ?? 0.3;
	const frameOf = (limb: GreatLimb) => (2 * sampleAlong(limb.axis, along).radius) / girth;
	const candidates = (
		options.limb === undefined
			? subjects.limbs.filter((limb) => limb.length >= frameOf(limb) * lens.aspect)
			: subjects.limbs.filter((limb) => limb.id === options.limb)
	)
		.slice()
		.sort((a, b) => b.radius - a.radius || a.id - b.id);
	if (candidates.length === 0)
		return options.limb === undefined
			? lacking('no great limb runs on past a frame of its own thickness')
			: absent(`the plant has no great limb ${options.limb}`);
	const solve = (limb: GreatLimb) => {
		const at = sampleAlong(limb.axis, along);
		const tall = frameOf(limb);
		const level = across(at.direction);
		// The limb's outer side first: the trunk and the crown's middle stand behind the camera there.
		const outer = dot(level, outwardOf(subjects.foot, at.at, 0)) >= 0 ? 1 : -1;
		let best: { camera: Camera; blocked: string | undefined } | undefined;
		for (const sign of [outer, -outer]) {
			const side: V3 = [level[0] * sign, level[1] * sign, level[2] * sign];
			const camera = aim(at.at, 0.5, 0.5, [-side[0], -side[1], -side[2]], tall, lens);
			const blocked = blockedBy(subjects, camera.position, step(at.at, side, 1.5 * at.radius), {
				limbs: [limb.id],
			});
			if (!best || (best.blocked !== undefined && blocked === undefined))
				best = { camera, blocked };
		}
		return { limb, at, tall, ...(best as { camera: Camera; blocked: string | undefined }) };
	};
	let chosen = solve(candidates[0] as GreatLimb);
	for (let k = 1; k < candidates.length && chosen.blocked !== undefined; k++) {
		const next = solve(candidates[k] as GreatLimb);
		if (next.blocked === undefined) chosen = next;
	}
	const { limb, at, tall, camera } = chosen;
	const reach = 0.35 * tall * lens.aspect;
	const distance = Math.hypot(
		camera.position[0] - at.at[0],
		camera.position[1] - at.at[1],
		camera.position[2] - at.at[2],
	);
	return {
		kind: 'the bark on a great limb',
		camera,
		// The plant is drawn from just in front of the limb's bark, so a spray of leaves or a branch
		// that hangs between the lens and the limb does not lie across the bark the picture is of.
		near: Math.max(0.02, distance - BARK_LIMB_CLEAR * at.radius),
		points: [
			{
				name: "the limb's bark",
				at: at.at,
				within: [0.4, 0.4, 0.6, 0.6],
				size: { metres: 2 * at.radius, of: 'height', min: girth * 0.6, max: girth * 1.5 },
			},
			{
				name: 'the limb running one way',
				at: step(at.at, at.direction, reach),
				within: [-0.1, 0, 1.1, 1],
			},
			{
				name: 'the limb running the other way',
				at: step(at.at, at.direction, -reach),
				within: [-0.1, 0, 1.1, 1],
			},
		],
		apart: [
			{
				a: 'the limb running one way',
				b: 'the limb running the other way',
				least: 0.4,
				along: 'either',
			},
		],
		regions: [
			{
				name: "the limb's bark",
				box: [0.4, 0.4, 0.6, 0.6],
				min: 0.85,
				of: 'wood',
				thick: SUBJECT_WOOD * at.radius,
				thickMost: SUBJECT_WOOD_MOST * at.radius,
			},
			{
				name: 'the leaves over the limb',
				box: [0.3, 0.3, 0.7, 0.7],
				max: MOST_LEAVES_OVER,
				of: 'foliage',
			},
			{
				name: 'the leaves in the picture',
				box: [0, 0, 1, 1],
				max: MOST_LEAVES_IN_BARK,
				of: 'foliage',
			},
			{ name: 'the ground beside the limb', box: [0, 0, 1, 1], max: 0.9 },
		],
		facts: {
			limb: limb.id,
			radius: at.radius,
			share: along,
			frame: tall,
			...(chosen.blocked !== undefined && {
				warning: `${chosen.blocked} stands between the camera and every great limb`,
			}),
		},
	};
}

/** How a view of one branch piece frames it. */
export interface BranchPieceOptions {
	/** The share of the frame that the piece takes from its cut to its tip. */
	readonly fill?: number;
	/** Whether the piece lies across the frame, its cut at the left, in place of standing on its cut. */
	readonly laid?: boolean;
}

/**
 * The view of one branch piece, as the cut-branch pictures show it: square to the piece's own face,
 * the piece standing on its cut at the frame's foot with its tip near the top, or laid across the
 * frame with its cut at the left. The piece fills the frame from cut to tip, and the frame widens
 * where the piece's spread needs it.
 */
export function branchPieceShot(
	piece: BranchPiece,
	lens: Lens,
	options: BranchPieceOptions = {},
): Solved {
	if (!(piece.length > 0)) return absent('the branch piece has no length');
	const fill = options.fill ?? 0.85;
	const face = piece.face ?? across(piece.direction);
	const forward: V3 = [-face[0], -face[1], -face[2]];
	const laid = options.laid === true;
	const roll = rollUp(forward, piece.direction) + (laid ? -Math.PI / 2 : 0);
	const tall = laid
		? Math.max(piece.length / (fill * lens.aspect), (2 * piece.spread) / fill)
		: Math.max(piece.length / fill, (2 * piece.spread) / (fill * lens.aspect));
	const middle = step(piece.socket, piece.direction, piece.length / 2);
	const camera = aim(middle, 0.5, 0.5, forward, tall, lens, roll);
	// The piece's run as a share of the frame's side it lies along.
	const run = piece.length / (laid ? tall * lens.aspect : tall);
	const tip = step(piece.socket, piece.direction, piece.length);
	const span = (centre: number): readonly [number, number] => [centre - 0.06, centre + 0.06];
	const cut = span(0.5 + (laid ? -run : run) / 2);
	const end = span(0.5 + (laid ? run : -run) / 2);
	return {
		kind: 'one branch piece from its cut to its tips',
		camera,
		points: [
			{
				name: 'the cut',
				at: piece.socket,
				within: laid ? [cut[0], 0.3, cut[1], 0.7] : [0.3, cut[0], 0.7, cut[1]],
			},
			{
				name: 'the tip',
				at: tip,
				within: laid ? [end[0], 0.3, end[1], 0.7] : [0.3, end[0], 0.7, end[1]],
			},
		],
		regions: [{ name: 'the plain ground round the piece', box: [0, 0, 1, 1], min: 0.03, max: 0.8 }],
		facts: { length: piece.length, spread: piece.spread, frame: tall, laid },
	};
}

/** Whether a shot's subject is in its picture, and where each of its points landed. */
export interface SubjectCheck {
	readonly present: boolean;
	/** What is missing, when the subject is not in the picture. */
	readonly reason?: string;
	readonly points: readonly {
		readonly name: string;
		readonly x: number;
		readonly y: number;
		readonly size?: number;
	}[];
}

/** A share rounded for a reason's text. */
function shown(value: number): string {
	return Number.isFinite(value) ? value.toFixed(2) : Number.isNaN(value) ? 'no place' : 'any';
}

/**
 * Whether a shot's subject is in its picture: each point of its contract is projected through the
 * camera and must land in front of the lens, inside its frame box and at its contracted size, and
 * each pair that must stand apart does. The first failures give the reason.
 */
export function checkShot(shot: SubjectShot, lens: Lens): SubjectCheck {
	const failures: string[] = [];
	const placed = new Map<string, { readonly x: number; readonly y: number }>();
	const gap = (a: { x: number; y: number }, b: { x: number; y: number }, either: boolean) =>
		either ? Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) : Math.abs(a.x - b.x);
	const points = shot.points.map((point) => {
		const { x, y, depth } = project(shot.camera, lens, point.at);
		placed.set(point.name, { x, y });
		const [left, top, right, bottom] = point.within;
		if (!(depth > 0)) failures.push(`${point.name} stands behind the lens`);
		else if (!(x >= left && x <= right && y >= top && y <= bottom))
			failures.push(
				`${point.name} lands at ${shown(x)} across and ${shown(y)} down, outside ${left} to ${right} across and ${top} to ${bottom} down`,
			);
		if (!point.size || !(depth > 0)) return { name: point.name, x, y };
		const size = shareAt(point.size.metres, depth, lens, point.size.of);
		if (!(size >= point.size.min && size <= point.size.max))
			failures.push(
				`${point.name} takes ${shown(size)} of the frame's ${point.size.of}, outside ${point.size.min.toFixed(2)} to ${shown(point.size.max)}`,
			);
		return { name: point.name, x, y, size };
	});
	for (const pair of shot.apart ?? []) {
		const a = placed.get(pair.a);
		const b = placed.get(pair.b);
		if (!a || !b || !(gap(a, b, pair.along === 'either') >= pair.least))
			failures.push(
				`${pair.a} and ${pair.b} do not stand ${pair.least} of the ${pair.along === 'either' ? 'frame' : 'width'} apart`,
			);
	}
	return failures.length === 0
		? { present: true, points }
		: { present: false, reason: failures.join('; '), points };
}
