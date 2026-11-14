// The extras: cones and fruit as lathe shapes, flowers as petal cups, thorns and cactus spines as
// spine fans, and catkins, on the sites their record names, in the seasons it names. A share of the
// matching sites carries one or more, chosen by hash, and a record may give the count at a site;
// each hangs from its site's direction toward the ground by the record's degrees. Shoot tips and
// nodes come from the shoot rows; old wood, areoles, the crown's top, flower sites, the tips of
// flowering stems, a culm's sheathed nodes and a culm's joints come from the skeleton's bud sites.
//
// A lathe measured in wood radii takes its size from the wood at its site, so one profile fits a
// thick culm and a thin one alike; every other shape is in metres.
//
// An extra's colour bytes hold its axis's wind record (high and low byte, global in the species'
// table), its entry in the record's extras, which picks its colour from the plant material's header,
// and the crown's sky visibility at its site. Only the first four entries draw. Its second texture
// coordinates' x is its share of the entry's band colour: 1 on a lathe's scaled band and on the
// stalks where the record gives a band colour, 0 elsewhere. Its texture coordinates hold no texture:
// the quantiser writes the rest of each position below the species box's step there.
import type { MeshArrays, ShootPrototype } from '../asset';
import {
	AXIS_CULM,
	BUD_AREOLE,
	BUD_DORMANT,
	BUD_FLOWER,
	BUD_JOINT,
	BUD_LATERAL,
	BUD_SPUR,
	BUD_TERMINAL,
} from '../core/graph';
import { unitAt } from '../core/hash';
import {
	atan2,
	cos,
	cross3,
	length3,
	normalize3,
	quatAxisAngle,
	quatRotate,
	radians,
	sin,
	type Vector3,
} from '../core/math';
import type { ExtraSpec } from '../core/record';
import { spreadAt } from '../core/types';
import { crownSkyAt } from '../crown/visibility';
import { shootReach } from '../lod/levels';
import type { MeshInput, MeshLevel } from '../stages';
import { VARIANT_RECORDS } from '../wind/records';
import { lathe, MeshWriter, SURFACE_STEM, sideAxes } from './writer';

/** Faces round an extra by level; the thinned level draws the fewest. */
const SIDES: Readonly<Record<MeshLevel, number>> = { 0: 8, 1: 5, 2: 3 };
/**
 * Extras smaller than this, in metres, are left out of the thinned level of a plant without shoots,
 * where they cover no pixel.
 */
const SMALLEST_FAR = 0.025;
/**
 * An extra that spans fewer pixels than this where a card level starts is left out of it: a speck
 * there, which the shoots' cards already colour.
 */
const FEWEST_PIXELS = 5;
/** The first hash purpose of the extras, past every purpose the instancer uses. */
const PURPOSE = 40;
/** The first hash purpose of the sites a triangle maximum keeps, past the extras' and the groups'. */
const THIN = 1 << 20;
/**
 * The first hash purpose of an extra group, past the entries' own purposes, so a group and an entry
 * number never draw the same sites.
 */
const GROUP = 44;
/** Extras a record can draw: the first four, whose colours the plant material's header holds. */
const MOST = 4;
/**
 * Faces round a stalk at the farther levels, and at the nearest where the shape names none: a thin
 * stem a few pixels wide reads round at four.
 */
const STALK_SIDES = 4;

/** One place an extra may hang from: its point, its outward direction and its wind record. */
interface Site {
	/**
	 * The site's number among the extra's sites on the plant as grown, which keys its random
	 * choices: a sparser plant keeps the number, so the same sites carry the same extras.
	 */
	readonly key: number;
	readonly at: Vector3;
	readonly direction: Vector3;
	readonly record: number;
	/** Sky visibility at the site, 0 to 255. */
	sky: number;
	/**
	 * The wood's radius at the site, in metres, which sizes a shape the record gives in wood
	 * radii; 0 where the site names no wood, such as a shoot row's tip.
	 */
	readonly woodRadius: number;
}

/** A shoot's wood tip: a point on its stem, and the way the stem runs there. */
interface WoodTip {
	/** The point on the stem's axis, in prototype space. */
	readonly at: Vector3;
	/** The stem's outward direction at that point. */
	readonly out: Vector3;
}

/** One ring of a stem: its centre on the axis, and its point along the shoot. */
interface StemRing {
	readonly at: Vector3;
	/** The bend byte, which orders the rings along the shoot. */
	readonly bend: number;
}

/** Each prototype's wood tip, by the share of the way in from it. */
const tips = new WeakMap<object, { share: number; tip: WoodTip }>();

/** Metres within which the vertices of one stem ring stand of each other: widest at a thick base. */
const RING_SPAN = 0.05;

/** The centre of a stem ring: the vertices that share `bend` and stand near a vertex of it. */
function ringCentre(
	points: ArrayLike<number>,
	bytes: ArrayLike<number>,
	from: number,
	bend: number,
): Vector3 {
	const ring: Vector3[] = [];
	for (let i = 0; i < points.length; i += 3) {
		if ((bytes[(i / 3) * 4 + 2] as number) !== SURFACE_STEM) continue;
		if ((bytes[(i / 3) * 4] as number) !== bend) continue;
		const x = points[i] as number;
		const y = points[i + 1] as number;
		const z = points[i + 2] as number;
		const dx = x - (points[from] as number);
		const dy = y - (points[from + 1] as number);
		const dz = z - (points[from + 2] as number);
		if (dx * dx + dy * dy + dz * dz > RING_SPAN * RING_SPAN) continue;
		// The tube's seam repeats its first vertex at the end of each ring.
		if (
			ring.some(
				(p) => Math.abs(p[0] - x) < 1e-6 && Math.abs(p[1] - y) < 1e-6 && Math.abs(p[2] - z) < 1e-6,
			)
		)
			continue;
		ring.push([x, y, z]);
	}
	const centre: Vector3 = [0, 0, 0];
	for (const p of ring) {
		centre[0] += p[0] / ring.length;
		centre[1] += p[1] / ring.length;
		centre[2] += p[2] / ring.length;
	}
	return centre;
}

