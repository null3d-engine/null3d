// The frond-colony grower: bracken. The plant has no crown and no centre. It is a patch of separate
// fronds whose feet are spread evenly over an ellipse of ground and joined by a buried rhizome.
// Each frond is one bare stalk, near plumb, that stands alone a step from its neighbours and holds
// one flat triangular leaf near level on its top, each at its own height, so the leaves overlap in
// loose tiers.
//
// The frame is the rhizome and the stalks. A stalk is a stipe axis (AXIS_STIPE), rooted at the
// ground, so the wood mesher draws it as a stem with the species' bark zones by height: black at
// the soil, green above. It stands plumb and straight and turns over in one smooth curve at its
// top, by the shared curve (core/arch.ts), so its end points the way the leaf is held. The rhizome
// is root axes under the soil: each foot's piece of it runs to the nearest foot that stands before
// it in the patch's order, so any leading run of feet hangs together.
//
// A frond's leaf is a piece of the kit, built once and placed whole at the socket on its stalk's
// end (grow/sockets.ts): its midrib runs on from the stalk, nearly straight, with the lower face
// toward the ground. The kit holds a grown leaf in three shapes, a young leaf at two stages of its
// unrolling, a browning leaf at two stages and a dead leaf that lies flat. The season picks each
// frond's age, and its age picks its leaf: spring croziers unrolling; summer grown fronds with the
// record's few late croziers; autumn browning fronds; winter dead fronds lying in a mat, a few
// stalks standing broken with their leaves gone.
//
// The feet stand in an order whose every leading run is spread evenly over the patch, so a patch
// that keeps only its first fronds keeps its footprint. A stalk never stands without its leaf: the
// two go together.
import type { MeshArrays } from '../asset';
import { archPath } from '../core/arch';
import {
	AXIS_ROOT,
	AXIS_STIPE,
	BUD_TERMINAL,
	type MacroSkeleton,
	SkeletonBuilder,
} from '../core/graph';
import { unitAt } from '../core/hash';
import {
	atan2,
	cos,
	normalize3,
	PI,
	quatFromFrame,
	radians,
	sin,
	tan,
	type Vector3,
} from '../core/math';
import type { FrondColony, FrondShape, Species } from '../core/record';
import type { TextureManifest } from '../core/textures';
import { type Curve, DETAILS, type Detail, type Season, spreadAt, spreadMean } from '../core/types';
import {
	FrondBlade,
	foldWeight,
	frondAge,
	frondCut,
	frondOutline,
	frondOutlineOf,
	MATURE_AGE,
	pinnaeOf,
	rachisCurve,
	writeBlade,
} from '../leaf/frond';
import type { WrittenPiece } from '../leaf/ground-piece';
import { cutLeaf } from '../leaf/leaf-mesh';
import { MeshWriter } from '../leaf/writer';
import type { GrowInput, MeshInput, MeshLevel } from '../stages';
import { axisPath } from '../wood/frames';
import { axisBytes, leafStrip, stalkRange, wholePath, writeStem } from './ground';
import { scaledWithPieces, targetHeight } from './height';
import type { Grower } from './models';
import { discPlaces } from './sockets';

/** Draw purposes, so no two draws share a key. */
const DRAW = {
	count: 1,
	turn: 3,
	size: 4,
	age: 7,
	young: 8,
	stipe: 9,
	lean: 10,
	leanTurn: 11,
	heading: 12,
	blade: 13,
	bow: 14,
	broken: 15,
	pose: 16,
} as const;

