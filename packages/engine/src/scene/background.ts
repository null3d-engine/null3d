// Backgrounds that the camera shows behind every object, past the background color: a texture, an
// environment, a cube map, or three.js's sky. `scene.setBackground` writes the background's values
// into a block of the core's memory, as the environment's values go, so a sketch can turn a cube
// map or move the sky's sun and clouds every frame with no allocation.

import { DEV } from '../errors/checks';
import { EngineError } from '../errors/engine-error';
import {
	BACKGROUND_KIND_CUBEMAP,
	BACKGROUND_KIND_ENVIRONMENT,
	BACKGROUND_KIND_NONE,
	BACKGROUND_KIND_SKY,
	BACKGROUND_KIND_TEXTURE,
	BACKGROUND_VALUE_BLUR,
	BACKGROUND_VALUE_CLOUD_COVERAGE,
	BACKGROUND_VALUE_CLOUD_DENSITY,
	BACKGROUND_VALUE_CLOUD_ELEVATION,
	BACKGROUND_VALUE_CLOUD_SCALE,
	BACKGROUND_VALUE_CLOUD_SPEED,
	BACKGROUND_VALUE_COUNT,
	BACKGROUND_VALUE_INTENSITY,
	BACKGROUND_VALUE_MIE_COEFFICIENT,
	BACKGROUND_VALUE_MIE_DIRECTIONAL_G,
	BACKGROUND_VALUE_RAYLEIGH,
	BACKGROUND_VALUE_ROTATION,
	BACKGROUND_VALUE_SUN_DISC,
	BACKGROUND_VALUE_SUN_POSITION,
	BACKGROUND_VALUE_TIME,
	BACKGROUND_VALUE_TURBIDITY,
} from '../generated/core';
import { Environment } from './environment';
import type { CoreMemory } from './memory';
import { ShaderPreloads } from './shader-preloads';
import { Texture } from './textures';

/**
 * A cube map of six images, which `assets.loadCubemap` loads, for a sky box behind every object:
 * `scene.setBackground(cubemap)`, as three.js's `CubeTextureLoader` makes a `CubeTexture` for
 * `scene.background`. It does not light the scene: light comes from an environment.
 *
 * @category api/assets
 */
export class Cubemap {
	/** @internal */
	constructor(
		/** @internal The cube texture of the six faces. */
		readonly texture: Texture,
		/** The width of each face, in texels. */
		readonly size: number,
	) {}

	/** The GPU bytes of its faces. */
	get bytes(): number {
		return this.texture.bytes;
	}

	/**
	 * Frees the faces' GPU memory. If `scene.setBackground` named the cube map last, the view shows
	 * the background color from then on. Passing it to `scene.setBackground` afterwards, or
	 * destroying it again, throws E1101.
	 */
	destroy(): void {
		this.texture.destroy();
	}
}

/**
 * The settings of three.js's sky, with the names and defaults of its `Sky` object's uniforms. A
 * call that leaves a setting out takes its default.
 *
 * @category api/scene
 */
export interface SkyOptions {
	/**
	 * A point toward the sun, as three.js's `sunPosition`. Its direction places the sun. A point
	 * far below the horizon, hundreds of thousands of units down, also dims the sky, as in
	 * three.js. The default is the sun 2 degrees above the horizon toward -Z, as three.js's sky
	 * example sets it: `[0, 0.0349, -0.9994]`.
	 */
	sunPosition?: readonly [number, number, number];
	/** The haze in the air, 0 or more. The default is 2. */
	turbidity?: number;
	/** The scattering by the air's molecules, which makes the sky blue, 0 or more. The default is 1. */
	rayleigh?: number;
	/** The scattering by haze, 0 or more. The default is 0.005. */
	mieCoefficient?: number;
	/** How much the haze scatters toward the sun, from 0 to 1 (below 1). The default is 0.8. */
	mieDirectionalG?: number;
	/** The share of the sky that clouds cover, from 0 to 1. 0 draws no clouds. The default is 0.4. */
	cloudCoverage?: number;
	/** How solid the clouds are, 0 or more. The default is 0.4. */
	cloudDensity?: number;
	/** The height of the clouds, from 0 to 1: higher clouds look smaller. The default is 0.5. */
	cloudElevation?: number;
	/** The size of the clouds' pattern, more than 0: larger values make smaller clouds. The default is 0.0002. */
	cloudScale?: number;
	/** How fast the clouds drift as `time` grows. The default is 0.00002. */
	cloudSpeed?: number;
	/**
	 * The time in seconds that moves the clouds, such as the sketch's `time`. The default is 0, so
	 * the clouds stand still until a sketch sets it.
	 */
	time?: number;
	/** Whether the sky shows the sun's disc. The default is true. */
	showSunDisc?: boolean;
}

