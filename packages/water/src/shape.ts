// The water body's shape: a river that follows a line, or a lake that fills an outline. Both kinds
// answer the same questions — where the water reaches, how deep the bed lies under a point, and
// which way the current runs there — so the rest of the add-on draws them with one set of rules.
import { math } from '@null3d/engine';

/**
 * A point on the ground plane, in meters: its x and its z.
 *
 * @category api/water
 */
export type WaterPoint = readonly [x: number, z: number];

/**
 * The depth of a river's bed under its middle line, in meters below the surface: one number for the
 * whole river, one number for each point of the middle line, or a function of the point and the
 * distance along the river from its first point.
 *
 * @category api/water
 */
export type RiverDepth =
	| number
	| readonly number[]
	| ((x: number, z: number, along: number) => number);

/**
 * The depth of a lake's bed, in meters below the surface: the deepest point, or a function of the
 * point and its distance from the shore.
 *
 * @category api/water
 */
export type LakeDepth = number | ((x: number, z: number, fromShore: number) => number);

/**
 * A river: the water that follows a line, with a width and a depth along it.
 *
 * @category api/water
 */
export interface RiverShape {
	/** The kind of water body. */
	kind: 'river';
	/**
	 * Points along the river's middle, from its source to its mouth, in meters: at least two. The
	 * water runs in the direction that the points give.
	 */
	middle: readonly WaterPoint[];
	/**
	 * The half width at each point of the middle line, in meters, from 0.01: one number for the
	 * whole river, or one for each point. The bed rises to the surface a third of the half width
	 * beyond the edge that it gives.
	 */
	halfWidth: number | readonly number[];
	/**
	 * The depth of the bed under the middle line, in meters. It is 1 by default.
	 */
	depth?: RiverDepth;
	/**
	 * How fast the current runs downstream, in meters a second. The ripples and the caustics drift
	 * with it. It is 0.35 by default, and 0 stills the water.
	 */
	speed?: number;
}

/**
 * A lake: the water that fills the area inside an outline.
 *
 * @category api/water
 */
export interface LakeShape {
	/** The kind of water body. */
	kind: 'lake';
	/** The shore's outline, as at least three points in order around the lake, in meters. */
	shore: readonly WaterPoint[];
	/**
	 * The depth of the bed, in meters below the surface: the deepest point, or a function of the
	 * point and its distance from the shore. It is 2 by default.
	 */
	depth?: LakeDepth;
	/**
	 * How far from the shore the bed reaches the depth of a lake that gives one number, in meters,
	 * from 0.01. It is 2 by default.
	 */
	shoreWidth?: number;
}

/**
 * The shape of one water body: a river or a lake.
 *
 * @category api/water
 */
export type WaterShape = RiverShape | LakeShape;

/**
 * A water body that a shape resolved to: its bounds, the depth of its bed at a point and the
 * current there. The add-on builds its surface from this, and a scene reads it to place what floats.
 *
 * @category api/water
 */
export interface WaterBody {
	/** The kind of water body that the shape describes. */
	readonly kind: 'river' | 'lake';
	/** The least x that the water reaches, in meters. */
	readonly minX: number;
	/** The greatest x that the water reaches, in meters. */
	readonly maxX: number;
	/** The least z that the water reaches, in meters. */
	readonly minZ: number;
	/** The greatest z that the water reaches, in meters. */
	readonly maxZ: number;
	/**
	 * The depth of the bed below the water's surface at a point, in meters, and 0 outside the
	 * water.
	 */
	depthAt(x: number, z: number): number;
	/** True when the point lies over the water, where its depth is above 0. */
	contains(x: number, z: number): boolean;
	/**
	 * The current at a point, as a direction and a speed in meters a second, written into `out`.
	 * It is zero for still water. A river carries its current along its middle line.
	 */
	currentAt(x: number, z: number, out: [x: number, z: number]): void;
}

/** The smallest width, depth or distance that a shape takes. */
const SMALL = 1e-4;

/** The share of the half width beyond the edge over which a river's bed rises to the surface. */
const RIVER_EDGE = 1.33;

/** The depth profile across a river: full in the middle, falling to nothing at its edge. */
function acrossDepth(across: number): number {
	return 1 - math.smoothstep(across, 0.72, 1.32);
}

/** An error of the water add-on's own. */
function error(message: string): Error {
	const error = new Error(`@null3d/water: ${message}`);
	error.name = 'WaterError';
	return error;
}

/** The number of a setting, or an error that names it. */
function numberSetting(value: unknown, what: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value))
		throw error(`the water ${what} must be a finite number`);
	return value;
}