/** Metres between a stipe's nodes. */
const STIPE_NODE = 0.08;
/** A stipe's radius at its top, as a share of its base. */
const STIPE_TAPER = 0.75;
/** A rachis's radius at its tip, in metres. */
const RACHIS_TIP = 0.0005;
/** A dead frond lies this many degrees from upright in winter, its range. */
const SLUMPED = [84, 89] as const;
/** The share of winter fronds whose stipe stands broken with the blade gone. */
const BROKEN = 0.18;
/** A crozier just risen is this share of its grown size. */
const YOUNG_SIZE = 0.35;
/** Radians a leaf's heading may turn from the way out of the patch, either way. */
const HEADING_STRAY = PI / 3;
/** The shares of the record's droop that the kit's grown leaves take: a flatter, the record's own and a deeper. */
const GROWN_DROOPS: readonly number[] = [0.5, 1, 1.5];
/** The least share of a stalk that stands straight below its bend. */
const LEAST_STRAIGHT = 0.3;
/** The ages the kit holds a young leaf at, and a browning one. */
const YOUNG_AGES: readonly number[] = [0.12, 0.3];
const BROWN_AGES: readonly number[] = [0.75, 0.95];
/** Faces round the rhizome, by level. */
const RHIZOME_SIDES: readonly number[] = [6, 4, 3];

function colonyOf(record: Species): FrondColony {
	if (record.growth.model !== 'frond-colony')
		throw new Error(
			`@null3d/vegetation: the frond-colony grower got a '${record.growth.model}' record`,
		);
	return record.growth;
}

/** One leaf the kit holds: its age, how far its droop is scaled, and whether it lies dead. */
/**
 * Degrees a grown leaf stands rolled about its rachis, one way or the other by kind. Still 12: the
 * blade turns about its rachis so one side stands higher; still 01's leaves show their faces at
 * three to five tenths of their width from a camera a little above them, where level blades would
 * be edges.
 */
const GROWN_ROLL = 30;

interface LeafKind {
	readonly name: string;
	readonly age: number;
	/** The share of the record's droop the leaf takes; a lying leaf takes none. */
	readonly droop: number;
	readonly lying: boolean;
	/** Degrees the leaf stands rolled about its rachis on its stalk; none for a leaf not yet open or lying. */
	readonly roll: number;
}

/** A curve with every value multiplied by a factor. */
function scaled(curve: Curve, factor: number): Curve {
	return typeof curve === 'number'
		? curve * factor
		: curve.map(([at, value]) => [at, value * factor] as [number, number]);
}

/**
 * The leaves a colony's kit holds, in the order of their vigor bands: the grown leaf in each of its
 * shapes, the young stages, the browning stages, and the dead leaf that lies flat.
 */
function leafKinds(): LeafKind[] {
	const kinds: LeafKind[] = [];
	GROWN_DROOPS.forEach((droop, k) => {
		const roll = GROWN_ROLL * (k % 2 === 0 ? 1 : -1);
		kinds.push({ name: `leaf-grown-${k}`, age: MATURE_AGE, droop, lying: false, roll });
	});
	YOUNG_AGES.forEach((age, k) => {
		kinds.push({ name: `leaf-young-${k}`, age, droop: 1, lying: false, roll: 0 });
	});
	BROWN_AGES.forEach((age, k) => {
		kinds.push({ name: `leaf-brown-${k}`, age, droop: 1, lying: false, roll: 0 });
	});
	kinds.push({ name: 'leaf-lying', age: 1, droop: 0, lying: true, roll: 0 });
	return kinds;
}

/** The kind of leaf a frond of an age carries: its place in `leafKinds`. */
function kindFor(age: number, lying: boolean, pose: number): number {
	const young = GROWN_DROOPS.length;
	const brown = young + YOUNG_AGES.length;
	if (lying) return brown + BROWN_AGES.length;
	const [y0, y1] = YOUNG_AGES as [number, number];
	const [b0, b1] = BROWN_AGES as [number, number];
	if (age < (y0 + y1) / 2) return young;
	if (age < (y1 + MATURE_AGE) / 2) return young + 1;
	if (age <= (MATURE_AGE + b0) / 2) return Math.min(young - 1, Math.floor(pose * young));
	return age <= (b0 + b1) / 2 ? brown : brown + 1;
}