/** The stem ring behind a point on the stem: the nearest wood on a smaller bend. */
function ringBehind(
	points: ArrayLike<number>,
	bytes: ArrayLike<number>,
	at: Readonly<Vector3>,
	bend: number,
): StemRing | undefined {
	let near = Number.POSITIVE_INFINITY;
	let found = -1;
	let foundBend = -1;
	for (let i = 0; i < points.length; i += 3) {
		if ((bytes[(i / 3) * 4 + 2] as number) !== SURFACE_STEM) continue;
		const b = bytes[(i / 3) * 4] as number;
		if (b >= bend) continue;
		const dx = (points[i] as number) - at[0];
		const dy = (points[i + 1] as number) - at[1];
		const dz = (points[i + 2] as number) - at[2];
		const away = dx * dx + dy * dy + dz * dz;
		if (away < near) {
			near = away;
			found = i;
			foundBend = b;
		}
	}
	if (found < 0) return undefined;
	return { at: ringCentre(points, bytes, found, foundBend), bend: foundBend };
}

/** A direction from a point on the stem, away from the ring behind it. */
function stemWay(from: Readonly<Vector3>, behind: Readonly<Vector3> | undefined): Vector3 {
	// A stem too short to hold a second ring keeps the line from its base to its tip.
	return behind
		? normalize3([from[0] - behind[0], from[1] - behind[1], from[2] - behind[2]])
		: normalize3([from[0], from[1], from[2]]);
}

/**
 * Finds a point on a prototype's own stem near its tip, not on its leaves. A leaf reaches well
 * past the twig it stands on, so a tip taken over the whole mesh hangs a fruit from a leaf, out of
 * reach of any wood. The point is the centre of the stem's last ring and the `share` of the way
 * back along the stem from it, and its direction follows the stem's own bend, so a stalk that
 * reaches into the wood stays on the twig.
 */
function tipOf(prototype: ShootPrototype, share: number): WoodTip {
	// The finest tier draws the same stem with the most rings, so a point a little way in from
	// the tip follows every bend the drawn wood has.
	const tier = prototype.tiers[3];
	const known = tips.get(tier);
	if (known && known.share === share) return known.tip;
	const points = tier.positions;
	const bytes = tier.colors;
	const fallback: WoodTip = { at: [0, prototype.length * share, 0], out: [0, 1, 0] };
	let far = -1;
	let best = -1;
	for (let i = 0; i < points.length; i += 3) {
		if ((bytes[(i / 3) * 4 + 2] as number) !== SURFACE_STEM) continue;
		const x = points[i] as number;
		const y = points[i + 1] as number;
		const z = points[i + 2] as number;
		const away = x * x + y * y + z * z;
		if (away > best) {
			best = away;
			far = i;
		}
	}
	if (far < 0) {
		tips.set(tier, { share, tip: fallback });
		return fallback;
	}
	const top = ringCentre(points, bytes, far, bytes[(far / 3) * 4] as number);
	let outer = top;
	let behind = ringBehind(points, bytes, outer, bytes[(far / 3) * 4] as number);
	let out = stemWay(outer, behind?.at);
	let at = outer;
	// The record's share is along the stem, so a point a little way in from the tip stays on the
	// twig however the twig bends.
	const target = Math.max(0, 1 - share) * prototype.length;
	let walked = 0;
	while (behind && walked < target) {
		const step = length3(outer[0] - behind.at[0], outer[1] - behind.at[1], outer[2] - behind.at[2]);
		if (walked + step >= target || step < 1e-9) {
			const t = step > 1e-9 ? (target - walked) / step : 0;
			at = [
				outer[0] + (behind.at[0] - outer[0]) * t,
				outer[1] + (behind.at[1] - outer[1]) * t,
				outer[2] + (behind.at[2] - outer[2]) * t,
			];
			break;
		}
		walked += step;
		outer = behind.at;
		behind = ringBehind(points, bytes, outer, (behind as StemRing).bend);
		out = stemWay(outer, behind?.at);
		at = outer;
	}
	const tip: WoodTip = { at, out };
	tips.set(tier, { share, tip });
	return tip;
}

/**
 * The sites of one extra in a dressed variant. The sites are numbered through the plant as grown:
 * a plant that sparseness took foliage from walks the grown plant's rows or bud sites, numbers each
 * site there, and keeps the sites whose row or bud it still holds.
 */
function sitesOf(input: MeshInput, extra: ExtraSpec): Site[] {
	const { rows, kit, skeleton } = input;
	const grown = input.grown;
	const base = input.variant * VARIANT_RECORDS;
	const out: Site[] = [];
	const up: Vector3 = [0, 1, 0];
	let key = 0;
	// The next row or bud this plant holds, in the grown plant's order.
	let held = 0;
	if (extra.at === 'shoot-tip' || extra.at === 'node' || extra.at === 'spur') {
		const all = grown?.rows ?? rows;
		const ids = grown ? rows.id : undefined;
		for (let g = 0; g < all.count; g++) {
			let r = g;
			if (ids) r = held < rows.count && ids[held] === g ? held++ : -1;
			const prototype = kit.prototypes[all.prototype[g] as number];
			if (!prototype) continue;
			if (extra.at === 'spur' && prototype.class !== 'spur') continue;
			const site = key++;
			if (r < 0) continue;
			const scale = rows.scale[r] as number;
			// A shoot bends, so its drawn tip is not on the straight line its base points along.
			// Take the prototype's own wood tip, turned into the row's frame, so a part that
			// hangs from the shoot meets the wood by the picture's own geometry.
			const along = Math.max(0, Math.min(1, extra.tipShare ?? 1));
			const wood = extra.at === 'shoot-tip' ? tipOf(prototype, along) : undefined;
			const direction = quatRotate(rows.rotation, r * 4, wood?.out ?? up, [0, 0, 0]);
			const reach = quatRotate(rows.rotation, r * 4, wood?.at ?? ([0, 0, 0] as Vector3), [0, 0, 0]);
			const tip: Vector3 = extra.at === 'shoot-tip' ? reach : [0, 0, 0];
			out.push({
				key: site,
				at: [
					(rows.position[r * 3] as number) + tip[0] * scale,
					(rows.position[r * 3 + 1] as number) + tip[1] * scale,
					(rows.position[r * 3 + 2] as number) + tip[2] * scale,
				],
				direction,
				record: base + (rows.record[r] as number),
				sky: 0,
				woodRadius: 0,
			});
		}
		return out;
	}
	const buds = skeleton.buds;
	const all = grown?.skeleton ?? skeleton;
	const origins = grown ? buds.origin : undefined;
	for (let g = 0; g < all.buds.count; g++) {
		let b = g;
		if (origins) b = held < buds.count && origins[held] === g ? held++ : -1;
		const kind = all.buds.kind[g] as number;
		const y = all.buds.position[g * 3 + 1] as number;
		let take: boolean;
		switch (extra.at) {
			case 'areole':
				take = kind === BUD_AREOLE;
				break;
			case 'old-wood':
				take = kind === BUD_LATERAL || kind === BUD_DORMANT || kind === BUD_SPUR;
				break;
			case 'flower':
				take = kind === BUD_FLOWER;
				break;
			case 'stem-tip':
				take =
					kind === BUD_TERMINAL &&
					(all.axes.kind[all.buds.axis[g] as number] as number) === AXIS_CULM;
				break;
			case 'culm-node':
				// The dormant buds a culm grower leaves along its lower nodes carry the sheaths.
				take =
					kind === BUD_DORMANT &&
					(all.axes.kind[all.buds.axis[g] as number] as number) === AXIS_CULM;
				break;
			case 'culm-joint':
				// Every joint of a culm carries its node ring, on the bud the grower leaves there.
				take =
					kind === BUD_JOINT && (all.axes.kind[all.buds.axis[g] as number] as number) === AXIS_CULM;
				break;
			default:
				take = kind === BUD_TERMINAL && y > all.height * 0.85;
		}
		if (!take) continue;
		const site = key++;
		if (b < 0) continue;
		out.push({
			key: site,
			at: [buds.position[b * 3] as number, y, buds.position[b * 3 + 2] as number],
			direction: quatRotate(buds.frame, b * 4, up, [0, 0, 0]),
			record: base + (skeleton.axes.record[buds.axis[b] as number] as number),
			sky: 0,
			woodRadius: buds.woodRadius[b] as number,
		});
	}
	return out;
}