/** The value of a per-point setting at one middle point. */
function atPoint(
	value: number | readonly number[],
	index: number,
	what: string,
	least: number,
): number {
	const number = numberSetting(typeof value === 'number' ? value : value[index], what);
	if (number < least)
		throw error(`the water ${what} must be ${least} or more, and it is ${number}`);
	return number;
}

/** One segment of a river's middle line, with the values at both of its ends. */
interface Segment {
	readonly ax: number;
	readonly az: number;
	readonly bx: number;
	readonly bz: number;
	/** Its length in meters. */
	readonly length: number;
	/** The direction of the current along it, as a unit vector. */
	readonly dx: number;
	readonly dz: number;
	/** The distance along the river at its first end, in meters. */
	readonly along: number;
	/** The half width at its first and second ends, in meters. */
	readonly halfA: number;
	readonly halfB: number;
	/** The depth at its first and second ends, in meters. */
	readonly depthA: number;
	readonly depthB: number;
}

/** What a nearest-segment search found, written in place so a query allocates nothing. */
interface Nearest {
	segment: Segment | undefined;
	/** The distance from the point to the segment, in meters. */
	distance: number;
	/** The place along the segment, from 0 at its first end to 1 at its second. */
	share: number;
}

/**
 * Finds the segment of a river's middle line nearest to a point, and how far the point lies from
 * it. It writes into `found`, so a frame allocates nothing.
 */
function nearestSegment(segments: readonly Segment[], x: number, z: number, found: Nearest): void {
	let best = Number.POSITIVE_INFINITY;
	found.segment = undefined;
	for (const segment of segments) {
		const px = x - segment.ax;
		const pz = z - segment.az;
		const along = math.clamp(px * segment.dx + pz * segment.dz, 0, segment.length);
		const qx = px - segment.dx * along;
		const qz = pz - segment.dz * along;
		const distance = Math.hypot(qx, qz);
		if (distance < best) {
			best = distance;
			found.segment = segment;
			found.distance = distance;
			found.share = along / segment.length;
		}
	}
}

/** Resolves a river shape into the body that the add-on draws. */
function riverBody(shape: RiverShape): WaterBody {
	const { middle } = shape;
	if (!Array.isArray(middle) || middle.length < 2)
		throw error('a river needs at least two points along its middle line');
	const speed = numberSetting(shape.speed ?? 0.35, 'current speed');
	if (speed < 0) throw error('the water current speed must be 0 or more');
	const count = middle.length;
	const xs = new Float64Array(count);
	const zs = new Float64Array(count);
	const along = new Float64Array(count);
	const halves = new Float64Array(count);
	const depths = new Float64Array(count);
	const depth = shape.depth;
	for (let i = 0; i < count; i++) {
		const [x, z] = middle[i] as WaterPoint;
		xs[i] = numberSetting(x, 'middle point x');
		zs[i] = numberSetting(z, 'middle point z');
		halves[i] = atPoint(shape.halfWidth, i, 'half width', SMALL);
	}
	for (let i = 0; i + 1 < count; i++) {
		const length = Math.hypot(
			(xs[i + 1] as number) - (xs[i] as number),
			(zs[i + 1] as number) - (zs[i] as number),
		);
		if (length < SMALL) throw error('two points of a river middle line must not be the same');
		along[i + 1] = (along[i] as number) + length;
	}
	for (let i = 0; i < count; i++) {
		const at =
			typeof depth === 'function'
				? numberSetting(depth(xs[i] as number, zs[i] as number, along[i] as number), 'depth')
				: Array.isArray(depth)
					? numberSetting(depth[i], 'depth')
					: numberSetting(depth ?? 1, 'depth');
		if (at < 0) throw error('the water depth must be 0 or more');
		depths[i] = at;
	}
	const segments: Segment[] = [];
	for (let i = 0; i + 1 < count; i++) {
		const ax = xs[i] as number;
		const az = zs[i] as number;
		const bx = xs[i + 1] as number;
		const bz = zs[i + 1] as number;
		const length = (along[i + 1] as number) - (along[i] as number);
		segments.push({
			ax,
			az,
			bx,
			bz,
			length,
			dx: (bx - ax) / length,
			dz: (bz - az) / length,
			along: along[i] as number,
			halfA: halves[i] as number,
			halfB: halves[i + 1] as number,
			depthA: depths[i] as number,
			depthB: depths[i + 1] as number,
		});
	}
	let minX = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let minZ = Number.POSITIVE_INFINITY;
	let maxZ = Number.NEGATIVE_INFINITY;
	for (let i = 0; i < count; i++) {
		const edge = (halves[i] as number) * RIVER_EDGE;
		minX = Math.min(minX, (xs[i] as number) - edge);
		maxX = Math.max(maxX, (xs[i] as number) + edge);
		minZ = Math.min(minZ, (zs[i] as number) - edge);
		maxZ = Math.max(maxZ, (zs[i] as number) + edge);
	}
	const found: Nearest = { segment: undefined, distance: 0, share: 0 };
	return {
		kind: 'river',
		minX,
		maxX,
		minZ,
		maxZ,
		depthAt(x, z) {
			nearestSegment(segments, x, z, found);
			const segment = found.segment;
			if (!segment) return 0;
			const half = segment.halfA + (segment.halfB - segment.halfA) * found.share;
			const across = found.distance / half;
			if (across >= 1.32) return 0;
			const deep = segment.depthA + (segment.depthB - segment.depthA) * found.share;
			return deep * acrossDepth(across);
		},
		contains(x, z) {
			nearestSegment(segments, x, z, found);
			const segment = found.segment;
			if (!segment) return false;
			const half = segment.halfA + (segment.halfB - segment.halfA) * found.share;
			return found.distance < half * 1.32;
		},
		currentAt(x, z, out) {
			nearestSegment(segments, x, z, found);
			const segment = found.segment;
			if (!segment || speed === 0) {
				out[0] = 0;
				out[1] = 0;
				return;
			}
			out[0] = segment.dx * speed;
			out[1] = segment.dz * speed;
		},
	};
}

