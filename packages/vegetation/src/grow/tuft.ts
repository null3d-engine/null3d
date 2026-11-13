// The tuft grower: grasses and sedges. The plant's frame is a stool: shoots (tillers) spread evenly
// over a small disc at the soil, each a short plumb column of sheaths. The stool itself is a low
// mound of old leaf bases that every shoot stands in, so the plant is one body however few shoots
// it keeps. Nothing else of the frame stands above the ground. Every part a viewer sees is a piece of the kit, built once and placed
// whole at a socket on a shoot:
//
// - the shoot's own column of sheaths;
// - a blade, in the poses the record measures and the shapes between them: the youngest stand near plumb at the shoot's heart,
//   the oldest arch out and over to the ground. Blades leave their shoot in two ranks (grasses) or
//   three (sedges);
// - in the seasons the record names, a flowering stem with its head: a sedge's stem bows over and
//   hangs its spikes plumb one below another, a grass's stands nearly straight under an open
//   pyramid of branches and spikelets.
//
// A piece is posed in its own space with +Y plumb, so a blade or a spike hangs under its own weight
// wherever it stands; how far a stem leans is one of its poses. The record's lengths are shares of
// the leaf mound's height, which is a share of the plant's height. Each bent part is one path of
// the shared curve (core/arch.ts), fitted to the record's measured figures.
//
// The sockets enter the skeleton in the order the plant thins by (grow/sockets.ts): shoots in an
// order whose every leading run is spread evenly over the stool, a shoot's blades from its oldest,
// and no piece before its shoot. The stool's mound draws as the plant's own mesh at every level,
// and what lies under the soil, a rhizome and roots, at the nearest.
import type { MeshArrays } from '../asset';
import { type Arch, archFromFigures, archPath } from '../core/arch';
import { AXIS_LIMB, AXIS_ROOT, type MacroSkeleton, SkeletonBuilder } from '../core/graph';
import { unitAt } from '../core/hash';
import { cos, PI, radians, sin, type Vector3 } from '../core/math';
import type { GrassBlade, Species, Tuft, TuftPanicle, TuftPose, TuftSpikes } from '../core/record';
import type { TextureManifest } from '../core/textures';
import { DETAILS, type Detail, spreadAt, spreadMean } from '../core/types';
import { BLADE_ACROSS, BLADE_ROWS, bladeTexture, writeBlade } from '../leaf/grass-blade';
import type { PieceClass } from '../leaf/piece';
import { MeshWriter } from '../leaf/writer';
import type { CrownLight, GrowInput, MeshInput, MeshLevel } from '../stages';
import { type AxisPath, axisPath, emptyFrame, frameAt } from '../wood/frames';
import { axisBytes, leafStrip, stalkRange, wholePath, writeStem } from './ground';
import type { Grower } from './models';
import { addSockets, discPlaces, type Socket } from './sockets';

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
/** Faces round a shoot's sheath column, by tier. */
const SHEATH_SIDES: readonly number[] = [4, 5, 6, 8];
/** The sheath column's width at its top, as a share of its width at the foot. */
const SHEATH_TAPER = 0.7;
/** A flowering stem's width under its head, as a share of its width at the foot. */
const STALK_TAPER = 0.35;
/** The share of a hanging spike's width that its thread takes. */
const THREAD_WIDTH = 0.22;
/** A panicle branch's width, as a share of the stem's foot, and a spikelet's width over its length. */
const BRANCH_WIDTH = 0.3;
const SPIKELET_WIDTH = 0.42;
/** How much shorter a panicle's top whorl's branches are than its lowest whorl's, as a share. */
const WHORL_TAPER = 0.75;

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
	if (record.growth.model !== 'tuft' || record.foliage.kind !== 'grass-blade')
		throw new Error(`@null3d/vegetation: '${record.id}' is not a tuft of grass blades`);
	return { growth: record.growth, blade: record.foliage.blade };
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
	readonly arch: Arch;
	/** The highest point above the attach point, in metres. */
	readonly top: number;
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

