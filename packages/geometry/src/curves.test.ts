// Parity tests for the curves, paths, shapes and outline helpers against three.js 0.186.1: points,
// spaced points, lengths, tangents, Frenet frames and triangulation must be equal.

import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import {
	ArcCurve,
	CatmullRomCurve3,
	CubicBezierCurve,
	CubicBezierCurve3,
	type Curve,
	EllipseCurve,
	LineCurve,
	LineCurve3,
	Path,
	QuadraticBezierCurve,
	QuadraticBezierCurve3,
	Shape,
	ShapeUtils,
	SplineCurve,
} from './index';

type ThreeCurve = THREE.Curve<THREE.Vector2> | THREE.Curve<THREE.Vector3>;
type PortCurve = Curve<[number, number]> | Curve<[number, number, number]>;

function arrays(points: (THREE.Vector2 | THREE.Vector3)[]): number[][] {
	return points.map((p) => p.toArray());
}

const ts = [0, 0.1, 0.25, 1 / 3, 0.5, 0.77, 0.999, 1];

function expectCurveParity(port: PortCurve, three: ThreeCurve): void {
	for (const t of ts) {
		expect(port.getPoint(t) as number[]).toEqual(three.getPoint(t).toArray());
		expect(port.getPointAt(t) as number[]).toEqual(three.getPointAt(t).toArray());
		expect(port.getTangent(t) as number[]).toEqual(three.getTangent(t).toArray());
		expect(port.getTangentAt(t) as number[]).toEqual(three.getTangentAt(t).toArray());
		expect(port.getUtoTmapping(t)).toBe(three.getUtoTmapping(t, 0));
	}
	expect(port.getPoints() as number[][]).toEqual(arrays(three.getPoints()));
	expect(port.getPoints(7) as number[][]).toEqual(arrays(three.getPoints(7)));
	expect(port.getSpacedPoints() as number[][]).toEqual(arrays(three.getSpacedPoints()));
	expect(port.getSpacedPoints(9) as number[][]).toEqual(arrays(three.getSpacedPoints(9)));
	expect(port.getLength()).toBe(three.getLength());
	expect(port.getLengths(17)).toEqual(three.getLengths(17));
}

const v2 = (x: number, y: number) => new THREE.Vector2(x, y);
const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

describe('2D curves match three.js', () => {
	test('LineCurve', () => {
		expectCurveParity(new LineCurve([1, 2], [-3, 5]), new THREE.LineCurve(v2(1, 2), v2(-3, 5)));
	});
	test('QuadraticBezierCurve', () => {
		expectCurveParity(
			new QuadraticBezierCurve([0, 0], [1, 3], [2, -1]),
			new THREE.QuadraticBezierCurve(v2(0, 0), v2(1, 3), v2(2, -1)),
		);
	});
	test('CubicBezierCurve', () => {
		expectCurveParity(
			new CubicBezierCurve([-1, 0], [-0.5, 2], [0.5, -2], [1, 0.3]),
			new THREE.CubicBezierCurve(v2(-1, 0), v2(-0.5, 2), v2(0.5, -2), v2(1, 0.3)),
		);
	});
	const ellipses: [number, number, number, number, number, number, boolean, number][] = [
		[0, 0, 1, 1, 0, Math.PI * 2, false, 0],
		[1, -1, 2, 0.5, 0.3, 2.5, true, 0.7],
		[0, 0, 1, 2, 2, 0.5, false, 0],
		[0, 0, 1, 2, 1, 1, true, 0],
		[0, 0, 3, 1, -1, 9, false, -0.2],
	];
	for (const e of ellipses) {
		test(`EllipseCurve ${JSON.stringify(e)}`, () => {
			expectCurveParity(new EllipseCurve(...e), new THREE.EllipseCurve(...e));
		});
	}
	test('ArcCurve', () => {
		expectCurveParity(
			new ArcCurve(0.5, 0.5, 2, 0, Math.PI, true),
			new THREE.ArcCurve(0.5, 0.5, 2, 0, Math.PI, true),
		);
	});
	test('SplineCurve', () => {
		const pts: [number, number][] = [
			[0, 0],
			[1, 2],
			[3, 1],
			[4, 4],
			[6, 0],
		];
		expectCurveParity(new SplineCurve(pts), new THREE.SplineCurve(pts.map(([x, y]) => v2(x, y))));
	});
});

