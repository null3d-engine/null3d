// The concrete curves, ported from three.js. In 2D: lines, quadratic and cubic Bézier curves,
// ellipses, arcs and splines. In 3D: lines, Bézier curves and Catmull-Rom splines. Each keeps its
// control points by reference, as three.js does, so a change to a point changes the curve.

import type { Vec3Like } from '@null3d/engine';
import { Curve } from './curve';
import { distanceSquared3, type Tuple2, type Tuple3 } from './math';
import type { Vec2Like } from './types';

function catmullRom(t: number, p0: number, p1: number, p2: number, p3: number): number {
	const v0 = (p2 - p0) * 0.5;
	const v1 = (p3 - p1) * 0.5;
	const t2 = t * t;
	const t3 = t * t2;
	return (2 * p1 - 2 * p2 + v0 + v1) * t3 + (-3 * p1 + 3 * p2 - 2 * v0 - v1) * t2 + v0 * t + p1;
}

function quadraticBezier(t: number, p0: number, p1: number, p2: number): number {
	const k = 1 - t;
	return k * k * p0 + 2 * (1 - t) * t * p1 + t * t * p2;
}

function cubicBezier(t: number, p0: number, p1: number, p2: number, p3: number): number {
	const k = 1 - t;
	return k * k * k * p0 + 3 * k * k * t * p1 + 3 * (1 - t) * t * t * p2 + t * t * t * p3;
}

function out2(out: Tuple2 | undefined, x: number, y: number): Tuple2 {
	const point = out ?? [0, 0];
	point[0] = x;
	point[1] = y;
	return point;
}

function out3(out: Tuple3 | undefined, x: number, y: number, z: number): Tuple3 {
	const point = out ?? [0, 0, 0];
	point[0] = x;
	point[1] = y;
	point[2] = z;
	return point;
}

/**
 * A straight 2D line from `v1` to `v2`, like three.js's `LineCurve`.
 *
 * @category api/geometry
 */
export class LineCurve extends Curve<[number, number]> {
	/** The start point. */
	v1: Vec2Like;
	/** The end point. */
	v2: Vec2Like;

	/** Makes a line from `v1` to `v2`. Both default to (0, 0). */
	constructor(v1: Vec2Like = [0, 0], v2: Vec2Like = [0, 0]) {
		super();
		this.v1 = v1;
		this.v2 = v2;
	}

	/** The point at `t` along the line. */
	getPoint(t: number, out?: [number, number]): [number, number] {
		const v1 = this.v1;
		const v2 = this.v2;
		if (t === 1) return out2(out, v2[0] as number, v2[1] as number);
		return out2(
			out,
			((v2[0] as number) - (v1[0] as number)) * t + (v1[0] as number),
			((v2[1] as number) - (v1[1] as number)) * t + (v1[1] as number),
		);
	}

	/** The point at `u`. A line's length grows evenly with `t`, so this equals `getPoint`. */
	override getPointAt(u: number, out?: [number, number]): [number, number] {
		return this.getPoint(u, out);
	}

	/** The line's unit direction, the same at every `t`. */
	override getTangent(_t: number, out?: [number, number]): [number, number] {
		const x = (this.v2[0] as number) - (this.v1[0] as number);
		const y = (this.v2[1] as number) - (this.v1[1] as number);
		const s = 1 / (Math.sqrt(x * x + y * y) || 1);
		return out2(out, x * s, y * s);
	}

	/** The line's unit direction, the same at every `u`. */
	override getTangentAt(u: number, out?: [number, number]): [number, number] {
		return this.getTangent(u, out);
	}
}

/**
 * A 2D quadratic Bézier curve from `v0` to `v2`, pulled toward the control point `v1`, like
 * three.js's `QuadraticBezierCurve`.
 *
 * @category api/geometry
 */
export class QuadraticBezierCurve extends Curve<[number, number]> {
	/** The start point. */
	v0: Vec2Like;
	/** The control point. */
	v1: Vec2Like;
	/** The end point. */
	v2: Vec2Like;

	/** Makes the curve. Each point defaults to (0, 0). */
	constructor(v0: Vec2Like = [0, 0], v1: Vec2Like = [0, 0], v2: Vec2Like = [0, 0]) {
		super();
		this.v0 = v0;
		this.v1 = v1;
		this.v2 = v2;
	}