/** A direction turned toward the ground by up to `degrees`, never past straight down. */
function hung(direction: Readonly<Vector3>, degrees: number): Vector3 {
	const out: Vector3 = [direction[0], direction[1], direction[2]];
	if (degrees <= 0) return out;
	const axis = cross3(direction, [0, -1, 0], [0, 0, 0]);
	const sine = length3(axis[0], axis[1], axis[2]);
	if (sine < 1e-6) return out;
	normalize3(axis);
	// The angle to straight down, so the hang stops there.
	const toDown = atan2(sine, -direction[1]);
	const q = [0, 0, 0, 1];
	quatAxisAngle(axis, Math.min(radians(degrees), toDown), q);
	return normalize3(quatRotate(q, 0, out, out));
}

/**
 * The breadth of an extra's shape in metres, what a far eye sees of it: a lathe's widest diameter,
 * past the thin stalk that its length counts, and otherwise its size.
 */
function breadthOf(extra: ExtraSpec): number {
	const shape = extra.shape;
	if ('samara' in shape) return shape.samara.width;
	if (!('lathe' in shape)) return sizeOf(extra);
	let breadth = 0;
	for (const [radius] of shape.lathe) breadth = Math.max(breadth, radius * 2);
	return breadth;
}

/** The largest size of an extra's shape, in metres. */
function sizeOf(extra: ExtraSpec): number {
	const shape = extra.shape;
	if ('samara' in shape) return shape.samara.length;
	if ('lathe' in shape) {
		let size = 0;
		for (const [radius, height] of shape.lathe) size = Math.max(size, radius * 2, height);
		return size;
	}
	if ('petals' in shape) return shape.radius * 2;
	if ('spines' in shape) return shape.length;
	return shape.catkin.length;
}

/**
 * The pixels a shape of `breadth` metres spans where a card level starts: its breadth over the
 * longest shoot's reach, times the pixels that shoot spans at the level's switch. Undefined for a
 * plant without shoots.
 */
function pixelsFor(input: MeshInput, breadth: number, level: 1 | 2): number | undefined {
	if (!input.record.shoots || input.kit.prototypes.length === 0) return undefined;
	const pixels = input.record.lod.switchPixels[level - 1] as number;
	return (breadth / shootReach(input.kit)) * pixels;
}

/** The pixels an extra spans where a card level starts, at its recorded size. */
function pixelsAt(input: MeshInput, extra: ExtraSpec, level: 1 | 2): number | undefined {
	return pixelsFor(input, breadthOf(extra), level);
}

/** Whether a shape's lathe stands in the site's wood radii rather than in metres. */
function byWoodRadius(extra: ExtraSpec): boolean {
	return 'lathe' in extra.shape && extra.shape.byWoodRadius === true;
}

/** The colour bytes of one extra: its axis's wind record, its entry in the record and its sky. */
function colourOf(site: Site, index: number): number[] {
	return [(site.record >>> 8) & 255, site.record & 255, index, site.sky];
}

/**
 * The depth a shared stalk reaches back past the site into the wood it grows from. Two parts built
 * separately meet at a point, and a point is no join at all under a close view: the stalk starts
 * inside the parent's own wood so the two read as one piece.
 *
 * It reaches back along the parent's axis, not along the direction the part hangs: a shoot runs
 * sideways as often as not, and reaching back against the hang leaves the stalk's end in open air
 * beside its twig.
 */
const STALK_OVERLAP = 0.02;
/** Metres a hanging body reaches back into its support, so the two tubes share a length. */
const BODY_ROOT = 0.012;
/** Degrees a copy's own footstalk splays from the shared stalk at its fork. */
const PEDICEL_SPLAY = 60;
/** Degrees a body leans from straight down below its footstalk. */
const NUT_LEAN = 25;
/** Metres a footstalk reaches back into the shared stalk's end, so the two join. */
const PEDICEL_ROOT = 0.003;
/** Metres each footstalk stands above the last along the shared stalk, so the bodies stagger. */
const PEDICEL_STAGGER = 0.01;

/** Sets the band share of the vertices from `first` on. */
function markBand(mesh: MeshWriter, first: number, share: number): void {
	for (let i = first; i < mesh.vertices; i++) mesh.uvs1[i * 2] = share;
}

/**
 * The half-width of a key's seed body, by position along the body: a spindle that swells quickly and
 * narrows again into the wing.
 */
const SAMARA_BODY_PROFILE: readonly (readonly [number, number])[] = [
	[0, 0],
	[0.45, 0.52],
	[1, 0.34],
];
/** The half-width of a key's wing, by position along the wing: it opens out of the body, reaches its
 * widest past the middle and closes to a point. */
const SAMARA_WING_PROFILE: readonly (readonly [number, number])[] = [
	[0, 0.34],
	[0.55, 1],
	[1, 0],
];
/** The key's half-thickness over its half-width: a wing, thin enough to read as a flat blade. */
const SAMARA_THIN = 0.12;

/**
 * A key: a seed body at the site and a flat wing running from it, closed as a lens of four faces, so
 * it reads from both sides. `turn` spins it about its own length.
 *
 * @param mesh The mesh to write into.
 * @param shape The record's key: its length, its wing's width and the share the seed body takes.
 * @param at The point it hangs from.
 * @param direction The way it hangs, from the site.
 * @param turn Radians the lens turns about its own length.
 * @param colour The vertex colour bytes.
 * @category api/vegetation
 */
