// The scene's fog. The core keeps it, and the lit and unlit shaders mix each object's linear color
// toward the fog color by its straight-line distance from the camera, along a curve. The fog can
// thin with height and glow toward the main directional light. The background takes no fog.

import { checkNumber, DEV, type Described } from '../errors/checks';
import { EngineError } from '../errors/engine-error';
import {
	FOG_CURVE_EXP2,
	FOG_CURVE_EXPONENTIAL,
	FOG_CURVE_LINEAR,
	FOG_CURVE_NONE,
} from '../generated/core';
import { type ColorInput, writeLinearColor } from './color';
import type { CoreMemory } from './memory';

/**
 * How fog thickens with distance. Exponential fog, `'exponential'`, follows light through an even
 * haze. An object at distance d takes the fog color by a factor of 1 - exp(-density × d).
 * Exponential squared fog, `'exp2'`, thickens with the square of the distance, as three.js's
 * `FogExp2`: 1 - exp(-(density × d)²). Linear fog, `'linear'`, is clear up to `near` and hides
 * objects from `far`, with a smooth step between them, as three.js's `Fog`.
 *
 * @category api/scene
 */
export type FogCurve = 'exponential' | 'exp2' | 'linear';

/**
 * Options of `scene.setFog`. Fog measures each object's straight-line distance from the camera, so
 * an object keeps its fog as the camera turns.
 *
 * @category api/scene
 */
export interface FogOptions {
	/** The fog's color. Give the background the same color, because the background takes no fog. */
	color: ColorInput;
	/** How the fog thickens with distance. The default is `'exponential'`. */
	curve?: FogCurve;
	/**
	 * How fast exponential and exponential squared fog thicken with distance: 0 or more. At the
	 * default of 0.01, exponential fog hides about two thirds of an object 100 units away.
	 */
	density?: number;
	/** The distance where linear fog starts. The default is 1. */
	near?: number;
	/** The distance from which linear fog hides every object. It must be above `near`. The default is 1000. */
	far?: number;
	/**
	 * The height where the fog has its `density`, or its `near` and `far` distances. Above it, fog
	 * with a `heightFalloff` thins; below it, the fog thickens. The default is 0.
	 */
	height?: number;
	/**
	 * How fast the fog thins with height, 0 or more: its density falls by a factor of e, to about a
	 * third, every 1 / `heightFalloff` units up. The engine adds up the fog along each line of sight,
	 * so a view down into a valley sees thick fog and a view up sees clear air. The default is 0: the
	 * fog is the same at every height.
	 */
	heightFalloff?: number;
	/**
	 * How much of the main directional light the fog scatters toward the camera, 0 or more. Fog
	 * toward that light then glows in the light's color. The default is 0: no glow.
	 */
	sunGlow?: number;
	/**
	 * How tightly the glow gathers around the light's direction, above 0. Higher values make a
	 * smaller glow. The default is 8.
	 */
	sunGlowExponent?: number;
}

const DEFAULT_DENSITY = 0.01;
/** three.js's defaults for `Fog`. */
const DEFAULT_NEAR = 1;
const DEFAULT_FAR = 1000;
const DEFAULT_SUN_GLOW_EXPONENT = 8;

const CURVES: Readonly<Record<FogCurve, number>> = {
	exponential: FOG_CURVE_EXPONENTIAL,
	exp2: FOG_CURVE_EXP2,
	linear: FOG_CURVE_LINEAR,
};

/** The place of the fog's first number in the core's call values, after the color. */
const FIRST = 3;
/** The option that gives each of the fog's numbers, in the order that the core takes them. */
const VALUE_NAMES = [
	'density',
	'near',
	'far',
	'height',
	'heightFalloff',
	'sunGlow',
	'sunGlowExponent',
] as const;

const CALL = 'setFog';
const FOG: Described = { describe: () => 'the fog' };

/** Throws E1108 unless `value` is 0 or more. */
function checkNotNegative(name: string, value: number): void {
	if (!(value >= 0))
		throw new EngineError('E1108', `${CALL}() got the ${name} ${value}; it takes 0 or more.`);
}

/**
 * Throws E1108 for an option that three.js's fog or an older call shape uses, an unknown curve, a
 * far distance that is not beyond the near one, or a value below its range, and E1203 for a value
 * that is not finite. Call it inside `if (DEV)`.
 */
function checkFog(fog: FogOptions, values: Float64Array): void {
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

/**
 * Gives the scene `fog`, or no fog for null. The linear color and the numbers go to the core
 * through its call values, so the call allocates nothing.
 */
export function setSceneFog(core: CoreMemory, fog: FogOptions | null): void {
	if (fog === null) {
		core.glue.setFog(FOG_CURVE_NONE);
		return;
	}
	const values = core.callValues();
	values[FIRST] = fog.density ?? DEFAULT_DENSITY;
	values[FIRST + 1] = fog.near ?? DEFAULT_NEAR;
	values[FIRST + 2] = fog.far ?? DEFAULT_FAR;
	values[FIRST + 3] = fog.height ?? 0;
	values[FIRST + 4] = fog.heightFalloff ?? 0;
	values[FIRST + 5] = fog.sunGlow ?? 0;
	values[FIRST + 6] = fog.sunGlowExponent ?? DEFAULT_SUN_GLOW_EXPONENT;
	if (DEV) checkFog(fog, values);
	writeLinearColor(values, fog.color, CALL);
	core.glue.setFog(CURVES[fog.curve ?? 'exponential']);
}