/** The frond a kind of leaf is shaped by: the record's, with the kind's share of its droop. */
function shapeOf(colony: FrondColony, kind: LeafKind): FrondShape {
	const shape = colony.frond;
	const pinnae = shape.pinnae;
	return {
		...shape,
		droop: scaled(shape.droop, kind.droop),
		// A dead leaf on the ground lies flat: its pinnae no longer hang.
		...(kind.lying && pinnae ? { pinnae: { ...pinnae, droop: 0 } } : {}),
	};
}

/** A leaf's rachis in piece space: its points, with +Y the way it leaves and +Z its lower face. */
function rachisOf(colony: FrondColony, kind: LeafKind, length: number): Float64Array {
	const age = frondAge(kind.age);
	const size = YOUNG_SIZE + (1 - YOUNG_SIZE) * age.unrolled;
	const curve = rachisCurve(shapeOf(colony, kind), age, length * size);
	const count = curve.length / 3;
	const points = new Float64Array(count * 3);
	// The leaf's line is +Y and its sky side +Z, so its droop toward the ground runs to -Z.
	for (let i = 0; i < count; i++) {
		points[i * 3 + 1] = curve[i * 3] as number;
		points[i * 3 + 2] = -(curve[i * 3 + 1] as number);
	}
	return points;
}

/** How far a kind of leaf rises, reaches and spreads from its socket, at a blade of one metre. */
interface LeafExtent {
	readonly rise: number;
	readonly out: number;
	readonly half: number;
}

/** The extents of a colony's kinds of leaf, by the growth they were found from. */
const EXTENTS = new WeakMap<FrondColony, readonly LeafExtent[]>();

function extentsOf(colony: FrondColony): readonly LeafExtent[] {
	const known = EXTENTS.get(colony);
	if (known) return known;
	// The blade's half-width, from the outline its pinnae draw.
	const outline = frondOutline(colony.frond);
	const span = Math.max(outline.tip[1] - outline.base[1], 1e-6);
	let widest = 0;
	for (let i = 0; i < outline.points.length; i += 2)
		widest = Math.max(widest, Math.abs((outline.points[i] as number) - 0.5));
	const extents = leafKinds().map((kind) => {
		const points = rachisOf(colony, kind, 1);
		const size = YOUNG_SIZE + (1 - YOUNG_SIZE) * frondAge(kind.age).unrolled;
		let rise = 0;
		let out = 0;
		for (let i = 0; i < points.length; i += 3) {
			rise = Math.max(rise, points[i + 1] as number);
			out = Math.max(out, -(points[i + 2] as number));
		}
		return { rise, out, half: (widest / span) * size };
	});
	EXTENTS.set(colony, extents);
	return extents;
}

/** A frond's age for the season: its share of the way from a new crozier to dead. */
function ageFor(
	season: Season,
	colony: FrondColony,
	input: GrowInput,
	index: number,
	count: number,
): number {
	const salt = input.record.seedSalt >>> 0;
	const draw = (purpose: number) => unitAt(input.seed, salt, input.variant, purpose, index);
	const unit = draw(DRAW.age);
	switch (season) {
		case 'blossom':
			return 0.04 + unit * (MATURE_AGE - 0.06);
		case 'autumn':
			return 0.65 + unit * 0.3;
		case 'winter':
			return 1;
		default: {
			const croziers = Math.max(0, spreadAt(colony.croziers, draw(DRAW.young)));
			return unit < croziers / Math.max(1, count)
				? 0.08 + draw(DRAW.young + 32) * 0.36
				: MATURE_AGE;
		}
	}
}

/**
 * How late a frond goes when the patch is thinned, from 0 for a frond of the least patch: the
 * fronds past the least count take even steps up to 1 in the patch's order.
 */
function keepOf(index: number, count: number, least: number): number {
	return index < least ? 0 : (index - least + 1) / Math.max(1, count - least + 1);
}

