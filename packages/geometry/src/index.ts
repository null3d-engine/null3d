// Geometry generators for null3D, ported from three.js: torus knots, polyhedra, lathes, flat
// shapes, extrusions and tubes, with the curves, paths and shapes they take. Each generator
// returns plain arrays for geometry.fromArrays, with the numbers that three.js's geometry holds.

export { Curve, type FrenetFrames } from './curve';
export {
	ArcCurve,
	CatmullRomCurve3,
	type CatmullRomCurveType,
	CubicBezierCurve,
	CubicBezierCurve3,
	EllipseCurve,
	LineCurve,
	LineCurve3,
	QuadraticBezierCurve,
	QuadraticBezierCurve3,
	SplineCurve,
} from './curves';
export { type ExtrudeOptions, extrude, type UVGenerator, WorldUVGenerator } from './extrude';
export { type LatheOptions, lathe } from './lathe';
export { CurvePath, Path, Shape } from './path';
export {
	dodecahedron,
	icosahedron,
	octahedron,
	type PolyhedronOptions,
	type PolyhedronShapeOptions,
	polyhedron,
	tetrahedron,
} from './polyhedra';
export { type ShapeOptions, shape } from './shape';
/**
 * Helpers for 2D outlines, like three.js's `ShapeUtils`: `ShapeUtils.area`,
 * `ShapeUtils.isClockWise` and `ShapeUtils.triangulateShape`.
 *
 * @category api/geometry
 */
export * as ShapeUtils from './shape-utils';
export { type TorusKnotOptions, torusKnot } from './torus-knot';
export { type TubeOptions, tube } from './tube';
export type { GeneratedArrays, Vec2Like } from './types';
