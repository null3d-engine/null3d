// Frames along a branch: a dense curve through the axis's points, its arc length, and a frame at
// each sample carried by parallel transport (the double-reflection method of Wang, Jüttler, Zheng
// and Liu 2008), so a tube never twists about its own axis. The curve is a centripetal Catmull-Rom
// spline through the skeleton's nodes: it rounds each node's kink a little without overshooting,
// so an oak's crooked limb keeps its crooks and loses only the facets of a polyline.
import { acos, tan } from '../core/math';

/** Samples of the curve between two of the axis's points. */
const SAMPLES_PER_SPAN = 6;

/**
 * A dense curve along one axis, with a parallel-transport frame and the pipe radius at each sample.
 * Arrays hold 3 numbers a sample for vectors and 1 for scalars.
 */
export interface AxisPath {
	/** Samples on the curve. */
	readonly count: number;
	/** Sample positions in plant space. */
	readonly position: Float64Array;
	/** Unit tangent. */
	readonly tangent: Float64Array;
	/** Unit normal of the frame; the ring's angle 0 points along it. */
	readonly normal: Float64Array;
	/** Unit binormal, tangent × normal, so normal × binormal is the tangent. */
	readonly binormal: Float64Array;
	/** Pipe radius in metres. */
	readonly radius: Float64Array;
	/** Arc length from the first sample, in metres. */
	readonly arc: Float64Array;
	/** The arc length of the whole curve. */
	readonly length: number;
	/** The arc length at each of the axis's points, where its radius and its direction may kink. */
	readonly knots: Float64Array;
}

/** Where an arc length falls on a path: the sample before it and the share to the next. */
export interface PathPlace {
	index: number;
	t: number;
}

/**
 * Finds the samples around an arc length.
 *
 * @param path The path.
 * @param s The arc length, clamped to the path.
 * @param out The place to write.
 * @returns `out`.
 */
export function placeOnPath(path: AxisPath, s: number, out: PathPlace): PathPlace {
	const arc = path.arc;
	const last = path.count - 1;
	if (last <= 0 || s <= 0) {
		out.index = 0;
		out.t = 0;
		return out;
	}
	if (s >= path.length) {
		out.index = Math.max(0, last - 1);
		out.t = last > 0 ? 1 : 0;
		return out;
	}
	let low = 0;
	let high = last;
	while (high - low > 1) {
		const middle = (low + high) >> 1;
		if ((arc[middle] as number) <= s) low = middle;
		else high = middle;
	}
	const span = (arc[high] as number) - (arc[low] as number);
	out.index = low;
	out.t = span > 0 ? (s - (arc[low] as number)) / span : 0;
	return out;
}

/** A point on a centripetal Catmull-Rom segment from p1 to p2, by the Barry-Goldman pyramid. */
function catmullRom(
	p: Float64Array,
	i0: number,
	i1: number,
	i2: number,
	i3: number,
	u: number,
	out: Float64Array,
	at: number,
): void {
	const knot = (a: number, b: number) => {
		const dx = (p[b * 3] as number) - (p[a * 3] as number);
		const dy = (p[b * 3 + 1] as number) - (p[a * 3 + 1] as number);
		const dz = (p[b * 3 + 2] as number) - (p[a * 3 + 2] as number);
		return Math.max(Math.sqrt(Math.sqrt(dx * dx + dy * dy + dz * dz)), 1e-6);
	};
	const t0 = 0;
	const t1 = t0 + knot(i0, i1);
	const t2 = t1 + knot(i1, i2);
	const t3 = t2 + knot(i2, i3);
	const t = t1 + u * (t2 - t1);
	for (let k = 0; k < 3; k++) {
		const a0 = p[i0 * 3 + k] as number;
		const a1 = p[i1 * 3 + k] as number;
		const a2 = p[i2 * 3 + k] as number;
		const a3 = p[i3 * 3 + k] as number;
		const b1 = ((t1 - t) * a0 + (t - t0) * a1) / (t1 - t0);
		const b2 = ((t2 - t) * a1 + (t - t1) * a2) / (t2 - t1);
		const b3 = ((t3 - t) * a2 + (t - t2) * a3) / (t3 - t2);
		const c1 = ((t2 - t) * b1 + (t - t0) * b2) / (t2 - t0);
		const c2 = ((t3 - t) * b2 + (t - t1) * b3) / (t3 - t1);
		out[at + k] = ((t2 - t) * c1 + (t - t1) * c2) / (t2 - t1);
	}
}