export function samaraMesh(
	mesh: MeshWriter,
	shape: {
		readonly length: number;
		readonly width: number;
		readonly body: number;
		readonly twist?: number;
	},
	at: Readonly<Vector3>,
	direction: Readonly<Vector3>,
	turn: number,
	colour: ArrayLike<number>,
): void {
	const [x, y] = sideAxes(direction, [0, 1, 0]);
	const spin = turn + radians(shape.twist ?? 0);
	const across: Vector3 = [
		x[0] * cos(spin) + y[0] * sin(spin),
		x[1] * cos(spin) + y[1] * sin(spin),
		x[2] * cos(spin) + y[2] * sin(spin),
	];
	const through: Vector3 = [
		x[0] * -sin(spin) + y[0] * cos(spin),
		x[1] * -sin(spin) + y[1] * cos(spin),
		x[2] * -sin(spin) + y[2] * cos(spin),
	];
	const body = Math.min(0.6, Math.max(0.1, shape.body));
	// The record gives the wing's full width; a station stands half of it from the key's line.
	const wing = shape.width * 0.5;
	const bodyStations: { readonly along: number; readonly half: number }[] = [];
	// The seed body's foot stands inside the stalk it hangs from, so the two read as one part rather
	// than meeting at a point.
	bodyStations.push({ along: -Math.min(0.004, shape.length * 0.15), half: 0 });
	for (const [t, share] of SAMARA_BODY_PROFILE)
		bodyStations.push({ along: t * body * shape.length, half: share * wing });
	const wingStations: { readonly along: number; readonly half: number }[] = [];
	// The body's last ring stands again as the wing's first, so the seed body's colour changes at a
	// sharp edge and not along the wing.
	wingStations.push({
		along: body * shape.length,
		half: (SAMARA_WING_PROFILE[0]?.[1] ?? 0) * wing,
	});
	for (const [t, share] of SAMARA_WING_PROFILE.slice(1))
		wingStations.push({
			along: (body + t * (1 - body)) * shape.length,
			half: share * wing,
		});
	const first = mesh.vertices;
	writeRings(mesh, bodyStations, at, direction, across, through, shape.length, colour);
	// The seed body takes the extra's band colour, so a key reads as a brown body on a green wing.
	markBand(mesh, first, 1);
	writeRings(mesh, wingStations, at, direction, across, through, shape.length, colour);
}

/** Writes a key's rings, four vertices each, and the faces between them. */
function writeRings(
	mesh: MeshWriter,
	stations: readonly { readonly along: number; readonly half: number }[],
	at: Readonly<Vector3>,
	direction: Readonly<Vector3>,
	across: Readonly<Vector3>,
	through: Readonly<Vector3>,
	length: number,
	colour: ArrayLike<number>,
): void {
	const first = mesh.vertices;
	for (const station of stations) {
		const { along, half } = station;
		const thin = half * SAMARA_THIN;
		const height = Math.max(thin, 0.0004);
		const centre: Vector3 = [
			at[0] + direction[0] * along,
			at[1] + direction[1] * along,
			at[2] + direction[2] * along,
		];
		const v = along / Math.max(length, 1e-6);
		for (let j = 0; j < 4; j++) {
			const side = j === 0 ? 1 : j === 2 ? -1 : 0;
			const face = j === 1 ? 1 : j === 3 ? -1 : 0;
			mesh.vertex(
				[
					centre[0] + across[0] * half * side + through[0] * height * face,
					centre[1] + across[1] * half * side + through[1] * height * face,
					centre[2] + across[2] * half * side + through[2] * height * face,
				],
				normalize3([
					across[0] * side + through[0] * face,
					across[1] * side + through[1] * face,
					across[2] * side + through[2] * face,
				]),
				[j / 4, v],
				[0, 0],
				colour,
			);
		}
	}
	for (let r = 0; r < stations.length - 1; r++)
		for (let j = 0; j < 4; j++) {
			const a = first + r * 4 + j;
			const b = first + r * 4 + ((j + 1) % 4);
			mesh.quad(a, b, b + 4, a + 4);
		}
}

/** Writes a thin shared stalk from a site along `down`, and gives back the point it reaches. */
function writeStalk(
	mesh: MeshWriter,
	site: Site,
	down: Vector3,
	length: number,
	colour: number[],
	sides: number,
	band: number,
): Vector3 {
	const first = mesh.vertices;
	const wood = site.direction;
	const top: Vector3 = [
		site.at[0] - wood[0] * STALK_OVERLAP,
		site.at[1] - wood[1] * STALK_OVERLAP,
		site.at[2] - wood[2] * STALK_OVERLAP,
	];
	const fork: Vector3 = [
		site.at[0] + down[0] * length,
		site.at[1] + down[1] * length,
		site.at[2] + down[2] * length,
	];
	// The stalk runs from inside the wood to the point the rest of the cluster forks from, so both
	// of its ends meet something.
	const axis = normalize3([fork[0] - top[0], fork[1] - top[1], fork[2] - top[2]]);
	const reach = length3(fork[0] - top[0], fork[1] - top[1], fork[2] - top[2]);
	lathe(
		mesh,
		[
			[0.0017, 0],
			[0.0013, reach],
		],
		top,
		axis,
		sides,
		colour,
	);
	markBand(mesh, first, band);
	// The stalk's vertices say so in their second coordinate, so it may take the wood's own colour
	// rather than the cup's.
	for (let i = first; i < mesh.vertices; i++) mesh.uvs1[i * 2 + 1] = 1;
	return fork;
}

/**
 * One scale's departure from its neighbours' shade: a fixed share of the band's colour from
 * -jitter to +jitter, the same for the same scale whichever picture draws it.
 *
 * @param ring The scale row, from the band's foot.
 * @param column The scale's place round the ring.
 * @param jitter The most a scale's share departs by, 0 to 1.
 * @returns The share to add to the scale's own.
 */
function scaleShadeAt(ring: number, column: number, jitter: number): number {
	let x = (ring * 374761393 + column * 668265263) >>> 0;
	x = ((x ^ (x >>> 13)) * 1274126177) >>> 0;
	return jitter * ((((x ^ (x >>> 16)) >>> 0) / 4294967295) * 2 - 1);
}

/** Lobes round a scaled lathe's band, so a cup's rim reads as fine scallops rather than a star. */
const SCALLOP_LOBES = 24;
/** The share of the radius the lobes rise and fall by. */
const SCALLOP_DEPTH = 0.06;

