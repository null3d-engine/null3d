// Parity tests: each generator against three.js 0.186.1's geometry with the same options. The
// vertex and index counts, the index array type and every position, normal, texture coordinate
// and index must be equal.

import { describe, expect, test } from 'bun:test';
import type { MeshArrays } from '@null3d/engine';
import * as THREE from 'three';
import {
	CatmullRomCurve3,
	CubicBezierCurve3,
	CurvePath,
	dodecahedron,
	extrude,
	type GeneratedArrays,
	icosahedron,
	LineCurve3,
	lathe,
	octahedron,
	Path,
	polyhedron,
	QuadraticBezierCurve3,
	Shape,
	shape,
	type TubeOptions,
	tetrahedron,
	torusKnot,
	tube,
	type UVGenerator,
} from './index';

// The places where two arrays differ, at most five, with both values. Plus and minus zero count as
// equal.
function differences(name: string, port: ArrayLike<number>, three: ArrayLike<number>): string[] {
	const out: string[] = [];
	if (port.length !== three.length) return [`${name}: length ${port.length} vs ${three.length}`];
	for (let i = 0; i < port.length && out.length < 5; i++) {
		const a = port[i] as number;
		const b = three[i] as number;
		if (a !== b && !(Number.isNaN(a) && Number.isNaN(b))) out.push(`${name}[${i}]: ${a} vs ${b}`);
	}
	return out;
}

function expectParity(port: GeneratedArrays, geometry: THREE.BufferGeometry): void {
	const position = geometry.getAttribute('position');
	expect(port.positions.length / 3).toBe(position.count);
	expect(port.normals.length / 3).toBe(position.count);
	expect(port.uvs.length / 2).toBe(position.count);
	const problems = [
		...differences('positions', port.positions, position.array),
		...differences('normals', port.normals, geometry.getAttribute('normal').array),
		...differences('uvs', port.uvs, geometry.getAttribute('uv').array),
	];
	if (geometry.index) {
		expect(port.indices).toBeDefined();
		expect(port.indices?.constructor).toBe(geometry.index.array.constructor);
		expect(port.indices?.length).toBe(geometry.index.count);
		problems.push(...differences('indices', port.indices ?? [], geometry.index.array));
	} else {
		expect(port.indices).toBeUndefined();
	}
	expect(problems).toEqual([]);
	geometry.dispose();
}

// A shape recipe, built once with this package's classes and once with three.js's.
interface ShapeKit {
	Shape: new (points?: never[]) => Shape;
	Path: new (points?: never[]) => Path;
	v2(x: number, y: number): never;
}

const portKit: ShapeKit = {
	Shape: Shape as ShapeKit['Shape'],
	Path: Path as ShapeKit['Path'],
	v2: (x, y) => [x, y] as never,
};
const threeKit = {
	Shape: THREE.Shape,
	Path: THREE.Path,
	v2: (x: number, y: number) => new THREE.Vector2(x, y),
} as unknown as ShapeKit;

type Recipe = (kit: ShapeKit) => Shape | Shape[];

const recipes: Record<string, Recipe> = {
	'a triangle from points': (k) => new k.Shape([k.v2(0, 0), k.v2(1, 0), k.v2(0.5, 1)]),
	'a clockwise square': (k) =>
		new k.Shape([k.v2(-1, -1), k.v2(-1, 1), k.v2(1, 1), k.v2(1, -1), k.v2(-1, -1)]),
	'a square with a round hole and a square hole': (k) => {
		const s = new k.Shape();
		s.moveTo(-2, -2).lineTo(2, -2).lineTo(2, 2).lineTo(-2, 2).lineTo(-2, -2);
		const round = new k.Path();
		round.absarc(-0.8, 0, 0.6, 0, Math.PI * 2, false);
		const square = new k.Path();
		square.moveTo(0.5, -0.5).lineTo(1.5, -0.5).lineTo(1.5, 0.5).lineTo(0.5, 0.5);
		s.holes.push(round, square);
		return s;
	},
	'a heart of Bézier curves': (k) => {
		const s = new k.Shape();
		s.moveTo(0.25, 0.25);
		s.bezierCurveTo(0.25, 0.25, 0.2, 0, 0, 0);
		s.bezierCurveTo(-0.3, 0, -0.3, 0.35, -0.3, 0.35);
		s.bezierCurveTo(-0.3, 0.55, -0.1, 0.77, 0.25, 0.95);
		s.bezierCurveTo(0.6, 0.77, 0.8, 0.55, 0.8, 0.35);
		s.bezierCurveTo(0.8, 0.35, 0.8, 0, 0.5, 0);
		s.bezierCurveTo(0.35, 0, 0.25, 0.25, 0.25, 0.25);
		return s;
	},
	'curves of every kind, in two shapes': (k) => {
		const a = new k.Shape();
		a.moveTo(0, 0);
		a.quadraticCurveTo(1, 2, 2, 0);
		a.splineThru([k.v2(2.5, -0.5), k.v2(2, -1), k.v2(1, -1.2)]);
		a.ellipse(-0.5, 0.3, 0.6, 0.3, 0, Math.PI, true, 0.4);
		a.arc(0, 0.5, 0.3, Math.PI, Math.PI * 1.5, false);
		const b = new k.Shape();
		b.absellipse(5, 0, 1, 0.5, 0, Math.PI * 2, false, 0.2);
		return [a, b];
	},
	'a many-sided ring with holes, which takes the hashed ear search': (k) => {
		const s = new k.Shape();
		s.absarc(0, 0, 3, 0, Math.PI * 2, false);
		for (let i = 0; i < 3; i++) {
			const hole = new k.Path();
			const angle = (i / 3) * Math.PI * 2;
			hole.absarc(Math.cos(angle) * 1.5, Math.sin(angle) * 1.5, 0.5, 0, Math.PI * 2, true);
			s.holes.push(hole);
		}
		return s;
	},
};

