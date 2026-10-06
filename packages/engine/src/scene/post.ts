// The post-processing settings that a sketch sets through `ctx.post`: the exposure and the tone
// mapping, which the engine applies to the scene's color on its way to the canvas, bloom, ambient
// occlusion, which darkens the ambient light of the camera's opaque objects, outlines, and the
// color grading table and the vignette, which the final pass applies after the tone mapping. The
// core takes one exposure: the sketch's exposure times the camera exposure of its EV100. The
// sketch's custom effects and custom tone curve come through here too (see `effects.ts`).

import { DEV } from '../errors/checks';
import { EngineError } from '../errors/engine-error';
import * as C from '../generated/core';
import { fromHex } from '../math/color';
import { hexValue, invalidColor } from '../math/hex';
import { type ColorInput, isComponent } from './color';
import { type Effect, EffectChain, type EffectOptions } from './effects';
import { Lut } from './lut';
import type { CoreMemory } from './memory';
import type { CompiledWgsl } from './resources';
import { ShaderPreloads } from './shader-preloads';
import { ShaderTemplates } from './shader-templates';
import type { UniformValues } from './wgsl-uniforms';

/**
 * How the engine maps the scene's high dynamic range color to the screen, with three.js's
 * formulas. The curves are three.js's `ACESFilmicToneMapping` (`'aces'`), `AgXToneMapping`
 * (`'agx'`) and `NeutralToneMapping` (`'neutral'`). The value `'none'` clips the exposed color at
 * 1, as `LinearToneMapping` does.
 *
 * @category api/post
 */
export type ToneMapping = 'aces' | 'agx' | 'neutral' | 'none';

/**
 * A custom tone curve: WGSL that declares `fn toneCurve(color: vec3f) -> vec3f`, compiled by the
 * null3D Vite plugin. The final pass calls it in place of the built-in curves, with the exposed
 * linear color of each pixel. It clamps what the curve returns to 0 to 1. TypeScript sees a tagged
 * template literal as its text, which names the function.
 *
 * @category api/post
 */
export type ToneCurve = CompiledWgsl | `${string}toneCurve${string}`;

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
	'ev100',
	'bloom',
	'ao',
	'lut',
	'lutIntensity',
	'vignette',
	'outline',
] as const;
const BLOOM_SETTINGS = ['intensity', 'threshold', 'knee', 'blend', 'weights'] as const;
/** Each way of blending bloom's glow, by its code in the core. */
const BLENDS = { mix: 0, add: 1, screen: 2 } as const;
/** The levels of bloom's chain, which take a weight each. */
const BLOOM_LEVELS = 10;
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
const OUTLINE_SETTINGS = ['color', 'hiddenColor', 'width'] as const;
const TONE_MAPPINGS = "'aces', 'agx', 'neutral' or 'none'";

/** The lowest and highest EV100 that `post.set` takes. */
const EV100_MIN = -20;
const EV100_MAX = 30;

/**
 * The exposure of a camera set to `ev100`: 1 / (1.2 × 2^EV100), the formula of Filament, Bevy,
 * Godot and Unity's HDRP, from the saturation-based sensitivity of ISO 12232. The brightest
 * luminance that the camera shows without clipping is 1.2 × 2^EV100 nits, which becomes 1.
 */
export function exposureOfEv100(ev100: number): number {
	return 1 / (1.2 * 2 ** ev100);
}

/**
 * How bloom's glow meets the scene's color. The `'mix'` blend moves each pixel's color toward the
 * glow by the intensity, which keeps the image's total light. The `'add'` blend adds the glow, as
 * three.js's `UnrealBloomPass` does. The `'screen'` blend screens it, as pmndrs's `BloomEffect`
 * does.
 *
 * @category api/post
 */
export type BloomBlend = 'mix' | 'add' | 'screen';

/**
 * Bloom's settings. Bloom blurs the scene's color through a chain of up to 10 levels, each half
 * the size of the one before. It blends their sum into the image. A setting that a call leaves out keeps its
 * value.
 *
 * @category api/post
 */