/**
 * A lathe whose radius ripples round the turn over a band of heights. A cup's rim then stands in
 * lobes below its scale rows rather than as a smooth ring. Two profile points that stand at the
 * same place give two rings there with no faces between them, so a colour can change at a sharp
 * edge.
 */
function scallopedLathe(
	mesh: MeshWriter,
	profile: readonly [number, number][],
	base: Readonly<Vector3>,
	direction: Vector3,
	sides: number,
	colour: number[],
	from: number,
	to: number,
): void {
	const [x, y] = sideAxes(direction, [0, 0, 1]);
	const height = (profile[profile.length - 1] as [number, number])[1] || 1;
	const span = Math.max(1e-6, to - from);
	const ramp = span * 0.5;
	let previous = -1;
	for (let k = 0; k < profile.length; k++) {
		const [radius, h] = profile[k] as [number, number];
		const prev = profile[Math.max(0, k - 1)] as [number, number];
		const next = profile[Math.min(profile.length - 1, k + 1)] as [number, number];
		const run = (next[1] as number) - (prev[1] as number);
		const rise = run > 1e-9 ? ((next[0] as number) - (prev[0] as number)) / run : 0;
		// The lobes grow from the band's foot to their full depth at its middle, and hold to the rim.
		const band = h < from || h > to ? 0 : Math.min(1, Math.max(0, (h - from) / ramp));
		const climb = h > from && h < from + ramp ? 1 / ramp : 0;
		const first = mesh.vertices;
		for (let j = 0; j <= sides; j++) {
			const angle = (2 * Math.PI * j) / sides;
			const c = cos(angle);
			const s = sin(angle);
			const radial: Vector3 = [c * x[0] + s * y[0], c * x[1] + s * y[1], c * x[2] + s * y[2]];
			const tangent: Vector3 = [-s * x[0] + c * y[0], -s * x[1] + c * y[1], -s * x[2] + c * y[2]];
			const wave = 1 + SCALLOP_DEPTH * band * cos(SCALLOP_LOBES * angle);
			const ripple = -SCALLOP_DEPTH * band * SCALLOP_LOBES * sin(SCALLOP_LOBES * angle);
			const lean = SCALLOP_DEPTH * cos(SCALLOP_LOBES * angle) * climb;
			const r = radius * wave;
			const p: Vector3 = [
				base[0] + direction[0] * h + radial[0] * r,
				base[1] + direction[1] * h + radial[1] * r,
				base[2] + direction[2] * h + radial[2] * r,
			];
			// The surface's tangents: up the profile, and round the turn. Their cross is the normal.
			// The radius's rate up the profile: the profile's own slope through the ripple, and the
			// ripple's growth over the band's foot.
			const climbRate = rise * wave + radius * lean;
			const along: Vector3 = [
				direction[0] + radial[0] * climbRate,
				direction[1] + radial[1] * climbRate,
				direction[2] + radial[2] * climbRate,
			];
			const around: Vector3 = [
				tangent[0] * r + radial[0] * radius * ripple,
				tangent[1] * r + radial[1] * radius * ripple,
				tangent[2] * r + radial[2] * radius * ripple,
			];
			const raw = cross3(along, around, [0, 0, 0]);
			// Where the profile closes to a point the ring has no width; the normal there lies in
			// the profile's own plane, as the plain lathe gives it.
			const n =
				raw[0] * raw[0] + raw[1] * raw[1] + raw[2] * raw[2] > 1e-18
					? normalize3(raw)
					: normalize3([
							radial[0] - direction[0] * rise,
							radial[1] - direction[1] * rise,
							radial[2] - direction[2] * rise,
						]);
			const out = n[0] * radial[0] + n[1] * radial[1] + n[2] * radial[2] < 0 ? -1 : 1;
			mesh.vertex(p, [n[0] * out, n[1] * out, n[2] * out], [j / sides, h / height], [0, 0], colour);
		}
		const repeat = prev !== profile[k] && prev[0] === radius && prev[1] === h;
		if (previous >= 0 && !repeat)
			for (let j = 0; j < sides; j++)
				mesh.quad(previous + j, previous + j + 1, first + j + 1, first + j);
		previous = first;
	}
}

/**
 * A lathe profile with each end of a band that falls inside it standing twice, and each ring's
 * share of the band: 1 from the band's start to its end, 0 elsewhere. At an end, the ring on the
 * band's side takes 1 and the other 0, so the colour changes at a sharp edge. An end that falls
 * between two profile points stands between them.
 */
function bandEdges(
	profile: readonly [number, number][],
	from: number,
	to: number,
): { readonly profile: [number, number][]; readonly shares: number[] } {
	const start = (profile[0] as [number, number])[1];
	const end = (profile[profile.length - 1] as [number, number])[1];
	const out: [number, number][] = [];
	const shares: number[] = [];
	const edge = (radius: number, h: number): void => {
		out.push([radius, h], [radius, h]);
		shares.push(h === from ? 0 : 1, h === from ? 1 : 0);
	};
	const inner = (h: number) => from < to && (h === from || h === to) && h > start && h < end;
	for (let k = 0; k < profile.length; k++) {
		const [radius, h] = profile[k] as [number, number];
		const prev = profile[k - 1];
		if (prev)
			for (const at of [from, to])
				if (at > prev[1] && at < h && inner(at))
					edge(prev[0] + ((at - prev[1]) / (h - prev[1])) * (radius - prev[0]), at);
		if (inner(h)) edge(radius, h);
		else {
			out.push([radius, h]);
			shares.push(h >= from && h <= to ? 1 : 0);
		}
	}
	return { profile: out, shares };
}

