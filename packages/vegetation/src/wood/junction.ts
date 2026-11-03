// Junctions, after design §7.3: a child starts on its parent's surface, never inside it. Each line
// of the child's tube (one per side) runs back from the child until it meets the parent's surface,
// so the child's first ring is the curve where the two tubes cross: an ellipse on a straight limb,
// a saddle in a crotch. Blend rings then run from that curve to the child's own circle, with normals
// that turn from the parent's to the child's, so the joint shades as one surface. The collar swells
// the child near the joint, drawn here and not piped, and a mask in `uv1.y` marks the crotch for the
// bark's ridge. A fork is the same weld onto the rounded end of the parent.
//
// The parent's surface is read from the rings the mesher built for it: between two rings, a point's
// distance from the surface is its distance from the centre line less the radius of the rings'
// polygons at its angle, both interpolated by where the point lies between the two ring planes. So
// a child's first ring lies on the parent's facets, not on a smooth cylinder they only approach.
import { atan2, PI } from '../core/math';
import { type AxisRings, ringTrig, stitch } from './tube';

/** What a query of the parent's surface found, besides the distance. */
export interface SurfacePlace {
	/** The ring before the point, and the share of the way to the next. */
	ring: number;
	t: number;
	/** The point's angle about the ring before, from its normal toward its binormal. */
	angle: number;
	/** The bark's `v` at the point. */
	v: number;
}

/** Where a line crosses the parent's triangles: the share along the line, `v` and the normal there. */
export interface SurfaceHit {
	/** Share along the segment from its start, 0 to 1. */
	share: number;
	/** The bark's `v`, from the triangle's corners. */
	v: number;
	/** The parent's shading normal there, from the triangle's corners. */
	readonly normal: Float64Array;
}

/**
 * The nearest point of a triangle to a point, and its barycentric weights.
 *
 * @param p The point.
 * @param a The triangle's first corner.
 * @param b Its second.
 * @param c Its third.
 * @returns The distance and the weights of the corners.
 */
export function nearestOnTriangle(
	p: readonly number[],
	a: readonly number[],
	b: readonly number[],
	c: readonly number[],
): { distance: number; wa: number; wb: number; wc: number } {
	// Ericson, Real-Time Collision Detection, 5.1.5.
	const sub = (x: readonly number[], y: readonly number[]) => [
		(x[0] as number) - (y[0] as number),
		(x[1] as number) - (y[1] as number),
		(x[2] as number) - (y[2] as number),
	];
	const dot = (x: readonly number[], y: readonly number[]) =>
		(x[0] as number) * (y[0] as number) +
		(x[1] as number) * (y[1] as number) +
		(x[2] as number) * (y[2] as number);
	const ab = sub(b, a);
	const ac = sub(c, a);
	const ap = sub(p, a);
	const d1 = dot(ab, ap);
	const d2 = dot(ac, ap);
	let wa = 1;
	let wb = 0;
	let wc = 0;
	const bp = sub(p, b);
	const d3 = dot(ab, bp);
	const d4 = dot(ac, bp);
	const cp = sub(p, c);
	const d5 = dot(ab, cp);
	const d6 = dot(ac, cp);
	const vc = d1 * d4 - d3 * d2;
	const vb = d5 * d2 - d1 * d6;
	const va = d3 * d6 - d5 * d4;
	if (d1 <= 0 && d2 <= 0) [wa, wb, wc] = [1, 0, 0];
	else if (d3 >= 0 && d4 <= d3) [wa, wb, wc] = [0, 1, 0];
	else if (vc <= 0 && d1 >= 0 && d3 <= 0) {
		const v = d1 / (d1 - d3);
		[wa, wb, wc] = [1 - v, v, 0];
	} else if (d6 >= 0 && d5 <= d6) [wa, wb, wc] = [0, 0, 1];
	else if (vb <= 0 && d2 >= 0 && d6 <= 0) {
		const w = d2 / (d2 - d6);
		[wa, wb, wc] = [1 - w, 0, w];
	} else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
		const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
		[wa, wb, wc] = [0, 1 - w, w];
	} else {
		const denom = 1 / (va + vb + vc);
		wb = vb * denom;
		wc = vc * denom;
		wa = 1 - wb - wc;
	}
	const q = [0, 1, 2].map(
		(k) => wa * (a[k] as number) + wb * (b[k] as number) + wc * (c[k] as number),
	);
	const d = sub(p, q);
	return { distance: Math.sqrt(dot(d, d)), wa, wb, wc };
}