/**
 * Grows a frond colony: the rhizome, each frond's stalk, and a socket on each stalk's top for the
 * frond's leaf.
 *
 * @param input The record, the seed, the variant and the season.
 * @returns The skeleton.
 * @category api/vegetation
 */
export function growFrondColony(input: GrowInput): MacroSkeleton {
	const { record, seed, variant, season } = input;
	const colony = colonyOf(record);
	const shape = colony.frond;
	const salt = record.seedSalt >>> 0;
	const draw = (purpose: number, index = 0) => unitAt(seed, salt, variant, purpose, index);
	const height = spreadMean(record.size.height);
	const count = Math.max(1, Math.round(spreadAt(colony.fronds, draw(DRAW.count))));
	// The feet: spread evenly over the patch's ellipse, every leading run of them too.
	const places = discPlaces(count, 1, draw(DRAW.turn) * 2 * PI).map((place) => ({
		x: (place.x * colony.patch.long * height) / 2,
		z: (place.z * colony.patch.short * height) / 2,
	}));
	// The short fronds stand at the patch's front edge.
	const shortCount = Math.round(colony.heights.shortShare * count);
	const byFront = places.map((_, f) => f).sort((a, b) => (places[b]?.z ?? 0) - (places[a]?.z ?? 0));
	const short = new Set(byFront.slice(0, shortCount));
	const kinds = leafKinds();
	const extents = extentsOf(colony);
	const builder = new SkeletonBuilder();
	const frame = new Float32Array(4);
	const { depth } = colony.rhizome;
	// The kit's leaf is the longest a socket asks for, so a socket's size is its leaf over that.
	const longestLeaf =
		typeof shape.length === 'number' ? shape.length : shape.length.mean + shape.length.spread;
	// The sockets enter the skeleton in the patch's order, so each one's rank is its place.
	let sockets = 0;
	// The rhizome: each foot's piece runs under the soil to the nearest foot that stands before it.
	const under: number[] = [];
	const rhizomes: number[] = [];
	places.forEach((place, f) => {
		let near = -1;
		let nearest = Number.POSITIVE_INFINITY;
		for (let e = 0; e < f; e++) {
			const other = places[e] as { x: number; z: number };
			const away = (other.x - place.x) ** 2 + (other.z - place.z) ** 2;
			if (away < nearest) {
				nearest = away;
				near = e;
			}
		}
		const axis = builder.addAxis(
			near < 0
				? { parent: -1, parentNode: -1, order: 0, kind: AXIS_ROOT }
				: {
						parent: rhizomes[near] as number,
						parentNode: under[near] as number,
						parentT: 1,
						order: 0,
						kind: AXIS_ROOT,
					},
		);
		// The first foot's piece is a short stub, so the rhizome begins somewhere.
		const from = near < 0 ? { x: place.x - 4 * colony.rhizome.radius, z: place.z } : places[near];
		const start = builder.addNode({
			x: from?.x ?? place.x,
			y: -depth,
			z: from?.z ?? place.z,
			radius: colony.rhizome.radius,
			parent: near < 0 ? -1 : (under[near] as number),
			axis,
			light: 1,
		});
		under.push(
			builder.addNode({
				x: place.x,
				y: -depth,
				z: place.z,
				radius: colony.rhizome.radius,
				parent: start,
				axis,
				light: 1,
			}),
		);
		rhizomes.push(axis);
	});
	let top = 0;
	let stood = 0;
	const low: [number, number] = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
	const high: [number, number] = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
	const holds = (x: number, z: number): void => {
		low[0] = Math.min(low[0], x);
		low[1] = Math.min(low[1], z);
		high[0] = Math.max(high[0], x);
		high[1] = Math.max(high[1], z);
	};
	places.forEach((place, f) => {
		const years = ageFor(season, colony, input, f, count);
		const age = frondAge(years);
		const range = short.has(f) ? colony.heights.short : colony.heights.tall;
		const size = range[0] + (range[1] - range[0]) * draw(DRAW.size, f);
		const bladeLength = Math.max(0.05, spreadAt(shape.length, draw(DRAW.blade, f)) * size);
		// Leaves reach outward from the patch's middle, give or take.
		const outward = place.x * place.x + place.z * place.z > 1e-6 ? atan2(place.z, place.x) : 0;
		const heading = outward + (draw(DRAW.heading, f) * 2 - 1) * HEADING_STRAY;
		// A dead winter frond lies flat, or stands as a broken stipe with its leaf gone.
		const dead = age.brown >= 1 && season === 'winter';
		const broken = dead && draw(DRAW.broken, f) < BROKEN;
		const lying = dead && !broken;
		const kind = kindFor(years, lying, draw(DRAW.pose + 32, f));
		const leanDegrees = lying
			? SLUMPED[0] + draw(DRAW.lean, f) * (SLUMPED[1] - SLUMPED[0])
			: Math.abs(spreadAt(colony.stipe.lean, draw(DRAW.lean, f))) * (broken ? 3 : 1);
		const leanTurn = lying ? heading : draw(DRAW.leanTurn, f) * 2 * PI;
		const lean = tan(radians(Math.min(leanDegrees, SLUMPED[1])));
		const tilt = colony.tilt[0] + (colony.tilt[1] - colony.tilt[0]) * draw(DRAW.pose, f);
		// The height the frond stands at when it is grown and alive: its stalk turned over and its
		// leaf held out. A frond that is young, lies dead or stands broken still counts at that
		// height, so the plant keeps one size through the year.
		const grownStalk = spreadAt(colony.stipe.length, draw(DRAW.stipe, f)) * size;
		const grownTurn = 90 - tilt;
		const alive = archPath(
			{
				length: grownStalk,
				leave: 90,
				turn: grownTurn,
				from: Math.max(LEAST_STRAIGHT, 1 - colony.stipe.bend * radians(grownTurn)),
			},
			0,
		);
		let aliveTop = 0;
		for (let n = 0; n <= alive.segments; n++) aliveTop = Math.max(aliveTop, alive.up[n] as number);
		// A grown leaf stands rolled about its rachis, so one side of its blade rises above it.
		const grownLeaf = extents[1] as LeafExtent;
		const grownTop =
			aliveTop +
			(sin(radians(tilt)) * grownLeaf.rise + sin(radians(GROWN_ROLL)) * grownLeaf.half) *
				bladeLength;
		stood = Math.max(stood, grownTop);
		// A young frond stands at its share of that height: its straight stalk and the leaf it
		// still holds upright together.
		const grown = YOUNG_SIZE + (1 - YOUNG_SIZE) * age.unrolled;
		const stipeLength =
			age.unrolled < 1
				? Math.max(0.05, grown * grownTop - (extents[kind] as LeafExtent).rise * bladeLength)
				: grownStalk;
		const standing = broken ? stipeLength * (0.2 + 0.3 * draw(DRAW.broken + 32, f)) : stipeLength;
		// The stalk stands straight and turns over at its top in one even curve, until its end
		// points the way the leaf is held. A crozier's stalk is still straight; a dead one has
		// fallen, and a broken one has lost its top.
		const turn = lying || broken ? 0 : grownTurn * age.unrolled * age.unrolled;
		const bend = (colony.stipe.bend * stipeLength * radians(turn)) / (standing + depth);
		// The stalk rises from the rhizome, so its first stretch lies under the soil.
		const stalk = archPath(
			{ length: standing + depth, leave: 90, turn, from: Math.max(LEAST_STRAIGHT, 1 - bend) },
			0,
			Math.max(2, Math.ceil((standing + depth) / STIPE_NODE)),
		);
		const stipeAxis = builder.addAxis({ parent: -1, parentNode: -1, order: 0, kind: AXIS_STIPE });
		const radius = Math.max(shape.petiole.width / 2, RACHIS_TIP) * (0.6 + 0.4 * size * grown);
		// A point of the stalk: along its own line, which leans from plumb, and out the way the
		// leaf heads.
		const line = normalize3([lean * cos(leanTurn), 1, lean * sin(leanTurn)]);
		const at = (n: number): Vector3 => {
			const along = stalk.up[n] as number;
			const out = stalk.out[n] as number;
			return [
				place.x + line[0] * along + cos(heading) * out,
				line[1] * along - depth,
				place.z + line[2] * along + sin(heading) * out,
			];
		};
		let node = -1;
		let last: Vector3 = at(0);
		let before: Vector3 = last;
		for (let n = 0; n <= stalk.segments; n++) {
			before = last;
			last = at(n);
			node = builder.addNode({
				x: last[0],
				y: last[1],
				z: last[2],
				radius: radius * (1 - (1 - STIPE_TAPER) * (stalk.along[n] as number)),
				parent: node,
				axis: stipeAxis,
			});
			holds(last[0], last[2]);
		}
		const [x, y, z] = last;
		top = Math.max(top, y);
		if (broken) return;
		const stalkEnd = radius * STIPE_TAPER;
		// The socket on the stalk's end: the leaf's midrib runs on from the stalk, and the leaf turns
		// along it with its lower face toward the ground. A stalk that still stands plumb, as a
		// crozier's does, has no lower side, so its line leans a hair the way the frond heads and
		// its leaf faces that way.
		const along = normalize3([last[0] - before[0], last[1] - before[1], last[2] - before[2]]);
		const up =
			Math.abs(along[1]) > 0.999
				? normalize3([along[0] + 0.01 * cos(heading), along[1], along[2] + 0.01 * sin(heading)])
				: along;
		const reach: Vector3 = [0, -1, 0];
		const dot = reach[0] * up[0] + reach[1] * up[1] + reach[2] * up[2];
		const lower = normalize3([
			reach[0] - dot * up[0],
			reach[1] - dot * up[1],
			reach[2] - dot * up[2],
		]);
		quatFromFrame(up, lower, frame);
		builder.addBud({
			node,
			x,
			y,
			z,
			frame,
			kind: BUD_TERMINAL,
			vigor: 1,
			// A frond stays as long as its place in the patch's order says.
			light: 1 - keepOf(f, count, colony.least),
			axis: stipeAxis,
			woodRadius: stalkEnd,
			socket: { scale: bladeLength / longestLeaf, rank: sockets++, lobe: f, piece: kind },
		});
		// The leaf's own rise and reach from its socket, and its width across its heading.
		const extent = extents[kind] as LeafExtent;
		const rise = extent.rise * bladeLength;
		const out = extent.out * bladeLength;
		const half = extent.half * bladeLength;
		const tip: Vector3 = [
			x + up[0] * rise + lower[0] * out,
			y + up[1] * rise + lower[1] * out,
			z + up[2] * rise + lower[2] * out,
		];
		// A rolled leaf's raised side stands above its rachis by its half-width.
		const lift = Math.abs(sin(radians((kinds[kind] as LeafKind).roll))) * half;
		top = Math.max(top, y + up[1] * rise + lift, tip[1] + lift);
		// The blade spreads across its heading, about its rachis.
		const across: Vector3 = normalize3([
			up[1] * lower[2] - up[2] * lower[1],
			up[2] * lower[0] - up[0] * lower[2],
			up[0] * lower[1] - up[1] * lower[0],
		]);
		for (const side of [-1, 1]) {
			holds(x + across[0] * half * side, z + across[2] * half * side);
			holds(tip[0] + across[0] * half * side, tip[2] + across[2] * half * side);
		}
	});
	const finished = builder.finish();
	// The skeleton holds the stalks and the rhizome. The plant's box is its leaves' too: the
	// highest leaf, and each leaf's reach from its stalk. Its height is the height its fronds
	// stand at when grown, which a patch of croziers or of dead fronds on the ground keeps.
	const drawn = Math.max(finished.height, top);
	const grown: MacroSkeleton = {
		...finished,
		height: stood,
		bounds: {
			min: [low[0], 0, low[1]],
			max: [high[0], drawn, high[1]],
		},
	};
	// A colony is its fronds, so each variant stands at the height its record asks for it with its
	// leaves scaled with it, and the height calibration after the grower finds nothing to scale.
	return scaledWithPieces(grown, stood > 0 ? targetHeight(record, seed, variant) / stood : 1);
}

