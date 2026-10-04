// The post-processing settings that a sketch sets through `ctx.post`: the exposure and the tone
// mapping, which the engine applies to the scene's color on its way to the canvas, bloom, ambient
// occlusion, which darkens the ambient light of the camera's opaque objects, and the color grading
// table and the vignette, which the final pass applies after the tone mapping.

import { DEV } from '../errors/checks';
import { EngineError } from '../errors/engine-error';
import * as C from '../generated/core';
import { Lut } from './lut';
import type { CoreMemory } from './memory';

/**
 * How the engine maps the scene's high dynamic range color to the screen, with three.js's
 * formulas. The curves are three.js's `ACESFilmicToneMapping` (`'aces'`), `AgXToneMapping`
 * (`'agx'`) and `NeutralToneMapping` (`'neutral'`). The value `'none'` clips the exposed color at
 * 1, as `LinearToneMapping` does.
 *
 * @category api/post
 */
export type ToneMapping = 'aces' | 'agx' | 'neutral' | 'none';

/** Each tone mapping's code, which the engine core and the shaders share. */
const CODES: Readonly<Record<ToneMapping, number>> = {
	aces: C.TONE_MAPPING_ACES,
	agx: C.TONE_MAPPING_AGX,
	neutral: C.TONE_MAPPING_NEUTRAL,
	none: C.TONE_MAPPING_NONE,
};

/** The settings that `post.set` takes, and the text of an error that lists them. */
const SETTINGS = [
	'toneMapping',
	'exposure',
	'bloom',
	'ao',
	'lut',
	'lutIntensity',
	'vignette',
] as const;
const BLOOM_SETTINGS = ['strength', 'radius', 'threshold'] as const;
const AO_SETTINGS = [
	'radius',
	'thickness',
	'distanceExponent',
	'distanceFalloff',
	'scale',
	'samples',
	'intensity',
] as const;
/** The most samples of ambient occlusion's horizon search. */
const MAX_AO_SAMPLES = 64;
const VIGNETTE_SETTINGS = ['offset', 'darkness'] as const;
const TONE_MAPPINGS = "'aces', 'agx', 'neutral' or 'none'";

/**
 * Bloom's settings, with the meanings of three.js's `UnrealBloomPass`. A setting that a call leaves
 * out keeps its value.
 *
 * @category api/post
 */
export interface BloomSettings {
	/** How bright the glow is: 0 or more, and 1 by default. */
	strength?: number;
	/**
	 * How far the glow spreads, from 0 to 1: higher values move its light from the narrow levels
	 * of its blur to the wide ones. It is 0.5 by default.
	 */
	radius?: number;
	/**
	 * The luminance from which a pixel glows, in linear color before the exposure: 0 or more, and 1
	 * by default. At 1, only colors brighter than white glow, such as strong emissive light.
	 */
	threshold?: number;
}

/**
 * Ambient occlusion's settings, with the meanings of three.js's `GTAOPass`. A setting that a call
 * leaves out keeps its value.
 *
 * @category api/post
 */
export interface AoSettings {
	/**
	 * How far from a surface the search for what hides it reaches, in world units: 0 or more, and
	 * 0.25 by default, as `GTAOPass`'s `radius`.
	 */
	radius?: number;
	/**
	 * How far in front of a surface, along the view, an object still hides it, in world units: 0
	 * or more, and 1 by default. Objects farther in front cast no occlusion, so a thin pole does
	 * not darken the wall far behind it.
	 */
	thickness?: number;
	/**
	 * How the search's steps spread over the radius: 1 spreads them evenly, the default, and
	 * higher values gather them near the surface. It is above 0.
	 */
	distanceExponent?: number;
	/**
	 * From 0 to 1: how much less the farther steps of the search count. It is 1 by default, as
	 * `GTAOPass`'s `distanceFallOff`.
	 */
	distanceFalloff?: number;
	/** The power that the occlusion is raised to: 0 or more, and 1 by default. Above 1 it darkens. */
	scale?: number;
	/**
	 * The depth samples that each pixel's search reads: a whole number from 1 to 64, and 16 by
	 * default. Below 30 they spread over 3 directions, and from 30 over 5.
	 */
	samples?: number;
	/**
	 * From 0 to 1: how much of the occlusion reaches the ambient light. It is 1 by default, as
	 * `GTAOPass`'s `blendIntensity`.
	 */
	intensity?: number;
}