/** The radius of the bend that rounds a kink in a wood's axis, in the wood's radii there. */
export const KINK_BEND = 6;
/** Radians of a kink below which a point stands as it is. */
const LEAST_KINK = 0.05;
/** The share of each internode beside a kink that the kink's rounding may take. */
const KINK_REACH = 0.45;
/** Metres of rounding below which a kink stands as it is: a twig keeps its sharp crook. */
const LEAST_ROUNDING = 0.002;
/** Radians the rounding of a kink turns between two of its points. */
const KINK_STEP = 0.2;

/**
 * The points of an axis with each kink rounded over a bend whose radius is a number of the wood's
 * radii there, so thick wood bends as an elbow and never folds on its inner side, while a twig
 * keeps its sharp crook. A kink's bend takes at most a share of the internodes beside it, so the
 * axis passes near each of its points; the first and last points stay where they are.
 *
 * @param points 3 numbers a point, base first.
 * @param radii The pipe radius at each point.
 * @param count The points.
 * @param bend The bend's radius in the wood's radii.
 * @returns The rounded points, their radii and their count.
 */
export function roundKinks(
	points: Float64Array,
	radii: Float64Array,
	count: number,
	bend: number,
): { points: Float64Array; radii: Float64Array; count: number } {
	if (count < 3) return { points, radii, count };
	const out: number[] = [points[0] as number, points[1] as number, points[2] as number];
	const outRadii: number[] = [radii[0] as number];
	const into = [0, 0, 0];
	const onto = [0, 0, 0];
	for (let i = 1; i < count - 1; i++) {
		let before = 0;
		let after = 0;
		for (let k = 0; k < 3; k++) {
			into[k] = (points[i * 3 + k] as number) - (points[(i - 1) * 3 + k] as number);
			onto[k] = (points[(i + 1) * 3 + k] as number) - (points[i * 3 + k] as number);
			before += (into[k] as number) ** 2;
			after += (onto[k] as number) ** 2;
		}
		before = Math.sqrt(before);
		after = Math.sqrt(after);
		const r = radii[i] as number;
		let cosine = 0;
		if (before > 0 && after > 0)
			for (let k = 0; k < 3; k++)
				cosine += ((into[k] as number) * (onto[k] as number)) / (before * after);
		const kink = acos(Math.min(1, Math.max(-1, cosine)));
		const reach = Math.min(bend * r * tan(kink / 2), KINK_REACH * before, KINK_REACH * after);
		if (kink < LEAST_KINK || !(reach >= LEAST_ROUNDING)) {
			for (let k = 0; k < 3; k++) out.push(points[i * 3 + k] as number);
			outRadii.push(r);
			continue;
		}
		// The bend runs on a quadratic curve from a point on the internode before to one on the
		// internode after, with the kink's point as its control: tangent to both internodes.
		const steps = Math.max(2, Math.ceil(kink / KINK_STEP));
		const rA = r + ((radii[i - 1] as number) - r) * (reach / before);
		const rB = r + ((radii[i + 1] as number) - r) * (reach / after);
		for (let j = 0; j <= steps; j++) {
			const t = j / steps;
			for (let k = 0; k < 3; k++) {
				const p = points[i * 3 + k] as number;
				const a = p - ((into[k] as number) / before) * reach;
				const b = p + ((onto[k] as number) / after) * reach;
				out.push((1 - t) * (1 - t) * a + 2 * t * (1 - t) * p + t * t * b);
			}
			outRadii.push(rA + (rB - rA) * t);
		}
	}
	for (let k = 0; k < 3; k++) out.push(points[(count - 1) * 3 + k] as number);
	outRadii.push(radii[count - 1] as number);
	return {
		points: new Float64Array(out),
		radii: new Float64Array(outRadii),
		count: outRadii.length,
	};
}

/**
 * The dense path through an axis's points, with frames by parallel transport.
 *
 * @param points 3 numbers a point, base first; at least two points.
 * @param radii The pipe radius at each point.
 * @param count The points.
 * @param normal0 A direction for the first frame's normal; it is made square to the first tangent.
 * @returns The path.
 */
