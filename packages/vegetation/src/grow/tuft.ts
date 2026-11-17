// The tuft grower: grasses and sedges. The plant's frame is a stool: shoots (tillers) spread evenly
// over a small disc at the soil, each a short plumb column of sheaths. The stool itself is a low
// mound of old leaf bases that every shoot stands in, so the plant is one body however few shoots
// it keeps. Nothing else of the frame stands above the ground. Every part a viewer sees is a piece
// of the kit, built once and placed whole at a socket on a shoot:
//
// - the shoot's own column of sheaths, a spindle that narrows to a point where its blades leave;
//   the middle shoots' columns stand plumb and tallest, the rim's lean out and stand lower;
// - a blade, in the poses the record measures and the shapes between them: the youngest stand near
//   plumb at the shoot's heart, the oldest arch out and over to the ground, where they turn and lie
//   on the soil. Blades leave their shoot in two ranks (grasses) or three (sedges);
// - in the seasons the record names, a flowering stem, and its head as a piece of its own at the
//   same socket: a sedge's stem bows over and hangs its spikes plumb one below another near the
//   crest of its bow, a grass's stands nearly straight under an open pyramid of branches and
//   spikelets.
//
// A piece is posed in its own space with +Y plumb, so a blade or a spike hangs under its own weight
// wherever it stands; how far a stem leans is one of its poses. The record's lengths are shares of
// the leaf mound's height, which is a share of the plant's height. Each bent part is a path of the
// shared curve (core/arch.ts), fitted to the record's measured figures: one arch, or for a blade
// that comes to rest on the soil a chain of three, the arch to the soil, a turn back to level and
// a run that lies on it.
//
// The sockets enter the skeleton in the order the plant thins by (grow/sockets.ts): shoots in an
// order whose every leading run is spread evenly over the stool, a shoot's blades from its oldest,
// no piece before its shoot, and a stem's head straight after its stem, so no head outlasts it. The stool's mound draws as the plant's own mesh at every level,
// and what lies under the soil, a rhizome and roots, at the nearest.
import type { MeshArrays } from '../asset';
import {
	type Arch,
	type ArchChain,
	archFromFigures,
	archPath,
	chainArches,
	chainLength,
	chainPath,
} from '../core/arch';
import { AXIS_LIMB, AXIS_ROOT, type MacroSkeleton, SkeletonBuilder } from '../core/graph';
import { unitAt } from '../core/hash';
import { atan2, cos, PI, pow, radians, sin, type Vector3 } from '../core/math';
import {
	type GrassBlade,
	type Planned,
	type Species,
	type Tuft,
	type TuftPanicle,
	type TuftPose,
	type TuftSpikes,
	tuftGrowth,
} from '../core/record';
import type { TextureManifest } from '../core/textures';
import { curveAt, DETAILS, type Detail, spreadAt, spreadMean } from '../core/types';
import { BLADE_ACROSS, BLADE_ROWS, bladeTexture, writeBlade } from '../leaf/grass-blade';
import type { WrittenPiece } from '../leaf/ground-piece';
import { MeshWriter } from '../leaf/writer';
import type {
	CrownLight,
	DetailPlan,
	GrowInput,
	GrowRequest,
	MeshInput,
	MeshLevel,
} from '../stages';
import { type AxisPath, axisPath, emptyFrame, frameAt } from '../wood/frames';
import { axisBytes, leafStrip, stalkRange, wholePath, writeStem } from './ground';
import { scaledWithPieces, targetHeight } from './height';
import {
	crownOf,
	type ModelAxis,
	type ModelPiece,
	type ModelSocket,
	type PlantModel,
} from './model';
import type { Grower } from './models';
import { addSockets, discPlaces, type Socket } from './sockets';
import { FOLIAGE_FLOOR } from './sparse';

/** Purposes of the grower's hash keys, so no two draws share one. */
const Purpose = {
	Shoots: 1,
	Shoot: 2,
	Blade: 4,
	Stalks: 5,
	Stalk: 6,
	Rhizome: 9,
	Root: 10,
} as const;

/** The poses a flowering stem takes, from the stool's middle to its rim. */
const STALK_POSES = 3;
/**
 * The blade shapes the kit holds from one measured pose to the next, the next one counted. A blade
 * ages through every shape between two measured poses, so the shapes between them are built too:
 * with the measured poses alone a mound reads as that many separate shells.
 */
const POSE_STEPS = 3;
/**
 * The shapes a blade strays from its age's, either side. Still 02's blades of one age come down at
 * different distances and many end in the air, so a blade takes any shape up to a whole step away.
 */
const SHAPE_STRAY = 1;
/** Radians a blade's heading strays from its rank. */
const RANK_STRAY = 0.5;
/** How far a rim shoot's blades turn from their rank toward the way out of the stool, as a share. */
const OUTWARD = 0.75;
/** Radians a flowering stem's heading strays from the way out of the stool. */
const STALK_STRAY = 0.5;
/** The golden ratio's fraction, which spreads the stems' heights evenly between their ends. */
const GOLDEN_SHARE = 0.6180339887498949;
/** The level of detail of the shared curve that each mesh tier cuts its bends at, low tier first. */
const TIER_LEVEL: readonly (0 | 1 | 2)[] = [2, 1, 0, 0];
/** Faces round a flowering stem and round a spike or spikelet, by tier. */
const STEM_SIDES: readonly number[] = [3, 3, 4, 5];
const HEAD_SIDES: readonly number[] = [3, 3, 4, 5];
/** Faces round a shoot's sheath column and rings up it, by tier. */
const SHEATH_SIDES: readonly number[] = [4, 5, 6, 8];
const SPINDLE_RINGS: readonly number[] = [4, 5, 6, 8];
/** A flowering stem's width under its head, as a share of its width at the foot. */
const STALK_TAPER = 0.35;
/** The share of a hanging spike's width that its thread takes. */
const THREAD_WIDTH = 0.22;
/**
 * Still 02: a spike's thread runs 0.04 to 0.1 of the mound's height, so each takes from six tenths
 * to one and four tenths of the record's mean; the spikes of a stem are of different lengths,
 * three quarters to one and a quarter of the record's; and a thread leans up to 25 degrees to one
 * side of the stem or the other, so the spikes hang in a loose bunch round it.
 */
const THREAD_LEAST = 0.6;
const THREAD_RANGE = 0.8;
const SPIKE_LEAST = 0.75;
const SPIKE_RANGE = 0.5;
const SPLAY = 25;
/** The plastic number's fraction, a second step that spreads the spikes' lengths unlike the threads'. */
const PLASTIC = 0.7548776662466927;
/** A panicle branch's width, as a share of the stem's foot, and a spikelet's width over its length. */
const BRANCH_WIDTH = 0.3;
const SPIKELET_WIDTH = 0.42;
/** How much shorter a panicle's top whorl's branches are than its lowest whorl's, as a share. */
const WHORL_TAPER = 0.75;
/**
 * The radius a blade that comes down to the soil turns on as it comes to rest, in blade widths: a
 * strap turns about as tight as its own width allows where it meets the ground.
 */
const LAND_RADIUS = 1.5;
/** How far a landed blade lies along the soil past where it comes down, in blade widths. */
const LAND_LIE = 1;
/**
 * Still 07: the shoot bases at the stool's rim lean out about 15 degrees from plumb and stand about
 * six tenths as tall as the plumb ones at its middle.
 */