/**
 * The vignette's settings, with the meanings of three.js's `VignetteShader`: each pixel blends
 * toward the gray of `1 - darkness` by its squared distance from the canvas's center, scaled by
 * `offset`. A setting that a call leaves out keeps its value.
 *
 * @category api/post
 */
export interface VignetteSettings {
	/**
	 * How far toward the center the darkening reaches: 0 or more, and 1 by default. At 1, the
	 * corners blend halfway toward the gray, and higher values darken more of the picture.
	 */
	offset?: number;
	/**
	 * How dark the edges turn: 0 or more, and 1 by default, which blends them toward black. Above 1
	 * the blend goes past black, so the edges darken faster.
	 */
	darkness?: number;
}

/**
 * Settings for `post.set`. A setting that the call leaves out keeps its value.
 *
 * @category api/post
 */
export interface PostSettings {
	/**
	 * How the engine maps high dynamic range color to the screen. The default is `'aces'`. three.js
	 * uses no tone mapping by default, so a port of a three.js scene without it sets `'none'`.
	 */
	toneMapping?: ToneMapping;
	/**
	 * Scales the scene's color before the tone mapping, as three.js's `toneMappingExposure` does:
	 * 2 is one stop brighter, and 0.5 one stop darker. It is 0 or more, and 1 by default.
	 */
	exposure?: number;
	/**
	 * Light that spreads from the brightest parts of the scene, as three.js's `UnrealBloomPass`
	 * spreads it. Settings turn bloom on, `{}` with the values it had, and `false` turns it off. It
	 * is off by default.
	 */
	bloom?: BloomSettings | false;
	/**
	 * Ambient occlusion: darkens the ambient light where nearby surfaces hide a surface from the
	 * sky, as three.js's `GTAOPass` finds it. It darkens only the light that comes from all around,
	 * where `GTAOPass` darkens the whole image. Settings turn it on, `{}` with the values it had,
	 * and `false` turns it off. It is off by default, and draws only where the quality setting
	 * `aoScale` is above 0.
	 */
	ao?: AoSettings | false;
	/**
	 * A color grading table from `assets.loadLut`, which maps each pixel's color after the tone
	 * mapping, as three.js's `LUTPass` does. `false` turns it off. It is off by default.
	 */
	lut?: Lut | false;
	/**
	 * The share of the table's color in each pixel, from 0 for none to 1 for all of it, as
	 * `LUTPass`'s `intensity`. It is 1 by default.
	 */
	lutIntensity?: number;
	/**
	 * Darkens the picture toward its edges, as three.js's `VignetteShader` does. Settings turn the
	 * vignette on, `{}` with the values it had, and `false` turns it off. It is off by default.
	 */
	vignette?: VignetteSettings | false;
}

/**
 * The post-processing settings, as `ctx.post`. The engine applies them to every pixel of the scene,
 * the background included, after lighting and before the canvas shows it.
 *
 * @category api/post
 */
export class Post {
	private toneMapping = C.TONE_MAPPING_ACES;
	private bloom = false;
	private warnedNoBloom = false;
	private ao = false;
	private warnedNoAo = false;
	private lut: Lut | false = false;
	private vignette = false;
	/**
	 * The core's block of post-processing values, which holds the numbers of every setting. The
	 * calls read it, so no fraction travels as an argument: the browser stores each fraction that
	 * it passes to a call it does not inline in an object of its own.
	 */
	private values: Float32Array | undefined;
	/** The memory's generation that `values` was made in. */
	private generation = -1;

	/**
	 * `hdrEffects` is false on a device that has no HDR target, where effects that need HDR color
	 * stay off. `occlusionTargets` is false on a device that does not draw into the float targets of
	 * ambient occlusion, where it stays off.
	 */
	constructor(
		private readonly core: CoreMemory,
		private readonly hdrEffects = true,
		private readonly occlusionTargets = true,
	) {}