export interface BloomSettings {
	/**
	 * How strong the glow is: 0 or more, and 0.15 by default. With the `'mix'` blend it is the
	 * glow's share of each pixel, at most 1. With `'add'` and `'screen'` it multiplies the glow.
	 */
	intensity?: number;
	/**
	 * The luminance from which a pixel glows, in linear color before the exposure: 0 or more, and 0
	 * by default, so all light glows a little. At 1, only colors brighter than white glow, such as
	 * strong emissive light.
	 */
	threshold?: number;
	/**
	 * The width of the threshold's soft edge, in luminance: 0 or more, and 0.1 by default. A pixel
	 * glows more as its luminance rises from the threshold to the threshold plus this width.
	 */
	knee?: number;
	/** How the glow meets the scene's color. It is `'mix'` by default. */
	blend?: BloomBlend;
	/**
	 * Each level's share of the glow, from the narrowest level to the widest: up to 10 numbers of 0
	 * or more, not all 0. The engine divides them by their sum, and a missing level takes 0. Each
	 * level spreads light twice as far as the one before: the eighth over about a quarter of the
	 * canvas's shorter side, and the tenth over all of it. Levels past the last one with a weight
	 * cost nothing. The default gives 8 levels weights, most to the narrow ones, for a soft glow.
	 */
	weights?: readonly number[];
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
 * The outline's settings: a sharp line of one width around the objects that `setOutlined(true)`
 * marks. A setting that a call leaves out keeps its value.
 *
 * @category api/post
 */
export interface OutlineSettings {
	/**
	 * The color of the line around the parts that nothing hides. The canvas shows this color
	 * exactly: the exposure and the tone mapping do not change it. It is white by default.
	 */
	color?: ColorInput;
	/**
	 * The color of the line around the parts that other objects hide, or `false` for no line
	 * there. It is `false` by default.
	 */
	hiddenColor?: ColorInput | false;
	/**
	 * The line's width in CSS pixels: 0 or more, and 2 by default. Above about 4 pixels of the
	 * canvas, parts thinner than the line can leave a gap between themselves and their line.
	 */
	width?: number;
}

/**
 * Settings for `post.set`. A setting that the call leaves out keeps its value.
 *
 * @category api/post
 */
export interface PostSettings {
	/**
	 * How the engine maps high dynamic range color to the screen: a built-in curve's name, or a
	 * custom tone curve's WGSL. The default is `'aces'`. three.js uses no tone mapping by default,
	 * so a port of a three.js scene without it sets `'none'`. A custom curve needs HDR color, as
	 * bloom does; on a device without an HDR target the built-in curve stays.
	 */
	toneMapping?: ToneMapping | ToneCurve;
	/**
	 * Scales the scene's color before the tone mapping, as three.js's `toneMappingExposure` does:
	 * 2 is one stop brighter, and 0.5 one stop darker. It is 0 or more, and 1 by default. With
	 * `ev100`, it scales the camera's exposure, as exposure compensation does.
	 */
	exposure?: number;
	/**
	 * The camera's exposure value at ISO 100, for lights in real units: 15 suits a sunny day lit by
	 * a sun of 100,000 lux, 12 an overcast day, and 7 a lit room. It scales the scene's color by
	 * 1 / (1.2 × 2^ev100), as Filament and Bevy do, so each step up is one stop darker. It is a
	 * number from -20 to 30, and `false`, the default, turns it off, which leaves three.js's
	 * units.
	 */
	ev100?: number | false;
	/**
	 * Light that spreads from the bright parts of the scene through a chain of blurred levels.
	 * Settings turn bloom on, `{}` with the values it had, and `false` turns it off. It is off by
	 * default. Its glow keeps its size as a share of the canvas at any pixel ratio and render scale.
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
	/**
	 * A sharp line around the objects that `setOutlined(true)` marks. Settings turn outlines on,
	 * `{}` with the values they had, and `false` turns them off. They are off by default.
	 */
	outline?: OutlineSettings | false;
}

/** Scratch for a hex color's linear components, so reading one allocates nothing. */
const linear = [0, 0, 0];

/**
 * Writes a color input's linear components into the post-processing values from `place` on. It
 * throws E1204 for a color it cannot read.
 */
function writeColor(values: Float32Array, place: number, color: ColorInput, call: string): void {
	if (typeof color === 'string' || typeof color === 'number') {
		if (hexValue(color) < 0) throw invalidColor(color, call);
		fromHex(linear, color);
		values[place] = linear[0] as number;
		values[place + 1] = linear[1] as number;
		values[place + 2] = linear[2] as number;
		return;
	}
	if (color?.length !== 3 || !color.every(isComponent)) throw invalidColor(color, call);
	values[place] = color[0];
	values[place + 1] = color[1];
	values[place + 2] = color[2];
}

/**
 * The post-processing settings, as `ctx.post`. The engine applies them to every pixel of the scene,
 * the background included, after lighting and before the canvas shows it.
 *
 * @category api/post
 */
export class Post {
	private toneMapping = C.TONE_MAPPING_ACES;
	/** The sketch's exposure, before the camera exposure of `ev100` scales it. */
	private exposure = 1;
	private ev100: number | false = false;
	private bloom = false;
	private warnedNoBloom = false;
	private ao = false;
	private warnedNoAo = false;
	private lut: Lut | false = false;
	private vignette = false;
	private outline = false;
	/** The custom tone curve that maps the scene's color, while the sketch sets one. */
	private toneCurve: ToneCurve | undefined;
	/** True when an effect or a tone curve came since the last frame, with pipelines to build. */
	private newPipelines = false;
	private warnedNoHdr = false;
	/** The sketch's custom effects and its custom tone curve. */
	private readonly effects: EffectChain;
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
		/** Asks for bloom's and ambient occlusion's shader files when they turn on. */
		private readonly shaders = new ShaderPreloads(),
		templates = new ShaderTemplates(),
		/** False when each custom effect draws in a pass of its own, as ?join=off asks. */
		joinEffects = true,
	) {
		this.effects = new EffectChain(core, templates, joinEffects);
	}