const SHEATH_LEAN = 15;
const SHEATH_RIM = 0.4;
/**
 * Still 07: a shoot base is a spindle, seven tenths of its widest at the soil, widest four tenths of
 * the way up and closed to a point at its top, where the blades leave.
 */
const SPINDLE_FOOT = 0.7;
const SPINDLE_WIDEST = 0.4;
const SPINDLE_TOP = 0.15;

/** A light that sees the whole sky, for a piece that is meshed before any crown stands round it. */
const OPEN: CrownLight = { cells: [1, 1, 1], min: [0, 0, 0], cell: 1, sky: new Float32Array([1]) };
/** The bytes of a piece's vertices before its row gives them a wind record. */
const NO_BYTES = { high: 0, low: 0, phase: 0 } as const;

/** A unit draw for one purpose of one variant. */
function draw(input: GrowInput, purpose: number, a = 0, b = 0, c = 0): number {
	return unitAt(input.seed, input.record.seedSalt, input.variant * 256 + purpose, a, b * 4096 + c);
}

/** The record's tuft and blade, or an error for a record of another model. */
function tuftOf(record: Species): { readonly growth: Tuft; readonly blade: GrassBlade } {
	const growth = tuftGrowth(record);
	if (!growth || record.foliage.kind !== 'grass-blade')
		throw new Error(`@null3d/vegetation: '${record.id}' is not a tuft of grass blades`);
	return { growth, blade: record.foliage.blade };
}

/** A direction in the vertical plane of a heading: `elevation` radians above the horizontal. */
function inPlane(heading: number, elevation: number): Vector3 {
	const c = cos(elevation);
	return [cos(heading) * c, sin(elevation), sin(heading) * c];
}

/** The signed angle from one heading to another, from -π to π. */
function angleBetween(from: number, to: number): number {
	let d = (to - from) % (2 * PI);
	if (d > PI) d -= 2 * PI;
	if (d < -PI) d += 2 * PI;
	return d;
}

/** One pose of a piece: its path at the largest size a socket asks for, and how high it stands. */
interface Pose {
	readonly chain: ArchChain;
	/** The path's length in metres. */
	readonly length: number;
	/** The highest point above the attach point, in metres. */
	readonly top: number;
	/** The farthest point out from the attach point along the heading, in metres. */
	readonly out: number;
	/**
	 * Metres above the soil under which a blade that comes to rest lies on it: the radius it turns
	 * on as it lands. None for a part that stays in the air.
	 */
	readonly lies?: number;
	/** The shares along the path where it turns to the soil and where it lies on it. */
	readonly landing?: readonly [number, number];
}

/** A tuft's sizes in metres and the poses of its pieces, from its record. */
interface Plan {
	/** The leaf mound's height. */
	readonly mound: number;
	/** The sheath column's height at its tallest, and its width at the foot. */
	readonly sheath: number;
	readonly sheathWidth: number;
	/** The blade's poses, the youngest first. */
	readonly blades: readonly Pose[];
	/** The flowering stem's poses, from the stool's middle to its rim; none without stems. */
	readonly stalks: readonly Pose[];
	/** A flowering stem's width at its foot. */
	readonly stalkWidth: number;
}

/** How much taller the tallest sheath column stands than the record's, as a share. */
const SHEATH_SPREAD = 0.15;

/** The plans found, by the growth they were found from: a fit costs more than a plant's sockets. */
const PLANS = new WeakMap<Tuft, Plan>();

/** An arch as a chain of one link. */
function single(arch: Arch): ArchChain {
	const { leave, ...link } = arch;
	return { leave, links: [link] };
}

/** How high a chain stands above its base and how far out it reaches, in metres. */
function extentOf(chain: ArchChain): { top: number; out: number } {
	const path = chainPath(chain, 0, 24);
	let top = 0;
	let out = 0;
	for (let i = 0; i <= path.segments; i++) {
		top = Math.max(top, path.up[i] as number);
		out = Math.max(out, path.out[i] as number);
	}
	return { top, out };
}

/** A tuft's plan. */
function planOf(record: Species): Plan {
	const { growth, blade } = tuftOf(record);
	const known = PLANS.get(growth);
	if (known) return known;
	const mound = growth.mound * spreadMean(record.size.height);
	const grown = 1 + Math.max(0, growth.bladeSpread);
	const keys = growth.poses;
	const blades: Pose[] = [];
	for (let i = 0; i <= (keys.length - 1) * POSE_STEPS; i++) {
		const from = keys[Math.min(keys.length - 1, Math.floor(i / POSE_STEPS))] as TuftPose;
		const to = keys[Math.min(keys.length - 1, Math.floor(i / POSE_STEPS) + 1)] as TuftPose;
		const share = (i % POSE_STEPS) / POSE_STEPS;
		const between = (a: number, b: number) => a + (b - a) * share;
		// A figure that only one of the two measured poses states is left for the fit to find.
		const stated = (a: number | undefined, b: number | undefined) =>
			a !== undefined && b !== undefined ? between(a, b) : undefined;
		const leave = stated(from.leave, to.leave);
		const tip = stated(from.tip, to.tip);
		const apex = between(from.apex, to.apex);
		const drop = between(from.drop, to.drop);
		const figures = {
			...(leave !== undefined ? { leave } : {}),
			...(tip !== undefined ? { tip } : {}),
			apex: apex * mound,
			drop: drop * mound,
			reach: between(from.reach, to.reach) * mound,
		};
		const fit = archFromFigures(figures);
		if (drop < apex) {
			const chain = single({ ...fit.arch, length: fit.arch.length * grown });
			blades.push({ chain, length: chainLength(chain), ...extentOf(chain) });
		} else blades.push(landing(fit.arch, figures, blade, grown));
	}
	const stalks: Pose[] = [];
	const stems = growth.stalks;
	if (stems)
		for (let k = 0; k < STALK_POSES; k++) {
			const share = (k + 0.5) / STALK_POSES;
			const shape = {
				leave: 90 - (stems.lean[0] + (stems.lean[1] - stems.lean[0]) * share),
				turn: stems.bow.turn[0] + (stems.bow.turn[1] - stems.bow.turn[0]) * share,
				from: stems.bow.from,
			};
			// The stem is as long as stands its highest point at the tallest stem's height.
			const length = (stems.top[1] * mound) / extentOf(single({ ...shape, length: 1 })).top;
			const chain = single({ ...shape, length });
			stalks.push({ chain, length, ...extentOf(chain) });
		}
	const plan: Plan = {
		mound,
		sheath: growth.sheath.height * mound * (1 + SHEATH_SPREAD),
		sheathWidth: growth.sheath.width * mound,
		blades,
		stalks,
		stalkWidth: (stems?.width ?? 0) * mound,
	};
	PLANS.set(growth, plan);
	return plan;
}

/**
 * A blade that comes down to the soil and comes to rest on it, as a chain of three arches: the arch
 * the figures fit as far as a land radius above the soil, a turn on that radius back to level, and
 * a run that lies on the soil. The blade meets the soil at the width it has where its point begins,
 * so the run is as long as the point, and the point lies on the ground.
 */
