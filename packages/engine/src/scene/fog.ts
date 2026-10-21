// The scene's fog. The core keeps it, and the lit and unlit shaders mix each object's linear color
// toward the fog color by its straight-line distance from the camera, along a curve. The fog can
// thin with height and glow toward the main directional light. The background takes no fog. The
// volumetric fog lights the same fog with the sun and the point and spot lights, through their
// shadows, in a grid that follows the camera's view (D-133).

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
	/**
	 * Lights the fog with the main directional light and the point and spot lights, through their
	 * shadows: sun rays through gaps in trees, and glowing cones under lamps and headlights. `true`
	 * takes the default options. While it draws, it replaces `sunGlow` with its own light of the
	 * sun. It needs HDR color, and the quality setting `fogSlices` above 0: on the Low preset the
	 * fog keeps its sun glow. The default is `false`.
	 */
	volumetric?: boolean | FogVolumeOptions;
}

/**
 * Options of the volumetric fog in `scene.setFog`. The fog's `density` and `heightFalloff` say
 * where the air holds fog, so the light falls through the same fog that dims the objects.
 *
 * @category api/scene
 */
export interface FogVolumeOptions {
	/**
	 * How much of the lights' light the fog scatters toward the camera, 0 or more: 1 scatters as
	 * much as the fog's density gives. Raise it for bolder rays. The default is 1.
	 */
	intensity?: number;
	/**
	 * How much light the fog scatters forward, from -0.95 to 0.95: 0 scatters it evenly in every
	 * direction, and values toward 0.95 gather it around the lights, as haze around a low sun.
	 * The default is 0.6.
	 */
	anisotropy?: number;
	/**
	 * How far along the view the lit fog reaches, above 0. Past it, the fog still scatters the
	 * sun's light, without shadows. A shorter reach gives finer rays near the camera. The default
	 * is 100.
	 */
	distance?: number;
}

const DEFAULT_DENSITY = 0.01;
/** three.js's defaults for `Fog`. */
const DEFAULT_NEAR = 1;
const DEFAULT_FAR = 1000;
const DEFAULT_SUN_GLOW_EXPONENT = 8;
const DEFAULT_VOLUME_INTENSITY = 1;
const DEFAULT_ANISOTROPY = 0.6;
const DEFAULT_VOLUME_DISTANCE = 100;
/** The strongest anisotropy, which keeps the phase function finite. */
const MAX_ANISOTROPY = 0.95;

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
 * Throws E1108 for a volumetric fog option out of its range, and E1203 for a value that is not
 * finite. Call it inside `if (DEV)`.
 */
function checkVolume(
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

/**
 * Gives the scene `fog`, or no fog for null, and its volumetric fog. Returns true while the
 * volumetric fog is on. The linear color and the numbers go to the core through its call values,
 * so the call allocates nothing.
 */
export function setSceneFog(core: CoreMemory, fog: FogOptions | null): boolean {
	if (fog === null) {
		core.glue.setFog(FOG_CURVE_NONE);
		const none = core.callValues();
		none[0] = 0;
		none[1] = 0;
		none[2] = 0;
		none[3] = 0;
		core.glue.setFogVolume(false);
		return false;
	}
	const values = core.callValues();
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
	const on = volumetric === true || volume !== undefined;
	let intensity = DEFAULT_VOLUME_INTENSITY;
	let anisotropy = DEFAULT_ANISOTROPY;
	let distance = DEFAULT_VOLUME_DISTANCE;
	if (volume !== undefined) {
		if ('intensity' in volume) intensity = volume.intensity ?? intensity;
		if ('anisotropy' in volume) anisotropy = volume.anisotropy ?? anisotropy;
		if ('distance' in volume) distance = volume.distance ?? distance;
	}
	if (DEV) {
		checkFog(fog, values);
		if (on) checkVolume(volume, intensity, anisotropy, distance);
	}
	writeLinearColor(values, fog.color, CALL);
	core.glue.setFog(CURVES[fog.curve ?? 'exponential']);
	// The volumetric fog reads its four numbers from the call values, which setFog has read.
	const density = values[FIRST] as number;
	values[0] = intensity;
	values[1] = anisotropy;
	values[2] = distance;
	values[3] = density;
	core.glue.setFogVolume(on);
	return on;
}
