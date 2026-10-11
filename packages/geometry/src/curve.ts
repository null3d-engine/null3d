// The base class of the curves, ported from three.js's Curve. A curve maps a number t from 0 to 1
// to a point. The base class adds sampling by arc length, tangents and Frenet frames on top of a
// subclass's getPoint. Points are plain tuples: two numbers for a 2D curve, three for a 3D curve.

import {
	clamp,
	cross3,
	distanceBetween,
	dot3,
	is2D,
	normalize3,
	rotateAboutAxis,
	type Tuple3,
} from './math';
import type { Vec2Like } from './types';

/**
 * The frames along a 3D curve that `computeFrenetFrames` returns: one tangent, normal and binormal
 * per sample, each a unit vector.
 *
 * @category api/geometry
 */
export interface FrenetFrames {
	/** The direction of the curve at each sample. */
	tangents: [number, number, number][];
	/** A direction at right angles to the tangent at each sample, which turns slowly along the curve. */
	normals: [number, number, number][];
	/** The cross product of the tangent and the normal at each sample. */
	binormals: [number, number, number][];
}

/**
 * The base class of all curves, like three.js's `Curve`. A subclass gives `getPoint`. The class
 * adds sampling by arc length, tangents and, for 3D curves, Frenet frames. `Point` is the type of
 * the curve's points. It is `[number, number]` for a 2D curve and `[number, number, number]` for a
 * 3D curve.
 *
 * @category api/geometry
 */
export abstract class Curve<Point extends Vec2Like> {
	/** How many samples `getLengths` takes to measure the curve. The default is 200. */
	arcLengthDivisions = 200;
	/** True makes the next `getLengths` measure the curve again. */
	needsUpdate = false;
	/** The lengths that `getLengths` measured last, or null before the first call. */
	cacheArcLengths: number[] | null = null;

	/**
	 * The point at `t`, from 0 at the start to 1 at the end. Equal steps of `t` need not give equal
	 * steps along the curve. Writes into `out` when given, else returns a new tuple.
	 */
	abstract getPoint(t: number, out?: Point): Point;

	/**
	 * The point at `u`, a fraction of the curve's length from 0 to 1. Equal steps of `u` give equal
	 * steps along the curve. Writes into `out` when given.
	 */
	getPointAt(u: number, out?: Point): Point {
		const t = this.getUtoTmapping(u);
		return this.getPoint(t, out);
	}

	/** `divisions + 1` points at equal steps of `t`. The default is 5 divisions. */
	getPoints(divisions = 5): Point[] {
		const points: Point[] = [];
		for (let d = 0; d <= divisions; d++) {
			points.push(this.getPoint(d / divisions));
		}
		return points;
	}

	/** `divisions + 1` points at equal steps along the curve. The default is 5 divisions. */
	getSpacedPoints(divisions = 5): Point[] {
		const points: Point[] = [];
		for (let d = 0; d <= divisions; d++) {
			points.push(this.getPointAt(d / divisions));
		}
		return points;
	}

	/** The curve's length, measured over `arcLengthDivisions` straight steps. */
	getLength(): number {
		const lengths = this.getLengths();
		return lengths[lengths.length - 1] as number;
	}

	/**
	 * The length from the start to each of `divisions + 1` points at equal steps of `t`. The curve
	 * keeps the list and returns it again until `needsUpdate` is set or `divisions` changes.
	 */
	getLengths(divisions: number = this.arcLengthDivisions): number[] {
		if (
			this.cacheArcLengths &&
			this.cacheArcLengths.length === divisions + 1 &&
			!this.needsUpdate
		) {
			return this.cacheArcLengths;
		}
		this.needsUpdate = false;
		const cache: number[] = [];
		let last = this.getPoint(0);
		const twoD = is2D(last);
		let sum = 0;
		cache.push(0);
		for (let p = 1; p <= divisions; p++) {
			const current = this.getPoint(p / divisions);
			sum += distanceBetween(current, last, twoD);
			cache.push(sum);
			last = current;
		}
		this.cacheArcLengths = cache;
		return cache;
	}

	/** Measures the curve again. Call it after the curve's points change. */
	updateArcLengths(): void {
		this.needsUpdate = true;
		this.getLengths();
	}

	/**
	 * The `t` that lies at the fraction `u` of the curve's length. A truthy `distance` gives the
	 * length from the start in place of `u`.
	 */
	getUtoTmapping(u: number, distance: number | null = null): number {
		const arcLengths = this.getLengths();
		let i = 0;
		const il = arcLengths.length;
		const targetArcLength = distance ? distance : u * (arcLengths[il - 1] as number);
		let low = 0;
		let high = il - 1;
		while (low <= high) {
			i = Math.floor(low + (high - low) / 2);
			const comparison = (arcLengths[i] as number) - targetArcLength;
			if (comparison < 0) {
				low = i + 1;
			} else if (comparison > 0) {
				high = i - 1;
			} else {
				high = i;
				break;
			}
		}
		i = high;
		if (arcLengths[i] === targetArcLength) {
			return i / (il - 1);
		}
		const lengthBefore = arcLengths[i] as number;
		const lengthAfter = arcLengths[i + 1] as number;
		const segmentLength = lengthAfter - lengthBefore;
		const segmentFraction = (targetArcLength - lengthBefore) / segmentLength;
		return (i + segmentFraction) / (il - 1);
	}