function landing(
	fitted: Arch,
	figures: { readonly leave?: number; apex: number; drop: number; reach: number },
	blade: GrassBlade,
	grown: number,
): Pose {
	const fall = Math.max(0, Math.min(90, fitted.turn - fitted.leave));
	const lift = 1 - cos(radians(fall));
	const aimed = LAND_RADIUS * blade.width;
	const arch = archFromFigures({
		...(figures.leave !== undefined ? { leave: figures.leave } : {}),
		tip: fall,
		apex: figures.apex,
		drop: Math.max(0, figures.drop - aimed * lift),
		reach: Math.max(0, figures.reach - aimed * sin(radians(fall))),
	}).arch;
	// The fit meets its figures to within its miss, so the turn is sized from where the arch truly
	// ends: it turns down from that height to the soil, and the run lies on the ground.
	const path = archPath(arch, 0, 24);
	const ends = Math.max(0, path.up[path.segments] as number);
	const radius = lift > 1e-6 ? ends / lift : aimed;
	const turnLength = radius * radians(fall);
	const shown = arch.length + turnLength;
	// It comes to rest over a blade's width, so no point lies out past the skirt.
	const lie = blade.width * LAND_LIE;
	const { leave, ...first } = arch;
	const chain: ArchChain = {
		leave,
		links: [
			{ ...first, length: arch.length * grown },
			{ length: turnLength * grown, turn: -fall },
			{ length: lie * grown, turn: 0 },
		],
	};
	const length = chainLength(chain);
	return {
		chain,
		length,
		...extentOf(chain),
		lies: Math.max(radius, blade.width) * grown,
		landing: [(arch.length * grown) / length, (shown * grown) / length],
	};
}

/**
 * Where a blade of an age stands among the measured poses: 0 at the first pose and one more at each
 * next. A pose holds the middle of its share of a shoot's blades, and a blade between two middles
 * stands between their poses.
 */
function shapeAt(poses: readonly TuftPose[], age: number): number {
	let whole = 0;
	for (const pose of poses) whole += pose.share;
	let before = 0;
	let last = 0;
	for (let j = 0; j < poses.length; j++) {
		const share = (poses[j] as TuftPose).share / whole;
		const middle = before + share / 2;
		if (age <= middle) return j === 0 ? 0 : j - 1 + (age - last) / (middle - last);
		before += share;
		last = middle;
	}
	return poses.length - 1;
}

/** The piece a shoot's sheath column is, a blade's pose is, and a stem's pose is, in the list. */
const SHEATH_CLASS = 0;
const bladeClass = (pose: number): number => 1 + pose;
const stalkClass = (plan: Plan, pose: number): number => 1 + plan.blades.length + pose;

/**
 * How late a part goes when the plant is thinned, from 0 for a part of the least plant: the parts
 * past the least count take even steps up to 1 in the order they are given.
 */
function keepOf(index: number, count: number, least: number): number {
	return index < least ? 0 : (index - least + 1) / Math.max(1, count - least + 1);
}

/**
 * How a tuft is tuned from its adult: the shares a younger, sparser or flowerless plant takes of
 * the record's own counts and of its size. The tuft model's own plant takes the adult tuning.
 */
interface TuftTune {
	/** The share of the adult's shoot and blade counts the plant carries. */
	readonly fill: number;
	/** The share of the adult's flowering stems the plant carries, 0 out of season. */
	readonly flowers: number;
	/** The share of the adult's height the tallest piece aims at. */
	readonly size: number;
	/** The share of the grown sockets the plant keeps, from its sparseness. */
	readonly keepShare: number;
}

/** The adult tuning of a plant at its record's own counts, size and density. */
const ADULT: TuftTune = { fill: 1, flowers: 1, size: 1, keepShare: 1 };

/**
 * A count of pieces on a growing plant: the least's count first, then the rest as the plant fills,
 * and the record's full count once it has.
 */
function filled(adult: number, least: number, fill: number): number {
	return fill >= 1 ? adult : Math.max(least, Math.round(least + (adult - least) * fill));
}

/** The flowering stems a plant keeps at its flowers' share: none before they open, the least after. */
function stemsAt(adult: number, shoots: number, least: number, flowers: number): number {
	if (flowers <= 0) return 0;
	if (flowers >= 1) return Math.min(shoots, adult);
	return Math.min(shoots, Math.max(least, Math.round(adult * flowers)));
}

/** How far a planned plant's flowering has come at a maturity, from 0 to 1. */
function flowersAt(growth: Planned, maturity: number): number {
	if (growth.flowers === undefined) return 1;
	return Math.max(
		0,
		Math.min(1, (maturity - growth.flowers.from) / Math.max(1e-9, growth.flowers.band)),
	);
}

/** The stool is the model's first axis; each shoot is one of the others. */
const STOOL = 0;

/**
 * Writes the tuft's intermediate model at the asked state: the stool and one axis for each shoot,
 * a socket for each sheath column, blade and flowering stem, and the pieces' measured figures. The
 * adapter writes no geometry, no material and no level. The shared stages price, grow, close,
 * allocate and bake the model.
 *
 * @param input The record, the seed, the variant, the season and the request.
 * @returns The model.
 * @category api/vegetation
 */
