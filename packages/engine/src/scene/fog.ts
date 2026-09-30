// The scene's fog, as three.js's `Fog` and `FogExp2`, with their formulas and defaults. The core
// keeps it, and the lit and unlit shaders mix each object's linear color toward the fog color by
// its depth along the camera's view. The background takes no fog.

import { checkNumber, DEV, type Described } from '../errors/checks';
import { EngineError } from '../errors/engine-error';
import { FOG_KIND_EXP2, FOG_KIND_LINEAR, FOG_KIND_NONE } from '../generated/core';
import type { CoreGlue } from '../shared/core';
import { type ColorInput, linearColor } from './color';

/**
 * Linear fog, as three.js's `Fog`: none up to `near`, full from `far`, and a smooth step between
 * them. Distances run from the camera along its view direction.
 *
 * @category api/scene
 */
export interface LinearFogOptions {
	/** Linear fog. */
	type: 'linear';
	/** The fog's color. */
	color: ColorInput;
	/** The distance where the fog starts. The default is 1. */
	near?: number;
	/** The distance from which the fog hides every object. It must be above `near`. The default is 1000. */
	far?: number;
}

/**
 * Exponential squared fog, as three.js's `FogExp2`: an object at distance d takes the fog color by
 * a factor of 1 - exp(-(density × d)²). Distances run from the camera along its view direction.
 *
 * @category api/scene
 */
export interface Exp2FogOptions {
	/** Exponential squared fog. */
	type: 'exp2';
	/** The fog's color. */
	color: ColorInput;
	/** How fast the fog thickens with distance: 0 or more. The default is 0.00025. */
	density?: number;
}

/**
 * Options of `scene.setFog`: linear fog or exponential squared fog.
 *
 * @category api/scene
 */
export type FogOptions = LinearFogOptions | Exp2FogOptions;

/** three.js's defaults for `Fog` and `FogExp2`. */
const DEFAULT_NEAR = 1;
const DEFAULT_FAR = 1000;
const DEFAULT_DENSITY = 0.00025;

const CALL = 'setFog';
const FOG: Described = { describe: () => 'the fog' };

/**
 * Throws E1203 for a distance or density that is not finite, and E1108 for a far distance that is
 * not beyond the near one, or a negative density. Call it inside `if (DEV)`.
 */
function checkFog(fog: FogOptions, near: number, far: number, density: number): void {
	if (fog.type === 'linear') {
		checkNumber(CALL, 'near', near, FOG);
		checkNumber(CALL, 'far', far, FOG);
		if (!(far > near))
			throw new EngineError(
				'E1108',
				`${CALL}() got the near distance ${near} and the far distance ${far}. The far distance must be above the near one.`,
			);
	} else if (fog.type === 'exp2') {
		checkNumber(CALL, 'density', density, FOG);
		if (!(density >= 0))
			throw new EngineError('E1108', `${CALL}() got the density ${density}; it takes 0 or more.`);
	} else
		throw new EngineError(
			'E1108',
			`${CALL}() got the fog type ${JSON.stringify((fog as { type: unknown }).type)}. It takes 'linear' or 'exp2'.`,
		);
}

/** Gives the scene `fog`, or no fog for null. Converting the color allocates. */
export function setSceneFog(glue: CoreGlue, fog: FogOptions | null): void {
	if (fog === null) {
		glue.setFog(FOG_KIND_NONE, 0, 0, 0, 0, 0, 0);
		return;
	}
	const linear = fog.type === 'linear';
	const near = linear ? (fog.near ?? DEFAULT_NEAR) : 0;
	const far = linear ? (fog.far ?? DEFAULT_FAR) : 0;
	const density = linear ? 0 : (fog.density ?? DEFAULT_DENSITY);
	if (DEV) checkFog(fog, near, far, density);
	const [r, g, b] = linearColor(fog.color, CALL);
	glue.setFog(linear ? FOG_KIND_LINEAR : FOG_KIND_EXP2, r, g, b, near, far, density);
}
