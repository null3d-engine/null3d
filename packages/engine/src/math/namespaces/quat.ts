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

export * from '../quat';

/** The rotation of `rad` radians about `axis`, a vector of length 1. */
export const setAxisAngle = /* @__PURE__ */ makeSetAxisAngle(Math.sin, Math.cos);

/**
 * The rotation of Euler angles in radians, applied in `order`, `'XYZ'` by default, as three.js's
 * `setFromEuler`. gl-matrix's `fromEuler` takes degrees, but this one takes radians.
 */
export const fromEuler = /* @__PURE__ */ makeFromEuler(Math.sin, Math.cos);

/** Turns the rotation `a` by `rad` radians about its own X axis. */
export const rotateX = /* @__PURE__ */ makeRotateX(Math.sin, Math.cos);

/** Turns the rotation `a` by `rad` radians about its own Y axis. */
export const rotateY = /* @__PURE__ */ makeRotateY(Math.sin, Math.cos);

/** Turns the rotation `a` by `rad` radians about its own Z axis. */
export const rotateZ = /* @__PURE__ */ makeRotateZ(Math.sin, Math.cos);

/**
 * The rotation a fraction `t` of the way from `a` to `b` along the shortest arc, turning at an even
 * speed, as three.js's `slerp`.
 */
export const slerp = /* @__PURE__ */ makeSlerp(Math.sin, Math.acos);