export function emitTuft(input: GrowInput): PlantModel {
	const { growth, blade } = tuftOf(input.record);
	const plan = planOf(input.record);
	const { mound } = plan;
	const tune = input.record.growth.model === 'planned' ? plannedTune(input) : ADULT;
	const stoolRadius = (growth.stool * mound) / 2;
	const stoolTop = plan.sheathWidth;
	const axes: ModelAxis[] = [
		{
			order: 0,
			parent: -1,
			parentShare: 0,
			from: [0, -0.03, 0],
			to: [0, stoolTop, 0],
			nodes: [
				{ at: [0, -0.03, 0], radius: stoolRadius },
				{ at: [0, 0, 0], radius: stoolRadius },
				{ at: [0, stoolTop, 0], radius: 0 },
			],
			radius: [stoolRadius, 0],
			body: true,
		},
	];
	// A young plant carries the least's shoots first and fills to the record's count as it grows.
	const adultShoots = Math.max(1, Math.round(spreadAt(growth.shoots, draw(input, Purpose.Shoots))));
	const shoots = filled(adultShoots, growth.least.shoots, tune.fill);
	const places = discPlaces(shoots, stoolRadius, draw(input, Purpose.Shoots, 1) * 2 * PI);
	const stems = growth.stalks;
	const adultStalks =
		stems?.seasons.includes(input.season) && plan.stalks.length > 0
			? Math.max(0, Math.round(spreadAt(stems.count, draw(input, Purpose.Stalks))))
			: 0;
	const stalks = stemsAt(adultStalks, shoots, growth.least.stalks, tune.flowers);
	const ranks = Math.max(1, growth.ranks);
	const sockets: ModelSocket[] = [];
	// An upright piece heads the level way its socket points.
	const level = (heading: number): Vector3 => [cos(heading), 0, sin(heading)];
	places.forEach((place, i) => {
		const unit = (k: number) => draw(input, Purpose.Shoot, i, k);
		const shootKeep = keepOf(i, shoots, growth.least.shoots);
		const column =
			growth.sheath.height *
			mound *
			(1 + SHEATH_SPREAD * (unit(0) * 2 - 1)) *
			(1 - SHEATH_RIM * place.out * place.out);
		// A rim shoot's column leans out of the stool; the pieces that hang stand plumb.
		const lean = radians(SHEATH_LEAN * place.out);
		const tilt: Vector3 = [
			cos(place.heading) * sin(lean),
			cos(lean),
			sin(place.heading) * sin(lean),
		];
		const from: Vector3 = [place.x, 0, place.z];
		const to: Vector3 = [place.x + tilt[0] * column, tilt[1] * column, place.z + tilt[2] * column];
		const axis = axes.length;
		const half = plan.sheathWidth / 2;
		axes.push({
			order: 1,
			parent: STOOL,
			parentShare: 1,
			from,
			to,
			nodes: [
				{ at: from, radius: half },
				{ at: to, radius: half * SPINDLE_TOP },
			],
			radius: [half, half * SPINDLE_TOP],
			body: false,
		});
		sockets.push({
			axis,
			order: 1,
			share: 0,
			at: from,
			direction: tilt,
			piece: SHEATH_CLASS,
			scale: column / plan.sheath,
			keep: shootKeep,
			group: i,
		});
		// The blades, the oldest first: it stands lowest and outermost, and it is the last to go.
		const adultBlades = Math.max(1, Math.round(spreadAt(growth.blades, unit(1))));
		const blades = filled(adultBlades, growth.least.blades, tune.fill);
		const rankTurn = unit(2) * 2 * PI;
		for (let k = 0; k < blades; k++) {
			const draws = (m: number) => draw(input, Purpose.Blade, i, k, m);
			// The blade's shape by its age, counted from the youngest, with a stray of up to a shape.
			const age = 1 - (k + 0.5) / blades;
			const pose = Math.min(
				plan.blades.length - 1,
				Math.max(
					0,
					Math.round(shapeAt(growth.poses, age) * POSE_STEPS + (draws(2) * 2 - 1) * SHAPE_STRAY),
				),
			);
			const around = rankTurn + (2 * PI * (k % ranks)) / ranks + (draws(0) - 0.5) * RANK_STRAY;
			// A blade faces out of its tuft: at the rim its heading turns toward the way out.
			const heading = around + OUTWARD * place.out * angleBetween(around, place.heading);
			const size = (1 + growth.bladeSpread * (draws(1) * 2 - 1)) / (1 + growth.bladeSpread);
			sockets.push({
				axis,
				order: 2,
				share: 0,
				at: from,
				direction: level(heading),
				piece: bladeClass(pose),
				scale: size,
				keep: Math.max(shootKeep, keepOf(k, blades, growth.least.blades)),
				group: i,
			});
		}
		if (stems && i < stalks) {
			const draws = (m: number) => draw(input, Purpose.Stalk, i, m);
			const pose = Math.min(STALK_POSES - 1, Math.floor(place.out * STALK_POSES));
			// The first stem is the tallest and the second the shortest, so a thinned plant keeps
			// the spread of heights; the rest fall evenly between.
			const share = i === 0 ? 1 : i === 1 ? 0 : (i * GOLDEN_SHARE) % 1;
			const size = (stems.top[0] + (stems.top[1] - stems.top[0]) * share) / stems.top[1];
			const heading = place.heading + (draws(0) - 0.5) * STALK_STRAY;
			sockets.push({
				axis,
				order: 2,
				share: 0,
				at: from,
				direction: level(heading),
				piece: stalkClass(plan, pose),
				scale: size,
				keep: Math.max(shootKeep, keepOf(i, stalks, growth.least.stalks)),
				group: i,
			});
		}
	});
	const pieces: ModelPiece[] = [
		{
			name: 'sheath',
			length: plan.sheath,
			width: plan.sheathWidth,
			depth: plan.sheathWidth,
			top: plan.sheath,
			reach: 0,
			figures: { height: growth.sheath.height, width: growth.sheath.width, mound },
		},
	];
	plan.blades.forEach((pose, k) => {
		pieces.push({
			name: `blade-${k}`,
			length: pose.length,
			width: blade.width,
			depth: blade.width,
			top: pose.top,
			reach: pose.out,
			figures: {
				length: spreadMean(blade.length),
				width: blade.width,
				top: pose.top,
				reach: pose.out,
			},
		});
	});
	plan.stalks.forEach((pose, k) => {
		pieces.push({
			name: `stalk-${k}`,
			length: pose.length,
			width: plan.stalkWidth,
			depth: plan.stalkWidth,
			top: pose.top,
			reach: pose.out,
			figures: {
				headTop: stems?.top[1] ?? pose.top,
				stemWidth: stems?.width ?? plan.stalkWidth,
				top: pose.top,
				reach: pose.out,
			},
		});
	});
	const crown = crownOf(sockets, pieces);
	return {
		species: input.record.id,
		axes,
		sockets,
		pieces,
		least: sockets.reduce((count, socket) => count + (socket.keep === 0 ? 1 : 0), 0),
		scale: tune.size,
		keepShare: tune.keepShare,
		crown: { top: crown.top, reach: crown.reach, base: crown.base },
	};
}

/** Builds a tuft skeleton from its model, at the model's state. */
export function growModel(
	input: GrowInput,
	model: PlantModel,
	soil?: (builder: SkeletonBuilder, crown: number, crownTop: number, stoolRadius: number) => void,
): MacroSkeleton {
	const { blade } = tuftOf(input.record);
	const builder = new SkeletonBuilder();
	const stool = model.axes[STOOL] as ModelAxis;
	const stoolRadius = stool.radius[0];
	const crown = builder.addAxis({ parent: -1, parentNode: -1, order: 0, kind: AXIS_ROOT });
	const stoolNodes =
		stool.nodes ??
		([
			{ at: stool.from, radius: stool.radius[0] },
			{ at: stool.to, radius: stool.radius[1] },
		] as const);
	let crownTop = -1;
	let prior = -1;
	stoolNodes.forEach((node, k) => {
		prior = builder.addNode({
			x: node.at[0] as number,
			y: node.at[1] as number,
			z: node.at[2] as number,
			radius: node.radius,
			parent: prior,
			axis: crown,
			light: 1,
		});
		if (k === 1) crownTop = prior;
	});
	soil?.(builder, crown, crownTop, stoolRadius);
	const built: { axis: number; base: number }[] = [];
	for (let a = 1; a < model.axes.length; a++) {
		const spec = model.axes[a] as ModelAxis;
		const axis = builder.addAxis({
			parent: crown,
			parentNode: crownTop,
			parentT: 1,
			order: 1,
			kind: AXIS_LIMB,
		});
		const base = builder.addNode({
			x: spec.from[0] as number,
			y: spec.from[1] as number,
			z: spec.from[2] as number,
			radius: spec.radius[0],
			parent: crownTop,
			axis,
			light: 1,
		});
		builder.addNode({
			x: spec.to[0] as number,
			y: spec.to[1] as number,
			z: spec.to[2] as number,
			radius: spec.radius[1],
			parent: base,
			axis,
			light: 1,
		});
		built[a] = { axis, base };
	}
	const candidates: Socket[] = model.sockets.map((socket) => {
		const seat = built[socket.axis] as { axis: number; base: number };
		return {
			axis: seat.axis,
			node: seat.base,
			at: socket.at,
			direction: socket.direction,
			piece: socket.piece,
			scale: socket.scale,
			keep: socket.keep,
			group: socket.group,
		};
	});
	// A sparser plant keeps the first sockets in the order the plant thins by, so every sparser
	// plant is a subset of a denser one: no piece moves and no shoot outlasts its sheath.
	let keptSockets = candidates;
	if (model.keepShare < 1) {
		const least = candidates.reduce((count, socket) => count + (socket.keep === 0 ? 1 : 0), 0);
		const most = Math.min(
			candidates.length,
			Math.max(least, Math.round(candidates.length * model.keepShare)),
		);
		const order = candidates.map((_, index) => index);
		order.sort((a, b) => (candidates[a] as Socket).keep - (candidates[b] as Socket).keep || a - b);
		const kept = new Set(order.slice(0, most));
		keptSockets = candidates.filter((_, index) => kept.has(index));
	}
	addSockets(builder, keptSockets);
	const finished = builder.finish(0);
	// The skeleton holds only the stool. The plant's top and its box are its pieces': the tallest
	// piece, and each piece's reach from its shoot with half a blade's width beside it.
	let top = 0;
	const low: [number, number] = [-stoolRadius, -stoolRadius];
	const high: [number, number] = [stoolRadius, stoolRadius];
	// The box and the top are the plant's own, so no sparseness moves them: every grown socket
	// counts, as the tuft model's box did.
	for (const socket of candidates) {
		const piece = model.pieces[socket.piece];
		if (!piece) continue;
		top = Math.max(top, (socket.at[1] as number) + piece.top * socket.scale);
		const out = piece.reach * socket.scale;
		if (!(out > 0)) continue;
		const heading = atan2(socket.direction[2] as number, socket.direction[0] as number);
		const x = (socket.at[0] as number) + cos(heading) * out;
		const z = (socket.at[2] as number) + sin(heading) * out;
		low[0] = Math.min(low[0], x);
		low[1] = Math.min(low[1], z);
		high[0] = Math.max(high[0], x);
		high[1] = Math.max(high[1], z);
	}
	const bladePiece = model.pieces.find((piece) => piece.name.startsWith('blade'));
	const beside = (bladePiece?.width ?? blade.width) / 2;
	const grown: MacroSkeleton = {
		...finished,
		height: top,
		bounds: {
			min: [low[0] - beside, 0, low[1] - beside],
			max: [high[0] + beside, top, high[1] + beside],
		},
	};
	// A tuft is its pieces, so each variant stands at the height its record asks for it with its
	// pieces scaled with it, and the height calibration after the grower finds nothing to scale.
	const aim = targetHeight(input.record, input.seed, input.variant) * model.scale;
	const factor = top > 0 ? aim / top : 1;
	return scaledWithPieces(grown, factor);
}