/**
 * three.js's analytic sky as a background: `scene.setBackground({ sky: { sunPosition } })`.
 *
 * @category api/scene
 */
export interface SkyBackground {
	/** The sky's settings. */
	sky: SkyOptions;
}

/**
 * The options of `scene.setBackground` for a texture, an environment, a cube map or the sky. A
 * call that leaves an option out takes its default.
 *
 * @category api/scene
 */
export interface BackgroundOptions {
	/**
	 * The factor of the background's light, 0 or more, as three.js's `scene.backgroundIntensity`.
	 * The default is 1.
	 */
	intensity?: number;
	/**
	 * How much an environment blurs, from 0 (sharp) to 1, as three.js's
	 * `scene.backgroundBlurriness`. It reads the environment's light at that roughness, so a
	 * blurred background costs no more than a sharp one. Only environments blur. The default is 0.
	 */
	blur?: number;
	/**
	 * The turn of a cube map or an environment about the scene, as Euler angles in radians in the
	 * order X, Y, Z, as three.js's `scene.backgroundRotation`. The default is `[0, 0, 0]`.
	 */
	rotation?: readonly [number, number, number];
}

/** The sky's defaults: three.js's `Sky` uniforms, and the sun of its example. */
const SKY_DEFAULTS = {
	sunPosition: [0, 0.0349, -0.9994],
	turbidity: 2,
	rayleigh: 1,
	mieCoefficient: 0.005,
	mieDirectionalG: 0.8,
	cloudCoverage: 0.4,
	cloudDensity: 0.4,
	cloudElevation: 0.5,
	cloudScale: 0.0002,
	cloudSpeed: 0.00002,
	time: 0,
} as const;

/** The sky's settings that take one number. */
type SkyNumber = Exclude<keyof SkyOptions, 'sunPosition' | 'showSunDisc'>;

/** The lowest value of each of the sky's numbers, and the highest where it has one. */
const SKY_RANGES: Readonly<Record<SkyNumber, readonly [number, number]>> = {
	turbidity: [0, Number.POSITIVE_INFINITY],
	rayleigh: [0, Number.POSITIVE_INFINITY],
	mieCoefficient: [0, Number.POSITIVE_INFINITY],
	mieDirectionalG: [0, 0.9999],
	cloudCoverage: [0, 1],
	cloudDensity: [0, Number.POSITIVE_INFINITY],
	cloudElevation: [0, 1],
	cloudScale: [Number.MIN_VALUE, Number.POSITIVE_INFINITY],
	cloudSpeed: [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY],
	time: [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY],
};

/**
 * What `scene.setBackground` draws behind every object in place of a plain color: a texture, an
 * environment, a cube map or three.js's sky.
 *
 * @category api/scene
 */
export type BackgroundSource = Texture | Environment | Cubemap | SkyBackground;

const CALL = 'setBackground';

/** @internal The scene's background source as the core holds it. */
export class SceneBackground {
	/** The core's block of the background's values. */
	private values: Float32Array | undefined;
	/** The memory's generation that `values` was made in. */
	private generation = -1;

	constructor(
		private readonly core: CoreMemory,
		/** Asks the thread that draws for a feature's shader file, once; it allocates nothing after. */
		private readonly shaders: ShaderPreloads = new ShaderPreloads(),
	) {}