/** The highest point of an arch above its base, in metres. */
function topOf(arch: Arch): number {
	const path = archPath(arch, 0, 24);
	let top = 0;
	for (let i = 0; i <= path.segments; i++) top = Math.max(top, path.up[i] as number);
	return top;
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
		const fit = archFromFigures({
			...(leave !== undefined ? { leave } : {}),
			...(tip !== undefined ? { tip } : {}),
			apex: apex * mound,
			drop: drop * mound,
			reach: between(from.reach, to.reach) * mound,
		});
		// A blade that comes down to the soil is longer than its fall: it meets the soil at the
		// width it has where its point begins, and the point runs on into the litter. The figures
		// fit the blade as far as the soil, and the point carries on along its line.
		const shown = drop >= apex ? 1 - blade.tipLength : 1;
		const arch = {
			...fit.arch,
			length: (fit.arch.length / shown) * grown,
			from: (fit.arch.from ?? 0) * shown,
			to: (fit.arch.to ?? 1) * shown,
		};
		blades.push({ arch, top: topOf(arch) });
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
			const length = (stems.top[1] * mound) / topOf({ ...shape, length: 1 });
			stalks.push({ arch: { ...shape, length }, top: stems.top[1] * mound });
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

/** The class of piece a shoot's sheath column is, a blade's pose is, and a stem's pose is. */
const SHEATH_CLASS = 0;
const bladeClass = (pose: number): number => 1 + pose;
const stalkClass = (plan: Plan, pose: number): number => 1 + plan.blades.length + pose;
const classCount = (plan: Plan): number => 1 + plan.blades.length + plan.stalks.length;

/**
 * How late a part goes when the plant is thinned, from 0 for a part of the least plant: the parts
 * past the least count take even steps up to 1 in the order they are given.
 */
function keepOf(index: number, count: number, least: number): number {
	return index < least ? 0 : (index - least + 1) / Math.max(1, count - least + 1);
}

/**
 * Grows a tuft: the stool, its shoots, and a socket for each shoot's sheath column, each blade and
 * each flowering stem in season.
 *
 * @param input The record, the seed, the variant and the season.
 * @returns The skeleton.
 * @category api/vegetation
 */
export function growTuft(input: GrowInput): MacroSkeleton {
	const { growth } = tuftOf(input.record);
	const plan = planOf(input.record);
	const { mound } = plan;
	const builder = new SkeletonBuilder();
	const stoolRadius = (growth.stool * mound) / 2;
	const crown = builder.addAxis({ parent: -1, parentNode: -1, order: 0, kind: AXIS_ROOT });
	builder.addNode({ x: 0, y: -0.03, z: 0, radius: stoolRadius, parent: -1, axis: crown, light: 1 });
	const crownTop = builder.addNode({
		x: 0,
		y: 0,
		z: 0,
		radius: stoolRadius,
		parent: 0,
		axis: crown,
		light: 1,
	});
	// The stool's mound closes over the shoots' feet, one shoot's width above the soil.
	builder.addNode({
		x: 0,
		y: plan.sheathWidth,
		z: 0,
		radius: 0,
		parent: crownTop,
		axis: crown,
		light: 1,
	});
	growSoil(input, builder, crown, crownTop, stoolRadius);
	const shoots = Math.max(1, Math.round(spreadAt(growth.shoots, draw(input, Purpose.Shoots))));
	const places = discPlaces(shoots, stoolRadius, draw(input, Purpose.Shoots, 1) * 2 * PI);
	const stems = growth.stalks;
	const stalks =
		stems?.seasons.includes(input.season) && plan.stalks.length > 0
			? Math.min(
					shoots,
					Math.max(0, Math.round(spreadAt(stems.count, draw(input, Purpose.Stalks)))),
				)
			: 0;
	const ranks = Math.max(1, growth.ranks);
	const sockets: Socket[] = [];
	const up: Vector3 = [0, 1, 0];
	let top = 0;
	places.forEach((place, i) => {
		const unit = (k: number) => draw(input, Purpose.Shoot, i, k);
		const shootKeep = keepOf(i, shoots, growth.least.shoots);
		const column = growth.sheath.height * mound * (1 + SHEATH_SPREAD * (unit(0) * 2 - 1));
		const axis = builder.addAxis({
			parent: crown,
			parentNode: crownTop,
			parentT: 1,
			order: 1,
			kind: AXIS_LIMB,
		});
		const base = builder.addNode({
			x: place.x,
			y: 0,
			z: place.z,
			radius: plan.sheathWidth / 2,
			parent: crownTop,
			axis,
			light: 1,
		});
		builder.addNode({
			x: place.x,
			y: column,
			z: place.z,
			radius: (plan.sheathWidth / 2) * SHEATH_TAPER,
			parent: base,
			axis,
			light: 1,
		});
		const at: Vector3 = [place.x, 0, place.z];
		sockets.push({
			axis,
			node: base,
			at,
			up,
			heading: place.heading,
			piece: SHEATH_CLASS,
			length: column,
			keep: shootKeep,
		});
		top = Math.max(top, column);
		// The blades, the oldest first: it stands lowest and outermost, and it is the last to go.
		const blades = Math.max(1, Math.round(spreadAt(growth.blades, unit(1))));
		const rankTurn = unit(2) * 2 * PI;
		for (let k = 0; k < blades; k++) {
			const draws = (m: number) => draw(input, Purpose.Blade, i, k, m);
			// The blade's shape by its age, counted from the youngest, with a stray of half a shape.
			const age = 1 - (k + 0.5) / blades;
			const pose = Math.min(
				plan.blades.length - 1,
				Math.max(0, Math.round(shapeAt(growth.poses, age) * POSE_STEPS + draws(2) - 0.5)),
			);
			const shape = plan.blades[pose] as Pose;
			const around = rankTurn + (2 * PI * (k % ranks)) / ranks + (draws(0) - 0.5) * RANK_STRAY;
			// A blade faces out of its tuft: at the rim its heading turns toward the way out.
			const heading = around + OUTWARD * place.out * angleBetween(around, place.heading);
			const size = (1 + growth.bladeSpread * (draws(1) * 2 - 1)) / (1 + growth.bladeSpread);
			sockets.push({
				axis,
				node: base,
				at,
				up,
				heading,
				piece: bladeClass(pose),
				length: shape.arch.length * size,
				keep: Math.max(shootKeep, keepOf(k, blades, growth.least.blades)),
			});
			top = Math.max(top, shape.top * size);
		}
		if (stems && i < stalks) {
			const draws = (m: number) => draw(input, Purpose.Stalk, i, m);
			const pose = Math.min(STALK_POSES - 1, Math.floor(place.out * STALK_POSES));
			const shape = plan.stalks[pose] as Pose;
			// The first stem is the tallest and the second the shortest, so a thinned plant keeps
			// the spread of heights; the rest fall evenly between.
			const share = i === 0 ? 1 : i === 1 ? 0 : (i * GOLDEN_SHARE) % 1;
			const size = (stems.top[0] + (stems.top[1] - stems.top[0]) * share) / stems.top[1];
			sockets.push({
				axis,
				node: base,
				at,
				up,
				heading: place.heading + (draws(0) - 0.5) * STALK_STRAY,
				piece: stalkClass(plan, pose),
				length: shape.arch.length * size,
				keep: Math.max(shootKeep, keepOf(i, stalks, growth.least.stalks)),
			});
			top = Math.max(top, shape.top * size);
		}
	});
	addSockets(builder, sockets, classCount(plan));
	const finished = builder.finish(0);
	// The skeleton holds only the stool. The plant's top and width are its pieces': the tallest
	// piece, and the widest reach of any piece from its socket.
	let reach = 0;
	for (const socket of sockets) reach = Math.max(reach, socket.length);
	return {
		...finished,
		height: top,
		bounds: {
			min: [-stoolRadius - reach, 0, -stoolRadius - reach],
			max: [stoolRadius + reach, top, stoolRadius + reach],
		},
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
 * A piece's path from an arch, in the piece's own space: its attach point at the origin, +Y plumb
 * and +Z the way it heads. The first frame's normal is the side that faces the sky once the path
 * has turned over.
 */
function pathOf(arch: Arch): AxisPath {
	const cut = archPath(arch, 0, 32);
	const count = cut.segments + 1;
	const points = new Float64Array(count * 3);
	for (let i = 0; i < count; i++) {
		points[i * 3 + 1] = cut.up[i] as number;
		points[i * 3 + 2] = cut.out[i] as number;
	}
	const leave = radians(arch.leave);
	return axisPath(points, new Float64Array(count), count, [0, cos(leave), -sin(leave)]);
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

/** Writes a sedge's head: spikes hanging plumb on threads along the bow, and one ending the stem. */
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
	const bowAt = arch.from ?? 0;
	const body = (head.width * mound) / 2;
	const tipLength = head.tip * mound;
	// The spike that ends the stem carries on along the stem's own line.
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
	for (let j = 0; j < head.count; j++) {
		const share = bowAt + ((1 - bowAt) * (j + 1)) / (head.count + 1);
		frameAt(path, share * path.length, place);
		const from = [
			place.position[0] as number,
			place.position[1] as number,
			place.position[2] as number,
		];
		const thread = head.thread * mound * (1 + 0.25 * j);
		const knot = [from[0] as number, (from[1] as number) - thread, from[2] as number];
		const foot = [knot[0] as number, (knot[1] as number) - head.length * mound, knot[2] as number];
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
			head.length * mound,
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
 * The classes of piece a tuft's sockets name: the shoot's sheath column, a blade in each of the
 * record's poses, and a flowering stem with its head in each of its leans.
 *
 * @param record The species record.
 * @param manifest The texture manifest.
 * @returns The classes, in the order of their vigor bands.
 * @category api/vegetation
 */
export function tuftPieces(record: Species, manifest: TextureManifest): readonly PieceClass[] {
	const { growth, blade } = tuftOf(record);
	const plan = planOf(record);
	const texture = bladeTexture(manifest);
	const leaf = leafStrip(manifest);
	const strip: Strip = { v: stalkRange(leaf), uHalf: leaf.stalkHalf };
	const classes: PieceClass[] = [];
	classes.push({
		name: 'piece-sheath',
		variants: 1,
		length: plan.sheath,
		leaves: 0,
		write: (mesh, tier) => {
			mesh.mark();
			const half = plan.sheathWidth / 2;
			writeRun(
				mesh,
				strip,
				straight([0, 0, 0], [0, plan.sheath, 0]),
				0,
				plan.sheath,
				3,
				SHEATH_SIDES[tier] as number,
				(s) => half * (1 - (1 - SHEATH_TAPER) * s),
				[0, 1],
				false,
				false,
				// The column takes the record's sheath colour where it gives one.
				growth.sheathColour !== undefined,
			);
		},
	});
	plan.blades.forEach((pose, k) => {
		const path = pathOf(pose.arch);
		classes.push({
			name: `piece-blade-${k}`,
			variants: 1,
			length: pose.arch.length,
			leaves: 1,
			write: (mesh, tier) => {
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
					},
					{
						rows: BLADE_ROWS[detail],
						across: BLADE_ACROSS[detail],
						// The rows stand where the shared curve cuts the pose for this tier, so no row
						// turns more than the curve's bound whatever the tier.
						along: archPath(pose.arch, TIER_LEVEL[tier] as 0 | 1 | 2, BLADE_ROWS[detail]).along,
					},
					texture,
					NO_BYTES,
					undefined,
					tier >= 2,
				);
				mesh.mark();
			},
		});
	});
	const stems = growth.stalks;
	if (stems)
		plan.stalks.forEach((pose, k) => {
			const path = pathOf(pose.arch);
			const head = stems.head;
			classes.push({
				name: `piece-stalk-${k}`,
				variants: 1,
				length: pose.arch.length,
				leaves: 0,
				write: (mesh, tier) => {
					mesh.mark();
					writeStalk(mesh, strip, path, pose.arch, tier, plan.stalkWidth, 1, stems.sides === 3);
					if (head.kind === 'spike')
						writeSpikes(mesh, strip, path, pose.arch, head, tier, plan.mound);
					else writePanicle(mesh, strip, path, head, tier, plan.mound, plan.stalkWidth);
				},
			});
		});
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
