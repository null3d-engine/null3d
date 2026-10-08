// Curves joined end to end, ported from three.js. CurvePath holds a list of curves. Path adds
// drawing commands like a 2D canvas's, and Shape adds holes. The shape and extrude generators read a
// Shape's outline and holes as lists of points.

import { Curve } from './curve';
import {
	CubicBezierCurve,
	EllipseCurve,
	LineCurve,
	LineCurve3,
	QuadraticBezierCurve,
	SplineCurve,
} from './curves';
import { equals, is2D, type Tuple2 } from './math';
import type { Vec2Like } from './types';

/**
 * A list of curves joined end to end and treated as one curve, like three.js's `CurvePath`. Its
 * `t` runs over the whole path by length.
 *
 * @category api/geometry
 */
export class CurvePath<Point extends Vec2Like> extends Curve<Point> {
	/** The curves, in order. */
	curves: Curve<Point>[] = [];
	/** True makes `getPoints` and `getSpacedPoints` repeat the first point at the end. */
	autoClose = false;
	/** The lengths that `getCurveLengths` measured last, or null before the first call. */
	cacheLengths: number[] | null = null;

	/** Adds a curve to the end of the path. */
	add(curve: Curve<Point>): void {
		this.curves.push(curve);
	}

	/** Adds a straight line from the path's end to its start, when they differ. */
	closePath(): this {
		const startPoint = (this.curves[0] as Curve<Point>).getPoint(0);
		const endPoint = (this.curves[this.curves.length - 1] as Curve<Point>).getPoint(1);
		const twoD = is2D(startPoint);
		if (!equals(startPoint, endPoint, twoD)) {
			const line = twoD
				? new LineCurve(endPoint, startPoint)
				: new LineCurve3(endPoint, startPoint);
			this.curves.push(line as unknown as Curve<Point>);
		}
		return this;
	}

	/**
	 * The point at `t` over the whole path by length. Writes into `out` when given. Throws a
	 * `RangeError` when `t` is above 1 or the path is empty, where three.js returns null.
	 */
	getPoint(t: number, out?: Point): Point {
		const d = t * this.getLength();
		const curveLengths = this.getCurveLengths();
		for (let i = 0; i < curveLengths.length; i++) {
			const length = curveLengths[i] as number;
			if (length >= d) {
				const diff = length - d;
				const curve = this.curves[i] as Curve<Point>;
				const segmentLength = curve.getLength();
				const u = segmentLength === 0 ? 0 : 1 - diff / segmentLength;
				return curve.getPointAt(u, out);
			}
		}
		throw new RangeError(`CurvePath.getPoint: no point at t = ${t}`);
	}

	/** The path's length: the sum of its curves' lengths. */
	override getLength(): number {
		const lens = this.getCurveLengths();
		return lens[lens.length - 1] as number;
	}

	/** Measures the path again. Call it after a curve's points change. */
	override updateArcLengths(): void {
		this.needsUpdate = true;
		this.cacheLengths = null;
		this.getCurveLengths();
	}

	/**
	 * The length from the start of the path to the end of each curve. The path keeps the list
	 * while the number of curves stays the same.
	 */
	getCurveLengths(): number[] {
		if (this.cacheLengths && this.cacheLengths.length === this.curves.length) {
			return this.cacheLengths;
		}
		const lengths: number[] = [];
		let sums = 0;
		for (let i = 0, l = this.curves.length; i < l; i++) {
			sums += (this.curves[i] as Curve<Point>).getLength();
			lengths.push(sums);
		}
		this.cacheLengths = lengths;
		return lengths;
	}

	/** `divisions + 1` points at equal steps along the path. The default is 40 divisions. */
	override getSpacedPoints(divisions = 40): Point[] {
		const points: Point[] = [];
		for (let i = 0; i <= divisions; i++) {
			points.push(this.getPoint(i / divisions));
		}
		if (this.autoClose) {
			points.push(points[0] as Point);
		}
		return points;
	}

	/**
	 * Points along each curve in turn, with no point twice in a row. A line gives its two ends, an
	 * ellipse `divisions * 2` steps, a spline `divisions` steps per point and any other curve
	 * `divisions` steps. The default is 12 divisions.
	 */
	override getPoints(divisions = 12): Point[] {
		const points: Point[] = [];
		let last: Point | undefined;
		for (const curve of this.curves) {
			const resolution =
				curve instanceof EllipseCurve
					? divisions * 2
					: curve instanceof LineCurve || curve instanceof LineCurve3
						? 1
						: curve instanceof SplineCurve
							? divisions * curve.points.length
							: divisions;
			const pts = curve.getPoints(resolution);
			for (const point of pts) {
				if (last && equals(last, point, is2D(point))) continue;
				points.push(point);
				last = point;
			}
		}
		if (this.autoClose && points.length > 1) {
			const first = points[0] as Point;
			if (!equals(points[points.length - 1] as Point, first, is2D(first))) {
				points.push(first);
			}
		}
		return points;
	}
}

/**
 * A 2D path drawn with commands like a canvas's, such as `moveTo`, `lineTo` and
 * `bezierCurveTo`, like three.js's `Path`. Each command adds a curve that starts at the current
 * point.
 *
 * @category api/geometry
 */
export class Path extends CurvePath<[number, number]> {
	/** Where the next command starts. */
	currentPoint: [number, number] = [0, 0];

	/** Makes a path, with straight lines through `points` when given. */
	constructor(points?: readonly Vec2Like[]) {
		super();
		if (points) this.setFromPoints(points);
	}