/**
 * The polygon radius of a ring at an angle: where a ray at that angle, of unit direction (dx, dy) in
 * the ring's plane, crosses the ring's edge.
 */
function polygonRadius(
	rings: AxisRings,
	ring: number,
	theta: number,
	dx: number,
	dy: number,
): number {
	const sides = rings.sides[ring] as number;
	const first = rings.first[ring] as number;
	const step = (2 * PI) / sides;
	let angle = theta % (2 * PI);
	if (angle < 0) angle += 2 * PI;
	if (angle >= 2 * PI) angle = 0;
	const j = Math.min(sides - 1, Math.floor(angle / step));
	const k = (j + 1) % sides;
	const r0 = rings.rho[first + j] as number;
	const r1 = rings.rho[first + k] as number;
	if (r0 <= 0 && r1 <= 0) return 0;
	// Vertices in the ring's plane, and the ray's crossing of the edge between them.
	const trig = ringTrig(sides);
	const x0 = r0 * (trig[j * 2] as number);
	const y0 = r0 * (trig[j * 2 + 1] as number);
	const x1 = r1 * (trig[(j + 1) * 2] as number);
	const y1 = r1 * (trig[(j + 1) * 2 + 1] as number);
	const ex = x1 - x0;
	const ey = y1 - y0;
	const den = dx * ey - dy * ex;
	if (Math.abs(den) < 1e-12) return Math.max(r0, r1);
	return (x0 * ey - y0 * ex) / den;
}

/**
 * The surface of one built axis, which its children weld onto.
 */
export class ParentSurface {
	private readonly rings: AxisRings;
	/** The rings a query looks between, set per child. */
	private from = 0;
	private to = 0;
	/** The stitched triangles of each strip, made when a weld first reads them. */
	private readonly strips = new Map<number, Int32Array>();

	/**
	 * @param rings The parent's rings, with its rounded end.
	 */
	constructor(rings: AxisRings) {
		this.rings = rings;
		this.to = rings.count - 1;
	}

	/**
	 * Narrows the queries to the rings within an arc range, so a child's weld reads only the stretch
	 * of the parent near it.
	 *
	 * @param low The lowest arc length on the parent.
	 * @param high The highest.
	 */
	window(low: number, high: number): void {
		const arc = this.rings.arc;
		const count = this.rings.count;
		let from = 0;
		while (from < count - 1 && (arc[from + 1] as number) < low) from++;
		let to = count - 1;
		while (to > from + 1 && (arc[to - 1] as number) > high) to--;
		this.from = from;
		this.to = to;
	}