/**
 * Grows a tuft of the tuft model: the stool, its shoots, and a socket for each shoot's sheath
 * column, each blade and each flowering stem in season.
 *
 * @param input The record, the seed, the variant and the season.
 * @returns The skeleton.
 * @category api/vegetation
 */
export function growTuft(input: GrowInput): MacroSkeleton {
	return growModel(input, emitTuft(input), (builder, crown, crownTop, radius) =>
		growSoil(input, builder, crown, crownTop, radius),
	);
}

/**
 * A plant that has not grown: no parts, no rows, no triangles.
 */
function emptyTuft(): MacroSkeleton {
	const builder = new SkeletonBuilder();
	return { ...builder.finish(0), clumps: [], made: 0, shed: 0 };
}

/**
 * The shares a planned tuft takes of its adult at the asked maturity, sparseness and season. The
 * height curve sets the plant's size and its fill; the flowers' ramp sets the flowering stems; the
 * sparseness keeps the first sockets in the order the plant thins by, down to the record's floor.
 */
function plannedTune(input: GrowInput): TuftTune {
	const growth = input.record.growth;
	if (growth.model !== 'planned' || growth.adult !== 'tuft' || growth.tuft === undefined)
		throw new Error(`@null3d/vegetation: '${input.record.id}' is not a planned tuft`);
	const request = input.request ?? { maturity: 1, sparse: 0 };
	const maturity = Math.max(0, Math.min(1, request.maturity));
	const top = Math.max(1e-9, curveAt(growth.height, 1));
	const size = Math.max(0, Math.min(1, curveAt(growth.height, maturity) / top));
	const flowers = flowersAt(growth, maturity);
	// A flowering plant aims its tallest stem at the plant's height; one in leaf alone aims its
	// leaf mound at the share of that height the mound holds, so its blades keep their own lengths.
	const stemsStand = growth.tuft.stalks?.seasons.includes(input.season) === true && flowers > 0;
	const aim = stemsStand ? size : size * growth.tuft.mound;
	const sparse = Math.max(0, Math.min(1, request.sparse));
	const floor = input.record.sparse?.foliage ?? FOLIAGE_FLOOR;
	return { fill: size, flowers, size: aim, keepShare: 1 - sparse * (1 - floor) };
}

/**
 * Grows a planned tuft straight to the asked state: the stool, its shoots and its flowering stems,
 * with the plant's size, its fill and its flowering from its maturity, and its pieces thinned by
 * sparseness. The pieces, their places and the stool are the tuft family's, so no part is grown and
 * then cut.
 *
 * A tree's frame cannot read this plant. It has one stem population where a tuft has two, the leaf
 * shoots and the flowering stems; its fill clothes a clump in rows of leaves, where a blade is one
 * strap; it has no body for the stool the pictures show; and its piece rules build a stem with
 * leaves, where a bare blade is a piece of its own. The tuft adult therefore keeps the tuft model's
 * own plan, pieces and stool mesh, and the planned model adds only the state it is asked for.
 *
 * @param input The record, the seed, the variant, the season and the plan.
 * @returns The skeleton.
 * @category api/vegetation
 */
export function growPlannedTuft(input: GrowInput): MacroSkeleton {
	const growth = input.record.growth;
	if (growth.model !== 'planned' || growth.adult !== 'tuft')
		throw new Error(`@null3d/vegetation: '${input.record.id}' is not a planned tuft`);
	const request = input.request ?? { maturity: 1, sparse: 0 };
	const detail = input.plan ?? planTuft(input.record, request);
	if (!(detail.age > 0)) return emptyTuft();
	return growModel(input, emitTuft(input), (builder, crown, crownTop, radius) =>
		growSoil(input, builder, crown, crownTop, radius),
	);
}

/**
 * What a planned tuft's state costs, as numbers, before any geometry is built: its age, its adult
 * counts and the sockets its sparseness keeps. A tuft has no wood above its stool, so its priced
 * part is the foliage alone: one piece at each socket.
 *
 * @param record The species record.
 * @param request The asked maturity and sparseness.
 * @returns The plan.
 * @category api/vegetation
 */
export function planTuft(record: Species, request: GrowRequest): DetailPlan {
	const growth = record.growth;
	if (growth.model !== 'planned' || growth.adult !== 'tuft' || growth.tuft === undefined)
		throw new Error(`@null3d/vegetation: '${record.id}' is not a planned tuft`);
	const tuft = growth.tuft;
	const maturity = Math.max(0, Math.min(1, request.maturity));
	const shoots = Math.max(1, Math.round(spreadMean(tuft.shoots)));
	const blades = Math.max(1, Math.round(spreadMean(tuft.blades)));
	const stalks =
		tuft.stalks === undefined ? 0 : Math.max(0, Math.round(spreadMean(tuft.stalks.count)));
	const flowers = flowersAt(growth, maturity);
	const stems = stemsAt(stalks, shoots, tuft.least.stalks, flowers);
	const sockets = shoots + shoots * blades + stems;
	const sparse = Math.max(0, Math.min(1, request.sparse));
	const floor = record.sparse?.foliage ?? FOLIAGE_FLOOR;
	const share = 1 - sparse * (1 - floor);
	const least =
		Math.min(shoots, tuft.least.shoots) * (1 + tuft.least.blades) +
		(tuft.stalks === undefined ? 0 : Math.min(stalks, tuft.least.stalks));
	const kept = Math.max(least, Math.round(sockets * share));
	const piece = growth.prices.piece;
	return {
		age: maturity * growth.fullAge,
		finestOrder: 1,
		expected: [1, shoots, sockets],
		tubeSides: [4, 4, 4, 4, 4],
		foliage: [
			{ form: 'piece', blend: 1 },
			{ form: 'cards', blend: 1 },
			{ form: 'cards', blend: 1 },
		],
		triangles: {
			trunk: 0,
			limbs: 0,
			branches: 0,
			twigs: 0,
			foliage: sockets * piece,
			fruit: 0,
		},
		fruit: 0,
		flowers,
		rankCut: [1, 1, kept / Math.max(1, sockets)],
	};
}