	/** Moves to the first point, then adds straight lines through the others. */
	setFromPoints(points: readonly Vec2Like[]): this {
		const first = points[0] as Vec2Like;
		this.moveTo(first[0] as number, first[1] as number);
		for (let i = 1, l = points.length; i < l; i++) {
			const p = points[i] as Vec2Like;
			this.lineTo(p[0] as number, p[1] as number);
		}
		return this;
	}

	/** Sets the current point without adding a curve. */
	moveTo(x: number, y: number): this {
		this.currentPoint[0] = x;
		this.currentPoint[1] = y;
		return this;
	}

	/** Adds a straight line to (x, y). */
	lineTo(x: number, y: number): this {
		this.curves.push(new LineCurve([...this.currentPoint], [x, y]));
		this.moveTo(x, y);
		return this;
	}

	/** Adds a quadratic Bézier curve to (aX, aY) with the control point (aCPx, aCPy). */
	quadraticCurveTo(aCPx: number, aCPy: number, aX: number, aY: number): this {
		this.curves.push(new QuadraticBezierCurve([...this.currentPoint], [aCPx, aCPy], [aX, aY]));
		this.moveTo(aX, aY);
		return this;
	}

	/** Adds a cubic Bézier curve to (aX, aY) with two control points. */
	bezierCurveTo(
		aCP1x: number,
		aCP1y: number,
		aCP2x: number,
		aCP2y: number,
		aX: number,
		aY: number,
	): this {
		this.curves.push(
			new CubicBezierCurve([...this.currentPoint], [aCP1x, aCP1y], [aCP2x, aCP2y], [aX, aY]),
		);
		this.moveTo(aX, aY);
		return this;
	}

	/** Adds a spline from the current point through `pts`. */
	splineThru(pts: readonly Vec2Like[]): this {
		const npts: Vec2Like[] = [[...this.currentPoint] as Tuple2, ...pts];
		this.curves.push(new SplineCurve(npts));
		const last = pts[pts.length - 1] as Vec2Like;
		this.moveTo(last[0] as number, last[1] as number);
		return this;
	}

	/** Adds an arc whose center lies at (aX, aY) from the current point. */
	arc(
		aX: number,
		aY: number,
		aRadius: number,
		aStartAngle: number,
		aEndAngle: number,
		aClockwise?: boolean,
	): this {
		const x0 = this.currentPoint[0];
		const y0 = this.currentPoint[1];
		this.absarc(aX + x0, aY + y0, aRadius, aStartAngle, aEndAngle, aClockwise);
		return this;
	}

	/** Adds an arc whose center lies at (aX, aY). */
	absarc(
		aX: number,
		aY: number,
		aRadius: number,
		aStartAngle: number,
		aEndAngle: number,
		aClockwise?: boolean,
	): this {
		this.absellipse(aX, aY, aRadius, aRadius, aStartAngle, aEndAngle, aClockwise);
		return this;
	}

	/** Adds an ellipse whose center lies at (aX, aY) from the current point. */
	ellipse(
		aX: number,
		aY: number,
		xRadius: number,
		yRadius: number,
		aStartAngle: number,
		aEndAngle: number,
		aClockwise?: boolean,
		aRotation?: number,
	): this {
		const x0 = this.currentPoint[0];
		const y0 = this.currentPoint[1];
		this.absellipse(
			aX + x0,
			aY + y0,
			xRadius,
			yRadius,
			aStartAngle,
			aEndAngle,
			aClockwise,
			aRotation,
		);
		return this;
	}

	/**
	 * Adds an ellipse whose center lies at (aX, aY). When the path already has curves and the
	 * ellipse starts away from the current point, a straight line joins them first.
	 */
	absellipse(
		aX: number,
		aY: number,
		xRadius: number,
		yRadius: number,
		aStartAngle: number,
		aEndAngle: number,
		aClockwise?: boolean,
		aRotation?: number,
	): this {
		const curve = new EllipseCurve(
			aX,
			aY,
			xRadius,
			yRadius,
			aStartAngle,
			aEndAngle,
			aClockwise,
			aRotation,
		);
		if (this.curves.length > 0) {
			const firstPoint = curve.getPoint(0);
			if (!equals(firstPoint, this.currentPoint, true)) {
				this.lineTo(firstPoint[0], firstPoint[1]);
			}
		}
		this.curves.push(curve);
		const lastPoint = curve.getPoint(1);
		this.moveTo(lastPoint[0], lastPoint[1]);
		return this;
	}
}

/**
 * A closed 2D outline with optional holes, like three.js's `Shape`. The `shape` and `extrude`
 * generators fill it.
 *
 * @category api/geometry
 */
export class Shape extends Path {
	/** The holes, each a path inside the outline. */
	holes: Path[] = [];

	/** The points of each hole, as `getPoints(divisions)` gives them. */
	getPointsHoles(divisions?: number): [number, number][][] {
		const holesPts: [number, number][][] = [];
		for (let i = 0, l = this.holes.length; i < l; i++) {
			holesPts[i] = (this.holes[i] as Path).getPoints(divisions);
		}
		return holesPts;
	}

	/** The points of the outline and of each hole, as `getPoints(divisions)` gives them. */
	extractPoints(divisions?: number): { shape: [number, number][]; holes: [number, number][][] } {
		return {
			shape: this.getPoints(divisions),
			holes: this.getPointsHoles(divisions),
		};
	}
}