	/** The point at `t`. */
	getPoint(t: number, out?: [number, number]): [number, number] {
		const { v0, v1, v2 } = this;
		return out2(
			out,
			quadraticBezier(t, v0[0] as number, v1[0] as number, v2[0] as number),
			quadraticBezier(t, v0[1] as number, v1[1] as number, v2[1] as number),
		);
	}
}

/**
 * A 2D cubic Bézier curve from `v0` to `v3`, shaped by the control points `v1` and `v2`, like
 * three.js's `CubicBezierCurve`.
 *
 * @category api/geometry
 */
export class CubicBezierCurve extends Curve<[number, number]> {
	/** The start point. */
	v0: Vec2Like;
	/** The first control point. */
	v1: Vec2Like;
	/** The second control point. */
	v2: Vec2Like;
	/** The end point. */
	v3: Vec2Like;

	/** Makes the curve. Each point defaults to (0, 0). */
	constructor(
		v0: Vec2Like = [0, 0],
		v1: Vec2Like = [0, 0],
		v2: Vec2Like = [0, 0],
		v3: Vec2Like = [0, 0],
	) {
		super();
		this.v0 = v0;
		this.v1 = v1;
		this.v2 = v2;
		this.v3 = v3;
	}

	/** The point at `t`. */
	getPoint(t: number, out?: [number, number]): [number, number] {
		const { v0, v1, v2, v3 } = this;
		return out2(
			out,
			cubicBezier(t, v0[0] as number, v1[0] as number, v2[0] as number, v3[0] as number),
			cubicBezier(t, v0[1] as number, v1[1] as number, v2[1] as number, v3[1] as number),
		);
	}
}

/**
 * A 2D ellipse or part of one, like three.js's `EllipseCurve`. Angles are in radians, measured
 * from the positive x axis.
 *
 * @category api/geometry
 */
export class EllipseCurve extends Curve<[number, number]> {
	/** The x of the center. */
	aX: number;
	/** The y of the center. */
	aY: number;
	/** The radius along x. */
	xRadius: number;
	/** The radius along y. */
	yRadius: number;
	/** The angle at which the curve starts. */
	aStartAngle: number;
	/** The angle at which the curve ends. */
	aEndAngle: number;
	/** True draws the curve clockwise. */
	aClockwise: boolean;
	/** How far the ellipse turns about its center, counterclockwise from the x axis. */
	aRotation: number;

	/**
	 * Makes the curve. The defaults give a full circle of radius 1 about the origin, drawn
	 * counterclockwise.
	 */
	constructor(
		aX = 0,
		aY = 0,
		xRadius = 1,
		yRadius = 1,
		aStartAngle = 0,
		aEndAngle = Math.PI * 2,
		aClockwise = false,
		aRotation = 0,
	) {
		super();
		this.aX = aX;
		this.aY = aY;
		this.xRadius = xRadius;
		this.yRadius = yRadius;
		this.aStartAngle = aStartAngle;
		this.aEndAngle = aEndAngle;
		this.aClockwise = aClockwise;
		this.aRotation = aRotation;
	}

	/** The point at `t`. */
	getPoint(t: number, out?: [number, number]): [number, number] {
		const twoPi = Math.PI * 2;
		let deltaAngle = this.aEndAngle - this.aStartAngle;
		const samePoints = Math.abs(deltaAngle) < Number.EPSILON;
		while (deltaAngle < 0) deltaAngle += twoPi;
		while (deltaAngle > twoPi) deltaAngle -= twoPi;
		if (deltaAngle < Number.EPSILON) {
			deltaAngle = samePoints ? 0 : twoPi;
		}
		if (this.aClockwise === true && !samePoints) {
			deltaAngle = deltaAngle === twoPi ? -twoPi : deltaAngle - twoPi;
		}
		const angle = this.aStartAngle + t * deltaAngle;
		let x = this.aX + this.xRadius * Math.cos(angle);
		let y = this.aY + this.yRadius * Math.sin(angle);
		if (this.aRotation !== 0) {
			const cos = Math.cos(this.aRotation);
			const sin = Math.sin(this.aRotation);
			const tx = x - this.aX;
			const ty = y - this.aY;
			x = tx * cos - ty * sin + this.aX;
			y = tx * sin + ty * cos + this.aY;
		}
		return out2(out, x, y);
	}
}