/**
 * The classes of piece a frond colony's sockets name: a frond's leaf, grown at each tilt, young,
 * browning, and dead on the ground.
 *
 * @param record The species record.
 * @param manifest The texture manifest.
 * @returns The classes, in the order of their vigor bands.
 * @category api/vegetation
 */
export function frondPieces(record: Species, manifest: TextureManifest): readonly WrittenPiece[] {
	const colony = colonyOf(record);
	const shape = colony.frond;
	// The kit's leaf is the longest a socket asks for, so no row's scale passes 1.
	const longest =
		typeof shape.length === 'number' ? shape.length : shape.length.mean + shape.length.spread;
	const outline = frondOutlineOf(shape, manifest);
	const base = Math.max(shape.petiole.width / 2, RACHIS_TIP) * STIPE_TAPER;
	const bytes = [0, 0, 0, 255] as const;
	return leafKinds().map((kind) => {
		const points = rachisOf(colony, kind, longest);
		const count = points.length / 3;
		const radii = new Float64Array(count);
		for (let i = 0; i < count; i++)
			radii[i] = Math.max(RACHIS_TIP, base + (RACHIS_TIP - base) * (i / Math.max(1, count - 1)));
		// The upper face is the sky side, +Z in piece space.
		const path = axisPath(points, radii, count, [0, 0, 1]);
		const kindShape = shapeOf(colony, kind);
		return {
			name: kind.name,
			attitude: 'along',
			...(kind.roll ? { roll: kind.roll } : {}),
			length: longest,
			leaves: 1,
			parts: [
				(mesh: MeshWriter, tier: number) => {
					const cut = frondCut(DETAILS[tier] as Detail, 0);
					const blade = new FrondBlade(
						kindShape,
						frondAge(kind.age),
						path,
						foldWeight(cut, pinnaeOf(shape)),
					);
					writeBlade(
						mesh,
						blade,
						outline,
						cutLeaf(outline, cut),
						{ colour: () => bytes },
						(placed) => [placed.share, placed.brown],
					);
				},
			],
		};
	});
}