describe('3D curves match three.js', () => {
	test('LineCurve3', () => {
		expectCurveParity(
			new LineCurve3([1, 2, 3], [-3, 5, 0]),
			new THREE.LineCurve3(v3(1, 2, 3), v3(-3, 5, 0)),
		);
	});
	test('QuadraticBezierCurve3', () => {
		expectCurveParity(
			new QuadraticBezierCurve3([0, 0, 0], [1, 3, 1], [2, -1, 2]),
			new THREE.QuadraticBezierCurve3(v3(0, 0, 0), v3(1, 3, 1), v3(2, -1, 2)),
		);
	});
	test('CubicBezierCurve3', () => {
		expectCurveParity(
			new CubicBezierCurve3([-1, 0, 0], [-0.5, 2, 1], [0.5, -2, 1], [1, 0.3, 0]),
			new THREE.CubicBezierCurve3(v3(-1, 0, 0), v3(-0.5, 2, 1), v3(0.5, -2, 1), v3(1, 0.3, 0)),
		);
	});
	const pts: [number, number, number][] = [
		[0, 0, 0],
		[1, 2, 0.5],
		[3, 1, -1],
		[4, 4, 2],
		[6, 0, 1],
		[6, 0, 1],
	];
	const types = [
		['centripetal', 0.5],
		['chordal', 0.5],
		['catmullrom', 0.5],
		['catmullrom', 0.1],
	] as const;
	for (const closed of [false, true]) {
		for (const [type, tension] of types) {
			test(`CatmullRomCurve3 ${type}, tension ${tension}, closed ${closed}`, () => {
				const port = new CatmullRomCurve3(pts, closed, type, tension);
				const three = new THREE.CatmullRomCurve3(
					pts.map((p) => v3(...p)),
					closed,
					type,
					tension,
				);
				expectCurveParity(port, three);
				for (const segments of [1, 12, 50]) {
					const a = port.computeFrenetFrames(segments, closed);
					const b = three.computeFrenetFrames(segments, closed);
					expect(a.tangents as number[][]).toEqual(arrays(b.tangents));
					expect(a.normals as number[][]).toEqual(arrays(b.normals));
					expect(a.binormals as number[][]).toEqual(arrays(b.binormals));
				}
			});
		}
	}
	test('Frenet frames of a straight line', () => {
		const a = new LineCurve3([0, 0, 0], [0, 0, 5]).computeFrenetFrames(4);
		const b = new THREE.LineCurve3(v3(0, 0, 0), v3(0, 0, 5)).computeFrenetFrames(4, false);
		expect(a.normals as number[][]).toEqual(arrays(b.normals));
		expect(a.binormals as number[][]).toEqual(arrays(b.binormals));
	});
	test('a point written into a given tuple', () => {
		const out: [number, number, number] = [9, 9, 9];
		const curve = new QuadraticBezierCurve3([0, 0, 0], [1, 1, 1], [2, 0, 2]);
		expect(curve.getPoint(0.5, out)).toBe(out);
		expect(out).toEqual(curve.getPoint(0.5));
	});
});

