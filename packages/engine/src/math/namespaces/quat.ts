// The main entry's `quat` namespace: the exact helpers of ../quat.ts, and the helpers that turn by an
// angle, built once, when the module loads, on the browser's `Math.sin`, `Math.cos` and `Math.acos`
// by their one implementation in ../create-math.ts. A sketch draws with these. A deterministic
// simulation imports `@null3d/engine/math/quat` and builds the angle helpers with `createMath`.
// A bundler drops each built helper that nothing calls.

import {
	makeFromEuler,
	makeRotateX,
	makeRotateY,
	makeRotateZ,
	makeSetAxisAngle,
	makeSlerp,
} from '../create-math';
import type { EulerOrder, QuatLike, Vec3Like } from '../types';

export * from '../quat';

/** The rotation of `rad` radians about `axis`, a vector of length 1. */
export const setAxisAngle: <T extends QuatLike>(out: T, axis: Vec3Like, rad: number) => T =
	/* @__PURE__ */ makeSetAxisAngle(Math.sin, Math.cos);

/**
 * The rotation of Euler angles in radians, applied in `order`, `'XYZ'` by default. gl-matrix's
 * `fromEuler` takes degrees, but this one takes radians.
 */
export const fromEuler: <T extends QuatLike>(
	out: T,
	x: number,
	y: number,
	z: number,
	order?: EulerOrder,
) => T = /* @__PURE__ */ makeFromEuler(Math.sin, Math.cos);

/** Turns the rotation `a` by `rad` radians about its own X axis. */
export const rotateX: <T extends QuatLike>(out: T, a: QuatLike, rad: number) => T =
	/* @__PURE__ */ makeRotateX(Math.sin, Math.cos);

/** Turns the rotation `a` by `rad` radians about its own Y axis. */
export const rotateY: <T extends QuatLike>(out: T, a: QuatLike, rad: number) => T =
	/* @__PURE__ */ makeRotateY(Math.sin, Math.cos);

/** Turns the rotation `a` by `rad` radians about its own Z axis. */
export const rotateZ: <T extends QuatLike>(out: T, a: QuatLike, rad: number) => T =
	/* @__PURE__ */ makeRotateZ(Math.sin, Math.cos);

/**
 * The rotation a fraction `t` of the way from `a` to `b` along the shortest arc, turning at an even
 * speed.
 */
export const slerp: <T extends QuatLike>(out: T, a: QuatLike, b: QuatLike, t: number) => T =
	/* @__PURE__ */ makeSlerp(Math.sin, Math.acos);