/**
 * A 2D circle or part of one, like three.js's `ArcCurve`: an `EllipseCurve` with one radius.
 *
 * @category api/geometry
 */
export class ArcCurve extends EllipseCurve {
	/** Makes the arc. The defaults give a full circle of radius 1 about the origin. */
	constructor(
		aX?: number,
		aY?: number,
		aRadius?: number,
		aStartAngle?: number,
		aEndAngle?: number,
		aClockwise?: boolean,
	) {
		super(aX, aY, aRadius, aRadius, aStartAngle, aEndAngle, aClockwise);
	}
}

/**
 * A smooth 2D curve through a list of points, like three.js's `SplineCurve`. It uses Catmull-Rom
 * interpolation.
 *
 * @category api/geometry
 */
export class SplineCurve extends Curve<[number, number]> {
	/** The points the curve passes through, in order. */
	points: Vec2Like[];

	/** Makes the curve through `points`. */
	constructor(points: Vec2Like[] = []) {
		super();
		this.points = points;
	}

	/** The point at `t`. */
	getPoint(t: number, out?: [number, number]): [number, number] {
		const points = this.points;
		const p = (points.length - 1) * t;
		const intPoint = Math.floor(p);
		const weight = p - intPoint;
		const p0 = points[intPoint === 0 ? intPoint : intPoint - 1] as Vec2Like;
		const p1 = points[intPoint] as Vec2Like;
		const p2 = points[intPoint > points.length - 2 ? points.length - 1 : intPoint + 1] as Vec2Like;
		const p3 = points[intPoint > points.length - 3 ? points.length - 1 : intPoint + 2] as Vec2Like;
		return out2(
			out,
			catmullRom(weight, p0[0] as number, p1[0] as number, p2[0] as number, p3[0] as number),
			catmullRom(weight, p0[1] as number, p1[1] as number, p2[1] as number, p3[1] as number),
		);
	}
}

/**
 * A straight 3D line from `v1` to `v2`, like three.js's `LineCurve3`.
 *
 * @category api/geometry
 */
export class LineCurve3 extends Curve<[number, number, number]> {
	/** The start point. */
	v1: Vec3Like;
	/** The end point. */
	v2: Vec3Like;

	/** Makes a line from `v1` to `v2`. Both default to (0, 0, 0). */
	constructor(v1: Vec3Like = [0, 0, 0], v2: Vec3Like = [0, 0, 0]) {
		super();
		this.v1 = v1;
		this.v2 = v2;
	}

	/** The point at `t` along the line. */
	getPoint(t: number, out?: [number, number, number]): [number, number, number] {
		const v1 = this.v1;
		const v2 = this.v2;
		if (t === 1) return out3(out, v2[0] as number, v2[1] as number, v2[2] as number);
		return out3(
			out,
			((v2[0] as number) - (v1[0] as number)) * t + (v1[0] as number),
			((v2[1] as number) - (v1[1] as number)) * t + (v1[1] as number),
			((v2[2] as number) - (v1[2] as number)) * t + (v1[2] as number),
		);
	}

	/** The point at `u`. A line's length grows evenly with `t`, so this equals `getPoint`. */
	override getPointAt(u: number, out?: [number, number, number]): [number, number, number] {
		return this.getPoint(u, out);
	}

	/** The line's unit direction, the same at every `t`. */
	override getTangent(_t: number, out?: [number, number, number]): [number, number, number] {
		const x = (this.v2[0] as number) - (this.v1[0] as number);
		const y = (this.v2[1] as number) - (this.v1[1] as number);
		const z = (this.v2[2] as number) - (this.v1[2] as number);
		const s = 1 / (Math.sqrt(x * x + y * y + z * z) || 1);
		return out3(out, x * s, y * s, z * s);
	}

	/** The line's unit direction, the same at every `u`. */
	override getTangentAt(u: number, out?: [number, number, number]): [number, number, number] {
		return this.getTangent(u, out);
	}
}

/**
 * A 3D quadratic Bézier curve from `v0` to `v2`, pulled toward the control point `v1`, like
 * three.js's `QuadraticBezierCurve3`.
 *
 * @category api/geometry
 */