/**
 * The stool's hold in the soil: a rhizome along the ground and the roots that leave it and the
 * stool.
 */
function growSoil(
	input: GrowInput,
	builder: SkeletonBuilder,
	crown: number,
	crownNode: number,
	stoolRadius: number,
): void {
	const { growth } = tuftOf(input.record);
	const soil = growth.soil;
	if (!soil) return;
	const roots = Math.max(0, Math.round(spreadAt(soil.roots, draw(input, Purpose.Root))));
	const heading = draw(input, Purpose.Rhizome, 2) * 2 * PI;
	let host = crown;
	let hostNode = crownNode;
	if (soil.rhizome !== undefined) {
		const half = spreadAt(soil.rhizome, draw(input, Purpose.Rhizome));
		const radius = soil.rhizomeRadius ?? 0.01;
		const along: [number, number] = [cos(heading), sin(heading)];
		const axis = builder.addAxis({ parent: -1, parentNode: -1, order: 0, kind: AXIS_ROOT });
		const nodes = 5;
		let previous = -1;
		for (let i = 0; i < nodes; i++) {
			const share = i / (nodes - 1);
			const out = -half + 2 * half * share;
			const end = Math.abs(2 * share - 1);
			previous = builder.addNode({
				x: along[0] * out,
				y: -radius * (0.4 + 0.35 * end),
				z: along[1] * out,
				radius: radius * (0.55 + 0.45 * (1 - end)),
				parent: previous < 0 ? -1 : previous,
				axis,
				light: 1,
			});
		}
		host = axis;
		hostNode = previous;
	}
	for (let r = 0; r < roots; r++) {
		const unit = (k: number) => draw(input, Purpose.Root, r, k);
		const out = heading + (r / Math.max(1, roots)) * 2 * PI + (unit(0) - 0.5) * 0.8;
		const droop = radians(spreadAt(soil.droop, unit(1)));
		const length = spreadAt(soil.rootLength, unit(2));
		const start = host === crown ? -0.02 : -0.01;
		const margin = host === crown ? stoolRadius : 0.01;
		const from: Vector3 = [cos(out) * margin * unit(3), start, sin(out) * margin * unit(3)];
		rootPath(builder, host, hostNode, from, out, -droop, length, soil.rootRadius);
	}
}

/**
 * Adds a root's axis: nodes running out from the stool and down below the soil, its radius closing
 * to a point at the end.
 */
function rootPath(
	builder: SkeletonBuilder,
	parent: number,
	parentNode: number,
	start: Readonly<Vector3>,
	heading: number,
	elevation: number,
	length: number,
	radius: number,
): void {
	const axis = builder.addAxis({ parent, parentNode, parentT: 1, order: 1, kind: AXIS_ROOT });
	const nodes = 4;
	const p: Vector3 = [start[0], start[1], start[2]];
	const step = length / (nodes - 1);
	let previous = parentNode;
	for (let i = 0; i < nodes; i++) {
		const share = i / (nodes - 1);
		if (i > 0) {
			const d = inPlane(heading, elevation - radians(25) * share);
			p[0] += d[0] * step;
			p[1] += d[1] * step;
			p[2] += d[2] * step;
		}
		previous = builder.addNode({
			x: p[0],
			y: p[1],
			z: p[2],
			radius: radius * (1 - 0.85 * share),
			parent: i === 0 ? parentNode : previous,
			axis,
			light: 1,
		});
	}
}

/**
 * A piece's path from a chain, in the piece's own space: its attach point at the origin, +Y plumb
 * and +Z the way it heads. The first frame's normal is the side that faces the sky once the path
 * has turned over.
 */
function pathOf(chain: ArchChain): AxisPath {
	const cut = chainPath(chain, 0, 32);
	const count = cut.segments + 1;
	const points = new Float64Array(count * 3);
	for (let i = 0; i < count; i++) {
		points[i * 3 + 1] = cut.up[i] as number;
		points[i * 3 + 2] = cut.out[i] as number;
	}
	const leave = radians(chain.leave);
	return axisPath(points, new Float64Array(count), count, [0, cos(leave), -sin(leave)]);
}

/** A shoot base's width at a share of its height, as a share of its widest: a pointed spindle. */
function spindle(share: number): number {
	if (share <= SPINDLE_WIDEST)
		return SPINDLE_FOOT + (1 - SPINDLE_FOOT) * sin((PI / 2) * (share / SPINDLE_WIDEST));
	const up = (share - SPINDLE_WIDEST) / (1 - SPINDLE_WIDEST);
	return 1 - (1 - SPINDLE_TOP) * pow(up, 1.6);
}

/** A straight path between two points, for a stalk, a thread, a spike or a spikelet. */
function straight(from: ArrayLike<number>, to: ArrayLike<number>): AxisPath {
	const points = new Float64Array(6);
	for (let k = 0; k < 3; k++) {
		points[k] = from[k] as number;
		points[3 + k] = to[k] as number;
	}
	return axisPath(points, new Float64Array(2), 2, [1, 0, 0]);
}

/** A three-angled stem's section: rounded corners, flat faces. */
function triangle(angle: number): number {
	return 0.8 + 0.2 * cos(3 * angle);
}

/** What the stem writers share: the texture's stalk strip. */
interface Strip {
	readonly v: readonly [number, number];
	readonly uHalf: number;
}

/** Writes a round or three-angled run along a path. */
function writeRun(
	mesh: MeshWriter,
	strip: Strip,
	path: AxisPath,
	from: number,
	to: number,
	rings: number,
	sides: number,
	radius: (share: number) => number,
	along: readonly [number, number],
	closeTip: boolean,
	angled = false,
	sheath = false,
): void {
	writeStem(mesh, {
		path,
		from,
		to,
		rings: Math.max(2, rings),
		radius,
		section: { sides, ...(angled ? { shape: triangle } : {}) },
		v: strip.v,
		uHalf: strip.uHalf,
		bytes: NO_BYTES,
		crown: OPEN,
		along,
		browning: 0,
		closeTip,
		sheath,
	});
}

/** Writes a flowering stem's own run: straight to its bow, then the bow's even arc. */
function writeStalk(
	mesh: MeshWriter,
	strip: Strip,
	path: AxisPath,
	arch: Arch,
	tier: number,
	width: number,
	until: number,
	angled: boolean,
): void {
	const sides = STEM_SIDES[tier] as number;
	const radius = (s: number) => (width / 2) * (1 - (1 - STALK_TAPER) * s);
	const bowAt = (arch.from ?? 0) * path.length;
	const end = until * path.length;
	const share = (s: number) => s / path.length;
	if (bowAt > 0)
		writeRun(
			mesh,
			strip,
			path,
			0,
			Math.min(bowAt, end),
			2,
			sides,
			(s) => radius(share(Math.min(bowAt, end)) * s),
			[0, share(Math.min(bowAt, end))],
			false,
			angled,
		);
	if (end <= bowAt) return;
	// The bow turns evenly, so even rings turn evenly: as many as the shared curve asks.
	const bends = archPath(arch, TIER_LEVEL[tier] as 0 | 1 | 2).segments;
	writeRun(
		mesh,
		strip,
		path,
		bowAt,
		end,
		bends + 1,
		sides,
		(s) => radius(share(bowAt) + (share(end) - share(bowAt)) * s),
		[share(bowAt), share(end)],
		false,
		angled,
	);
}

