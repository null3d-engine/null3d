// The main entry's `vec3` namespace: the exact helpers of ../vec3.ts, and `angle`, built once, when
// the module loads, on the browser's `Math.acos` by its one implementation in ../create-math.ts. A
// sketch draws with these. A deterministic simulation imports `@null3d/engine/math/vec3` and builds
// `angle` with `createMath`.

import { makeAngle } from '../create-math';
import type { Vec3Like } from '../types';

export * from '../vec3';

/** The angle between `a` and `b` in radians, from 0 to π. It is π / 2 when either vector is zero. */
export const angle: (a: Vec3Like, b: Vec3Like) => number = /* @__PURE__ */ makeAngle(Math.acos);
