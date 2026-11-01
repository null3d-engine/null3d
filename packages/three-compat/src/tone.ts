// The two tone curves that three.js has and the engine keeps out of its core, from three.js's own
// formulas. `post.set({ toneMapping })` takes one as its tone mapping, as a port of a three.js
// scene sets `renderer.toneMapping`.
import type { ToneCurve } from '@null3d/engine';
import cineonCurve from './cineon.wgsl';
import reinhardCurve from './reinhard.wgsl';

/**
 * Reinhard's tone curve, with three.js's `ReinhardToneMapping` formula. Give it to
 * `post.set({ toneMapping })` where the three.js scene sets `ReinhardToneMapping`.
 *
 * @category api/three-compat
 */
export const reinhard: ToneCurve = reinhardCurve;

/**
 * Cineon's tone curve, with three.js's `CineonToneMapping` formula, the filmic operator of Jim Hejl
 * and Richard Burgess-Dawson. Give it to `post.set({ toneMapping })` where the three.js scene sets
 * `CineonToneMapping`.
 *
 * @category api/three-compat
 */
export const cineon: ToneCurve = cineonCurve;
