// Backgrounds that the camera shows behind every object, past the background color: a texture, an
// environment, a cube map, three.js's sky, or the physical sky. `scene.setBackground` writes the background's values
// into a block of the core's memory, as the environment's values go, so a sketch can turn a cube
// map or move the sky's sun and clouds every frame with no allocation.

import { DEV } from '../errors/checks';
import { EngineError } from '../errors/engine-error';
import {
	BACKGROUND_KIND_ATMOSPHERE,
	BACKGROUND_KIND_CUBEMAP,
	BACKGROUND_KIND_ENVIRONMENT,
	BACKGROUND_KIND_NONE,
	BACKGROUND_KIND_SKY,
	BACKGROUND_KIND_TEXTURE,
	BACKGROUND_VALUE_AERIAL_PERSPECTIVE,
	BACKGROUND_VALUE_ALTITUDE,
	BACKGROUND_VALUE_BLUR,
	BACKGROUND_VALUE_CLOUD_COVERAGE,
	BACKGROUND_VALUE_CLOUD_DENSITY,
	BACKGROUND_VALUE_CLOUD_ELEVATION,
	BACKGROUND_VALUE_CLOUD_SCALE,
	BACKGROUND_VALUE_CLOUD_SPEED,
	BACKGROUND_VALUE_COUNT,
	BACKGROUND_VALUE_GROUND_ALBEDO,
	BACKGROUND_VALUE_HAZE,
	BACKGROUND_VALUE_INTENSITY,
	BACKGROUND_VALUE_METERS_PER_UNIT,
	BACKGROUND_VALUE_MIE_COEFFICIENT,
	BACKGROUND_VALUE_MIE_DIRECTIONAL_G,
	BACKGROUND_VALUE_MOON_INTENSITY,
	BACKGROUND_VALUE_MOON_POSITION,
	BACKGROUND_VALUE_OZONE,
	BACKGROUND_VALUE_RAYLEIGH,
	BACKGROUND_VALUE_ROTATION,
	BACKGROUND_VALUE_SECOND_SKY_WEIGHT,
	BACKGROUND_VALUE_SECOND_SUN_POSITION,
	BACKGROUND_VALUE_STARS,
	BACKGROUND_VALUE_SUN_DISC,
	BACKGROUND_VALUE_SUN_INTENSITY,
	BACKGROUND_VALUE_SUN_POSITION,
	BACKGROUND_VALUE_TIME,
	BACKGROUND_VALUE_TURBIDITY,
} from '../generated/core';
import type { ShaderVariants } from '../generated/shaders';
import { Environment } from './environment';
import type { FeatureDescription } from './features';
import type { CoreMemory, ViewHolder } from './memory';
import type { CompiledWgsl } from './resources';
import { ShaderPreloads } from './shader-preloads';
import type { ShaderTemplates } from './shader-templates';
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
	/**
	 * A point toward the sun of a second sky, which adds its light to this sky's at
	 * `secondSkyWeight`, with the same air and clouds. `timeOfDay` fades the moon's sky in over
	 * the sunset's sky with it. The default is straight up.
	 */
	secondSunPosition?: readonly [number, number, number];
	/**
	 * The weight of the second sky's light beside this sky's, 0 or more. Both then take the
	 * background's `intensity`. The default is 0, no second sky, which costs nothing.
	 */
	secondSkyWeight?: number;
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
 * The settings of the physical sky: the earth's air, with Rayleigh and Mie scattering and ozone,
 * lit by the sun and the moon. The same air hazes distant objects (aerial perspective). A call
 * that leaves a setting out takes its default.
 *
 * @category api/scene
 */