/**
 * Meshes what a frond colony draws beside its stalks and leaves: the buried rhizome that joins the
 * fronds' feet.
 *
 * @param input The dressed variant.
 * @param level The level.
 * @returns The mesh.
 */
export function meshFrondColony(input: MeshInput, level: MeshLevel): MeshArrays {
	const { skeleton, crown, kit } = input;
	const axes = skeleton.axes;
	const leaf = leafStrip(kit.manifest);
	const mesh = new MeshWriter();
	for (let a = 0; a < axes.count; a++) {
		if ((axes.kind[a] as number) !== AXIS_ROOT) continue;
		const path = wholePath(skeleton, a, [0, 1, 0]);
		if (!path || path.length < 1e-4) continue;
		const radius = skeleton.radius[axes.first[a] as number] as number;
		writeStem(mesh, {
			path,
			from: 0,
			to: path.length,
			rings: 2,
			radius: () => radius,
			section: { sides: RHIZOME_SIDES[level] as number },
			v: stalkRange(leaf),
			uHalf: leaf.stalkHalf,
			bytes: axisBytes(input, a),
			crown,
			along: [0, 0],
			browning: 1,
		});
	}
	return mesh.finishMesh();
}

/** The frond-colony grower: the colony's frame, its leaves as pieces, and its rhizome. */
export const grower: Grower = {
	grow: growFrondColony,
	foliage: meshFrondColony,
	pieces: frondPieces,
};