/** Writes one extra at a site. */
function writeExtra(
	mesh: MeshWriter,
	extra: ExtraSpec,
	index: number,
	site: Site,
	direction: Vector3,
	sides: number,
	turn: number,
	nearest: boolean,
): void {
	const colour = colourOf(site, index);
	const shape = extra.shape;
	if ('samara' in shape) {
		samaraMesh(mesh, shape.samara, site.at, direction, turn, colour);
		return;
	}
	if ('lathe' in shape || 'catkin' in shape) {
		let profile: [number, number][];
		let scaledFrom = 0;
		let scaledTo = 0;
		if ('lathe' in shape) {
			profile = shape.lathe.map(([radius, height]) => [radius, height]);
			// Scales: rings of bumps over a cone's or a cup's own part of the profile, one ring a
			// scale row. The profile's own points keep the shape; the rows add rings between them.
			const rows = shape.scales ?? 0;
			if (rows > 0 && profile.length > 1) {
				const height = (profile[profile.length - 1] as [number, number])[1];
				const from = shape.scaled?.[0] ?? 0;
				const to = Math.min(height, shape.scaled?.[1] ?? height);
				scaledFrom = from;
				scaledTo = to;
				const span = Math.max(1e-6, to - from);
				const bump = (h: number): number =>
					h >= from && h <= to ? 1 + 0.18 * Math.abs(sin((Math.PI * rows * (h - from)) / span)) : 1;
				const across = (a: [number, number], b: [number, number], h: number): number =>
					b[1] > a[1] ? a[0] + ((h - a[1]) / (b[1] - a[1])) * (b[0] - a[0]) : b[0];
				const fine: [number, number][] = [];
				let row = 0;
				for (let k = 0; k < profile.length; k++) {
					const point = profile[k] as [number, number];
					// One ring at the crest of each scale row, between the profile's own points so
					// that its shape stays as drawn.
					for (; row < rows; row++) {
						const h = from + (span * (row + 0.5)) / rows;
						if (h >= point[1]) break;
						const prev = (profile[Math.max(0, k - 1)] as [number, number]) ?? point;
						fine.push([across(prev, point, h) * 1.18, h]);
					}
					fine.push([point[0] * bump(point[1]), point[1]]);
				}
				profile = fine;
			}
		} else {
			const { length, radius, spikelets } = shape.catkin;
			const rows = spikelets?.count ?? 0;
			if (rows > 0) {
				// A sedge's spike is a cluster of short spikelets: a ring of swellings for each
				// row along the body, so the silhouette carries the cluster's own edge.
				const bulge = spikelets?.bulge ?? 0.35;
				const from = 0.12;
				const to = 0.88;
				const rings = rows * 2;
				profile = [[radius, 0]];
				for (let k = 0; k <= rings; k++) {
					const t = from + ((to - from) * k) / rings;
					const swell = k % 2 === 0 ? 1 + bulge : 1 - bulge * 0.45;
					profile.push([radius * swell, length * t]);
				}
				profile.push([radius * 0.55, length * 0.95]);
				profile.push([0, length]);
			} else {
				profile = [
					// The foot takes the body's width at the stalk, so a thin hanging spike keeps its
					// join through a silhouette's half-cover cutoff instead of pinching to nothing.
					[radius, 0],
					[radius, length * 0.15],
					[radius, length * 0.8],
					[0, length],
				];
			}
		}
		// A profile given in wood radii takes the width of the wood its site names, so one ring fits a
		// thick culm and a thin one alike. The band's bounds are heights of the profile, so they
		// scale with it.
		const wood = 'lathe' in shape && shape.byWoodRadius ? site.woodRadius || 0 : 0;
		const size = wood > 0 ? wood : 1;
		if (wood > 0) {
			profile = profile.map(([radius, height]) => [radius * wood, height * wood]);
			scaledFrom *= wood;
			scaledTo *= wood;
		}
		const band =
			'lathe' in shape && shape.scaled
				? [shape.scaled[0] * size, shape.scaled[1] * size]
				: undefined;
		// A band colour meets the body at a sharp edge, so each end of the band stands twice.
		const banded =
			'lathe' in shape && band && extra.bandColour
				? bandEdges(profile, band[0] as number, band[1] as number)
				: undefined;
		if (banded) profile = banded.profile;
		// A hanging body roots a short way back along the support it hangs from, so the body's tube
		// and the stalk's share a length rather than meeting at a point that a thin outline drops.
		const root = 'catkin' in shape ? Math.min(BODY_ROOT, shape.catkin.length * 0.15) : 0;
		const base: Readonly<Vector3> = [
			site.at[0] - site.direction[0] * root,
			site.at[1] - site.direction[1] * root,
			site.at[2] - site.direction[2] * root,
		];
		const first = mesh.vertices;
		if (scaledTo > scaledFrom)
			scallopedLathe(mesh, profile, base, direction, sides, colour, scaledFrom, scaledTo);
		else lathe(mesh, profile, base, direction, sides, colour);
		// The band's crevices take part of the body's colour on every other vertex round each ring,
		// offset from ring to ring, so a cup reads as rows of overlapping scales. Each scale's own
		// shade then departs from its neighbours' by a fixed share, so no two read alike.
		const crevice = 'lathe' in shape ? (shape.scaleShade ?? 0) : 0;
		const jitter = 'lathe' in shape ? (shape.scaleJitter ?? 0) : 0;
		if (banded)
			banded.shares.forEach((share, ring) => {
				const from = first + ring * (sides + 1);
				for (let j = 0; j <= sides; j++) {
					const shaded = share > 0 && (j + ring) % 2 === 1 ? share - crevice : share;
					const scale = jitter > 0 && share > 0 ? scaleShadeAt(ring, j, jitter) : 0;
					mesh.uvs1[(from + j) * 2] = Math.min(1, Math.max(0, shaded * (1 + scale)));
				}
			});
		// A bed of bristles over the scaled band: short cones standing along the surface's own
		// normal, so the husk reads as a burr rather than a shaded cone. They take the band's colour.
		if ('lathe' in shape && shape.bristles) {
			const { rows: beds, sides: around, length: longest } = shape.bristles;
			const outline = shape.lathe;
			const top = (outline[outline.length - 1] as readonly [number, number])[1] || 1;
			const from = shape.scaled?.[0] ?? 0;
			const to = Math.min(top, shape.scaled?.[1] ?? top);
			const radiusAt = (h: number): number => {
				for (let k = 1; k < outline.length; k++) {
					const a = outline[k - 1] as readonly [number, number];
					const b = outline[k] as readonly [number, number];
					if (h <= b[1])
						return b[1] > a[1] ? a[0] + ((h - a[1]) / (b[1] - a[1])) * (b[0] - a[0]) : b[0];
				}
				return 0;
			};
			const [bx, by] = sideAxes(direction, [0, 1, 0]);
			for (let bed = 0; bed < beds; bed++) {
				const h = from + ((bed + 0.5) / beds) * Math.max(1e-6, to - from);
				const radius = radiusAt(h);
				if (radius <= 0) continue;
				for (let j = 0; j < around; j++) {
					// Each row stands its bristles half a step round from the last, so the bed staggers.
					const angle = turn + (2 * Math.PI * (j + (bed % 2) * 0.5)) / around;
					const radial: Vector3 = [
						cos(angle) * bx[0] + sin(angle) * by[0],
						cos(angle) * bx[1] + sin(angle) * by[1],
						cos(angle) * bx[2] + sin(angle) * by[2],
					];
					const point: Vector3 = [
						site.at[0] + direction[0] * h + radial[0] * radius,
						site.at[1] + direction[1] * h + radial[1] * radius,
						site.at[2] + direction[2] * h + radial[2] * radius,
					];
					const lean = normalize3([
						radial[0] + direction[0] * 0.25,
						radial[1] + direction[1] * 0.25,
						radial[2] + direction[2] * 0.25,
					]);
					const spike = longest * (0.65 + 0.7 * (((bed * 7 + j * 3) % 5) / 5));
					const start = mesh.vertices;
					lathe(
						mesh,
						[
							[0.0004, 0],
							[0.00004, spike],
						],
						point,
						lean,
						3,
						colour,
					);
					for (let v = start; v < mesh.vertices; v++) mesh.uvs1[v * 2] = 1;
				}
			}
		}
		return;
	}
	const [x, y] = sideAxes(direction, [0, 1, 0]);
	if ('petals' in shape) {
		// A cup of petals: each petal a pointed blade from the centre, opening by the cup. A stalk of
		// the record's length holds the cup along the shoot's own direction, so a corymb stands above
		// its rosette; with no length the cup sits at its site, as before.
		const length = Math.max(0, shape.stalk ?? 0) * (nearest ? 1 : 0);
		const centre: Vector3 =
			length > 0
				? [
						site.at[0] + site.direction[0] * length,
						site.at[1] + site.direction[1] * length,
						site.at[2] + site.direction[2] * length,
					]
				: site.at;
		if (length > 0) {
			const first = mesh.vertices;
			lathe(
				mesh,
				[
					[0.0017, 0],
					[0.0013, length],
				],
				site.at,
				site.direction,
				3,
				colour,
			);
			// The stalk is wood, so its vertices say so and take the extra's stalk colour.
			for (let i = first; i < mesh.vertices; i++) mesh.uvs1[i * 2 + 1] = 1;
		}
		const open = radians(90 * (1 - Math.min(1, Math.max(0, shape.cup))));
		for (let k = 0; k < shape.petals; k++) {
			const a = turn + (2 * Math.PI * k) / shape.petals;
			const out: Vector3 = [
				x[0] * cos(a) + y[0] * sin(a),
				x[1] * cos(a) + y[1] * sin(a),
				x[2] * cos(a) + y[2] * sin(a),
			];
			const petal = normalize3([
				out[0] * sin(open) + direction[0] * cos(open),
				out[1] * sin(open) + direction[1] * cos(open),
				out[2] * sin(open) + direction[2] * cos(open),
			]);
			const across = normalize3(cross3(petal, out, [0, 0, 0]));
			const normal = normalize3(cross3(across, petal, [0, 0, 0]));
			const r = shape.radius;
			const w = (r * Math.PI) / shape.petals;
			const point = (along: number, side: number): number[] => [
				centre[0] + petal[0] * along * r + across[0] * side * w,
				centre[1] + petal[1] * along * r + across[1] * side * w,
				centre[2] + petal[2] * along * r + across[2] * side * w,
			];
			const a0 = mesh.vertex(point(0, 0), normal, [0, 0], [0, 0], colour);
			const a1 = mesh.vertex(point(0.55, 0.5), normal, [0, 0.55], [0, 0], colour);
			const a2 = mesh.vertex(point(1, 0), normal, [0, 1], [0, 0], colour);
			const a3 = mesh.vertex(point(0.55, -0.5), normal, [0, 0.55], [0, 0], colour);
			mesh.quad(a0, a1, a2, a3);
		}
		return;
	}
	// A fan of spines: thin cones of three sides within the spread round the site's direction.
	const spread = radians(shape.spread);
	for (let k = 0; k < shape.spines; k++) {
		const a = turn + (2 * Math.PI * k) / shape.spines;
		const tilt = spread * (k === 0 ? 0 : 1);
		const spine = normalize3([
			direction[0] * cos(tilt) + (x[0] * cos(a) + y[0] * sin(a)) * sin(tilt),
			direction[1] * cos(tilt) + (x[1] * cos(a) + y[1] * sin(a)) * sin(tilt),
			direction[2] * cos(tilt) + (x[2] * cos(a) + y[2] * sin(a)) * sin(tilt),
		]);
		// A cone of three base vertices and one shared apex: three triangles, a third of the lathe's
		// six, and the same small spine to the eye.
		const [bx, by] = sideAxes(spine, [0, 1, 0]);
		const ring = shape.length * 0.05;
		const corner = (angle: number): number => {
			const radial: Vector3 = [
				bx[0] * cos(angle) + by[0] * sin(angle),
				bx[1] * cos(angle) + by[1] * sin(angle),
				bx[2] * cos(angle) + by[2] * sin(angle),
			];
			return mesh.vertex(
				[
					site.at[0] + radial[0] * ring,
					site.at[1] + radial[1] * ring,
					site.at[2] + radial[2] * ring,
				],
				radial,
				[0, 0],
				[0, 0],
				colour,
			);
		};
		const b0 = corner(0);
		const b1 = corner((2 * Math.PI) / 3);
		const b2 = corner((4 * Math.PI) / 3);
		const apex = mesh.vertex(
			[
				site.at[0] + spine[0] * shape.length,
				site.at[1] + spine[1] * shape.length,
				site.at[2] + spine[2] * shape.length,
			],
			spine,
			[0, 1],
			[0, 0],
			colour,
		);
		mesh.tri(b0, b1, apex);
		mesh.tri(b1, b2, apex);
		mesh.tri(b2, b0, apex);
	}
}