	/**
	 * Draws `source` behind every object from the next frame on, with `options`. Throws E1203 for
	 * a number that is not finite, E1108 for a number out of its range, E1213 for an option that
	 * the source does not take, and E1101 for a texture that was destroyed.
	 */
	set(source: BackgroundSource, options: BackgroundOptions | undefined): void {
		if (DEV) checkBackground(source, options);
		const values = this.block();
		values[BACKGROUND_VALUE_INTENSITY] = options?.intensity ?? 1;
		values[BACKGROUND_VALUE_BLUR] = options?.blur ?? 0;
		const rotation = options?.rotation;
		values[BACKGROUND_VALUE_ROTATION] = rotation ? rotation[0] : 0;
		values[BACKGROUND_VALUE_ROTATION + 1] = rotation ? rotation[1] : 0;
		values[BACKGROUND_VALUE_ROTATION + 2] = rotation ? rotation[2] : 0;
		let kind = BACKGROUND_KIND_SKY;
		let texture = 0;
		this.shaders.need(isSkyBackground(source) ? 'sky' : 'background');
		if (source instanceof Texture) {
			kind = BACKGROUND_KIND_TEXTURE;
			texture = source.handle;
		} else if (source instanceof Environment) {
			kind = BACKGROUND_KIND_ENVIRONMENT;
			texture = source.texture.handle;
		} else if (source instanceof Cubemap) {
			kind = BACKGROUND_KIND_CUBEMAP;
			texture = source.texture.handle;
		} else {
			writeSky(values, source.sky);
		}
		const status = this.core.glue.setBackgroundSource(kind, texture);
		this.core.check(status, CALL, 'a texture', true);
	}

	/** Draws only the background color from the next frame on. */
	clear(): void {
		this.core.glue.setBackgroundSource(BACKGROUND_KIND_NONE, 0);
	}

	/** The core's block of values, through a view made again after the memory grew. */
	private block(): Float32Array {
		const { core } = this;
		if (!this.values || this.generation !== core.generation) {
			this.values = core.f32(core.glue.backgroundValues(), BACKGROUND_VALUE_COUNT);
			this.generation = core.generation;
		}
		return this.values;
	}
}

/**
 * Writes the sky's settings into the background's block, each read once by its name and written
 * straight in. A fraction read from an object for a comparison as well, or read by a key that
 * changes, becomes an object of its own in the browser.
 */
function writeSky(values: Float32Array, sky: SkyOptions): void {
	const d = SKY_DEFAULTS;
	const sun = sky.sunPosition ?? d.sunPosition;
	values[BACKGROUND_VALUE_SUN_POSITION] = sun[0];
	values[BACKGROUND_VALUE_SUN_POSITION + 1] = sun[1];
	values[BACKGROUND_VALUE_SUN_POSITION + 2] = sun[2];
	values[BACKGROUND_VALUE_TURBIDITY] = sky.turbidity ?? d.turbidity;
	values[BACKGROUND_VALUE_RAYLEIGH] = sky.rayleigh ?? d.rayleigh;
	values[BACKGROUND_VALUE_MIE_COEFFICIENT] = sky.mieCoefficient ?? d.mieCoefficient;
	values[BACKGROUND_VALUE_MIE_DIRECTIONAL_G] = sky.mieDirectionalG ?? d.mieDirectionalG;
	values[BACKGROUND_VALUE_CLOUD_COVERAGE] = sky.cloudCoverage ?? d.cloudCoverage;
	values[BACKGROUND_VALUE_CLOUD_DENSITY] = sky.cloudDensity ?? d.cloudDensity;
	values[BACKGROUND_VALUE_CLOUD_ELEVATION] = sky.cloudElevation ?? d.cloudElevation;
	values[BACKGROUND_VALUE_CLOUD_SCALE] = sky.cloudScale ?? d.cloudScale;
	values[BACKGROUND_VALUE_CLOUD_SPEED] = sky.cloudSpeed ?? d.cloudSpeed;
	values[BACKGROUND_VALUE_TIME] = sky.time ?? d.time;
	values[BACKGROUND_VALUE_SUN_DISC] = sky.showSunDisc === false ? 0 : 1;
}