/** Writes the spike that ends a sedge's stem, carrying on along the stem's own line. */
function writeEndSpike(
	mesh: MeshWriter,
	strip: Strip,
	path: AxisPath,
	head: TuftSpikes,
	tier: number,
	mound: number,
): void {
	const sides = HEAD_SIDES[tier] as number;
	const place = emptyFrame();
	const body = (head.width * mound) / 2;
	const tipLength = head.tip * mound;
	frameAt(path, path.length, place);
	const end = [0, 1, 2].map(
		(k) => (place.position[k] as number) + (place.tangent[k] as number) * tipLength,
	);
	writeRun(
		mesh,
		strip,
		straight(place.position, end),
		0,
		tipLength,
		3,
		sides,
		(s) => body * (0.9 - 0.5 * s),
		[1, 1],
		true,
	);
}

/**
 * The share along a stem's bow where it points at an angle above level: the bow turns evenly, so
 * the share follows the angle straight.
 */
function bowShareAt(arch: Arch, angle: number): number {
	const bowAt = arch.from ?? 0;
	if (arch.turn <= 0) return 1;
	const turned = Math.min(1, Math.max(0, (arch.leave - angle) / arch.turn));
	return bowAt + (1 - bowAt) * turned;
}

/**
 * Writes a sedge's head: spikes hanging plumb on threads from the stem where its bow runs between
 * the record's two angles, one below another near the bow's crest.
 */
function writeSpikes(
	mesh: MeshWriter,
	strip: Strip,
	path: AxisPath,
	arch: Arch,
	head: TuftSpikes,
	tier: number,
	mound: number,
): void {
	const sides = HEAD_SIDES[tier] as number;
	const place = emptyFrame();
	const body = (head.width * mound) / 2;
	const first = bowShareAt(arch, head.hang[0]);
	const last = bowShareAt(arch, head.hang[1]);
	for (let j = 0; j < head.count; j++) {
		const share = first + ((last - first) * (j + 0.5)) / head.count;
		frameAt(path, share * path.length, place);
		const from = [
			place.position[0] as number,
			place.position[1] as number,
			place.position[2] as number,
		];
		// A loose bunch: each spike on its own length of thread, of its own length, its thread
		// leaning to one side of the stem or the other, so no two hang in one row.
		const thread =
			head.thread * mound * (THREAD_LEAST + THREAD_RANGE * (((j + 1) * GOLDEN_SHARE) % 1));
		const length = head.length * mound * (SPIKE_LEAST + SPIKE_RANGE * (((j + 1) * PLASTIC) % 1));
		const side = (j % 2 === 0 ? 1 : -1) * thread * sin(radians(SPLAY));
		const knot = [0, 1, 2].map(
			(k) =>
				(from[k] as number) +
				(place.binormal[k] as number) * side -
				(k === 1 ? thread * cos(radians(SPLAY)) : 0),
		);
		const foot = [knot[0] as number, (knot[1] as number) - length, knot[2] as number];
		writeRun(
			mesh,
			strip,
			straight(from, knot),
			0,
			thread,
			2,
			3,
			() => body * THREAD_WIDTH,
			[share, share],
			false,
		);
		// The spike swells below its thread and closes at its foot.
		writeRun(
			mesh,
			strip,
			straight(knot, foot),
			0,
			length,
			tier === 0 ? 3 : 5,
			sides,
			(s) => body * Math.min(1, 0.35 + 6 * s) * (s > 0.85 ? (1 - s) / 0.15 + 0.2 : 1),
			[share, share],
			true,
		);
	}
}

/** Writes a grass's head: whorls of branches up the stem's top, each ending in a cluster of spikelets. */
function writePanicle(
	mesh: MeshWriter,
	strip: Strip,
	path: AxisPath,
	head: TuftPanicle,
	tier: number,
	mound: number,
	width: number,
): void {
	const sides = HEAD_SIDES[tier] as number;
	const place = emptyFrame();
	const length = head.length * mound;
	const whorls = Math.max(1, Math.round(head.whorls));
	const branches = Math.max(1, Math.round(head.branches));
	const spikelet = head.spikelet * mound;
	const angle = radians(head.angle);
	const branchRadius = (width / 2) * BRANCH_WIDTH;
	// A spikelet: a short body closed at both ends, lying along a direction from a point.
	const spikeletAt = (from: readonly number[], dir: readonly number[], share: number): void => {
		const to = [0, 1, 2].map((k) => (from[k] as number) + (dir[k] as number) * spikelet);
		writeRun(
			mesh,
			strip,
			straight(from, to),
			0,
			spikelet,
			3,
			sides,
			(s) => spikelet * SPIKELET_WIDTH * (s < 0.5 ? 0.25 + 1.5 * s : 1) * 0.5,
			[share, share],
			true,
		);
	};
	for (let w = 0; w < whorls; w++) {
		const up = w / whorls;
		const share = (path.length - length * (1 - up)) / path.length;
		frameAt(path, share * path.length, place);
		const from = [
			place.position[0] as number,
			place.position[1] as number,
			place.position[2] as number,
		];
		const reach = ((head.width * mound) / 2 / sin(angle)) * (1 - WHORL_TAPER * up);
		for (let b = 0; b < branches; b++) {
			const turn = (2 * PI * b) / branches + w * 2.399963;
			const dir = [0, 1, 2].map(
				(k) =>
					(place.tangent[k] as number) * cos(angle) +
					((place.normal[k] as number) * cos(turn) + (place.binormal[k] as number) * sin(turn)) *
						sin(angle),
			);
			const tip = [0, 1, 2].map((k) => (from[k] as number) + (dir[k] as number) * reach);
			writeRun(
				mesh,
				strip,
				straight(from, tip),
				0,
				reach,
				2,
				3,
				() => branchRadius,
				[share, share],
				false,
			);
			// The cluster stands along the branch's outer half, each spikelet a little off its line.
			const cluster = tier === 0 ? Math.min(2, head.spikelets) : head.spikelets;
			for (let n = 0; n < cluster; n++) {
				const along = 0.5 + (0.5 * (n + 0.5)) / cluster;
				const at = [0, 1, 2].map((k) => (from[k] as number) + (dir[k] as number) * reach * along);
				const side = n % 2 === 0 ? 0.35 : -0.35;
				const off = [0, 1, 2].map(
					(k) =>
						(dir[k] as number) +
						side * ((place.tangent[k] as number) - (dir[k] as number) * cos(angle)),
				);
				const l = Math.sqrt(off.reduce((sum, v) => sum + v * v, 0)) || 1;
				spikeletAt(
					at,
					off.map((v) => v / l),
					share,
				);
			}
		}
	}
	// The stem's own tip carries a cluster.
	frameAt(path, path.length, place);
	spikeletAt(
		[place.position[0] as number, place.position[1] as number, place.position[2] as number],
		[place.tangent[0] as number, place.tangent[1] as number, place.tangent[2] as number],
		1,
	);
}