export class QuadraticBezierCurve3 extends Curve<[number, number, number]> {
	/** The start point. */
	v0: Vec3Like;
	/** The control point. */
	v1: Vec3Like;
	/** The end point. */
	v2: Vec3Like;

	/** Makes the curve. Each point defaults to (0, 0, 0). */
	constructor(v0: Vec3Like = [0, 0, 0], v1: Vec3Like = [0, 0, 0], v2: Vec3Like = [0, 0, 0]) {
		super();
		this.v0 = v0;
		this.v1 = v1;
		this.v2 = v2;
	}

	/** The point at `t`. */
	getPoint(t: number, out?: [number, number, number]): [number, number, number] {
		const { v0, v1, v2 } = this;
		return out3(
			out,
			quadraticBezier(t, v0[0] as number, v1[0] as number, v2[0] as number),
			quadraticBezier(t, v0[1] as number, v1[1] as number, v2[1] as number),
			quadraticBezier(t, v0[2] as number, v1[2] as number, v2[2] as number),
		);
	}
}

/**
 * A 3D cubic Bézier curve from `v0` to `v3`, shaped by the control points `v1` and `v2`, like
 * three.js's `CubicBezierCurve3`.
 *
 * @category api/geometry
 */
export class CubicBezierCurve3 extends Curve<[number, number, number]> {
	/** The start point. */
	v0: Vec3Like;
	/** The first control point. */
	v1: Vec3Like;
	/** The second control point. */
	v2: Vec3Like;
	/** The end point. */
	v3: Vec3Like;

	/** Makes the curve. Each point defaults to (0, 0, 0). */
	constructor(
		v0: Vec3Like = [0, 0, 0],
		v1: Vec3Like = [0, 0, 0],
		v2: Vec3Like = [0, 0, 0],
		v3: Vec3Like = [0, 0, 0],
	) {
		super();
		this.v0 = v0;
		this.v1 = v1;
		this.v2 = v2;
		this.v3 = v3;
	}

	/** The point at `t`. */
	getPoint(t: number, out?: [number, number, number]): [number, number, number] {
		const { v0, v1, v2, v3 } = this;
		return out3(
			out,
			cubicBezier(t, v0[0] as number, v1[0] as number, v2[0] as number, v3[0] as number),
			cubicBezier(t, v0[1] as number, v1[1] as number, v2[1] as number, v3[1] as number),
			cubicBezier(t, v0[2] as number, v1[2] as number, v2[2] as number, v3[2] as number),
		);
	}
}

/**
 * How a `CatmullRomCurve3` spaces its spline between points. `'centripetal'` uses the fourth root
 * of the distance, `'chordal'` the square root, and `'catmullrom'` even steps with a tension.
 *
 * @category api/geometry
 */
export type CatmullRomCurveType = 'centripetal' | 'chordal' | 'catmullrom';

// The coefficients of one cubic, set for the span between the second and third of four values.
class CubicPoly {
	c0 = 0;
	c1 = 0;
	c2 = 0;
	c3 = 0;

	init(x0: number, x1: number, t0: number, t1: number): void {
		this.c0 = x0;
		this.c1 = t0;
		this.c2 = -3 * x0 + 3 * x1 - 2 * t0 - t1;
		this.c3 = 2 * x0 - 2 * x1 + t0 + t1;
	}

	initCatmullRom(x0: number, x1: number, x2: number, x3: number, tension: number): void {
		this.init(x1, x2, tension * (x2 - x0), tension * (x3 - x1));
	}

	initNonuniformCatmullRom(
		x0: number,
		x1: number,
		x2: number,
		x3: number,
		dt0: number,
		dt1: number,
		dt2: number,
	): void {
		let t1 = (x1 - x0) / dt0 - (x2 - x0) / (dt0 + dt1) + (x2 - x1) / dt1;
		let t2 = (x2 - x1) / dt1 - (x3 - x1) / (dt1 + dt2) + (x3 - x2) / dt2;
		t1 *= dt1;
		t2 *= dt1;
		this.init(x1, x2, t1, t2);
	}

	calc(t: number): number {
		const t2 = t * t;
		const t3 = t2 * t;
		return this.c0 + this.c1 * t + this.c2 * t2 + this.c3 * t3;
	}
}

const px = new CubicPoly();
const py = new CubicPoly();
const pz = new CubicPoly();
const extraStart: Tuple3 = [0, 0, 0];
const extraEnd: Tuple3 = [0, 0, 0];

