/**
 * A species' sheath target for the review: the colours its sheath surface should show at the foot and
 * collar of the column, in linear reflectance, and the share of the column's top over which the
 * collar's colour takes over. The target belongs to the species' review data, not to the plant record:
 * the record's colour draws the surface, and this target is the authored colour the review compares it
 * with. A species that names one colour gives it at both ends.
 */
export interface SheathTarget {
	/** The colour at the column's foot, in linear reflectance, from 0 to 1. */
	readonly foot: readonly [number, number, number];
	/** The colour at the column's collar, in linear reflectance, from 0 to 1. */
	readonly collar: readonly [number, number, number];
	/** The share of the column's top, from 0 to 1, over which the collar's colour takes over. */
	readonly reach: number;
}

/** The key in a species' review data that names its sheath target. */
export const SHEATH_TARGET_KEY = '_sheath';

/** The share of a surface's top a single-colour target gives to the collar's band. */
const FLAT_REACH = 0.5;

const isRgb = (value: unknown): value is readonly [number, number, number] =>
	Array.isArray(value) &&
	value.length === 3 &&
	value.every((channel) => typeof channel === 'number' && channel >= 0 && channel <= 1);

/**
 * Reads a sheath target from a species' review data. An Rgb names one colour at both ends; an object
 * names the foot and collar colours and the reach. A malformed target is refused by name, so a
 * mistyped value is not read as a colour.
 */
export function readSheathTarget(value: unknown): SheathTarget | undefined {
	if (value === undefined || value === null) return undefined;
	if (isRgb(value)) return { foot: value, collar: value, reach: FLAT_REACH };
	if (typeof value !== 'object' || Array.isArray(value))
		throw new Error(`${SHEATH_TARGET_KEY} must be an Rgb or an object with foot, collar and reach`);
	const named = value as Record<string, unknown>;
	if (!isRgb(named.foot) || !isRgb(named.collar))
		throw new Error(`${SHEATH_TARGET_KEY} foot and collar must be Rgb colours from 0 to 1`);
	if (typeof named.reach !== 'number' || !(named.reach >= 0 && named.reach <= 1))
		throw new Error(`${SHEATH_TARGET_KEY} reach must be a number from 0 to 1`);
	return { foot: named.foot, collar: named.collar, reach: named.reach };
}

/** The sheath target a parsed species review data object names, if any. */
export function sheathTargetOf(data: Record<string, unknown>): SheathTarget | undefined {
	return readSheathTarget(data[SHEATH_TARGET_KEY]);
}
