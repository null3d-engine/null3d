// The maths entry, `@null3d/engine/math`, for code that must give the same bits on every
// JavaScript engine, such as a game's simulation that a server replays. It holds `createMath` and
// the array types. Its sub-paths hold the helpers that use exact arithmetic alone:
// `@null3d/engine/math/vec3`, `/quat`, `/mat4` and `/math`, which are ./vec3.ts, ./quat.ts, ./mat4.ts
// and ./math.ts. Each sub-path is a module of named functions, so a bundler keeps only the helpers
// that a simulation calls; a re-export of whole namespaces would keep every helper of each.
//
// Nothing that this entry reaches names `Math.sin`, `Math.random`, `**` or any page, worker,
// generated or WebAssembly code. `math-entry.test.ts` bundles a simulation that imports it and
// checks the bundle for every name that a deterministic simulation may not use.

export {
	createMath,
	type MathFunctions,
	type MathHelpers,
	type NumberHelpers,
	type QuatHelpers,
	type Vec3Helpers,
} from './create-math';
export type { EulerOrder, Mat4Like, QuatLike, Vec2Like, Vec3Like } from './types';