export interface AtmosphereOptions {
	/**
	 * A point toward the sun. Its direction places the sun. The default is 20 degrees above the
	 * horizon toward -Z: `[0, 0.342, -0.94]`.
	 */
	sunPosition?: readonly [number, number, number];
	/**
	 * The sun's light above the air, in the units of a directional light's intensity, 0 or more.
	 * The air dims it on its way down, more as the sun sinks. The default is 3.6, which gives a
	 * high sun's light about 3.2 at the ground.
	 */
	sunIntensity?: number;
	/** Whether the sky shows the sun's disc. The default is true. */
	showSunDisc?: boolean;
	/** The factor of the scattering by the air's molecules, which makes the sky blue, 0 or more. The default is 1, the earth's. */
	rayleigh?: number;
	/** The factor of the haze in the air (Mie scattering), which whitens the sky and glows around the sun, 0 or more. The default is 1. */
	haze?: number;
	/** The factor of ozone, which keeps the twilight sky blue, 0 or more. The default is 1. */
	ozone?: number;
	/** How much the haze scatters toward the light, from 0 to 1 (below 1). The default is 0.8. */
	mieDirectionalG?: number;
	/** The share of light that the ground below the horizon reflects, from 0 to 1. The default is 0.3. */
	groundAlbedo?: number;
	/** The height of the scene's y = 0 above the ground, in meters, 0 or more. The default is 0. */
	altitude?: number;
	/** The meters in one unit of the scene, more than 0. The default is 1. */
	metersPerUnit?: number;
	/**
	 * The factor of the haze between the camera and each object, 0 or more: 0 for none, 1 for the
	 * real air. A larger value makes a small scene look as large as a landscape. The default is 1.
	 */
	aerialPerspective?: number;
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
	/** A point toward the moon. The default is straight up. */
	moonPosition?: readonly [number, number, number];
	/**
	 * The moon's light above the air, 0 or more. It lights the air as the sun does, and the sky
	 * shows its disc, lit from the sun's side. The default is 0, no moon.
	 */
	moonIntensity?: number;
	/** The stars' brightness, 0 or more. They show where the sky is dark. The default is 0, no stars. */
	stars?: number;
}

/**
 * The physical sky as a background: `scene.setBackground({ atmosphere: { sunPosition } })`.
 *
 * @category api/scene
 */
export interface AtmosphereBackground {
	/** The physical sky's settings. */
	atmosphere: AtmosphereOptions;
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
	secondSunPosition: [0, 1, 0],
	secondSkyWeight: 0,
} as const;

/** The sky's settings that take one number. */
type SkyNumber = Exclude<keyof SkyOptions, 'sunPosition' | 'showSunDisc' | 'secondSunPosition'>;

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
	secondSkyWeight: [0, Number.POSITIVE_INFINITY],
};

/** The physical sky's defaults. */
const ATMOSPHERE_DEFAULTS = {
	sunPosition: [0, 0.342, -0.94],
	sunIntensity: 3.6,
	rayleigh: 1,
	haze: 1,
	ozone: 1,
	mieDirectionalG: 0.8,
	groundAlbedo: 0.3,
	altitude: 0,
	metersPerUnit: 1,
	aerialPerspective: 1,
	moonPosition: [0, 1, 0],
	moonIntensity: 0,
	stars: 0,
} as const;

/** The physical sky's settings that take one number. */
type AtmosphereNumber = Exclude<
	keyof AtmosphereOptions,
	'sunPosition' | 'showSunDisc' | 'moonPosition'
>;

/** The lowest value of each of the physical sky's numbers, and the highest where it has one. */
const ATMOSPHERE_RANGES: Readonly<Record<AtmosphereNumber, readonly [number, number]>> = {
	sunIntensity: [0, Number.POSITIVE_INFINITY],
	rayleigh: [0, Number.POSITIVE_INFINITY],
	haze: [0, Number.POSITIVE_INFINITY],
	ozone: [0, Number.POSITIVE_INFINITY],
	mieDirectionalG: [0, 0.9999],
	groundAlbedo: [0, 1],
	altitude: [0, Number.POSITIVE_INFINITY],
	metersPerUnit: [Number.MIN_VALUE, Number.POSITIVE_INFINITY],
	aerialPerspective: [0, Number.POSITIVE_INFINITY],
	cloudCoverage: SKY_RANGES.cloudCoverage,
	cloudDensity: SKY_RANGES.cloudDensity,
	cloudElevation: SKY_RANGES.cloudElevation,
	cloudScale: SKY_RANGES.cloudScale,
	cloudSpeed: SKY_RANGES.cloudSpeed,
	time: SKY_RANGES.time,
	moonIntensity: [0, Number.POSITIVE_INFINITY],
	stars: [0, Number.POSITIVE_INFINITY],
};