	/**
	 * Changes the settings that `settings` gives, from the next frame on. It allocates nothing, so
	 * a sketch can change the exposure, bloom, the table's intensity or the vignette every frame.
	 * It throws E1213 for a setting or a tone mapping it does not know, or a value out of its range,
	 * E1203 for a value that is not a number, and E1101 for a table that was destroyed.
	 */
	set(settings: PostSettings): void {
		if (DEV) checkSettings(settings);
		const { toneMapping, exposure, bloom, ao, lut, lutIntensity, vignette } = settings;
		const { core } = this;
		const { glue } = core;
		const values = this.block();
		if (toneMapping !== undefined && Object.hasOwn(CODES, toneMapping))
			this.toneMapping = CODES[toneMapping];
		if (exposure !== undefined) values[C.POST_VALUE_EXPOSURE] = exposure;
		core.check(glue.setOutput(this.toneMapping), 'post.set', undefined, true);
		if (lut !== undefined || lutIntensity !== undefined) {
			if (lut !== undefined) this.lut = lut;
			if (lutIntensity !== undefined) values[C.POST_VALUE_LUT_INTENSITY] = lutIntensity;
			const table = this.lut;
			if (table) {
				for (let axis = 0; axis < 3; axis++) {
					values[C.POST_VALUE_LUT_DOMAIN_MIN + axis] = table.domainMin[axis] as number;
					values[C.POST_VALUE_LUT_DOMAIN_MAX + axis] = table.domainMax[axis] as number;
				}
			}
			core.check(glue.setLut(table ? table.texture.handle : 0), 'post.set', undefined, true);
		}
		if (vignette !== undefined) {
			this.vignette = vignette !== false;
			if (vignette !== false) {
				if (vignette.offset !== undefined) values[C.POST_VALUE_VIGNETTE_OFFSET] = vignette.offset;
				if (vignette.darkness !== undefined)
					values[C.POST_VALUE_VIGNETTE_DARKNESS] = vignette.darkness;
			}
			core.check(glue.setVignette(this.vignette), 'post.set', undefined, true);
		}
		if (ao !== undefined) this.setAo(ao, values);
		if (bloom === undefined) return;
		this.bloom = bloom !== false;
		if (bloom !== false) {
			if (bloom.strength !== undefined) values[C.POST_VALUE_BLOOM_STRENGTH] = bloom.strength;
			if (bloom.radius !== undefined) values[C.POST_VALUE_BLOOM_RADIUS] = bloom.radius;
			if (bloom.threshold !== undefined) values[C.POST_VALUE_BLOOM_THRESHOLD] = bloom.threshold;
		}
		if (DEV && this.bloom && !this.hdrEffects && !this.warnedNoBloom) {
			this.warnedNoBloom = true;
			console.warn(
				'null3D: bloom stays off on this device: it needs HDR color, and the device has no HDR target. See the post-processing concepts page.',
			);
		}
		core.check(glue.setBloom(this.bloom), 'post.set', undefined, true);
	}

	/** Turns ambient occlusion on with the settings that `ao` gives, or off with `false`. */
	private setAo(ao: AoSettings | false, values: Float32Array): void {
		this.ao = ao !== false;
		if (ao !== false) {
			if (ao.radius !== undefined) values[C.POST_VALUE_AO_RADIUS] = ao.radius;
			if (ao.thickness !== undefined) values[C.POST_VALUE_AO_THICKNESS] = ao.thickness;
			if (ao.distanceExponent !== undefined)
				values[C.POST_VALUE_AO_DISTANCE_EXPONENT] = ao.distanceExponent;
			if (ao.distanceFalloff !== undefined)
				values[C.POST_VALUE_AO_DISTANCE_FALLOFF] = ao.distanceFalloff;
			if (ao.scale !== undefined) values[C.POST_VALUE_AO_SCALE] = ao.scale;
			if (ao.samples !== undefined) values[C.POST_VALUE_AO_SAMPLES] = ao.samples;
			if (ao.intensity !== undefined) values[C.POST_VALUE_AO_INTENSITY] = ao.intensity;
		}
		const on = this.ao && this.occlusionTargets;
		if (DEV && this.ao && !this.occlusionTargets && !this.warnedNoAo) {
			this.warnedNoAo = true;
			console.warn(
				'null3D: ambient occlusion stays off on this device: it needs float render targets, and the device has none. See the post-processing concepts page.',
			);
		}
		this.core.check(this.core.glue.setAo(on), 'post.set', undefined, true);
	}

	/** The core's block of post-processing values, through a view made again after the memory grew. */
	private block(): Float32Array {
		const { core } = this;
		if (!this.values || this.generation !== core.generation) {
			this.values = core.f32(core.glue.postValues(), C.POST_VALUE_COUNT);
			this.generation = core.generation;
		}
		return this.values;
	}

	/** @internal True while the sketch has bloom on. */
	get bloomOn(): boolean {
		return this.bloom;
	}