/** The distance from a point to the nearest edge of an outline. */
export function fromShore(shore: readonly WaterPoint[], x: number, z: number): number {
	let best = Number.POSITIVE_INFINITY;
	for (let i = 0; i < shore.length; i++) {
		const [ax, az] = shore[i] as WaterPoint;
		const [bx, bz] = shore[(i + 1) % shore.length] as WaterPoint;
		const dx = bx - ax;
		const dz = bz - az;
		const length = Math.hypot(dx, dz);
		if (length < SMALL) continue;
		const share = math.clamp(((x - ax) * dx + (z - az) * dz) / (length * length), 0, 1);
		best = Math.min(best, Math.hypot(x - (ax + dx * share), z - (az + dz * share)));
	}
	return best;
}

/** True when a point lies inside an outline, by the even-odd rule. */
function insideOutline(shore: readonly WaterPoint[], x: number, z: number): boolean {
	let inside = false;
	for (let i = 0, j = shore.length - 1; i < shore.length; j = i++) {
		const [xi, zi] = shore[i] as WaterPoint;
		const [xj, zj] = shore[j] as WaterPoint;
		if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
	}
	return inside;
}

/** Resolves a lake shape into the body that the add-on draws. */
function lakeBody(shape: LakeShape): WaterBody {
	const { shore } = shape;
	if (!Array.isArray(shore) || shore.length < 3)
		throw error('a lake needs at least three points around its shore');
	const points: WaterPoint[] = [];
	let minX = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let minZ = Number.POSITIVE_INFINITY;
	let maxZ = Number.NEGATIVE_INFINITY;
	for (const [x, z] of shore) {
		const px = numberSetting(x, 'shore point x');
		const pz = numberSetting(z, 'shore point z');
		points.push([px, pz]);
		minX = Math.min(minX, px);
		maxX = Math.max(maxX, px);
		minZ = Math.min(minZ, pz);
		maxZ = Math.max(maxZ, pz);
	}
	// A shore with no area would make a lake that holds no water.
	let area = 0;
	for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
		const [xi, zi] = points[i] as WaterPoint;
		const [xj, zj] = points[j] as WaterPoint;
		area += xj * zi - xi * zj;
	}
	if (Math.abs(area) < SMALL) throw error('the points around a lake shore must enclose an area');
	const depth = shape.depth ?? 2;
	const shoreWidth = numberSetting(shape.shoreWidth ?? 2, 'shore width');
	if (shoreWidth < SMALL) throw error('the water shore width must be above 0');
	if (typeof depth === 'number' && depth < 0) throw error('the water depth must be 0 or more');
	return {
		kind: 'lake',
		minX,
		maxX,
		minZ,
		maxZ,
		depthAt(x, z) {
			if (!insideOutline(points, x, z)) return 0;
			const from = fromShore(points, x, z);
			if (typeof depth === 'function') {
				const at = numberSetting(depth(x, z, from), 'depth');
				return at < 0 ? 0 : at;
			}
			return depth * math.smoothstep(from, 0, shoreWidth);
		},
		contains(x, z) {
			return insideOutline(points, x, z);
		},
		currentAt(_x, _z, out) {
			out[0] = 0;
			out[1] = 0;
		},
	};
}

/**
 * Resolves a shape into the water body that the add-on draws: its bounds, the depth of its bed at a
 * point, and the current there.
 *
 * @category api/water
 */
export function waterBody(shape: WaterShape): WaterBody {
	if (shape?.kind === 'river') return riverBody(shape);
	if (shape?.kind === 'lake') return lakeBody(shape);
	throw error('a shape must be a river or a lake');
}