	/**
	 * The signed distance of a point from the parent's surface: below zero inside.
	 *
	 * @param x The point's x.
	 * @param y The point's y.
	 * @param z The point's z.
	 * @param place Filled with the rings around the point and the bark's `v` there.
	 * @returns The distance in metres.
	 */
	distance(x: number, y: number, z: number, place?: SurfacePlace): number {
		const r = this.rings;
		const c = r.centre;
		const tg = r.tangent;
		let best = -1;
		let bestT = 0;
		let bestScore = Number.POSITIVE_INFINITY;
		for (let k = this.from; k < this.to; k++) {
			const ax = x - (c[k * 3] as number);
			const ay = y - (c[k * 3 + 1] as number);
			const az = z - (c[k * 3 + 2] as number);
			const a =
				ax * (tg[k * 3] as number) +
				ay * (tg[k * 3 + 1] as number) +
				az * (tg[k * 3 + 2] as number);
			const k1 = k + 1;
			const bx = x - (c[k1 * 3] as number);
			const by = y - (c[k1 * 3 + 1] as number);
			const bz = z - (c[k1 * 3 + 2] as number);
			const b =
				bx * (tg[k1 * 3] as number) +
				by * (tg[k1 * 3 + 1] as number) +
				bz * (tg[k1 * 3 + 2] as number);
			// Between the two ring planes the score is the distance from the centre line; outside
			// them it grows with how far outside, so the nearest slab wins.
			let t: number;
			let outside = 0;
			if (a >= 0 && b <= 0) t = a - b > 1e-12 ? a / (a - b) : 0;
			else if (a < 0) {
				t = 0;
				outside = -a;
			} else {
				t = 1;
				outside = b;
			}
			const qx = (c[k * 3] as number) * (1 - t) + (c[k1 * 3] as number) * t;
			const qy = (c[k * 3 + 1] as number) * (1 - t) + (c[k1 * 3 + 1] as number) * t;
			const qz = (c[k * 3 + 2] as number) * (1 - t) + (c[k1 * 3 + 2] as number) * t;
			const d = Math.sqrt((x - qx) ** 2 + (y - qy) ** 2 + (z - qz) ** 2);
			const score = d + 4 * outside;
			if (score < bestScore) {
				bestScore = score;
				best = k;
				bestT = t;
			}
		}
		if (best < 0) return Number.POSITIVE_INFINITY;
		const k = best;
		const k1 = k + 1;
		const t = bestT;
		// The point's distance from the straight line between the two ring centres, and its angle
		// in each ring's frame.
		const qx = (c[k * 3] as number) * (1 - t) + (c[k1 * 3] as number) * t;
		const qy = (c[k * 3 + 1] as number) * (1 - t) + (c[k1 * 3 + 1] as number) * t;
		const qz = (c[k * 3 + 2] as number) * (1 - t) + (c[k1 * 3 + 2] as number) * t;
		let dx = (c[k1 * 3] as number) - (c[k * 3] as number);
		let dy = (c[k1 * 3 + 1] as number) - (c[k * 3 + 1] as number);
		let dz = (c[k1 * 3 + 2] as number) - (c[k * 3 + 2] as number);
		const dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
		if (dl > 1e-12) {
			dx /= dl;
			dy /= dl;
			dz /= dl;
		} else {
			dx = tg[k * 3] as number;
			dy = tg[k * 3 + 1] as number;
			dz = tg[k * 3 + 2] as number;
		}
		const ox = x - qx;
		const oy = y - qy;
		const oz = z - qz;
		const along = ox * dx + oy * dy + oz * dz;
		const rx = ox - along * dx;
		const ry = oy - along * dy;
		const rz = oz - along * dz;
		const distance = Math.sqrt(rx * rx + ry * ry + rz * rz);
		const radiusIn = (ring: number): number => {
			const py =
				rx * (r.binormal[ring * 3] as number) +
				ry * (r.binormal[ring * 3 + 1] as number) +
				rz * (r.binormal[ring * 3 + 2] as number);
			const px =
				rx * (r.normal[ring * 3] as number) +
				ry * (r.normal[ring * 3 + 1] as number) +
				rz * (r.normal[ring * 3 + 2] as number);
			const l = Math.sqrt(px * px + py * py);
			if (ring === k) angle = atan2(py, px);
			const theta = ring === k ? angle : atan2(py, px);
			return l > 0 ? polygonRadius(r, ring, theta, px / l, py / l) : 0;
		};
		let angle = 0;
		const surface = radiusIn(k) * (1 - t) + radiusIn(k1) * t;
		let signed = distance - surface;
		// Past the rounded end of the parent the point is outside by at least its distance beyond
		// the end plane.
		const end = r.count - 1;
		if (this.to === end) {
			const ex = x - (c[end * 3] as number);
			const ey = y - (c[end * 3 + 1] as number);
			const ez = z - (c[end * 3 + 2] as number);
			const beyond =
				ex * (tg[end * 3] as number) +
				ey * (tg[end * 3 + 1] as number) +
				ez * (tg[end * 3 + 2] as number);
			if (beyond > 0) signed = Math.max(signed, beyond);
		}
		if (place) {
			place.ring = k;
			place.t = t;
			place.angle = angle;
			place.v = (r.v[k] as number) * (1 - t) + (r.v[k1] as number) * t;
		}
		return signed;
	}

