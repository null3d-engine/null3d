// The GPU's clock, as the browser reports it in its timestamps. The browser tells no period for
// those values, so the step between them comes from the values themselves: their greatest common
// divisor. A device constant would be wrong on a browser that rounds to another grid, and on one
// whose timing runs turn the rounding off.

/**
 * The greatest common divisor of two whole numbers, treated as positive. A zero gives the other
 * number.
 */
export function gcd(a: number, b: number): number {
	let x = Math.abs(a);
	let y = Math.abs(b);
	while (y !== 0) {
		const rest = x % y;
		x = y;
		y = rest;
	}
	return x;
}

/**
 * The step between whole values in nanoseconds: the greatest common divisor of the non-zero values
 * in the first `count` of them, or 0 when there are none. A step of 1 means the values look exact.
 */
export function commonStep(valuesNs: ArrayLike<number>, count = valuesNs.length): number {
	let step = 0;
	for (let k = 0; k < count; k++) {
		const ns = Math.abs(valuesNs[k] as number);
		if (ns > 0 && Number.isFinite(ns)) step = gcd(step, ns);
	}
	return step;
}

/** Below this step, in milliseconds, GPU timestamps look exact rather than rounded. */
export const MIN_STEP_MS = 0.01;

/** A step in nanoseconds as milliseconds, or null when it is too small to be rounding. */
export function stepMs(ns: number): number | null {
	const ms = ns / 1e6;
	return ms >= MIN_STEP_MS ? ms : null;
}