/**
 * @internal Writes the sky's defaults into the background's block of `values` unless a sky
 * background wrote its settings there, so a sky map shows the default sky until the first one.
 */
export function writeSkyDefaults(values: Float32Array): void {
	const sun = BACKGROUND_VALUE_SUN_POSITION;
	// Only a sky background writes the sun's position, and it is never zero.
	if (values[sun] === 0 && values[sun + 1] === 0 && values[sun + 2] === 0) writeSky(values, {});
}

/** True for a background source of the sky. */
export function isSkyBackground(value: unknown): value is SkyBackground {
	return typeof value === 'object' && value !== null && 'sky' in value;
}

/** Throws the errors that `SceneBackground.set` names. Call it inside `if (DEV)`. */
function checkBackground(source: BackgroundSource, options: BackgroundOptions | undefined): void {
	const sky = isSkyBackground(source);
	if (
		!sky &&
		!(source instanceof Texture || source instanceof Environment || source instanceof Cubemap)
	)
		throw new EngineError(
			'E1213',
			`${CALL}() got ${String(source)}, which takes a color, a texture, an environment, a cube map from assets.loadCubemap() or { sky }.`,
		);
	const intensity = options?.intensity ?? 1;
	const blur = options?.blur ?? 0;
	const rotation = options?.rotation;
	checkNumber('intensity', intensity, 0, Number.POSITIVE_INFINITY);
	checkNumber('blur', blur, 0, 1);
	if (blur > 0 && !(source instanceof Environment))
		throw new EngineError(
			'E1213',
			`${CALL}() got a blur of ${blur} for a background that is not an environment. Only environments blur: load one with assets.loadEnvironment() or assets.builtinEnvironment().`,
		);
	checkTriple('rotation', rotation);
	if (rotation !== undefined && (sky || source instanceof Texture))
		throw new EngineError(
			'E1213',
			`${CALL}() got a rotation for ${sky ? 'the sky' : 'a texture'}. Only cube maps and environments turn: move the sky's sun with sunPosition.`,
		);
	if (!sky) return;
	const settings = source.sky;
	if (typeof settings !== 'object' || settings === null)
		throw new EngineError(
			'E1213',
			`${CALL}() got ${String(settings)} for sky, which takes an object of the sky's settings.`,
		);
	checkTriple('sky.sunPosition', settings.sunPosition);
	const sun = settings.sunPosition;
	if (sun && sun[0] === 0 && sun[1] === 0 && sun[2] === 0)
		throw new EngineError(
			'E1108',
			`${CALL}() got [0, 0, 0] for sky.sunPosition, which gives the sun no direction. Give a point toward the sun.`,
		);
	for (const name of Object.keys(SKY_RANGES) as SkyNumber[]) {
		const value = settings[name];
		if (value === undefined) continue;
		const [low, high] = SKY_RANGES[name];
		checkNumber(`sky.${name}`, value, low, high);
	}
}

/** Throws E1203 for a number that is not finite, and E1108 for one outside `low` to `high`. */
function checkNumber(name: string, value: number, low: number, high: number): void {
	if (typeof value !== 'number' || !Number.isFinite(value))
		throw new EngineError('E1203', `${CALL}() got ${value} for ${name}.`);
	if (value < low || value > high) {
		const range =
			high === Number.POSITIVE_INFINITY
				? low === Number.MIN_VALUE
					? 'more than 0'
					: `${low} or more`
				: `${low} to ${high}`;
		throw new EngineError('E1108', `${CALL}() got ${value} for ${name}; it takes ${range}.`);
	}
}

/** Throws E1203 unless `value` is left out or holds three finite numbers. */
function checkTriple(name: string, value: readonly number[] | undefined): void {
	if (
		value !== undefined &&
		!(Array.isArray(value) && value.length === 3 && value.every(Number.isFinite))
	)
		throw new EngineError(
			'E1203',
			`${CALL}() got ${String(value)} for ${name}, which takes three finite numbers.`,
		);
}
