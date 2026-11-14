// The small value types that every part of the plant core shares. Records are plain data, so they
// cross to a job worker and into a test unchanged. Every number is in metres, degrees, linear colour
// or a share from 0 to 1, as each field says.

/**
 * A linear RGB colour, each channel from 0 to 1.
 *
 * @category api/vegetation
 */
export type Rgb = readonly [number, number, number];

/**
 * Two numbers, such as a point in a texture or a profile's radius and height.
 *
 * @category api/vegetation
 */
export type Vec2 = readonly [number, number];

/**
 * Three numbers, such as a point or a direction in plant space: metres, with +Y up.
 *
 * @category api/vegetation
 */
export type Vec3 = readonly [number, number, number];

/**
 * A number that changes along a coordinate t from 0 to 1: [t, value] pairs with t rising, linear
 * between pairs and constant past the ends. A bare number is the same at every t. Each field that
 * takes a curve says what its t is.
 *
 * @category api/vegetation
 */
export type Curve = number | readonly (readonly [t: number, value: number])[];

/**
 * A number drawn per item: a mean and the half-width of an even spread around it. A bare number has
 * no spread.
 *
 * @category api/vegetation
 */
export type Spread = number | { readonly mean: number; readonly spread: number };

/**
 * The season a plant grows for: its leaves, their colour, its flowers and its fruit.
 *
 * @category api/vegetation
 */
export type Season = 'summer' | 'autumn' | 'winter' | 'blossom';

/**
 * The mesh detail tier, which follows the quality preset. Growth never depends on it: a tier
 * changes the triangles of a plant, never its shape.
 *
 * @category api/vegetation
 */
export type Detail = 'low' | 'medium' | 'high' | 'ultra';

/**
 * The detail tiers in order, so a tier's index picks a prototype's mesh.
 *
 * @category api/vegetation
 */
export const DETAILS: readonly Detail[] = ['low', 'medium', 'high', 'ultra'];

/**
 * The most side shoots that one joint of a shoot prototype puts out.
 *
 * @category api/vegetation
 */
export const SIDE_SHOOTS_MOST = 3;

/**
 * The largest share of a growth unit between one side shoot of a joint and the next, so that the
 * most side shoots a joint puts out all leave within their own unit.
 *
 * @category api/vegetation
 */
export const LATERAL_GAP_MOST = 0.45;

/**
 * The shortest straight piece, in metres, that a bent internode breaks into.
 *
 * @category api/vegetation
 */
export const BEND_PIECE_LEAST = 0.005;

/**
 * The value of a curve at `t`: linear between its pairs and constant past its ends.
 *
 * @param curve The curve.
 * @param t The coordinate the curve's field names.
 * @returns The value at `t`.
 * @category api/vegetation
 */
export function curveAt(curve: Curve, t: number): number {
	if (typeof curve === 'number') return curve;
	const count = curve.length;
	if (count === 0) return 0;
	const first = curve[0] as readonly [number, number];
	if (t <= first[0]) return first[1];
	for (let i = 1; i < count; i++) {
		const right = curve[i] as readonly [number, number];
		if (t <= right[0]) {
			const left = curve[i - 1] as readonly [number, number];
			const span = right[0] - left[0];
			return span > 0 ? left[1] + ((t - left[0]) / span) * (right[1] - left[1]) : right[1];
		}
	}
	return (curve[count - 1] as readonly [number, number])[1];
}

/**
 * The mean of a spread.
 *
 * @param spread The spread.
 * @returns Its mean.
 * @category api/vegetation
 */
export function spreadMean(spread: Spread): number {
	return typeof spread === 'number' ? spread : spread.mean;
}

/**
 * One draw from a spread: the mean moved by up to the half-width, by a choice between 0 and 1.
 *
 * @param spread The spread.
 * @param unit A choice in [0, 1), such as one from `unitAt`.
 * @returns The drawn value.
 * @category api/vegetation
 */
export function spreadAt(spread: Spread, unit: number): number {
	if (typeof spread === 'number') return spread;
	return spread.mean + (unit * 2 - 1) * spread.spread;
}

/**
 * The largest value a spread can draw.
 *
 * @param spread The spread.
 * @returns Its mean plus its half-width.
 * @category api/vegetation
 */
export function spreadMax(spread: Spread): number {
	return typeof spread === 'number' ? spread : spread.mean + Math.abs(spread.spread);
}
