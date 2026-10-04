// Environments: the light around a scene from every direction, which `scene.setEnvironment` lights
// standard materials with. `assets.loadEnvironment` and `assets.builtinEnvironment` make them from
// the asset tool's files, with the reader in environment-file.ts. The scene's environment goes to
// the core through a block of its memory, as the post-processing values do, so a sketch can turn
// it every frame with no allocation.

import { DEV } from '../errors/checks';
import { EngineError } from '../errors/engine-error';
import {
	ENVIRONMENT_VALUE_COUNT,
	ENVIRONMENT_VALUE_INTENSITY,
	ENVIRONMENT_VALUE_ROTATION,
	ENVIRONMENT_VALUE_SH,
} from '../generated/core';
import type { CoreMemory } from './memory';
import type { Texture } from './textures';

/**
 * The texel format of an environment map: `rgb9e5ufloat`, three 9-bit values with a shared
 * exponent in 4 bytes, or `rgba16float`, four half floats in 8 bytes.
 *
 * @category api/assets
 */
export type EnvironmentFormat = 'rgb9e5ufloat' | 'rgba16float';

/**
 * The names of the built-in environments that `assets.builtinEnvironment` loads. `room` is the
 * room that three.js's `RoomEnvironment` builds: a white room with six boxes and glowing panels,
 * which gives soft, neutral light.
 *
 * @category api/assets
 */
export type BuiltinEnvironmentName = 'room';

/**
 * An environment map, which `assets.loadEnvironment` and `assets.builtinEnvironment` load. It
 * holds the light around a scene from every direction, filtered for each roughness, and the
 * diffuse light that it gives. Give it to `scene.setEnvironment`, which lights standard materials
 * with it, as three.js's `scene.environment` does with a texture from `PMREMGenerator`.
 *
 * @category api/assets
 */
export class Environment {
	/** @internal */
	constructor(
		/** @internal The cube texture of the filtered light. */
		readonly texture: Texture,
		/** The width of the largest faces of its cube map, in texels. */
		readonly size: number,
		/** The mip levels of its cube map: one for each roughness step, from a mirror up. */
		readonly levels: number,
		/** How its cube map stores its texels. */
		readonly format: EnvironmentFormat,
		/**
		 * @internal The nine spherical harmonics coefficients of its diffuse light: red, green and
		 * blue for each, in three.js's order.
		 */
		readonly sh: Float32Array,
	) {}

	/** The GPU bytes of its cube map, with every mip level. */
	get bytes(): number {
		return this.texture.bytes;
	}

	/**
	 * Frees the cube map's GPU memory. If `scene.setEnvironment` named the environment last, the
	 * scene shows without it from then on. Passing it to `scene.setEnvironment` afterwards, or
	 * destroying it again, throws E1101.
	 */
	destroy(): void {
		this.texture.destroy();
	}
}

/**
 * The options of `scene.setEnvironment`. A call that leaves an option out takes its default.
 *
 * @category api/scene
 */
export interface EnvironmentOptions {
	/**
	 * The factor of the environment's light on every surface, 0 or more, as three.js's
	 * `scene.environmentIntensity`. A material's `envIntensity` multiplies it. The default is 1.
	 */
	intensity?: number;
	/**
	 * The turn of the environment about the scene, as Euler angles in radians in the order X, Y,
	 * Z, as three.js's `scene.environmentRotation`. The default is `[0, 0, 0]`.
	 */
	rotation?: readonly [number, number, number];
}

const CALL = 'setEnvironment';

/** @internal The scene's environment as the core holds it. */
export class SceneEnvironment {
	/** The core's block of the environment's values. */
	private values: Float32Array | undefined;
	/** The memory's generation that `values` was made in. */
	private generation = -1;
	/** The environment whose coefficients the block holds. */
	private coefficientsOf: Environment | null = null;

	constructor(private readonly core: CoreMemory) {}

	/**
	 * Lights the scene with `environment`, or with none for null, from the next frame on. Throws
	 * E1203 for a number that is not finite, E1108 for a negative intensity, E1213 for something
	 * that is not an environment, and E1101 for an environment that was destroyed.
	 */
	set(environment: Environment | null, options: EnvironmentOptions | undefined): void {
		if (DEV) checkEnvironment(environment, options?.intensity ?? 1, options?.rotation);
		const values = this.block();
		values[ENVIRONMENT_VALUE_INTENSITY] = 1;
		values.fill(0, ENVIRONMENT_VALUE_ROTATION, ENVIRONMENT_VALUE_ROTATION + 3);
		if (options) this.write(values, options);
		if (environment && environment !== this.coefficientsOf) {
			values.set(environment.sh, ENVIRONMENT_VALUE_SH);
			this.coefficientsOf = environment;
		}
		const status = this.core.glue.setEnvironment(environment ? environment.texture.handle : 0);
		this.core.check(status, CALL, 'an environment', true);
	}

	/**
	 * Writes the options that `options` gives into the block. Each value is read once and goes
	 * straight into the block: a fraction read from an object for a comparison as well becomes an
	 * object of its own in the browser.
	 */
	private write(values: Float32Array, options: EnvironmentOptions): void {
		const { intensity, rotation } = options;
		if (intensity !== undefined) values[ENVIRONMENT_VALUE_INTENSITY] = intensity;
		if (rotation === undefined) return;
		values[ENVIRONMENT_VALUE_ROTATION] = rotation[0];
		values[ENVIRONMENT_VALUE_ROTATION + 1] = rotation[1];
		values[ENVIRONMENT_VALUE_ROTATION + 2] = rotation[2];
	}

	/** The core's block of values, through a view made again after the memory grew. */
	private block(): Float32Array {
		const { core } = this;
		if (!this.values || this.generation !== core.generation) {
			this.values = core.f32(core.glue.environmentValues(), ENVIRONMENT_VALUE_COUNT);
			this.generation = core.generation;
		}
		return this.values;
	}
}

/** Throws the errors that `SceneEnvironment.set` names. Call it inside `if (DEV)`. */
function checkEnvironment(
	environment: Environment | null,
	intensity: number,
	rotation: readonly number[] | undefined,
): void {
	if (environment !== null && !(environment instanceof Environment))
		throw new EngineError(
			'E1213',
			`${CALL}() got ${String(environment)}, which takes an environment from assets.loadEnvironment() or assets.builtinEnvironment(), or null.`,
		);
	if (!Number.isFinite(intensity))
		throw new EngineError('E1203', `${CALL}() got ${intensity} for intensity.`);
	if (intensity < 0)
		throw new EngineError('E1108', `${CALL}() got the intensity ${intensity}; it takes 0 or more.`);
	if (
		rotation !== undefined &&
		!(Array.isArray(rotation) && rotation.length === 3 && rotation.every(Number.isFinite))
	)
		throw new EngineError(
			'E1203',
			`${CALL}() got ${String(rotation)} for rotation, which takes three finite angles in radians.`,
		);
}