describe('the port matches three.js', () => {
	test('its arrays fit the engine', () => {
		const arrays: MeshArrays = torusKnot();
		const extruded = extrude() satisfies MeshArrays;
		expect(arrays.positions).toBeInstanceOf(Float32Array);
		expect(extruded.indices).toBeUndefined();
	});

	describe('torusKnot', () => {
		const cases: [number?, number?, number?, number?, number?, number?][] = [
			[],
			[2, 0.3, 100.7, 12.2, 3, 7],
			[0.5, 0.1, 5, 3, 1, 4],
			[1, 0.4, 400, 200, 2, 3],
		];
		for (const c of cases) {
			test(`options ${JSON.stringify(c)}`, () => {
				const [radius, tube, tubularSegments, radialSegments, p, q] = c;
				expectParity(
					torusKnot({ radius, tube, tubularSegments, radialSegments, p, q }),
					new THREE.TorusKnotGeometry(radius, tube, tubularSegments, radialSegments, p, q),
				);
			});
		}
		test('a large knot takes 32-bit indices', () => {
			expect(torusKnot({ tubularSegments: 400, radialSegments: 200 }).indices).toBeInstanceOf(
				Uint32Array,
			);
		});
	});

	describe('polyhedra', () => {
		const named = [
			['tetrahedron', tetrahedron, THREE.TetrahedronGeometry],
			['octahedron', octahedron, THREE.OctahedronGeometry],
			['icosahedron', icosahedron, THREE.IcosahedronGeometry],
			['dodecahedron', dodecahedron, THREE.DodecahedronGeometry],
		] as const;
		for (const [name, port, Three] of named) {
			for (const detail of [0, 1, 2]) {
				for (const radius of [1, 2.5]) {
					test(`${name} with detail ${detail} and radius ${radius}`, () => {
						expectParity(port({ radius, detail }), new Three(radius, detail));
					});
				}
			}
			test(`${name} with the defaults`, () => {
				expectParity(port(), new Three());
			});
		}
		const cube = {
			vertices: [
				-1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1, -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1,
			],
			indices: [
				2, 1, 0, 0, 3, 2, 0, 4, 7, 7, 3, 0, 0, 1, 5, 5, 4, 0, 1, 2, 6, 6, 5, 1, 2, 3, 7, 7, 6, 2, 4,
				5, 6, 6, 7, 4,
			],
		};
		for (const detail of [0, 1, 3]) {
			test(`a custom polyhedron with detail ${detail}`, () => {
				expectParity(
					polyhedron({ ...cube, radius: 1.5, detail }),
					new THREE.PolyhedronGeometry(cube.vertices, cube.indices, 1.5, detail),
				);
			});
		}
		test('an empty polyhedron', () => {
			expectParity(polyhedron(), new THREE.PolyhedronGeometry());
		});
	});

	describe('lathe', () => {
		const vase: [number, number][] = [];
		for (let i = 0; i < 10; i++) vase.push([Math.sin(i * 0.2) * 1.5 + 0.5, (i - 5) * 0.4]);
		const cases: [string, [number, number][] | undefined, number?, number?, number?][] = [
			['the defaults', undefined],
			['a vase on part of a turn', vase, 20, 0.3, Math.PI],
			['a vase with a turn above 2π', vase, 7.9, -1, 7],
			[
				'two points',
				[
					[1, 0],
					[0.5, 1],
				],
				3,
				0,
				Math.PI / 2,
			],
		];
		for (const [name, points, segments, phiStart, phiLength] of cases) {
			test(name, () => {
				expectParity(
					lathe({ points, segments, phiStart, phiLength }),
					new THREE.LatheGeometry(
						points?.map(([x, y]) => new THREE.Vector2(x, y)),
						segments,
						phiStart,
						phiLength,
					),
				);
			});
		}
	});

	describe('shape', () => {
		test('the defaults', () => {
			expectParity(shape(), new THREE.ShapeGeometry());
		});
		for (const [name, recipe] of Object.entries(recipes)) {
			for (const curveSegments of [undefined, 5]) {
				test(`${name}, curveSegments ${curveSegments}`, () => {
					expectParity(
						shape({ shapes: recipe(portKit), curveSegments }),
						new THREE.ShapeGeometry(recipe(threeKit) as unknown as THREE.Shape, curveSegments),
					);
				});
			}
		}
	});

	describe('extrude', () => {
		test('the defaults', () => {
			expectParity(extrude(), new THREE.ExtrudeGeometry());
		});
		const optionSets: Record<string, Record<string, unknown>> = {
			'the default bevel': {},
			'no bevel': { bevelEnabled: false },
			'a custom bevel and steps': {
				bevelThickness: 0.3,
				bevelSize: 0.1,
				bevelOffset: 0.05,
				bevelSegments: 5,
				steps: 3,
				depth: 2,
				curveSegments: 4,
			},
			'only a bevel thickness': { bevelThickness: 0.5, depth: 0.25 },
		};
		for (const [recipeName, recipe] of Object.entries(recipes)) {
			for (const [optionName, opts] of Object.entries(optionSets)) {
				test(`${recipeName}, ${optionName}`, () => {
					expectParity(
						extrude({ shapes: recipe(portKit), ...opts }),
						new THREE.ExtrudeGeometry(recipe(threeKit) as unknown as THREE.Shape, opts),
					);
				});
			}
		}

		const paths: Record<
			string,
			() => [ConstructorParameters<typeof CatmullRomCurve3>[0], boolean]
		> = {
			'an open Catmull-Rom path': () => [
				[
					[0, 0, 0],
					[2, 1, 1],
					[4, 0, 3],
					[6, -2, 2],
				],
				false,
			],
			'a closed Catmull-Rom path': () => [
				[
					[-3, 0, 0],
					[0, 2, 1],
					[3, 0, 0],
					[0, -2, -1],
				],
				true,
			],
		};
		for (const [name, make] of Object.entries(paths)) {
			for (const steps of [1, 10]) {
				test(`${name}, ${steps} steps, with holes`, () => {
					const [points, closed] = make();
					const threePoints = (points ?? []).map(
						(p) => new THREE.Vector3(p[0] as number, p[1] as number, p[2] as number),
					);
					const recipe = recipes['a square with a round hole and a square hole'] as Recipe;
					expectParity(
						extrude({
							shapes: recipe(portKit),
							steps,
							extrudePath: new CatmullRomCurve3(points, closed),
						}),
						new THREE.ExtrudeGeometry(recipe(threeKit) as unknown as THREE.Shape, {
							steps,
							extrudePath: new THREE.CatmullRomCurve3(threePoints, closed),
						}),
					);
				});
			}
		}
		test('a cubic Bézier path, with a bevel asked for but turned off', () => {
			expectParity(
				extrude({
					steps: 8,
					bevelEnabled: true,
					extrudePath: new CubicBezierCurve3([0, 0, 0], [0, 3, 0], [3, 3, 2], [4, 0, 4]),
				}),
				new THREE.ExtrudeGeometry(undefined, {
					steps: 8,
					bevelEnabled: true,
					extrudePath: new THREE.CubicBezierCurve3(
						new THREE.Vector3(0, 0, 0),
						new THREE.Vector3(0, 3, 0),
						new THREE.Vector3(3, 3, 2),
						new THREE.Vector3(4, 0, 4),
					),
				}),
			);
		});
		test('a custom texture coordinate generator', () => {
			const portUV: UVGenerator = {
				generateTopUV: (v, a, b, c) =>
					[a, b, c].map((i) => [(v[i * 3] as number) * 0.5, (v[i * 3 + 1] as number) * 0.25]),
				generateSideWallUV: (v, a, b, c, d) =>
					[a, b, c, d].map((i) => [
						v[i * 3 + 2] as number,
						(v[i * 3] as number) + (v[i * 3 + 1] as number),
					]),
			};
			const threeUV = {
				generateTopUV: (_g: unknown, v: number[], a: number, b: number, c: number) =>
					[a, b, c].map(
						(i) => new THREE.Vector2((v[i * 3] as number) * 0.5, (v[i * 3 + 1] as number) * 0.25),
					),
				generateSideWallUV: (
					_g: unknown,
					v: number[],
					a: number,
					b: number,
					c: number,
					d: number,
				) =>
					[a, b, c, d].map(
						(i) =>
							new THREE.Vector2(
								v[i * 3 + 2] as number,
								(v[i * 3] as number) + (v[i * 3 + 1] as number),
							),
					),
			};
			expectParity(
				extrude({ UVGenerator: portUV }),
				new THREE.ExtrudeGeometry(undefined, {
					UVGenerator: threeUV as unknown as THREE.UVGenerator,
				}),
			);
		});
	});

	describe('tube', () => {
		test('the defaults', () => {
			expectParity(tube(), new THREE.TubeGeometry());
		});
		const loop: [number, number, number][] = [
			[-2, 0, 0],
			[0, 1, 1.5],
			[2, 0, 0],
			[0, -1, -1.5],
		];
		const cases: Record<string, [TubeOptions, () => THREE.TubeGeometry]> = {
			'a closed Catmull-Rom loop': [
				{ path: new CatmullRomCurve3(loop, true), tubularSegments: 40, radius: 0.2, closed: true },
				() =>
					new THREE.TubeGeometry(
						new THREE.CatmullRomCurve3(
							loop.map((p) => new THREE.Vector3(...p)),
							true,
						),
						40,
						0.2,
						8,
						true,
					),
			],
			'a chordal Catmull-Rom curve with few segments': [
				{
					path: new CatmullRomCurve3(loop, false, 'chordal'),
					tubularSegments: 7,
					radius: 0.5,
					radialSegments: 5,
				},
				() =>
					new THREE.TubeGeometry(
						new THREE.CatmullRomCurve3(
							loop.map((p) => new THREE.Vector3(...p)),
							false,
							'chordal',
						),
						7,
						0.5,
						5,
					),
			],
			'a Catmull-Rom curve with tension': [
				{ path: new CatmullRomCurve3(loop, true, 'catmullrom', 0.2), closed: true },
				() =>
					new THREE.TubeGeometry(
						new THREE.CatmullRomCurve3(
							loop.map((p) => new THREE.Vector3(...p)),
							true,
							'catmullrom',
							0.2,
						),
						64,
						1,
						8,
						true,
					),
			],
			'a straight line': [
				{ path: new LineCurve3([0, 0, 0], [1, 2, 3]), tubularSegments: 3, radialSegments: 4 },
				() =>
					new THREE.TubeGeometry(
						new THREE.LineCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 2, 3)),
						3,
						1,
						4,
					),
			],
			'a path of 3D curves': [
				{
					path: (() => {
						const p = new CurvePath<[number, number, number]>();
						p.add(new LineCurve3([0, 0, 0], [1, 0, 0]));
						p.add(new QuadraticBezierCurve3([1, 0, 0], [2, 0, 0], [2, 1, 0.5]));
						p.add(new CubicBezierCurve3([2, 1, 0.5], [2, 2, 1], [1, 3, 1], [0, 3, 0]));
						return p;
					})(),
					tubularSegments: 30,
					radius: 0.1,
				},
				() => {
					const p = new THREE.CurvePath<THREE.Vector3>();
					const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
					p.add(new THREE.LineCurve3(v(0, 0, 0), v(1, 0, 0)));
					p.add(new THREE.QuadraticBezierCurve3(v(1, 0, 0), v(2, 0, 0), v(2, 1, 0.5)));
					p.add(new THREE.CubicBezierCurve3(v(2, 1, 0.5), v(2, 2, 1), v(1, 3, 1), v(0, 3, 0)));
					return new THREE.TubeGeometry(p, 30, 0.1);
				},
			],
		};
		for (const [name, [options, makeThree]] of Object.entries(cases)) {
			test(name, () => {
				expectParity(tube(options), makeThree());
			});
		}
	});
});