export function axisPath(
	points: Float64Array,
	radii: Float64Array,
	count: number,
	normal0: readonly [number, number, number],
): AxisPath {
	const spans = count - 1;
	const samples = spans * SAMPLES_PER_SPAN + 1;
	const position = new Float64Array(samples * 3);
	const radius = new Float64Array(samples);
	// Phantom end points mirror the second and second-last points, so the ends keep their direction.
	const padded = new Float64Array((count + 2) * 3);
	padded.set(points.subarray(0, count * 3), 3);
	for (let k = 0; k < 3; k++) {
		padded[k] = 2 * (points[k] as number) - (points[3 + k] as number);
		padded[(count + 1) * 3 + k] =
			2 * (points[(count - 1) * 3 + k] as number) - (points[(count - 2) * 3 + k] as number);
	}
	let n = 0;
	for (let i = 0; i < spans; i++) {
		const r0 = radii[i] as number;
		const r1 = radii[i + 1] as number;
		for (let j = 0; j < SAMPLES_PER_SPAN; j++) {
			const u = j / SAMPLES_PER_SPAN;
			catmullRom(padded, i, i + 1, i + 2, i + 3, u, position, n * 3);
			radius[n] = r0 + (r1 - r0) * u;
			n++;
		}
	}
	for (let k = 0; k < 3; k++) position[n * 3 + k] = points[spans * 3 + k] as number;
	radius[n] = radii[spans] as number;
	n++;
	const path = framedPath(position, radius, n, normal0);
	const knots = new Float64Array(count);
	for (let i = 0; i < count; i++) knots[i] = path.arc[i * SAMPLES_PER_SPAN] as number;
	return { ...path, knots };
}

/**
 * Frames, tangents and arc lengths for a dense list of samples.
 *
 * @param position 3 numbers a sample.
 * @param radius The radius at each sample.
 * @param count The samples, at least two.
 * @param normal0 A direction for the first frame's normal.
 * @returns The path.
 */