/**
 * The pieces a tuft's sockets carry: the shoot's sheath column, a blade in each of the record's
 * poses, and a flowering stem with its head in each of its leans. Each stands upright, heading the
 * way its socket points.
 *
 * @param record The species record.
 * @param manifest The texture manifest.
 * @returns The pieces, in the order a socket names them by.
 * @category api/vegetation
 */
export function tuftPieces(record: Species, manifest: TextureManifest): readonly WrittenPiece[] {
	const { growth, blade } = tuftOf(record);
	const plan = planOf(record);
	const texture = bladeTexture(manifest);
	const leaf = leafStrip(manifest);
	const strip: Strip = { v: stalkRange(leaf), uHalf: leaf.stalkHalf };
	const classes: WrittenPiece[] = [];
	classes.push({
		name: 'sheath',
		// The column leans with its socket, out of the stool at the rim.
		attitude: 'along',
		length: plan.sheath,
		leaves: 0,
		parts: [
			(mesh, tier) => {
				mesh.mark();
				const half = plan.sheathWidth / 2;
				writeRun(
					mesh,
					strip,
					straight([0, 0, 0], [0, plan.sheath, 0]),
					0,
					plan.sheath,
					SPINDLE_RINGS[tier] as number,
					SHEATH_SIDES[tier] as number,
					(s) => half * spindle(s),
					[0, 1],
					true,
					false,
					// The column takes the record's sheath colour where it gives one.
					growth.sheathColour !== undefined,
				);
			},
		],
	});
	plan.blades.forEach((pose, k) => {
		const path = pathOf(pose.chain);
		classes.push({
			name: `blade-${k}`,
			attitude: 'upright',
			length: pose.length,
			leaves: 1,
			...(pose.lies !== undefined ? { lies: pose.lies } : {}),
			parts: [
				(mesh, tier) => {
					const detail = DETAILS[tier] as Detail;
					writeBlade(
						mesh,
						path,
						{
							length: path.length,
							width: blade.width,
							blade,
							// Neighbouring shapes twist opposite ways.
							twist: blade.twist * (k % 2 === 0 ? 1 : -1),
							browning: 0,
							dry: 0.5,
							...(pose.landing ? { flat: pose.landing } : {}),
						},
						{
							rows: BLADE_ROWS[detail],
							across: BLADE_ACROSS[detail],
							// The rows stand where the shared curve cuts the pose for this tier, so no row
							// turns more than the curve's bound whatever the tier.
							along: chainPath(pose.chain, TIER_LEVEL[tier] as 0 | 1 | 2, BLADE_ROWS[detail]).along,
						},
						texture,
						NO_BYTES,
						undefined,
						tier >= 2,
					);
					mesh.mark();
				},
			],
		});
	});
	const stems = growth.stalks;
	if (stems) {
		const head = stems.head;
		const stalkArch = (pose: Pose) => chainArches(pose.chain)[0] as Arch;
		plan.stalks.forEach((pose, k) => {
			const path = pathOf(pose.chain);
			classes.push({
				name: `stalk-${k}`,
				attitude: 'upright',
				length: pose.length,
				leaves: 0,
				// The stem, and its head as a part of its own: the head's card frames the spikes at
				// their own size, and the two stand at one socket, so a level keeps or drops them
				// together.
				parts: [
					(mesh, tier) => {
						mesh.mark();
						writeStalk(
							mesh,
							strip,
							path,
							stalkArch(pose),
							tier,
							plan.stalkWidth,
							1,
							stems.sides === 3,
						);
						if (head.kind === 'spike') writeEndSpike(mesh, strip, path, head, tier, plan.mound);
					},
					(mesh, tier) => {
						mesh.mark();
						if (head.kind === 'spike')
							writeSpikes(mesh, strip, path, stalkArch(pose), head, tier, plan.mound);
						else writePanicle(mesh, strip, path, head, tier, plan.mound, plan.stalkWidth);
					},
				],
			});
		});
	}
	return classes;
}

/** Faces round the stool's mound and rings over its dome, by level. */
const STOOL_SIDES: readonly number[] = [12, 8, 6];
const STOOL_RINGS: readonly number[] = [4, 3, 2];

/**
 * Meshes what a tuft draws beside its pieces: the stool's mound at every level, and the rhizome and
 * the roots at the nearest. They lie in the soil, so a farther view does not see them.
 *
 * @param input The dressed variant.
 * @param level The level.
 * @returns The mesh.
 */
export function meshTuft(input: MeshInput, level: MeshLevel): MeshArrays {
	const { skeleton, crown, kit } = input;
	const { growth } = tuftOf(input.record);
	const axes = skeleton.axes;
	const leaf = leafStrip(kit.manifest);
	const stems = stalkRange(leaf);
	const mesh = new MeshWriter();
	// A species that colours its sheaths marks them in the phase byte, so every other run keeps
	// that byte's low bits alone.
	const sheathed = growth.sheathColour !== undefined;
	const bytesOf = (axis: number) => {
		const raw = axisBytes(input, axis);
		return sheathed ? { ...raw, phase: raw.phase >> 1 } : raw;
	};
	// The stool: a drum from under the soil to its surface, closed by a dome over the shoots' feet.
	// A cut shoot has left its stool behind: its first axis starts at the cut, not under the soil.
	const foot = axes.first[0] as number;
	const under = -(skeleton.position[foot * 3 + 1] as number);
	const rise = skeleton.position[(axes.last[0] as number) * 3 + 1] as number;
	const wide = skeleton.radius[foot] as number;
	if (under > 0 && rise > 0 && wide > 0)
		writeStem(mesh, {
			path: straight([0, -under, 0], [0, rise, 0]),
			from: 0,
			to: under + rise,
			rings: 2 + (STOOL_RINGS[level] as number),
			radius: (share) => {
				const up = (share * (under + rise) - under) / rise;
				return up <= 0 ? wide : wide * Math.sqrt(Math.max(0, 1 - up * up));
			},
			section: { sides: STOOL_SIDES[level] as number },
			v: stems,
			uHalf: leaf.stalkHalf,
			bytes: bytesOf(0),
			crown,
			along: [0, 0],
			browning: 1,
			closeTip: true,
			sheath: sheathed,
		});
	if (level === 0)
		for (let a = 1; a < axes.count; a++) {
			if ((axes.kind[a] as number) !== AXIS_ROOT) continue;
			const path = wholePath(skeleton, a, [0, 1, 0]);
			if (!path || path.length < 1e-4) continue;
			const first = axes.first[a] as number;
			const last = axes.last[a] as number;
			const r0 = skeleton.radius[first] as number;
			const r1 = skeleton.radius[last] as number;
			writeStem(mesh, {
				path,
				from: 0,
				to: path.length,
				rings: Math.max(2, last - first + 1),
				radius: (share) => r0 + (r1 - r0) * share,
				section: { sides: 4 },
				v: stems,
				uHalf: leaf.stalkHalf,
				bytes: bytesOf(a),
				crown,
				along: [0, 0.05],
				browning: 0.3,
				closeTip: true,
			});
		}
	return mesh.finishMesh();
}

/** The tuft grower. */
export const grower: Grower = {
	grow: growTuft,
	foliage: meshTuft,
	pieces: tuftPieces,
};

/** The tuft adult of the planned model: the same stool, pieces and meshes, grown to its state. */
export const plannedGrower: Grower = {
	grow: growPlannedTuft,
	plan: planTuft,
	foliage: meshTuft,
	pieces: tuftPieces,
};