/**
 * What `scene.setBackground` draws behind every object in place of a plain color: a texture, an
 * environment, a cube map, three.js's sky or the physical sky.
 *
 * @category api/scene
 */
export type BackgroundSource =
	| Texture
	| Environment
	| Cubemap
	| SkyBackground
	| AtmosphereBackground;

/**
 * The values of a sky layer that `scene.setSkyLayer` takes, and that a later call changes: its
 * opacity and the share of the sun that it hides. A value that a later call leaves out keeps its
 * own.
 *
 * @category api/scene
 */
export interface SkyLayerValues {
	/** How much of the layer's color draws, from 0 for none to 1 for all of it. The default is 1. */
	readonly opacity?: number;
	/**
	 * How much of the sun the layer hides, from 0 for none to 1 for all of it. The core sky dims
	 * its disc and glow by the rest, and the layer reads the share to dim its own. The default is
	 * 0.
	 */
	readonly sun?: number;
}

/**
 * Options of `scene.setSkyLayer`: the layer's WGSL, compiled by the null3D Vite plugin, and its
 * first values.
 *
 * @category api/scene
 */
export interface SkyLayerOptions extends SkyLayerValues {
	/**
	 * The layer's WGSL, which declares `fn skyLayer(input: SkyLayerInput) -> SkyLayer`. It draws
	 * over the background, under every object, on every GPU path. `SkyLayerInput` gives the
	 * fragment's direction, the core sky's cloud settings, the sketch time and the share of the sun
	 * that the layer hides.
	 */
	readonly wgsl: CompiledWgsl;
}

/**
 * A sky layer that `scene.setSkyLayer` installed over the background. `set` changes its values,
 * and `scene.clearSkyLayer` removes it.
 *
 * @category api/scene
 */
export interface SkyLayer {
	/** Changes the layer's opacity, the share of the sun that it hides, or both. */
	set(values: SkyLayerValues): void;
}

const CALL = 'setBackground';

/** @internal The scene's sky layer, from its compiled WGSL to the core. */
export class SceneSkyLayer implements SkyLayer {
	/** The render pipeline template of the layer's shader, which the draw thread builds, or 0. */
	private template = 0;
	private opacity = 1;
	private sun = 0;

	constructor(
		private readonly core: CoreMemory,
		private readonly templates: ShaderTemplates,
	) {}

	/**
	 * Installs a layer over the background, or replaces the one there. The description names the
	 * feature and must record at the background point, as a draw, provide the sky, and draw in the
	 * main view, the scene passes and the reflections. Throws E1223 for such a description that it
	 * cannot place, E1215 for WGSL that the plugin did not compile as a sky layer, and the checks
	 * of `set` for its values.
	 */
	install(description: FeatureDescription, options: SkyLayerOptions, call: string): void {
		checkSkyLayer(description, call);
		if (DEV && (typeof options !== 'object' || options === null))
			throw new EngineError(
				'E1213',
				`${call}() got ${String(options)}, which is not an object of a sky layer's options. Give { wgsl }, with WGSL that declares fn skyLayer(input: SkyLayerInput) -> SkyLayer.`,
			);
		const compiled = compiledSkyLayer(options.wgsl, call);
		const { opacity, sun } = options;
		if (DEV) checkLayerValues({ opacity, sun }, call);
		this.template = this.templates.of(compiled, () => [
			{
				kind: 'skyLayer',
				variants: compiled.variants,
				locations: [],
				textures: 0,
			},
		]);
		this.opacity = opacity ?? 1;
		this.sun = sun ?? 0;
		this.send(call);
	}

	/** Changes the layer's values. Throws E1101 while no layer is installed. */
	set(values: SkyLayerValues): void {
		const call = 'SkyLayer.set';
		if (DEV) {
			checkLayerLive(this.template, call);
			checkLayerValues(values, call);
		}
		this.opacity = values.opacity ?? this.opacity;
		this.sun = values.sun ?? this.sun;
		this.send(call);
	}

	/** Removes the layer from the next frame on. */
	clear(): void {
		if (this.template === 0) return;
		this.template = 0;
		this.core.check(this.core.glue.setSkyLayer(0, 0, 1), 'clearSkyLayer', undefined, true);
	}

	/** Writes the layer's template and values into the core, which the next frame draws. */
	private send(call: string): void {
		const { core } = this;
		core.check(core.glue.setSkyLayer(this.template, this.sun, this.opacity), call, undefined, true);
	}
}