export function framedPath(
	position: Float64Array,
	radius: Float64Array,
	count: number,
	normal0: readonly [number, number, number],
): AxisPath {
	const tangent = new Float64Array(count * 3);
	const normal = new Float64Array(count * 3);
	const binormal = new Float64Array(count * 3);
	const arc = new Float64Array(count);
	for (let i = 0; i < count; i++) {
		const a = Math.max(0, i - 1);
		const b = Math.min(count - 1, i + 1);
		let tx = (position[b * 3] as number) - (position[a * 3] as number);
		let ty = (position[b * 3 + 1] as number) - (position[a * 3 + 1] as number);
		let tz = (position[b * 3 + 2] as number) - (position[a * 3 + 2] as number);
		const length = Math.sqrt(tx * tx + ty * ty + tz * tz);
		if (length > 0) {
			tx /= length;
			ty /= length;
			tz /= length;
		} else if (i > 0) {
			tx = tangent[(i - 1) * 3] as number;
			ty = tangent[(i - 1) * 3 + 1] as number;
			tz = tangent[(i - 1) * 3 + 2] as number;
		} else {
			ty = 1;
		}
		tangent[i * 3] = tx;
		tangent[i * 3 + 1] = ty;
		tangent[i * 3 + 2] = tz;
		if (i > 0) {
			const dx = (position[i * 3] as number) - (position[(i - 1) * 3] as number);
			const dy = (position[i * 3 + 1] as number) - (position[(i - 1) * 3 + 1] as number);
			const dz = (position[i * 3 + 2] as number) - (position[(i - 1) * 3 + 2] as number);
			arc[i] = (arc[i - 1] as number) + Math.sqrt(dx * dx + dy * dy + dz * dz);
		}
	}
	// The first normal: the given direction made square to the tangent, or any square direction.
	let nx = normal0[0];
	let ny = normal0[1];
	let nz = normal0[2];
	const t0x = tangent[0] as number;
	const t0y = tangent[1] as number;
	const t0z = tangent[2] as number;
	let dot = nx * t0x + ny * t0y + nz * t0z;
	nx -= dot * t0x;
	ny -= dot * t0y;
	nz -= dot * t0z;
	let nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
	if (nl < 1e-6) {
		const pick = Math.abs(t0x) < 0.9 ? [1, 0, 0] : [0, 0, 1];
		dot = (pick[0] as number) * t0x + (pick[1] as number) * t0y + (pick[2] as number) * t0z;
		nx = (pick[0] as number) - dot * t0x;
		ny = (pick[1] as number) - dot * t0y;
		nz = (pick[2] as number) - dot * t0z;
		nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
	}
	normal[0] = nx / nl;
	normal[1] = ny / nl;
	normal[2] = nz / nl;
	// Double reflection: reflect the frame across the bisector of each step, then across the
	// plane that takes the reflected tangent onto the next tangent.
	for (let i = 0; i < count - 1; i++) {
		const v1x = (position[(i + 1) * 3] as number) - (position[i * 3] as number);
		const v1y = (position[(i + 1) * 3 + 1] as number) - (position[i * 3 + 1] as number);
		const v1z = (position[(i + 1) * 3 + 2] as number) - (position[i * 3 + 2] as number);
		const c1 = v1x * v1x + v1y * v1y + v1z * v1z;
		const rx = normal[i * 3] as number;
		const ry = normal[i * 3 + 1] as number;
		const rz = normal[i * 3 + 2] as number;
		const tx = tangent[i * 3] as number;
		const ty = tangent[i * 3 + 1] as number;
		const tz = tangent[i * 3 + 2] as number;
		let rLx = rx;
		let rLy = ry;
		let rLz = rz;
		let tLx = tx;
		let tLy = ty;
		let tLz = tz;
		if (c1 > 1e-18) {
			const fr = (2 / c1) * (v1x * rx + v1y * ry + v1z * rz);
			rLx = rx - fr * v1x;
			rLy = ry - fr * v1y;
			rLz = rz - fr * v1z;
			const ft = (2 / c1) * (v1x * tx + v1y * ty + v1z * tz);
			tLx = tx - ft * v1x;
			tLy = ty - ft * v1y;
			tLz = tz - ft * v1z;
		}
		const nxt = tangent[(i + 1) * 3] as number;
		const nyt = tangent[(i + 1) * 3 + 1] as number;
		const nzt = tangent[(i + 1) * 3 + 2] as number;
		const v2x = nxt - tLx;
		const v2y = nyt - tLy;
		const v2z = nzt - tLz;
		const c2 = v2x * v2x + v2y * v2y + v2z * v2z;
		let ox = rLx;
		let oy = rLy;
		let oz = rLz;
		if (c2 > 1e-18) {
			const f = (2 / c2) * (v2x * rLx + v2y * rLy + v2z * rLz);
			ox -= f * v2x;
			oy -= f * v2y;
			oz -= f * v2z;
		}
		// Keep the normal square to the tangent and of unit length against rounding.
		const d = ox * nxt + oy * nyt + oz * nzt;
		ox -= d * nxt;
		oy -= d * nyt;
		oz -= d * nzt;
		const l = Math.sqrt(ox * ox + oy * oy + oz * oz) || 1;
		normal[(i + 1) * 3] = ox / l;
		normal[(i + 1) * 3 + 1] = oy / l;
		normal[(i + 1) * 3 + 2] = oz / l;
	}
	for (let i = 0; i < count; i++) {
		const tx = tangent[i * 3] as number;
		const ty = tangent[i * 3 + 1] as number;
		const tz = tangent[i * 3 + 2] as number;
		const nx2 = normal[i * 3] as number;
		const ny2 = normal[i * 3 + 1] as number;
		const nz2 = normal[i * 3 + 2] as number;
		binormal[i * 3] = ty * nz2 - tz * ny2;
		binormal[i * 3 + 1] = tz * nx2 - tx * nz2;
		binormal[i * 3 + 2] = tx * ny2 - ty * nx2;
	}
	return {
		count,
		position,
		tangent,
		normal,
		binormal,
		radius,
		arc,
		length: arc[count - 1] as number,
		knots: new Float64Array(0),
	};
}

/** A frame at an arc length: position, tangent, normal and binormal, interpolated between samples. */
export interface PathFrame {
	readonly position: Float64Array;
	readonly tangent: Float64Array;
	readonly normal: Float64Array;
	readonly binormal: Float64Array;
	radius: number;
}

/** A frame to fill, with its own small arrays. */
export function emptyFrame(): PathFrame {
	return {
		position: new Float64Array(3),
		tangent: new Float64Array(3),
		normal: new Float64Array(3),
		binormal: new Float64Array(3),
		radius: 0,
	};
}

const place: PathPlace = { index: 0, t: 0 };

/** Writes the unit-length mix of two samples' vectors into `out`. */
function mixUnit(from: Float64Array, i: number, j: number, t: number, out: Float64Array): void {
	const x = (from[i * 3] as number) * (1 - t) + (from[j * 3] as number) * t;
	const y = (from[i * 3 + 1] as number) * (1 - t) + (from[j * 3 + 1] as number) * t;
	const z = (from[i * 3 + 2] as number) * (1 - t) + (from[j * 3 + 2] as number) * t;
	const l = Math.sqrt(x * x + y * y + z * z) || 1;
	out[0] = x / l;
	out[1] = y / l;
	out[2] = z / l;
}

