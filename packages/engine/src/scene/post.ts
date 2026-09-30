// The post-processing settings that a sketch sets through `ctx.post`: the exposure and the tone
// mapping, which the engine applies to the scene's color on its way to the canvas.

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
const SETTINGS = ['toneMapping', 'exposure'] as const;
const TONE_MAPPINGS = "'aces', 'agx', 'neutral' or 'none'";

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

	constructor(private readonly core: CoreMemory) {}

	/**
	 * Changes the settings that `settings` gives, from the next frame on. It allocates nothing, so
	 * a sketch can change the exposure every frame. It throws E1213 for a setting or a tone mapping
	 * it does not know, or a negative exposure, and E1203 for an exposure that is not a number.
	 */
	set(settings: PostSettings): void {
		if (DEV) checkSettings(settings);
		const { toneMapping, exposure } = settings;
		if (toneMapping !== undefined && Object.hasOwn(CODES, toneMapping))
			this.toneMapping = CODES[toneMapping];
		if (exposure !== undefined) this.exposure = exposure;
		this.core.check(
			this.core.glue.setOutput(this.toneMapping, this.exposure),
			'post.set',
			undefined,
			true,
		);
	}
}

/** Throws the error of the first setting that `post.set` cannot take. */
function checkSettings(settings: PostSettings): void {
	for (const key in settings)
		if (!(SETTINGS as readonly string[]).includes(key))
			throw new EngineError(
				'E1213',
				`post.set() got the setting ${key}, and this version has only toneMapping and exposure.`,
			);
	const { toneMapping, exposure } = settings;
	if (toneMapping !== undefined && !Object.hasOwn(CODES, toneMapping))
		throw new EngineError(
			'E1213',
			`post.set() got the tone mapping ${JSON.stringify(toneMapping)}, which is not ${TONE_MAPPINGS}.`,
		);
	if (exposure === undefined) return;
	if (!Number.isFinite(exposure))
		throw new EngineError('E1203', `post.set() got ${exposure} for exposure.`);
	if (exposure < 0)
		throw new EngineError('E1213', `post.set() got the exposure ${exposure}, below 0.`);
}
