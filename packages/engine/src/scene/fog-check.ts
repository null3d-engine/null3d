// The checks of `scene.setFog`, and the tables that they and the write share. They stay in the
// start so that a bad argument throws at the call, while the write itself loads on the first call
// that sets fog. Release builds drop the checks, so a start holds only the tables.

import { checkNumber, type Described } from '../errors/checks';
import { EngineError } from '../errors/engine-error';
import { FOG_CURVE_EXP2, FOG_CURVE_EXPONENTIAL, FOG_CURVE_LINEAR } from '../generated/core';
import type { FogCurve, FogOptions, FogVolumeOptions } from './fog';

export const DEFAULT_DENSITY = 0.01;
/** three.js's defaults for `Fog`. */
export const DEFAULT_NEAR = 1;
export const DEFAULT_FAR = 1000;
export const DEFAULT_SUN_GLOW_EXPONENT = 8;
export const DEFAULT_VOLUME_INTENSITY = 1;
export const DEFAULT_ANISOTROPY = 0.6;
export const DEFAULT_VOLUME_DISTANCE = 100;
/** The strongest anisotropy, which keeps the phase function finite. */
export const MAX_ANISOTROPY = 0.95;

export const CURVES: Readonly<Record<FogCurve, number>> = {
	exponential: FOG_CURVE_EXPONENTIAL,
	exp2: FOG_CURVE_EXP2,
	linear: FOG_CURVE_LINEAR,
};

/** The place of the fog's first number in the core's call values, after the color. */
export const FIRST = 3;
/** The option that gives each of the fog's numbers, in the order that the core takes them. */
export const VALUE_NAMES = [
	'density',
	'near',
	'far',
	'height',
	'heightFalloff',
	'sunGlow',
	'sunGlowExponent',
] as const;

export const CALL = 'setFog';
export const FOG: Described = { describe: () => 'the fog' };

/** Throws E1108 unless `value` is 0 or more. */
export function checkNotNegative(name: string, value: number): void {
	if (!(value >= 0))
		throw new EngineError('E1108', `${CALL}() got the ${name} ${value}; it takes 0 or more.`);
}

/**
 * Throws E1108 for an option that three.js's fog or an older call shape uses, an unknown curve, a
 * far distance that is not beyond the near one, or a value below its range, and E1203 for a value
 * that is not finite. Call it inside `if (DEV)`.
 */
export function checkFog(fog: FogOptions, values: Float64Array): void {
	if ('type' in fog)
		throw new EngineError(
			'E1108',
			`${CALL}() got a type option. Name the fog's shape with curve: 'exponential', 'exp2' or 'linear'.`,
		);
	if (fog.curve !== undefined && !(fog.curve in CURVES))
		throw new EngineError(
			'E1108',
			`${CALL}() got the curve ${JSON.stringify(fog.curve)}. It takes 'exponential', 'exp2' or 'linear'.`,
		);
	const value = (k: number) => values[FIRST + k] as number;
	for (const [k, name] of VALUE_NAMES.entries()) checkNumber(CALL, name, value(k), FOG);
	const density = value(0);
	const near = value(1);
	const far = value(2);
	const heightFalloff = value(4);
	const sunGlow = value(5);
	const sunGlowExponent = value(6);
	if (!(far > near))
		throw new EngineError(
			'E1108',
			`${CALL}() got the near distance ${near} and the far distance ${far}. The far distance must be above the near one.`,
		);
	checkNotNegative('density', density);
	checkNotNegative('height falloff', heightFalloff);
	checkNotNegative('sun glow', sunGlow);
	if (!(sunGlowExponent > 0))
		throw new EngineError(
			'E1108',
			`${CALL}() got the sun glow exponent ${sunGlowExponent}; it takes a number above 0.`,
		);
}

/** The volumetric fog's numbers, as its options give them. */
export interface FogNumbers {
	/** True while the volumetric fog is on. */
	on: boolean;
	intensity: number;
	anisotropy: number;
	distance: number;
}

/**
 * Writes the fog's numbers into `values`, from its options and their defaults, and gives the
 * volumetric fog's numbers. It touches no core: the caller still checks them, and the write that
 * loads on first use gives the core the same numbers.
 */
export function fogNumbers(fog: FogOptions, values: Float64Array): FogNumbers {
	values[FIRST] = fog.density ?? DEFAULT_DENSITY;
	values[FIRST + 1] = fog.near ?? DEFAULT_NEAR;
	values[FIRST + 2] = fog.far ?? DEFAULT_FAR;
	values[FIRST + 3] = fog.height ?? 0;
	values[FIRST + 4] = fog.heightFalloff ?? 0;
	values[FIRST + 5] = fog.sunGlow ?? 0;
	values[FIRST + 6] = fog.sunGlowExponent ?? DEFAULT_SUN_GLOW_EXPONENT;
	// `volumetric: true` takes every default. Each number of the sketch's own options goes into a
	// local, read only where the object holds it: a read that can give `undefined` boxes a fraction.
	const { volumetric } = fog;
	const volume = volumetric && typeof volumetric === 'object' ? volumetric : undefined;
	let intensity = DEFAULT_VOLUME_INTENSITY;
	let anisotropy = DEFAULT_ANISOTROPY;
	let distance = DEFAULT_VOLUME_DISTANCE;
	if (volume !== undefined) {
		if ('intensity' in volume) intensity = volume.intensity ?? intensity;
		if ('anisotropy' in volume) anisotropy = volume.anisotropy ?? anisotropy;
		if ('distance' in volume) distance = volume.distance ?? distance;
	}
	return { on: volumetric === true || volume !== undefined, intensity, anisotropy, distance };
}

/**
 * Throws E1108 for a volumetric fog option out of its range, and E1203 for a value that is not
 * finite. Call it inside `if (DEV)`.
 */
export function checkVolume(
	volume: FogVolumeOptions | undefined,
	intensity: number,
	anisotropy: number,
	distance: number,
): void {
	checkNumber(CALL, 'volumetric.intensity', intensity, FOG);
	checkNumber(CALL, 'volumetric.anisotropy', anisotropy, FOG);
	checkNumber(CALL, 'volumetric.distance', distance, FOG);
	checkNotNegative('volumetric intensity', intensity);
	if (!(Math.abs(anisotropy) <= MAX_ANISOTROPY))
		throw new EngineError(
			'E1108',
			`${CALL}() got the volumetric anisotropy ${anisotropy}; it takes a number from -0.95 to 0.95.`,
		);
	if (!(distance > 0))
		throw new EngineError(
			'E1108',
			`${CALL}() got the volumetric distance ${distance}; it takes a number above 0.`,
		);
	if (volume && 'density' in volume)
		throw new EngineError(
			'E1108',
			`${CALL}() got a density in volumetric. The volumetric fog takes the fog's own density: set density beside color.`,
		);
}