/**
 * The frame at an arc length. Past either end the path runs on straight along its end tangent.
 *
 * @param path The path.
 * @param s The arc length; it may lie before 0 or past the end.
 * @param out The frame to write.
 * @returns `out`.
 */
export function frameAt(path: AxisPath, s: number, out: PathFrame): PathFrame {
	placeOnPath(path, s, place);
	const i = place.index;
	const j = Math.min(path.count - 1, i + 1);
	const t = place.t;
	const p = path.position;
	const position = out.position;
	position[0] = (p[i * 3] as number) * (1 - t) + (p[j * 3] as number) * t;
	position[1] = (p[i * 3 + 1] as number) * (1 - t) + (p[j * 3 + 1] as number) * t;
	position[2] = (p[i * 3 + 2] as number) * (1 - t) + (p[j * 3 + 2] as number) * t;
	const tg = out.tangent;
	const nm = out.normal;
	mixUnit(path.tangent, i, j, t, tg);
	mixUnit(path.normal, i, j, t, nm);
	// Square the normal to the tangent again, then the binormal from both.
	const tx = tg[0] as number;
	const ty = tg[1] as number;
	const tz = tg[2] as number;
	let nx = nm[0] as number;
	let ny = nm[1] as number;
	let nz = nm[2] as number;
	const d = nx * tx + ny * ty + nz * tz;
	nx -= d * tx;
	ny -= d * ty;
	nz -= d * tz;
	const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
	nx /= l;
	ny /= l;
	nz /= l;
	nm[0] = nx;
	nm[1] = ny;
	nm[2] = nz;
	const b = out.binormal;
	b[0] = ty * nz - tz * ny;
	b[1] = tz * nx - tx * nz;
	b[2] = tx * ny - ty * nx;
	out.radius = (path.radius[i] as number) * (1 - t) + (path.radius[j] as number) * t;
	// Run on straight past the ends.
	const beyond = s < 0 ? s : s > path.length ? s - path.length : 0;
	if (beyond !== 0) {
		position[0] = (position[0] as number) + beyond * tx;
		position[1] = (position[1] as number) + beyond * ty;
		position[2] = (position[2] as number) + beyond * tz;
	}
	return out;
}

/** The pipe radius and the height of the curve at an arc length. */
export interface PathSample {
	radius: number;
	height: number;
}

/**
 * The pipe radius and the height at an arc length, without the frame. Past either end the radius
 * holds and the height runs on along the end tangent.
 *
 * @param path The path.
 * @param s The arc length.
 * @param out The sample to write.
 * @returns `out`.
 */
export function sampleAt(path: AxisPath, s: number, out: PathSample): PathSample {
	placeOnPath(path, s, place);
	const i = place.index;
	const j = Math.min(path.count - 1, i + 1);
	const t = place.t;
	out.radius = (path.radius[i] as number) * (1 - t) + (path.radius[j] as number) * t;
	let height =
		(path.position[i * 3 + 1] as number) * (1 - t) + (path.position[j * 3 + 1] as number) * t;
	if (s < 0) height += s * (path.tangent[1] as number);
	else if (s > path.length)
		height += (s - path.length) * (path.tangent[(path.count - 1) * 3 + 1] as number);
	out.height = height;
	return out;
}

/** The arc length on a path nearest a point. */
export function nearestArc(path: AxisPath, x: number, y: number, z: number): number {
	let best = 0;
	let bestDistance = Number.POSITIVE_INFINITY;
	const q = path.position;
	for (let i = 0; i < path.count - 1; i++) {
		const ax = q[i * 3] as number;
		const ay = q[i * 3 + 1] as number;
		const az = q[i * 3 + 2] as number;
		const bx = (q[(i + 1) * 3] as number) - ax;
		const by = (q[(i + 1) * 3 + 1] as number) - ay;
		const bz = (q[(i + 1) * 3 + 2] as number) - az;
		const l2 = bx * bx + by * by + bz * bz;
		const t =
			l2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * bx + (y - ay) * by + (z - az) * bz) / l2)) : 0;
		const d = (x - ax - t * bx) ** 2 + (y - ay - t * by) ** 2 + (z - az - t * bz) ** 2;
		if (d < bestDistance) {
			bestDistance = d;
			best = (path.arc[i] as number) + t * ((path.arc[i + 1] as number) - (path.arc[i] as number));
		}
	}
	return best;
}
