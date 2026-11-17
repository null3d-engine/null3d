// The main entry's `math` namespace: the exact number helpers of ../math.ts, `damp`, built once,
// when the module loads, on the browser's `Math.exp` by its one implementation in ../create-math.ts,
// and the random generator of ../random.ts. A sketch draws with these. A deterministic simulation
// imports `@null3d/engine/math/math`, builds `damp` with `createMath`, and draws its random numbers
// from a generator of its own.

import { makeDamp } from '../create-math';

export * from '../math';
export * from '../random';

/**
 * Moves `x` toward `y` by an amount that suits the frame's step `dt` in seconds, so the motion looks
 * the same at every frame rate. A larger `lambda` moves faster.
 */
export const damp = /* @__PURE__ */ makeDamp(Math.exp);
