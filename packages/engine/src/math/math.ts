// Number helpers with three.js's names and arithmetic. Each uses exact arithmetic only, so a
// deterministic simulation can import this module through the maths entry
// (`@null3d/engine/math/math`) and get the same bits on every JavaScript engine. The main entry's
// `math` namespace adds `damp`, built on the browser's `Math.exp` (create-math.ts), and the random
// generator (random.ts).

/** `value` limited to the range from `min` to `max`. */
export function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

/** The number a fraction `t` of the way from `x` to `y`. */
export function lerp(x: number, y: number, t: number): number {
	return (1 - t) * x + t * y;
}

/** The fraction of the way from `x` to `y` at which `value` lies: the reverse of `lerp`. It is 0 when `x` equals `y`. */
export function inverseLerp(x: number, y: number, value: number): number {
	return x === y ? 0 : (value - x) / (y - x);
}

/** `x` moved from the range `a1` to `a2` onto the range `b1` to `b2`. */
export function mapLinear(x: number, a1: number, a2: number, b1: number, b2: number): number {
	return b1 + ((x - a1) * (b2 - b1)) / (a2 - a1);
}

/** 0 when `x` is at or below `min`, 1 at or above `max`, and a smooth curve between them. */
export function smoothstep(x: number, min: number, max: number): number {
	if (x <= min) return 0;
	if (x >= max) return 1;
	const t = (x - min) / (max - min);
	return t * t * (3 - 2 * t);
}

/** An angle in degrees as radians. */
export function degToRad(degrees: number): number {
	return degrees * (Math.PI / 180);
}

/** An angle in radians as degrees. */
export function radToDeg(radians: number): number {
	return radians * (180 / Math.PI);
}

/** The remainder of `n` divided by `m`, with the sign of `m`. For example, -1 modulo 3 is 2. */
export function euclideanModulo(n: number, m: number): number {
	return ((n % m) + m) % m;
}