describe('paths and shapes match three.js', () => {
	interface Kit {
		Path: new () => Path;
		Shape: new () => Shape;
		v2(x: number, y: number): never;
	}
	const portKit: Kit = { Path, Shape, v2: (x, y) => [x, y] as never };
	const threeKit = { Path: THREE.Path, Shape: THREE.Shape, v2 } as unknown as Kit;
	const draw = (k: Kit): Path => {
		const p = new k.Path();
		p.moveTo(1, 1);
		p.lineTo(2, 1);
		p.quadraticCurveTo(3, 2, 2, 3);
		p.bezierCurveTo(1.5, 3.5, 0.5, 3.5, 0, 3);
		p.splineThru([k.v2(-1, 2), k.v2(-0.5, 1)]);
		p.arc(0.5, 0, 0.5, Math.PI, 0, true);
		p.absarc(3, 0, 0.5, 0, Math.PI / 2);
		p.ellipse(0, 1, 1, 0.5, 0, Math.PI, false, 0.3);
		p.absellipse(0, 0, 2, 1, 0, Math.PI, true);
		return p;
	};

	test('a path drawn with every command', () => {
		const port = draw(portKit);
		const three = draw(threeKit) as unknown as THREE.Path;
		expect(port.curves.length).toBe(three.curves.length);
		expect(port.currentPoint).toEqual(three.currentPoint.toArray());
		expectCurveParity(port, three);
		expect(port.getPoints(5) as number[][]).toEqual(arrays(three.getPoints(5)));
		expect(port.getSpacedPoints(30) as number[][]).toEqual(arrays(three.getSpacedPoints(30)));
		expect(port.getCurveLengths()).toEqual(three.getCurveLengths());
		port.closePath();
		three.closePath();
		port.autoClose = true;
		three.autoClose = true;
		port.updateArcLengths();
		three.updateArcLengths();
		expect(port.curves.length).toBe(three.curves.length);
		expect(port.getPoints() as number[][]).toEqual(arrays(three.getPoints()));
		expect(port.getSpacedPoints() as number[][]).toEqual(arrays(three.getSpacedPoints()));
	});

	test('a path from points', () => {
		const pts: [number, number][] = [
			[0, 0],
			[1, 0],
			[1, 1],
		];
		const port = new Path(pts);
		const three = new THREE.Path(pts.map(([x, y]) => v2(x, y)));
		expect(port.getPoints() as number[][]).toEqual(arrays(three.getPoints()));
		expect(port.getLength()).toBe(three.getLength());
	});

	test('a shape with holes', () => {
		const make = (k: Kit): Shape => {
			const s = new k.Shape();
			s.moveTo(-2, -2).lineTo(2, -2).lineTo(2, 2).lineTo(-2, 2);
			const hole = new k.Path();
			hole.absarc(0, 0, 1, 0, Math.PI * 2, true);
			s.holes.push(hole, draw(k));
			return s;
		};
		const port = make(portKit).extractPoints(6);
		const three = (make(threeKit) as unknown as THREE.Shape).extractPoints(6);
		expect(port.shape as number[][]).toEqual(arrays(three.shape));
		expect(port.holes.map((h) => h as number[][])).toEqual(three.holes.map(arrays));
	});
});

describe('ShapeUtils match three.js', () => {
	const outline: [number, number][] = [];
	for (let i = 0; i < 60; i++) {
		const angle = (i / 60) * Math.PI * 2;
		const r = 3 + Math.sin(angle * 5);
		outline.push([Math.cos(angle) * r, Math.sin(angle) * r]);
	}
	const hole: [number, number][] = [
		[-0.5, -0.5],
		[-0.5, 0.5],
		[0.5, 0.5],
		[0.5, -0.5],
		[-0.5, -0.5],
	];
	const toThree = (pts: [number, number][]) => pts.map(([x, y]) => v2(x, y));

	test('area and winding', () => {
		expect(ShapeUtils.area(outline)).toBe(THREE.ShapeUtils.area(toThree(outline)));
		expect(ShapeUtils.area(hole)).toBe(THREE.ShapeUtils.area(toThree(hole)));
		expect(ShapeUtils.isClockWise(outline)).toBe(false);
		expect(ShapeUtils.isClockWise(hole)).toBe(true);
	});

	const cases: [string, [number, number][], [number, number][][]][] = [
		['a triangle', outline.slice(0, 3), []],
		['a star of 60 points', outline, []],
		['a star with a square hole that repeats its first point', outline, [hole]],
		[
			'a square with two touching holes',
			[
				[0, 0],
				[4, 0],
				[4, 4],
				[0, 4],
			],
			[
				[
					[1, 1],
					[1, 2],
					[2, 2],
					[2, 1],
				],
				[
					[2, 2],
					[2, 3],
					[3, 3],
					[3, 2],
				],
			],
		],
		[
			'a self-crossing bow tie',
			[
				[0, 0],
				[2, 2],
				[2, 0],
				[0, 2],
			],
			[],
		],
	];
	for (const [name, contour, holes] of cases) {
		test(`triangulateShape: ${name}`, () => {
			const portContour = contour.map((p) => [...p] as [number, number]);
			const portHoles = holes.map((h) => h.map((p) => [...p] as [number, number]));
			const threeContour = toThree(contour);
			const threeHoles = holes.map(toThree);
			const port = ShapeUtils.triangulateShape(portContour, portHoles);
			const three = THREE.ShapeUtils.triangulateShape(threeContour, threeHoles);
			expect(port).toEqual(three as [number, number, number][]);
			expect(port.length).toBeGreaterThan(0);
			// Both drop a last point that repeats the first.
			expect(portContour.length).toBe(threeContour.length);
			expect(portHoles.map((h) => h.length)).toEqual(threeHoles.map((h) => h.length));
		});
	}
});
