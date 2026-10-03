// The post-processing settings that a sketch sets through `ctx.post`: the exposure and the tone
// mapping, which the engine applies to the scene's color on its way to the canvas, and bloom.

import { DEV } from '../errors/checks';
import { EngineError } from '../errors/engine-error';
import * as C from '../generated/core';
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
const SETTINGS = ['toneMapping', 'exposure', 'bloom'] as const;
const BLOOM_SETTINGS = ['strength', 'radius', 'threshold'] as const;
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
}

/**
 * The post-processing settings, as `ctx.post`. The engine applies them to every pixel of the scene,
 * the background included, after lighting and before the canvas shows it.
 *
 * @category api/post
 */
export class Post {
	private toneMapping = C.TONE_MAPPING_ACES;
	private exposure = 1;
	private bloom = false;
	private strength = 1;
	private radius = 0.5;
	private threshold = 1;
	private warnedNoBloom = false;

	/**
	 * `hdrEffects` is false on a device that has no HDR target, where effects that need HDR color
	 * stay off.
	 */
	constructor(
		private readonly core: CoreMemory,
		private readonly hdrEffects = true,
	) {}

	/**
	 * Changes the settings that `settings` gives, from the next frame on. It allocates nothing, so
	 * a sketch can change the exposure or bloom every frame. It throws E1213 for a setting or a
	 * tone mapping it does not know, or a value out of its range, and E1203 for a value that is not
	 * a number.
	 */
	set(settings: PostSettings): void {
		if (DEV) checkSettings(settings);
		const { toneMapping, exposure, bloom } = settings;
		if (toneMapping !== undefined && Object.hasOwn(CODES, toneMapping))
			this.toneMapping = CODES[toneMapping];
		if (exposure !== undefined) this.exposure = exposure;
		const glue = this.core.glue;
		this.core.check(glue.setOutput(this.toneMapping, this.exposure), 'post.set', undefined, true);
		if (bloom === undefined) return;
		this.bloom = bloom !== false;
		if (bloom !== false) {
			if (bloom.strength !== undefined) this.strength = bloom.strength;
			if (bloom.radius !== undefined) this.radius = bloom.radius;
			if (bloom.threshold !== undefined) this.threshold = bloom.threshold;
		}
		if (DEV && this.bloom && !this.hdrEffects && !this.warnedNoBloom) {
			this.warnedNoBloom = true;
			console.warn(
				'null3D: bloom stays off on this device: it needs HDR color, and the device has no HDR target. See the post-processing concepts page.',
			);
		}
		this.core.check(
			glue.setBloom(this.bloom, this.strength, this.radius, this.threshold),
			'post.set',
			undefined,
			true,
		);
	}

	/** @internal True while the sketch has bloom on. */
	get bloomOn(): boolean {
		return this.bloom;
	}
}

/** Throws E1203 for a value that is not a finite number, and E1213 for one out of its range. */
function checkNumber(name: string, value: number | undefined, max = Number.POSITIVE_INFINITY) {
	if (value === undefined) return;
	if (!Number.isFinite(value))
		throw new EngineError('E1203', `post.set() got ${value} for ${name}.`);
	if (value < 0 || value > max) {
		const range = max === Number.POSITIVE_INFINITY ? 'below 0' : `outside 0 to ${max}`;
		throw new EngineError('E1213', `post.set() got ${value} for ${name}, ${range}.`);
	}
}

/** Throws the error of the first setting that `post.set` cannot take. */
function checkSettings(settings: PostSettings): void {
	for (const key in settings)
		if (!(SETTINGS as readonly string[]).includes(key))
			throw new EngineError(
				'E1213',
				`post.set() got the setting ${key}, and this version has only toneMapping, exposure and bloom.`,
			);
	const { toneMapping, exposure, bloom } = settings;
	if (toneMapping !== undefined && !Object.hasOwn(CODES, toneMapping))
		throw new EngineError(
			'E1213',
			`post.set() got the tone mapping ${JSON.stringify(toneMapping)}, which is not ${TONE_MAPPINGS}.`,
		);
	checkNumber('exposure', exposure);
	if (bloom === undefined || bloom === false) return;
	if (typeof bloom !== 'object' || bloom === null)
		throw new EngineError(
			'E1213',
			`post.set() got ${String(bloom)} for bloom, which takes bloom settings or false.`,
		);
	for (const key in bloom)
		if (!(BLOOM_SETTINGS as readonly string[]).includes(key))
			throw new EngineError(
				'E1213',
				`post.set() got the bloom setting ${key}, and bloom has only strength, radius and threshold.`,
			);
	checkNumber('bloom.strength', bloom.strength);
	checkNumber('bloom.radius', bloom.radius, 1);
	checkNumber('bloom.threshold', bloom.threshold);
}