/** Throws E1101 unless a layer is installed. Call it inside `if (DEV)`. */
function checkLayerLive(template: number, call: string): void {
	if (template === 0)
		throw new EngineError(
			'E1101',
			`${call}() ran on a sky layer that scene.clearSkyLayer() removed. Install another with scene.setSkyLayer().`,
		);
}

/** The views that a sky layer draws in, which its description must name. */
const SKY_LAYER_VIEWS = ['main', 'scenePass', 'reflection'] as const;

/**
 * Throws E1223 unless the description places a sky layer: the background point, as a draw, with the
 * sky slot and the three views that the engine draws it in.
 */
function checkSkyLayer(description: FeatureDescription, call: string): void {
	if (typeof description !== 'object' || description === null)
		throw new EngineError(
			'E1223',
			`${call}() got ${String(description)}, which is not a feature description. Give defineFeature({ name, frame: 'background', kind: 'draw', provides: ['sky'], views: ['main', 'scenePass', 'reflection'] }).`,
		);
	const name = description.name;
	if (description.frame !== 'background')
		throw new EngineError(
			'E1223',
			`${call}() got the feature '${name}' with the frame ${JSON.stringify(description.frame)}; a sky layer records at 'background'.`,
		);
	if (description.kind !== 'draw')
		throw new EngineError(
			'E1223',
			`${call}() got the feature '${name}' with the kind ${JSON.stringify(description.kind)}; a sky layer draws, so give the kind 'draw'.`,
		);
	const provides = description.provides ?? [];
	if (!provides.includes('sky'))
		throw new EngineError(
			'E1223',
			`${call}() got the feature '${name}' with the provides ${JSON.stringify(provides)}; a sky layer provides 'sky'.`,
		);
	const views = description.views ?? [];
	if (views.length !== SKY_LAYER_VIEWS.length || !SKY_LAYER_VIEWS.every((v) => views.includes(v)))
		throw new EngineError(
			'E1223',
			`${call}() got the feature '${name}' with the views ${JSON.stringify(views)}; a sky layer draws in 'main', 'scenePass' and 'reflection'.`,
		);
}

/** Throws E1108 or E1203 for a layer's value outside 0 to 1. Call it inside `if (DEV)`. */
function checkLayerValues(values: SkyLayerValues, call: string): void {
	if (values.opacity !== undefined) checkNumber('opacity', values.opacity, 0, 1, call);
	if (values.sun !== undefined) checkNumber('sun', values.sun, 0, 1, call);
}

/** A layer's compiled WGSL, or throws E1215 for WGSL that the plugin did not compile as one. */
function compiledSkyLayer(
	wgsl: unknown,
	call: string,
): CompiledWgsl & { readonly variants: ShaderVariants } {
	if (typeof wgsl === 'object' && wgsl !== null && (wgsl as CompiledWgsl).kind === 'skyLayer')
		return wgsl as CompiledWgsl & { readonly variants: ShaderVariants };
	throw new EngineError(
		'E1215',
		typeof wgsl === 'string'
			? `${call}() got WGSL as text, which the null3D Vite plugin did not compile. Tag the WGSL with a /* wgsl */ comment, or import it from a .wgsl file.`
			: `${call}() got ${JSON.stringify((wgsl as CompiledWgsl)?.kind ?? wgsl)}, which is not a sky layer. A sky layer's WGSL declares fn skyLayer(input: SkyLayerInput) -> SkyLayer.`,
	);
}

/** @internal The scene's background source as the core holds it. */
export class SceneBackground implements ViewHolder {
	/** The core's block of the background's values. */
	private values: Float32Array | undefined;
	/** The memory's generation that `values` was made in. */
	private generation = -1;

	constructor(
		private readonly core: CoreMemory,
		/** Asks the thread that draws for a feature's shader file, once; it allocates nothing after. */
		private readonly shaders: ShaderPreloads = new ShaderPreloads(),
	) {
		core.holdViews(this);
	}

