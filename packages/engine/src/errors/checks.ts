// Checks that run only in development builds. Bundlers replace `__SOKKO3D_DEV__` with false in
// release builds, so every check below becomes dead code and leaves the download. A check that
// passes allocates nothing, so setters can run it every frame.

import { EngineError } from './engine-error';

declare const __SOKKO3D_DEV__: boolean | undefined;

/** True in development builds, and whenever no bundler has defined the constant. */
export const DEV: boolean = typeof __SOKKO3D_DEV__ === 'undefined' ? true : __SOKKO3D_DEV__;

/** Something an error message can name, such as '"Player" (slot 12)'. */
export interface Described {
	describe(): string;
}

const AXES = ['x', 'y', 'z', 'w'] as const;

/** Throws E1203 when a vector component is not finite. Call it inside `if (DEV)`. */
export function checkVector(
	call: string,
	target: Described,
	x: number,
	y: number,
	z: number,
	w = 0,
): void {
	if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) && Number.isFinite(w)) return;
	const values = [x, y, z, w];
	const index = values.findIndex((v) => !Number.isFinite(v));
	throw new EngineError(
		'E1203',
		`${call}() got ${values[index]} for ${AXES[index]} on ${target.describe()}.`,
	);
}

/** Throws E1203 when a number is not finite. Call it inside `if (DEV)`. */
export function checkNumber(call: string, name: string, value: number, target: Described): void {
	if (!Number.isFinite(value))
		throw new EngineError('E1203', `${call}() got ${value} for ${name} on ${target.describe()}.`);
}