	/**
	 * Adds a custom effect, which runs from the next frame on, and returns it. An effect is a
	 * full-screen pass of WGSL that declares `fn effect(input: EffectInput) -> vec4f`. It reads the
	 * scene's HDR color after the exposure, before bloom and the tone mapping, and returns the new
	 * color. Effects run from the lowest `order` to the highest. The engine joins an effect that reads
	 * only its own pixel into the pass of the effect before it, so effects take few passes. At most
	 * 8 run at once. An effect needs HDR color, as bloom does; on a device without an HDR target it
	 * stays off, and development builds warn once. Throws E1215 for WGSL that the null3D Vite plugin
	 * did not compile as an effect, E1216 for a uniform that the WGSL does not declare or a value of
	 * the wrong kind, E1203 for an order that is not a number, and E1213 for a ninth effect.
	 */
	addEffect<const Wgsl extends string | CompiledWgsl>(
		options: EffectOptions<Wgsl>,
	): Effect<UniformValues<Wgsl>> {
		const effect = this.effects.add(options as unknown as EffectOptions, 'post.addEffect');
		this.newPipelines = true;
		this.warnWithoutHdr();
		return effect as Effect<UniformValues<Wgsl>>;
	}

	/**
	 * Changes one uniform of an effect, from the next frame on. It allocates nothing, so a sketch can
	 * change a uniform every frame. Keep a vector's values in one array that the sketch changes in
	 * place. Throws E1216 for a uniform
	 * that the effect's WGSL does not declare or a value of the wrong kind, and E1101 for an effect
	 * that `removeEffect` removed.
	 */
	setEffectUniform<Values, Name extends keyof Values & string>(
		effect: Effect<Values>,
		name: Name,
		value: NonNullable<Values[Name]>,
	): void {
		this.effects.setUniform(
			effect as Effect,
			name,
			value as unknown as number | string | readonly number[],
			'post.setEffectUniform',
		);
	}