	/** Forgets the view of the block, which the next write makes again. */
	dropViews(): void {
		this.values = undefined;
	}

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
		const atmosphere = isAtmosphereBackground(source);
		this.shaders.need(atmosphere ? 'physical_sky' : isSkyBackground(source) ? 'sky' : 'background');
		if (atmosphere) {
			kind = BACKGROUND_KIND_ATMOSPHERE;
			writeAtmosphere(values, source.atmosphere);
		} else if (source instanceof Texture) {
			kind = BACKGROUND_KIND_TEXTURE;
			texture = source.handle;
		} else if (source instanceof Environment) {
			kind = BACKGROUND_KIND_ENVIRONMENT;
			texture = source.texture.handle;
		} else if (source instanceof Cubemap) {
			kind = BACKGROUND_KIND_CUBEMAP;
			texture = source.texture.handle;
		} else {
			writeSky(values, (source as SkyBackground).sky);
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
	const second = sky.secondSunPosition ?? d.secondSunPosition;
	values[BACKGROUND_VALUE_SECOND_SUN_POSITION] = second[0];
	values[BACKGROUND_VALUE_SECOND_SUN_POSITION + 1] = second[1];
	values[BACKGROUND_VALUE_SECOND_SUN_POSITION + 2] = second[2];
	values[BACKGROUND_VALUE_SECOND_SKY_WEIGHT] = sky.secondSkyWeight ?? d.secondSkyWeight;
}

/**
 * Writes the physical sky's settings into the background's block, each read once by its name and
 * written straight in. It shares the sky's places for the sun, Rayleigh's factor, the Mie
 * directional g, the clouds, the time and the sun's disc.
 */
function writeAtmosphere(values: Float32Array, atmosphere: AtmosphereOptions): void {
	const d = ATMOSPHERE_DEFAULTS;
	const s = SKY_DEFAULTS;
	const sun = atmosphere.sunPosition ?? d.sunPosition;
	values[BACKGROUND_VALUE_SUN_POSITION] = sun[0];
	values[BACKGROUND_VALUE_SUN_POSITION + 1] = sun[1];
	values[BACKGROUND_VALUE_SUN_POSITION + 2] = sun[2];
	values[BACKGROUND_VALUE_SUN_INTENSITY] = atmosphere.sunIntensity ?? d.sunIntensity;
	values[BACKGROUND_VALUE_SUN_DISC] = atmosphere.showSunDisc === false ? 0 : 1;
	values[BACKGROUND_VALUE_RAYLEIGH] = atmosphere.rayleigh ?? d.rayleigh;
	values[BACKGROUND_VALUE_HAZE] = atmosphere.haze ?? d.haze;
	values[BACKGROUND_VALUE_OZONE] = atmosphere.ozone ?? d.ozone;
	values[BACKGROUND_VALUE_MIE_DIRECTIONAL_G] = atmosphere.mieDirectionalG ?? d.mieDirectionalG;
	values[BACKGROUND_VALUE_GROUND_ALBEDO] = atmosphere.groundAlbedo ?? d.groundAlbedo;
	values[BACKGROUND_VALUE_ALTITUDE] = atmosphere.altitude ?? d.altitude;
	values[BACKGROUND_VALUE_METERS_PER_UNIT] = atmosphere.metersPerUnit ?? d.metersPerUnit;
	values[BACKGROUND_VALUE_AERIAL_PERSPECTIVE] = atmosphere.aerialPerspective ?? d.aerialPerspective;
	values[BACKGROUND_VALUE_CLOUD_COVERAGE] = atmosphere.cloudCoverage ?? s.cloudCoverage;
	values[BACKGROUND_VALUE_CLOUD_DENSITY] = atmosphere.cloudDensity ?? s.cloudDensity;
	values[BACKGROUND_VALUE_CLOUD_ELEVATION] = atmosphere.cloudElevation ?? s.cloudElevation;
	values[BACKGROUND_VALUE_CLOUD_SCALE] = atmosphere.cloudScale ?? s.cloudScale;
	values[BACKGROUND_VALUE_CLOUD_SPEED] = atmosphere.cloudSpeed ?? s.cloudSpeed;
	values[BACKGROUND_VALUE_TIME] = atmosphere.time ?? s.time;
	const moon = atmosphere.moonPosition ?? d.moonPosition;
	values[BACKGROUND_VALUE_MOON_POSITION] = moon[0];
	values[BACKGROUND_VALUE_MOON_POSITION + 1] = moon[1];
	values[BACKGROUND_VALUE_MOON_POSITION + 2] = moon[2];
	values[BACKGROUND_VALUE_MOON_INTENSITY] = atmosphere.moonIntensity ?? d.moonIntensity;
	values[BACKGROUND_VALUE_STARS] = atmosphere.stars ?? d.stars;
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

/** True for a background source of the physical sky. */
export function isAtmosphereBackground(value: unknown): value is AtmosphereBackground {
	return typeof value === 'object' && value !== null && 'atmosphere' in value;
}

/** True for a background source of the sky. */
export function isSkyBackground(value: unknown): value is SkyBackground {
	return typeof value === 'object' && value !== null && 'sky' in value;
}

/** Throws the errors that `SceneBackground.set` names. Call it inside `if (DEV)`. */
function checkBackground(source: BackgroundSource, options: BackgroundOptions | undefined): void {
	const atmosphere = isAtmosphereBackground(source);
	const sky = isSkyBackground(source) || atmosphere;
	if (
		!sky &&
		!(source instanceof Texture || source instanceof Environment || source instanceof Cubemap)
	)
		throw new EngineError(
			'E1213',
			`${CALL}() got ${String(source)}, which takes a color, a texture, an environment, a cube map from assets.loadCubemap(), { sky } or { atmosphere }.`,
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
	if (atmosphere) {
		checkAtmosphere(source.atmosphere);
		return;
	}
	if (!sky) return;
	const settings = (source as SkyBackground).sky;
	if (typeof settings !== 'object' || settings === null)
		throw new EngineError(
			'E1213',
			`${CALL}() got ${String(settings)} for sky, which takes an object of the sky's settings.`,
		);
	for (const name of ['sunPosition', 'secondSunPosition'] as const) {
		checkTriple(`sky.${name}`, settings[name]);
		const sun = settings[name];
		if (sun && sun[0] === 0 && sun[1] === 0 && sun[2] === 0)
			throw new EngineError(
				'E1108',
				`${CALL}() got [0, 0, 0] for sky.${name}, which gives the sun no direction. Give a point toward the sun.`,
			);
	}
	for (const name of Object.keys(SKY_RANGES) as SkyNumber[]) {
		const value = settings[name];
		if (value === undefined) continue;
		const [low, high] = SKY_RANGES[name];
		checkNumber(`sky.${name}`, value, low, high);
	}
}

/** Throws the errors that `SceneBackground.set` names for the physical sky's settings. */
function checkAtmosphere(settings: AtmosphereOptions): void {
	if (typeof settings !== 'object' || settings === null)
		throw new EngineError(
			'E1213',
			`${CALL}() got ${String(settings)} for atmosphere, which takes an object of the physical sky's settings.`,
		);
	for (const name of ['sunPosition', 'moonPosition'] as const) {
		checkTriple(`atmosphere.${name}`, settings[name]);
		const point = settings[name];
		if (point && point[0] === 0 && point[1] === 0 && point[2] === 0)
			throw new EngineError(
				'E1108',
				`${CALL}() got [0, 0, 0] for atmosphere.${name}, which gives no direction. Give a point toward the ${name === 'sunPosition' ? 'sun' : 'moon'}.`,
			);
	}
	for (const name of Object.keys(ATMOSPHERE_RANGES) as AtmosphereNumber[]) {
		const value = settings[name];
		if (value === undefined) continue;
		const [low, high] = ATMOSPHERE_RANGES[name];
		checkNumber(`atmosphere.${name}`, value, low, high);
	}
}

/**
 * Throws E1203 for a number that is not finite, and E1108 for one outside `low` to `high`, naming
 * the call that `call` gives.
 */
function checkNumber(name: string, value: number, low: number, high: number, call = CALL): void {
	if (typeof value !== 'number' || !Number.isFinite(value))
		throw new EngineError('E1203', `${call}() got ${value} for ${name}.`);
	if (value < low || value > high) {
		const range =
			high === Number.POSITIVE_INFINITY
				? low === Number.MIN_VALUE
					? 'more than 0'
					: `${low} or more`
				: `${low} to ${high}`;
		throw new EngineError('E1108', `${call}() got ${value} for ${name}; it takes ${range}.`);
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