	/** @internal True while the sketch has ambient occlusion on, on a device that draws it. */
	get aoOn(): boolean {
		return this.ao && this.occlusionTargets;
	}
}

/**
 * The largest 32-bit float. The core keeps each post-processing value in one, so a larger value
 * would become infinite there, and an infinite exposure turns black pixels into NaN.
 */
const F32_MAX = 3.4028234663852886e38;

/** Throws E1203 for a value that is not a finite number, and E1213 for one out of its range. */
function checkNumber(name: string, value: number | undefined, max = F32_MAX) {
	if (value === undefined) return;
	if (!Number.isFinite(value))
		throw new EngineError('E1203', `post.set() got ${value} for ${name}.`);
	if (value < 0 || value > max) {
		const range =
			max === F32_MAX
				? 'outside 0 to the largest 32-bit float, about 3.4e38'
				: `outside 0 to ${max}`;
		throw new EngineError('E1213', `post.set() got ${value} for ${name}, ${range}.`);
	}
}

/** Throws the error of the first setting that `post.set` cannot take. */
function checkSettings(settings: PostSettings): void {
	for (const key in settings)
		if (!(SETTINGS as readonly string[]).includes(key))
			throw new EngineError(
				'E1213',
				`post.set() got the setting ${key}, and this version has only toneMapping, exposure, bloom, ao, lut, lutIntensity and vignette.`,
			);
	const { toneMapping, exposure, bloom, ao, lut, lutIntensity, vignette } = settings;
	checkGroup(
		'ao',
		ao,
		AO_SETTINGS,
		'radius, thickness, distanceExponent, distanceFalloff, scale, samples and intensity',
	);
	if (ao) {
		checkNumber('ao.radius', ao.radius);
		checkNumber('ao.thickness', ao.thickness);
		checkNumber('ao.distanceExponent', ao.distanceExponent);
		if (ao.distanceExponent === 0)
			throw new EngineError('E1213', 'post.set() got 0 for ao.distanceExponent, which is above 0.');
		checkNumber('ao.distanceFalloff', ao.distanceFalloff, 1);
		checkNumber('ao.scale', ao.scale);
		checkNumber('ao.intensity', ao.intensity, 1);
		checkNumber('ao.samples', ao.samples, MAX_AO_SAMPLES);
		if (ao.samples !== undefined && (ao.samples < 1 || !Number.isInteger(ao.samples)))
			throw new EngineError(
				'E1213',
				`post.set() got ${ao.samples} for ao.samples, which takes a whole number from 1 to ${MAX_AO_SAMPLES}.`,
			);
	}
	if (lut !== undefined && lut !== false && !(lut instanceof Lut))
		throw new EngineError(
			'E1213',
			`post.set() got ${String(lut)} for lut, which takes a table from assets.loadLut() or false.`,
		);
	checkNumber('lutIntensity', lutIntensity, 1);
	checkGroup('vignette', vignette, VIGNETTE_SETTINGS, 'offset and darkness');
	if (vignette) {
		checkNumber('vignette.offset', vignette.offset);
		checkNumber('vignette.darkness', vignette.darkness);
	}
	if (toneMapping !== undefined && !Object.hasOwn(CODES, toneMapping))
		throw new EngineError(
			'E1213',
			`post.set() got the tone mapping ${JSON.stringify(toneMapping)}, which is not ${TONE_MAPPINGS}.`,
		);
	checkNumber('exposure', exposure);
	checkGroup('bloom', bloom, BLOOM_SETTINGS, 'strength, radius and threshold');
	if (!bloom) return;
	checkNumber('bloom.strength', bloom.strength);
	checkNumber('bloom.radius', bloom.radius, 1);
	checkNumber('bloom.threshold', bloom.threshold);
}

/**
 * Throws E1213 unless a group of settings, such as bloom's, is undefined, false, or an object of
 * only the keys in `keys`, which `listed` names for the error.
 */
function checkGroup(
	name: string,
	group: object | false | undefined,
	keys: readonly string[],
	listed: string,
): void {
	if (group === undefined || group === false) return;
	if (typeof group !== 'object' || group === null)
		throw new EngineError(
			'E1213',
			`post.set() got ${String(group)} for ${name}, which takes ${name} settings or false.`,
		);
	for (const key in group)
		if (!keys.includes(key))
			throw new EngineError(
				'E1213',
				`post.set() got the ${name} setting ${key}, and ${name} has only ${listed}.`,
			);
}