	/** The stitched triangles of the strip after a ring, in the ring set's own vertex numbers. */
	private strip(k: number): Int32Array {
		const cached = this.strips.get(k);
		if (cached) return cached;
		const r = this.rings;
		const sidesA = r.sides[k] as number;
		const sidesB = r.sides[k + 1] as number;
		const local: number[] = [];
		stitch(local, 0, sidesA, sidesA + 1, sidesB);
		const firstA = r.first[k] as number;
		const firstB = r.first[k + 1] as number;
		const out = new Int32Array(local.length);
		for (let i = 0; i < local.length; i++) {
			const l = local[i] as number;
			out[i] = l <= sidesA ? firstA + (l % sidesA) : firstB + ((l - sidesA - 1) % sidesB);
		}
		this.strips.set(k, out);
		return out;
	}

	/**
	 * Where the segment from `a` to `b` crosses the parent's own triangles near a place that a
	 * query found: the strips beside the place's ring, within a few sides of its angle. So a weld's
	 * vertex lies on the parent's mesh exactly, not on the smooth surface the rings sample.
	 *
	 * @param a The segment's start, inside the parent.
	 * @param b The segment's end, outside.
	 * @param place The place a distance query found near the crossing; without one, every triangle in
	 *   the window is searched for the segment's first crossing.
	 * @param out The hit to write.
	 * @returns Whether the segment crosses a triangle there.
	 */
	snap(
		a: Float64Array,
		b: Float64Array,
		place: SurfacePlace | undefined,
		out: SurfaceHit,
	): boolean {
		const r = this.rings;
		let best = Number.POSITIVE_INFINITY;
		let found = false;
		const angle = place?.angle ?? 0;
		const share = (angle < 0 ? angle + 2 * PI : angle) / (2 * PI);
		const ring = place?.ring ?? 0;
		const search = (reach: number, window: number) => {
			for (
				let k = Math.max(this.from, ring - reach);
				k <= Math.min(this.to - 1, ring + reach);
				k++
			) {
				const triangles = this.strip(k);
				const count = triangles.length / 3;
				const sidesA = r.sides[k] as number;
				const sidesB = r.sides[k + 1] as number;
				// Triangles run round the strip in order, one per step of either ring.
				const centre = Math.round(share * (sidesA + sidesB));
				const span = Math.min(window, count >> 1);
				for (let w = -span; w <= span; w++) {
					const t = (((centre + w) % count) + count) % count;
					const i0 = triangles[t * 3] as number;
					const i1 = triangles[t * 3 + 1] as number;
					const i2 = triangles[t * 3 + 2] as number;
					const hit = this.crossing(a, b, i0, i1, i2);
					if (hit === undefined) continue;
					const [lambda, w1, w2] = hit;
					// Near a place, the crossing nearest the segment's middle; without one, the first.
					const score = place ? Math.abs(lambda - 0.5) : lambda;
					if (score >= best) continue;
					best = score;
					found = true;
					const w0 = 1 - w1 - w2;
					out.share = lambda;
					out.v = w0 * (r.vv[i0] as number) + w1 * (r.vv[i1] as number) + w2 * (r.vv[i2] as number);
					const n = r.vertexNormal;
					for (let q = 0; q < 3; q++)
						out.normal[q] =
							w0 * (n[i0 * 3 + q] as number) +
							w1 * (n[i1 * 3 + q] as number) +
							w2 * (n[i2 * 3 + q] as number);
				}
			}
		};
		// Near the place's angle first; where the rings tilt apart the place can stray, so then every
		// triangle of the strips around it.
		if (place) {
			search(1, 8);
			if (!found) search(2, Number.MAX_SAFE_INTEGER);
		} else search(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
		if (found) {
			const n = out.normal;
			const l =
				Math.sqrt((n[0] as number) ** 2 + (n[1] as number) ** 2 + (n[2] as number) ** 2) || 1;
			n[0] = (n[0] as number) / l;
			n[1] = (n[1] as number) / l;
			n[2] = (n[2] as number) / l;
		}
		return found;
	}

	/**
	 * Moves a point onto the nearest of the parent's triangles in the strips around a place, and
	 * reads the bark's `v` and the shading normal there. The weld's last resort, where the distance
	 * query strays too far for any line to cross the parent where it says.
	 *
	 * @param point The point, moved in place.
	 * @param place The place a distance query found near the point.
	 * @param out The hit to write: its `v` and normal.
	 */
	nearest(point: Float64Array, place: SurfacePlace, out: SurfaceHit): void {
		const r = this.rings;
		const p = [point[0] as number, point[1] as number, point[2] as number];
		const corner = (i: number) => [
			r.position[i * 3] as number,
			r.position[i * 3 + 1] as number,
			r.position[i * 3 + 2] as number,
		];
		let best = Number.POSITIVE_INFINITY;
		let bestCorners = [0, 0, 0];
		let weights = [1, 0, 0];
		for (
			let k = Math.max(this.from, place.ring - 2);
			k <= Math.min(this.to - 1, place.ring + 2);
			k++
		) {
			const triangles = this.strip(k);
			for (let t = 0; t < triangles.length; t += 3) {
				const i0 = triangles[t] as number;
				const i1 = triangles[t + 1] as number;
				const i2 = triangles[t + 2] as number;
				const hit = nearestOnTriangle(p, corner(i0), corner(i1), corner(i2));
				if (hit.distance >= best) continue;
				best = hit.distance;
				bestCorners = [i0, i1, i2];
				weights = [hit.wa, hit.wb, hit.wc];
			}
		}
		if (!Number.isFinite(best)) return;
		const [i0, i1, i2] = bestCorners as [number, number, number];
		const [w0, w1, w2] = weights as [number, number, number];
		const n = r.vertexNormal;
		for (let q = 0; q < 3; q++) {
			point[q] =
				w0 * (r.position[i0 * 3 + q] as number) +
				w1 * (r.position[i1 * 3 + q] as number) +
				w2 * (r.position[i2 * 3 + q] as number);
			out.normal[q] =
				w0 * (n[i0 * 3 + q] as number) +
				w1 * (n[i1 * 3 + q] as number) +
				w2 * (n[i2 * 3 + q] as number);
		}
		out.v = w0 * (r.vv[i0] as number) + w1 * (r.vv[i1] as number) + w2 * (r.vv[i2] as number);
		const l =
			Math.sqrt(
				(out.normal[0] as number) ** 2 +
					(out.normal[1] as number) ** 2 +
					(out.normal[2] as number) ** 2,
			) || 1;
		for (let q = 0; q < 3; q++) out.normal[q] = (out.normal[q] as number) / l;
	}

	/** The segment's crossing of a triangle (Möller and Trumbore): its share and two weights. */
	private crossing(
		a: Float64Array,
		b: Float64Array,
		i0: number,
		i1: number,
		i2: number,
	): [number, number, number] | undefined {
		const p = this.rings.position;
		const ox = a[0] as number;
		const oy = a[1] as number;
		const oz = a[2] as number;
		const dx = (b[0] as number) - ox;
		const dy = (b[1] as number) - oy;
		const dz = (b[2] as number) - oz;
		const v0x = p[i0 * 3] as number;
		const v0y = p[i0 * 3 + 1] as number;
		const v0z = p[i0 * 3 + 2] as number;
		const e1x = (p[i1 * 3] as number) - v0x;
		const e1y = (p[i1 * 3 + 1] as number) - v0y;
		const e1z = (p[i1 * 3 + 2] as number) - v0z;
		const e2x = (p[i2 * 3] as number) - v0x;
		const e2y = (p[i2 * 3 + 1] as number) - v0y;
		const e2z = (p[i2 * 3 + 2] as number) - v0z;
		const hx = dy * e2z - dz * e2y;
		const hy = dz * e2x - dx * e2z;
		const hz = dx * e2y - dy * e2x;
		const det = e1x * hx + e1y * hy + e1z * hz;
		if (Math.abs(det) < 1e-18) return undefined;
		const inv = 1 / det;
		const sx = ox - v0x;
		const sy = oy - v0y;
		const sz = oz - v0z;
		const u = (sx * hx + sy * hy + sz * hz) * inv;
		const slack = 1e-7;
		if (u < -slack || u > 1 + slack) return undefined;
		const qx = sy * e1z - sz * e1y;
		const qy = sz * e1x - sx * e1z;
		const qz = sx * e1y - sy * e1x;
		const v = (dx * qx + dy * qy + dz * qz) * inv;
		if (v < -slack || u + v > 1 + slack) return undefined;
		const lambda = (e2x * qx + e2y * qy + e2z * qz) * inv;
		if (lambda < 0 || lambda > 1) return undefined;
		return [lambda, Math.min(1, Math.max(0, u)), Math.min(1, Math.max(0, v))];
	}

	/**
	 * The surface's outward normal near a point, from the slope of the distance.
	 *
	 * @param x The point's x.
	 * @param y The point's y.
	 * @param z The point's z.
	 * @param step The step of the differences, in metres.
	 * @param out The normal to write.
	 */
	normal(x: number, y: number, z: number, step: number, out: Float64Array): void {
		const gx = this.distance(x + step, y, z) - this.distance(x - step, y, z);
		const gy = this.distance(x, y + step, z) - this.distance(x, y - step, z);
		const gz = this.distance(x, y, z + step) - this.distance(x, y, z - step);
		const l = Math.sqrt(gx * gx + gy * gy + gz * gz);
		if (!(l > 0) || !Number.isFinite(l)) return;
		out[0] = gx / l;
		out[1] = gy / l;
		out[2] = gz / l;
	}
}

/**
 * The collar's swell at a point of a child: full at the joint, easing to none over the collar's
 * length.
 *
 * @param distance Metres from where the child leaves its parent's surface.
 * @param length The collar's length in metres.
 * @returns The swell's share, 0 to 1.
 */
export function collarShare(distance: number, length: number): number {
	if (length <= 0) return 0;
	const x = Math.min(1, Math.max(0, distance / length));
	const ease = 1 - x;
	return ease * ease;
}

/**
 * The junction mask of a vertex near a joint: 1 on the weld at the top of the crotch, less round the
 * sides and least underneath, easing to 0 over the collar.
 *
 * @param distance Metres from the weld along the child.
 * @param length The collar's length in metres.
 * @param cosTheta The cosine of the vertex's angle round the child, 1 underneath.
 * @returns The mask, 0 to 1.
 */
export function junctionMask(distance: number, length: number, cosTheta: number): number {
	if (length <= 0) return 0;
	const x = Math.min(1, Math.max(0, distance / length));
	const fade = (1 - x) * (1 - x);
	const top = Math.max(0, -cosTheta);
	return fade * (0.35 + 0.65 * top);
}
