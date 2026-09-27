// Checks that run only in development builds. Bundlers replace `__SOKKO3D_DEV__` with false in
// release builds, so every check below becomes dead code and leaves the download.

import { EngineError } from './engine-error';

declare const __SOKKO3D_DEV__: boolean | undefined;

/** True in development builds, and whenever no bundler has defined the constant. */
export const DEV: boolean = typeof __SOKKO3D_DEV__ === 'undefined' ? true : __SOKKO3D_DEV__;

/** Throws E1203 when any value is not a finite number. Call it inside `if (DEV)`. */
export function checkFinite(
	call: string,
	names: readonly string[],
	values: readonly number[],
	object: string,
): void {
	for (let i = 0; i < values.length; i++) {
		const value = values[i] as number;
		if (!Number.isFinite(value)) {
			throw new EngineError('E1203', `${call}() got ${value} for ${names[i]} on ${object}.`);
		}
	}
}
