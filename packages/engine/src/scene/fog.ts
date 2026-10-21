// The scene's fog. The core keeps it, and the lit and unlit shaders mix each object's linear color
// toward the fog color by its straight-line distance from the camera, along a curve. The fog can
// thin with height and glow toward the main directional light. The background takes no fog. The
// volumetric fog lights the same fog with the sun and the point and spot lights, through their
// shadows, in a grid that follows the camera's view (D-133).

import { DEV } from '../errors/checks';
import {
	FOG_CURVE_EXP2,
	FOG_CURVE_EXPONENTIAL,
	FOG_CURVE_LINEAR,
	FOG_CURVE_NONE,
} from '../generated/core';
import { type ColorInput, writeLinearColor } from './color';
import {
	CALL,
	CURVES,
	checkFog,
	checkVolume,
	DEFAULT_ANISOTROPY,
	DEFAULT_DENSITY,
	DEFAULT_FAR,
	DEFAULT_NEAR,
	FIRST,
	fogNumbers,
	VALUE_NAMES,
} from './fog-check';
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
	const { on, intensity, anisotropy, distance } = fogNumbers(fog, values);
	if (DEV) {
		checkFog(fog, values);
		const volume =
			fog.volumetric && typeof fog.volumetric === 'object' ? fog.volumetric : undefined;
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