/**
 * A smooth 3D curve through a list of points, like three.js's `CatmullRomCurve3`.
 *
 * @category api/geometry
 */
export class CatmullRomCurve3 extends Curve<[number, number, number]> {
	/** The points the curve passes through, in order. */
	points: Vec3Like[];
	/** True joins the last point back to the first. */
	closed: boolean;
	/** How the spline spaces itself between points. */
	curveType: CatmullRomCurveType;
	/** How tight the curve is, from 0 to 1, when `curveType` is `'catmullrom'`. */
	tension: number;

	/** Makes the curve. The defaults give an open, centripetal curve with tension 0.5. */
	constructor(
		points: Vec3Like[] = [],
		closed = false,
		curveType: CatmullRomCurveType = 'centripetal',
		tension = 0.5,
	) {
		super();
		this.points = points;
		this.closed = closed;
		this.curveType = curveType;
		this.tension = tension;
	}

	/** The point at `t`. */
	getPoint(t: number, out?: [number, number, number]): [number, number, number] {
		const points = this.points;
		const l = points.length;
		const p = (l - (this.closed ? 0 : 1)) * t;
		let intPoint = Math.floor(p);
		let weight = p - intPoint;
		if (this.closed) {
			intPoint += intPoint > 0 ? 0 : (Math.floor(Math.abs(intPoint) / l) + 1) * l;
		} else if (weight === 0 && intPoint === l - 1) {
			intPoint = l - 2;
			weight = 1;
		}
		let p0: Vec3Like;
		let p3: Vec3Like;
		if (this.closed || intPoint > 0) {
			p0 = points[(intPoint - 1) % l] as Vec3Like;
		} else {
			const a = points[0] as Vec3Like;
			const b = points[1] as Vec3Like;
			extraStart[0] = (a[0] as number) - (b[0] as number) + (a[0] as number);
			extraStart[1] = (a[1] as number) - (b[1] as number) + (a[1] as number);
			extraStart[2] = (a[2] as number) - (b[2] as number) + (a[2] as number);
			p0 = extraStart;
		}
		const p1 = points[intPoint % l] as Vec3Like;
		const p2 = points[(intPoint + 1) % l] as Vec3Like;
		if (this.closed || intPoint + 2 < l) {
			p3 = points[(intPoint + 2) % l] as Vec3Like;
		} else {
			const a = points[l - 1] as Vec3Like;
			const b = points[l - 2] as Vec3Like;
			extraEnd[0] = (a[0] as number) - (b[0] as number) + (a[0] as number);
			extraEnd[1] = (a[1] as number) - (b[1] as number) + (a[1] as number);
			extraEnd[2] = (a[2] as number) - (b[2] as number) + (a[2] as number);
			p3 = extraEnd;
		}
		if (this.curveType === 'centripetal' || this.curveType === 'chordal') {
			const pow = this.curveType === 'chordal' ? 0.5 : 0.25;
			let dt0 = distanceSquared3(p0, p1) ** pow;
			let dt1 = distanceSquared3(p1, p2) ** pow;
			let dt2 = distanceSquared3(p2, p3) ** pow;
			if (dt1 < 1e-4) dt1 = 1.0;
			if (dt0 < 1e-4) dt0 = dt1;
			if (dt2 < 1e-4) dt2 = dt1;
			for (let k = 0; k < 3; k++) {
				const poly = k === 0 ? px : k === 1 ? py : pz;
				poly.initNonuniformCatmullRom(
					p0[k] as number,
					p1[k] as number,
					p2[k] as number,
					p3[k] as number,
					dt0,
					dt1,
					dt2,
				);
			}
		} else if (this.curveType === 'catmullrom') {
			px.initCatmullRom(
				p0[0] as number,
				p1[0] as number,
				p2[0] as number,
				p3[0] as number,
				this.tension,
			);
			py.initCatmullRom(
				p0[1] as number,
				p1[1] as number,
				p2[1] as number,
				p3[1] as number,
				this.tension,
			);
			pz.initCatmullRom(
				p0[2] as number,
				p1[2] as number,
				p2[2] as number,
				p3[2] as number,
				this.tension,
			);
		}
		return out3(out, px.calc(weight), py.calc(weight), pz.calc(weight));
	}
}
