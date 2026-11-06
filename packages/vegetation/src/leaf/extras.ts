// The extras: cones and fruit as lathe shapes, flowers as petal cups, thorns and cactus spines as
// spine fans, and catkins, on the sites their record names, in the seasons it names. A share of the
// matching sites carries one or more, chosen by hash, and a record may give the count at a site;
// each hangs from its site's direction toward the ground by the record's degrees. Shoot tips and
// nodes come from the shoot rows; old wood, areoles, the crown's top, flower sites and the tips of
// flowering stems come from the skeleton's bud sites.
//
// An extra's colour bytes hold its axis's wind record (high and low byte, global in the species'
// table), its entry in the record's extras, which picks its colour from the plant material's header,
// and the crown's sky visibility at its site. Only the first four entries draw. The second texture
// coordinate runs along the extra.
import type { MeshArrays, ShootPrototype } from '../asset';
import {
	AXIS_CULM,
	BUD_AREOLE,
	BUD_DORMANT,
	BUD_FLOWER,
	BUD_LATERAL,
	BUD_SPUR,
	BUD_TERMINAL,
} from '../core/graph';
import { unitAt } from '../core/hash';
import {
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
import { spreadAt, spreadMax } from '../core/types';
import { crownSkyAt } from '../crown/visibility';
import type { MeshInput, MeshLevel } from '../stages';
import { VARIANT_RECORDS } from '../wind/records';
import { lathe, MeshWriter, SURFACE_STEM, sideAxes } from './writer';

/** Faces round an extra by level; the thinned level draws the fewest. */
const SIDES: Readonly<Record<MeshLevel, number>> = { 0: 8, 1: 5, 2: 4 };
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
/** Extras a record can draw: the first four, whose colours the plant material's header holds. */
const MOST = 4;
/** Faces round a shared stalk: a thin stem a few pixels wide reads round at four. */
const STALK_SIDES = 4;

/** One place an extra may hang from: its point, its outward direction and its wind record. */
interface Site {
	readonly at: Vector3;
	readonly direction: Vector3;
	readonly record: number;
	/** Sky visibility at the site, 0 to 255. */
	sky: number;
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

/** The sites of one extra in a dressed variant. */
function sitesOf(input: MeshInput, extra: ExtraSpec): Site[] {
	const { rows, kit, skeleton } = input;
	const base = input.variant * VARIANT_RECORDS;
	const out: Site[] = [];
	const up: Vector3 = [0, 1, 0];
	if (extra.at === 'shoot-tip' || extra.at === 'node' || extra.at === 'spur') {
		for (let r = 0; r < rows.count; r++) {
			const prototype = kit.prototypes[rows.prototype[r] as number];
			if (!prototype) continue;
			if (extra.at === 'spur' && prototype.class !== 'spur') continue;
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
				at: [
					(rows.position[r * 3] as number) + tip[0] * scale,
					(rows.position[r * 3 + 1] as number) + tip[1] * scale,
					(rows.position[r * 3 + 2] as number) + tip[2] * scale,
				],
				direction,
				record: base + (rows.record[r] as number),
				sky: 0,
			});
		}
		return out;
	}
	const buds = skeleton.buds;
	const axes = skeleton.axes;
	for (let b = 0; b < buds.count; b++) {
		const kind = buds.kind[b] as number;
		const y = buds.position[b * 3 + 1] as number;
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
				take = kind === BUD_TERMINAL && (axes.kind[buds.axis[b] as number] as number) === AXIS_CULM;
				break;
			default:
				take = kind === BUD_TERMINAL && y > skeleton.height * 0.85;
		}
		if (!take) continue;
		out.push({
			at: [buds.position[b * 3] as number, y, buds.position[b * 3 + 2] as number],
			direction: quatRotate(buds.frame, b * 4, up, [0, 0, 0]),
			record: base + (skeleton.axes.record[buds.axis[b] as number] as number),
			sky: 0,
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
	const toDown = Math.atan2(sine, -direction[1]);
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
	if (!('lathe' in shape)) return sizeOf(extra);
	let breadth = 0;
	for (const [radius] of shape.lathe) breadth = Math.max(breadth, radius * 2);
	return breadth;
}

/** The largest size of an extra's shape, in metres. */
function sizeOf(extra: ExtraSpec): number {
	const shape = extra.shape;
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
 * The pixels an extra spans where a card level starts: its breadth over the largest shoot's length,
 * times the pixels that shoot spans at the level's switch. Undefined for a plant without shoots.
 */
function pixelsAt(input: MeshInput, extra: ExtraSpec, level: 1 | 2): number | undefined {
	const shoots = input.record.shoots;
	let longest = 0;
	for (const prototype of input.kit.prototypes) longest = Math.max(longest, prototype.length);
	if (!shoots || longest <= 0) return undefined;
	longest *= spreadMax(shoots.placement.scale);
	return (breadthOf(extra) / longest) * (input.record.lod.switchPixels[level - 1] as number);
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

/** Writes a thin shared stalk from a site along `down`, and gives back the point it reaches. */
function writeStalk(
	mesh: MeshWriter,
	site: Site,
	down: Vector3,
	length: number,
	colour: number[],
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
		STALK_SIDES,
		colour,
	);
	for (let i = first; i < mesh.vertices; i++) mesh.uvs[i * 2] = 0;
	return fork;
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
): void {
	const colour = colourOf(site, index);
	const shape = extra.shape;
	if ('lathe' in shape || 'catkin' in shape) {
		let profile: [number, number][];
		if ('lathe' in shape) {
			profile = shape.lathe.map(([radius, height]) => [radius, height]);
			// Scales: rings of bumps over a cone's or a cup's own part of the profile, one ring a
			// scale row. The profile's own points keep the shape; the rows add rings between them.
			const rows = shape.scales ?? 0;
			if (rows > 0 && profile.length > 1) {
				const height = (profile[profile.length - 1] as [number, number])[1];
				const from = shape.scaled?.[0] ?? 0;
				const to = Math.min(height, shape.scaled?.[1] ?? height);
				const span = Math.max(1e-6, to - from);
				const bump = (h: number): number =>
					h >= from && h <= to ? 1 + 0.12 * Math.abs(sin((Math.PI * rows * (h - from)) / span)) : 1;
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
						fine.push([across(prev, point, h) * 1.12, h]);
					}
					fine.push([point[0] * bump(point[1]), point[1]]);
				}
				profile = fine;
			}
		} else {
			const { length, radius } = shape.catkin;
			profile = [
				[radius * 0.4, 0],
				[radius, length * 0.15],
				[radius, length * 0.8],
				[0, length],
			];
		}
		const first = mesh.vertices;
		lathe(mesh, profile, site.at, direction, sides, colour);
		for (let i = first; i < mesh.vertices; i++) mesh.uvs[i * 2] = 0;
		return;
	}
	const [x, y] = sideAxes(direction, [0, 1, 0]);
	if ('petals' in shape) {
		// A cup of petals: each petal a pointed blade from the centre, opening by the cup.
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
				site.at[0] + petal[0] * along * r + across[0] * side * w,
				site.at[1] + petal[1] * along * r + across[1] * side * w,
				site.at[2] + petal[2] * along * r + across[2] * side * w,
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
		const first = mesh.vertices;
		lathe(
			mesh,
			[
				[shape.length * 0.05, 0],
				[0, shape.length],
			],
			site.at,
			spine,
			3,
			colour,
		);
		for (let i = first; i < mesh.vertices; i++) mesh.uvs[i * 2] = 0;
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
		if (level > 0) {
			const pixels = pixelsAt(input, extra, level as 1 | 2);
			if (
				pixels === undefined ? level === 2 && sizeOf(extra) < SMALLEST_FAR : pixels < FEWEST_PIXELS
			)
				return;
		}
		const shape = extra.shape;
		const faces = level === 0 && 'lathe' in shape && shape.sides ? shape.sides : SIDES[level];
		const stalk = 'lathe' in shape ? (shape.stalk ?? 0) : 0;
		sitesOf(input, extra).forEach((site, s) => {
			const purpose = input.variant * 64 + PURPOSE + index;
			if (unitAt(input.seed, salt, purpose, s) >= extra.share) return;
			const turn = unitAt(input.seed, salt, purpose, s, 1) * 2 * Math.PI;
			site.sky = Math.round(
				255 * Math.min(1, Math.max(0, crownSkyAt(input.crown, site.at[0], site.at[1], site.at[2]))),
			);
			const down = hung(site.direction, extra.hang);
			// A shared stalk carries every copy from the site, so the cluster forks from one stem.
			const from: Site =
				stalk > 0
					? { ...site, at: writeStalk(mesh, site, down, stalk, colourOf(site, index)) }
					: site;
			// A site carries a cluster where the record gives a count: the copies hang from the one
			// point, leaning apart round it, as an oak's acorns share a stalk.
			const count = extra.count
				? Math.max(1, Math.round(spreadAt(extra.count, unitAt(input.seed, salt, purpose, s, 2))))
				: 1;
			const [side, other] = sideAxes(down, [0, 1, 0]);
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
				const direction: Vector3 =
					count > 1
						? normalize3([
								down[0] * cos(lean) + outward[0] * sin(lean),
								down[1] * cos(lean) + outward[1] * sin(lean),
								down[2] * cos(lean) + outward[2] * sin(lean),
							])
						: down;
				writeExtra(mesh, extra, index, from, direction, faces, azimuth);
			}
		});
	});
	return mesh.vertices > 0 ? mesh.finishMesh() : undefined;
}