	/**
	 * The unit direction of the curve at `t`, from two points a small step apart. Writes into `out`
	 * when given.
	 */
	getTangent(t: number, out?: Point): Point {
		const delta = 0.0001;
		let t1 = t - delta;
		let t2 = t + delta;
		if (t1 < 0) t1 = 0;
		if (t2 > 1) t2 = 1;
		const pt1 = this.getPoint(t1);
		const pt2 = this.getPoint(t2);
		const twoD = is2D(pt1);
		const tangent = out ?? ((twoD ? [0, 0] : [0, 0, 0]) as unknown as Point);
		const x = (pt2[0] as number) - (pt1[0] as number);
		const y = (pt2[1] as number) - (pt1[1] as number);
		if (twoD) {
			const s = 1 / (Math.sqrt(x * x + y * y) || 1);
			tangent[0] = x * s;
			tangent[1] = y * s;
		} else {
			const z = (pt2[2] as number) - (pt1[2] as number);
			const s = 1 / (Math.sqrt(x * x + y * y + z * z) || 1);
			tangent[0] = x * s;
			tangent[1] = y * s;
			tangent[2] = z * s;
		}
		return tangent;
	}

	/** The unit direction at the fraction `u` of the curve's length. Writes into `out` when given. */
	getTangentAt(u: number, out?: Point): Point {
		const t = this.getUtoTmapping(u);
		return this.getTangent(t, out);
	}

	/**
	 * The Frenet frames of a 3D curve at `segments + 1` points spaced along its length, as three.js
	 * computes them for tubes and extrusions. A closed curve gets a twist spread over its length,
	 * so the last frame matches the first.
	 */
	computeFrenetFrames(segments: number, closed = false): FrenetFrames {
		const normal: Tuple3 = [0, 0, 0];
		const tangents: Tuple3[] = [];
		const normals: Tuple3[] = [];
		const binormals: Tuple3[] = [];
		const vec: Tuple3 = [0, 0, 0];
		for (let i = 0; i <= segments; i++) {
			const u = i / segments;
			tangents[i] = this.getTangentAt(u, [0, 0, 0] as unknown as Point) as unknown as Tuple3;
		}
		const t0 = tangents[0] as Tuple3;
		const n0: Tuple3 = [0, 0, 0];
		const b0: Tuple3 = [0, 0, 0];
		normals[0] = n0;
		binormals[0] = b0;
		let min = Number.MAX_VALUE;
		const tx = Math.abs(t0[0]);
		const ty = Math.abs(t0[1]);
		const tz = Math.abs(t0[2]);
		if (tx <= min) {
			min = tx;
			normal[0] = 1;
			normal[1] = 0;
			normal[2] = 0;
		}
		if (ty <= min) {
			min = ty;
			normal[0] = 0;
			normal[1] = 1;
			normal[2] = 0;
		}
		if (tz <= min) {
			normal[0] = 0;
			normal[1] = 0;
			normal[2] = 1;
		}
		cross3(vec, t0, normal);
		normalize3(vec);
		cross3(n0, t0, vec);
		cross3(b0, t0, n0);
		for (let i = 1; i <= segments; i++) {
			const ni: Tuple3 = [...(normals[i - 1] as Tuple3)];
			const bi: Tuple3 = [...(binormals[i - 1] as Tuple3)];
			normals[i] = ni;
			binormals[i] = bi;
			const tPrev = tangents[i - 1] as Tuple3;
			const ti = tangents[i] as Tuple3;
			cross3(vec, tPrev, ti);
			if (Math.sqrt(vec[0] * vec[0] + vec[1] * vec[1] + vec[2] * vec[2]) > Number.EPSILON) {
				normalize3(vec);
				const theta = Math.acos(clamp(dot3(tPrev, ti), -1, 1));
				rotateAboutAxis(ni, vec, theta);
			}
			cross3(bi, ti, ni);
		}
		if (closed === true) {
			const nLast = normals[segments] as Tuple3;
			let theta = Math.acos(clamp(dot3(n0, nLast), -1, 1));
			theta /= segments;
			cross3(vec, n0, nLast);
			if (dot3(t0, vec) > 0) {
				theta = -theta;
			}
			for (let i = 1; i <= segments; i++) {
				const ni = normals[i] as Tuple3;
				const ti = tangents[i] as Tuple3;
				rotateAboutAxis(ni, ti, theta * i);
				cross3(binormals[i] as Tuple3, ti, ni);
			}
		}
		return { tangents, normals, binormals };
	}
}