	/** Removes an effect from the next frame on. Removing an effect twice does nothing. */
	removeEffect<Values>(effect: Effect<Values>): void {
		this.effects.remove(effect as Effect, 'post.removeEffect');
	}

	/**
	 * Changes the settings that `settings` gives, from the next frame on. It allocates nothing, so
	 * a sketch can change the exposure, bloom, the outline, the table's intensity or the vignette
	 * every frame. It throws E1213 for a setting or a tone mapping it does not know, or a value out
	 * of its range, E1203 for a value that is not a number, E1204 for a color it cannot read, and
	 * E1101 for a table that was destroyed.
	 */
	set(settings: PostSettings): void {
		if (DEV) checkSettings(settings);
		const { toneMapping, exposure, ev100, bloom, ao, lut, lutIntensity, vignette, outline } =
			settings;
		const { core } = this;
		const { glue } = core;
		const values = this.block();
		const sketchExposure = exposure ?? this.exposure;
		const cameraEv100 = ev100 ?? this.ev100;
		const exposed =
			cameraEv100 === false ? sketchExposure : sketchExposure * exposureOfEv100(cameraEv100);
		if (DEV) checkNumber('the exposure times the camera exposure of ev100', exposed);
		this.exposure = sketchExposure;
		this.ev100 = cameraEv100;
		values[C.POST_VALUE_EXPOSURE] = exposed;
		if (typeof toneMapping === 'string' && Object.hasOwn(CODES, toneMapping)) {
			this.toneMapping = CODES[toneMapping as ToneMapping];
			if (this.toneCurve !== undefined) {
				this.effects.setToneCurve(undefined, 'post.set');
				this.newPipelines = true;
			}
			this.toneCurve = undefined;
		} else if (toneMapping !== undefined && toneMapping !== this.toneCurve) {
			this.effects.setToneCurve(toneMapping, 'post.set');
			this.toneCurve = toneMapping as ToneCurve;
			this.newPipelines = true;
			this.warnWithoutHdr();
		}
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
		if (outline !== undefined) {
			this.outline = outline !== false;
			if (outline !== false) {
				const { color, hiddenColor, width } = outline;
				if (color !== undefined) writeColor(values, C.POST_VALUE_OUTLINE_COLOR, color, 'post.set');
				if (hiddenColor !== undefined) {
					values[C.POST_VALUE_OUTLINE_HIDDEN] = hiddenColor === false ? 0 : 1;
					if (hiddenColor !== false)
						writeColor(values, C.POST_VALUE_OUTLINE_HIDDEN_COLOR, hiddenColor, 'post.set');
				}
				if (width !== undefined) values[C.POST_VALUE_OUTLINE_WIDTH] = width;
			}
			core.check(glue.setOutline(this.outline), 'post.set', undefined, true);
		}
		if (bloom === undefined) return;
		this.bloom = bloom !== false;
		if (bloom !== false) {
			const { intensity, threshold, knee, blend, weights } = bloom;
			if (intensity !== undefined) values[C.POST_VALUE_BLOOM_INTENSITY] = intensity;
			if (threshold !== undefined) values[C.POST_VALUE_BLOOM_THRESHOLD] = threshold;
			if (knee !== undefined) values[C.POST_VALUE_BLOOM_KNEE] = knee;
			if (blend !== undefined && Object.hasOwn(BLENDS, blend))
				values[C.POST_VALUE_BLOOM_BLEND] = BLENDS[blend];
			if (weights !== undefined)
				for (let level = 0; level < BLOOM_LEVELS; level++)
					values[C.POST_VALUE_BLOOM_WEIGHTS + level] = weights[level] ?? 0;
		}
		if (DEV && this.bloom && !this.hdrEffects && !this.warnedNoBloom) {
			this.warnedNoBloom = true;
			console.warn(
				'null3D: bloom stays off on this device: it needs HDR color, and the device has no HDR target. See the post-processing concepts page.',
			);
		}
		if (this.bloom && this.hdrEffects) this.shaders.need('bloom');
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
		if (on) this.shaders.need('ao');
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

	/**
	 * @internal True while the sketch uses something that needs HDR color: bloom, a custom effect
	 * or a custom tone curve.
	 */
	get needsHdr(): boolean {
		return this.bloom || this.toneCurve !== undefined || this.effects.any;
	}

	/**
	 * @internal Draws the effects of the joined shader of template `template` one pass each from now
	 * on, after the thread that draws found that its pipeline failed to build.
	 */
	dropJoin(template: number): void {
		this.effects.dropJoin(template);
	}

	/**
	 * @internal True once after an effect or a tone curve came: the frame draws with pipelines that
	 * may still build, so the thread that draws holds it until they are built. A frame that drew
	 * an effect's pass with no pipeline would show its blank target.
	 */
	takeNewPipelines(): boolean {
		const taken = this.newPipelines;
		this.newPipelines = false;
		return taken;
	}

	/** Warns once in development builds that effects and tone curves stay off on this device. */
	private warnWithoutHdr(): void {
		if (!DEV || this.hdrEffects || this.warnedNoHdr) return;
		this.warnedNoHdr = true;
		console.warn(
			'null3D: custom effects and custom tone curves stay off on this device: they need HDR color, and the device has no HDR target. See the post-processing concepts page.',
		);
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
				`post.set() got the setting ${key}, and this version has only toneMapping, exposure, ev100, bloom, ao, lut, lutIntensity, vignette and outline.`,
			);
	const { toneMapping, exposure, ev100, bloom, ao, lut, lutIntensity, vignette, outline } =
		settings;
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
	checkGroup('outline', outline, OUTLINE_SETTINGS, 'color, hiddenColor and width');
	if (outline) checkNumber('outline.width', outline.width);
	if (
		typeof toneMapping === 'string' &&
		!Object.hasOwn(CODES, toneMapping) &&
		!toneMapping.includes('toneCurve')
	)
		throw new EngineError(
			'E1213',
			`post.set() got the tone mapping ${JSON.stringify(toneMapping)}, which is not ${TONE_MAPPINGS}.`,
		);
	checkNumber('exposure', exposure);
	checkEv100(ev100);
	checkGroup('bloom', bloom, BLOOM_SETTINGS, 'intensity, threshold, knee, blend and weights');
	if (!bloom) return;
	checkNumber('bloom.intensity', bloom.intensity);
	checkNumber('bloom.threshold', bloom.threshold);
	checkNumber('bloom.knee', bloom.knee);
	if (bloom.blend !== undefined && !Object.hasOwn(BLENDS, bloom.blend))
		throw new EngineError(
			'E1213',
			`post.set() got the bloom blend ${JSON.stringify(bloom.blend)}, which is not 'mix', 'add' or 'screen'.`,
		);
	const { weights } = bloom;
	if (weights === undefined) return;
	if (!Array.isArray(weights) || weights.length < 1 || weights.length > BLOOM_LEVELS)
		throw new EngineError(
			'E1213',
			`post.set() got ${String(weights)} for bloom.weights, which takes a list of 1 to ${BLOOM_LEVELS} numbers.`,
		);
	for (const weight of weights) checkNumber('a bloom weight', weight);
	if (!weights.some((weight) => weight > 0))
		throw new EngineError(
			'E1213',
			'post.set() got bloom weights that are all 0. Give at least one level a weight above 0.',
		);
}

/** Throws E1203 for an EV100 that is not a number or `false`, and E1213 for one out of its range. */
function checkEv100(ev100: number | false | undefined): void {
	if (ev100 === undefined || ev100 === false) return;
	if (typeof ev100 !== 'number' || !Number.isFinite(ev100))
		throw new EngineError('E1203', `post.set() got ${String(ev100)} for ev100.`);
	if (ev100 < EV100_MIN || ev100 > EV100_MAX)
		throw new EngineError(
			'E1213',
			`post.set() got ${ev100} for ev100, outside ${EV100_MIN} to ${EV100_MAX}.`,
		);
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