/**
 * The extras of one variant at a level, or none when the record has none in this season.
 *
 * @param input The dressed variant.
 * @param level The level.
 * @returns The extras' mesh, or undefined.
 */
export function extrasMesh(input: MeshInput, level: MeshLevel): MeshArrays | undefined {
	const extras = input.record.extras ?? [];
	const mesh = new MeshWriter();
	const salt = input.record.seedSalt;
	extras.forEach((extra, index) => {
		if (index >= MOST || !extra.seasons.includes(input.season)) return;
		// A shape that takes its size from its site's wood is judged site by site, since one record
		// serves the thick culms and the thin ones.
		const sized = byWoodRadius(extra);
		if (level > 0 && !sized) {
			const pixels = pixelsAt(input, extra, level as 1 | 2);
			if (
				pixels === undefined ? level === 2 && sizeOf(extra) < SMALLEST_FAR : pixels < FEWEST_PIXELS
			)
				return;
		}
		const shape = extra.shape;
		const faces = level === 0 && 'lathe' in shape && shape.sides ? shape.sides : SIDES[level];
		const stalk = 'lathe' in shape || 'samara' in shape ? (shape.stalk ?? 0) : 0;
		// The nearest level's stalks take the faces the shape names, where a close view reads a thin
		// stem's facets.
		const stalkFaces =
			level === 0 && ('lathe' in shape || 'samara' in shape) && shape.stalkSides
				? shape.stalkSides
				: STALK_SIDES;
		// The stalks take the band colour where the record gives one, as an acorn's peduncle does.
		const stalkBand = extra.bandColour ? 1 : 0;
		sitesOf(input, extra).forEach((given: Site) => {
			const s = given.key;
			// Extras that name one group pick the same sites, so the parts of one fruit hang on one
			// twig; each part keeps its own place on the shoot through its tip share and offset.
			const purpose =
				input.variant * 64 + (extra.group === undefined ? PURPOSE + index : GROUP + extra.group);
			if (unitAt(input.seed, salt, purpose, s) >= extra.share) return;
			// A triangle maximum may draw a share of the sites: a draw of its own, by the site's number
			// as grown, so the sites that stay at a share stay at every larger one. The parts of one
			// fruit share the draw, as they share their sites.
			if (
				input.extrasShare !== undefined &&
				unitAt(input.seed, salt, THIN + purpose, s) >= input.extrasShare
			)
				return;
			const turn = unitAt(input.seed, salt, purpose, s, 1) * 2 * Math.PI;
			// A fruit that stands beside its site moves with its whole body, stalks included.
			const offset = extra.offset;
			const site: Site = offset
				? {
						...given,
						at: [given.at[0] + offset[0], given.at[1] + offset[1], given.at[2] + offset[2]],
					}
				: given;
			// A shape sized by its site's wood spans the pixels that this site's stem gives it.
			if (sized && level > 0) {
				const breadth = breadthOf(extra) * given.woodRadius;
				const pixels = pixelsFor(input, breadth, level as 1 | 2);
				if (pixels === undefined ? level === 2 && breadth < SMALLEST_FAR : pixels < FEWEST_PIXELS)
					return;
			}
			site.sky = Math.round(
				255 * Math.min(1, Math.max(0, crownSkyAt(input.crown, site.at[0], site.at[1], site.at[2]))),
			);
			const down = hung(site.direction, extra.hang);
			// A shared stalk carries every copy from the site, so the cluster forks from one stem.
			const from: Site =
				stalk > 0
					? {
							...site,
							at: writeStalk(mesh, site, down, stalk, colourOf(site, index), stalkFaces, stalkBand),
						}
					: site;
			// A site carries a cluster where the record gives a count: the copies hang from the one
			// point, leaning apart round it, as an oak's acorns share a stalk.
			const count = extra.count
				? Math.max(1, Math.round(spreadAt(extra.count, unitAt(input.seed, salt, purpose, s, 2))))
				: 1;
			const [side, other] = sideAxes(down, [0, 1, 0]);
			// A copy with a footstalk of its own stands on it, clear of the others; copies without
			// one lean apart from the fork itself.
			const pedicel = 'lathe' in shape || 'samara' in shape ? (shape.pedicel ?? 0) : 0;
			const splay = radians(PEDICEL_SPLAY);
			const nutLean = radians(NUT_LEAN);
			// Copies from a shared stalk lean apart enough that their bodies clear one another below
			// the fork; one that has no stalk carries them as close as a budding cluster.
			const lean = radians(stalk > 0 ? 36 : 16);
			for (let k = 0; k < count; k++) {
				const azimuth = turn + (2 * Math.PI * k) / count;
				const outward: Vector3 = [
					side[0] * cos(azimuth) + other[0] * sin(azimuth),
					side[1] * cos(azimuth) + other[1] * sin(azimuth),
					side[2] * cos(azimuth) + other[2] * sin(azimuth),
				];
				if (pedicel > 0 && count > 1) {
					const arm = normalize3([
						down[0] * cos(splay) + outward[0] * sin(splay),
						down[1] * cos(splay) + outward[1] * sin(splay),
						down[2] * cos(splay) + outward[2] * sin(splay),
					]);
					// A thin footstalk roots in the shared stalk's end and reaches out to the body,
					// which follows the footstalk's own line. Each copy roots a little further up
					// the shared stalk, so two that share a line of sight still stand apart.
					const rise = Math.min(k * PEDICEL_STAGGER, stalk * 0.5);
					const root: Vector3 = [
						from.at[0] - down[0] * rise,
						from.at[1] - down[1] * rise,
						from.at[2] - down[2] * rise,
					];
					const top: Vector3 = [
						root[0] - arm[0] * PEDICEL_ROOT,
						root[1] - arm[1] * PEDICEL_ROOT,
						root[2] - arm[2] * PEDICEL_ROOT,
					];
					const end: Vector3 = [
						root[0] + arm[0] * pedicel,
						root[1] + arm[1] * pedicel,
						root[2] + arm[2] * pedicel,
					];
					const axis = normalize3([end[0] - top[0], end[1] - top[1], end[2] - top[2]]);
					const reach = length3(end[0] - top[0], end[1] - top[1], end[2] - top[2]);
					const body = normalize3([
						down[0] * cos(nutLean) + outward[0] * sin(nutLean),
						down[1] * cos(nutLean) + outward[1] * sin(nutLean),
						down[2] * cos(nutLean) + outward[2] * sin(nutLean),
					]);
					const first = mesh.vertices;
					lathe(
						mesh,
						[
							[0.0011, 0],
							[0.0008, reach],
						],
						top,
						axis,
						stalkFaces,
						colourOf(from, index),
					);
					markBand(mesh, first, stalkBand);
					// The footstalk is wood too: its vertices say so, as the shared stalk's do.
					for (let v = first; v < mesh.vertices; v++) mesh.uvs1[v * 2 + 1] = 1;
					writeExtra(mesh, extra, index, { ...from, at: end }, body, faces, azimuth, level === 0);
					continue;
				}
				const direction: Vector3 =
					count > 1
						? normalize3([
								down[0] * cos(lean) + outward[0] * sin(lean),
								down[1] * cos(lean) + outward[1] * sin(lean),
								down[2] * cos(lean) + outward[2] * sin(lean),
							])
						: down;
				writeExtra(mesh, extra, index, from, direction, faces, azimuth, level === 0);
			}
		});
	});
	return mesh.vertices > 0 ? mesh.finishMesh() : undefined;
}
