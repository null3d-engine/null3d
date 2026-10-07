// Custom effects: full-screen passes of the sketch's own WGSL, which `post.addEffect` adds. Each
// effect's WGSL declares `fn effect(input: EffectInput) -> vec4f`, which the null3D Vite plugin
// builds into the engine's effect template. The engine runs the effects on the scene's HDR color,
// after the exposure and before bloom and the tone curve, in the order of their `order` values.
//
// The chain keeps the effects in run order and gives the core the effects from the first place
// that changed. A uniform's new value goes to the core with its effect's other uniforms, through
// the core's block of effect values, so setting a uniform every frame allocates nothing.

import { DEV } from '../errors/checks';
import { EngineError } from '../errors/engine-error';
import { EFFECT_DEPTH, EFFECT_FLOATS, EFFECT_MAX } from '../generated/core';
import type { ShaderVariants } from '../generated/shaders';
import { fromHex } from '../math/color';
import { hexValue, invalidColor } from '../math/hex';
import type { CoreMemory } from './memory';
import type { CompiledWgsl } from './resources';
import type { ShaderTemplates } from './shader-templates';
import type { UniformType, UniformValue, UniformValues } from './wgsl-uniforms';

/**
 * Options of `post.addEffect`: the effect's WGSL, the first values of its uniforms, and its place
 * among the effects. `Wgsl` is the type of the effect's WGSL. It gives the names and types of the
 * uniforms.
 *
 * @category api/post
 */
export interface EffectOptions<Wgsl extends string | CompiledWgsl = string | CompiledWgsl> {
	/**
	 * The effect's WGSL, compiled by the null3D Vite plugin. It declares
	 * `fn effect(input: EffectInput) -> vec4f`, which the engine calls for each pixel of the
	 * scene's image. It can declare `struct Uniforms`, whose fields the effect reads from
	 * `uniforms`. Effects made from the same WGSL share their shader.
	 */
	wgsl: Wgsl;
	/**
	 * The first value of each uniform, by name. A uniform without one starts at 0. When TypeScript
	 * can see the WGSL's uniforms, a name that the WGSL does not declare fails the type check.
	 */
	uniforms?: NoInfer<
		[keyof UniformValues<Wgsl>] extends [never]
			? { readonly [name: string]: never }
			: UniformValues<Wgsl>
	>;
	/**
	 * The effect's place among the effects: effects run from the lowest order to the highest, and
	 * effects of the same order run in the order they were added. It is 0 by default.
	 */
	order?: number;
}

/**
 * A custom effect that `post.addEffect` added. `post.setEffectUniform` changes its uniforms, and
 * `post.removeEffect` removes it. `Values` gives the names and types of its uniforms.
 *
 * @category api/post
 */
export class Effect<Values = UniformValues<string>> {
	/** @internal The values of its uniforms, as the shader build placed them. */
	readonly values = new Float32Array(EFFECT_FLOATS);
	/** @internal Its place in the run order, or -1 once it was removed. */
	place = -1;
	declare private readonly uniformValues: Values;

	/** @internal */
	constructor(
		/** @internal The render pipeline template of its compiled WGSL. */
		readonly template: number,
		/** @internal True when it reads the scene's depth. */
		readonly depth: boolean,
		/** @internal Its uniforms by name. */
		readonly uniforms: ReadonlyMap<string, EffectUniform>,
		/** @internal Its order value. */
		readonly order: number,
		/** @internal How many effects were added before it, which breaks ties of order. */
		readonly sequence: number,
	) {}

	/** True until `post.removeEffect` removes the effect. */
	get live(): boolean {
		return this.place >= 0;
	}
}

/** A uniform of a custom effect: its type, and the float of the effect's values it starts at. */
interface EffectUniform {
	readonly name: string;
	readonly type: UniformType;
	readonly offset: number;
}

/** A custom effect's WGSL as the plugin compiles it. */
interface CompiledEffect extends CompiledWgsl {
	readonly kind: 'effect';
	readonly uniforms: readonly EffectUniform[];
	readonly depth: boolean;
	readonly variants: ShaderVariants;
}

/** A custom tone curve's WGSL as the plugin compiles it. */
interface CompiledToneCurve extends CompiledWgsl {
	readonly kind: 'toneCurve';
	readonly variants: ShaderVariants;
}

/** The numbers each type of uniform takes. */
const UNIFORM_FLOATS: Readonly<Record<UniformType, number>> = {
	f32: 1,
	i32: 1,
	u32: 1,
	vec2f: 2,
	vec3f: 3,
	vec4f: 4,
};

/** Scratch for a hex color's linear components, so a color allocates nothing. */
const linear = [0, 0, 0];

/** What a uniform of `type` takes, for an error. */
function takes(type: UniformType): string {
	const count = UNIFORM_FLOATS[type];
	if (count === 1) return type === 'f32' ? 'a number' : 'a whole number';
	return `an array of ${count} numbers${count === 3 ? ', or a color' : ''}`;
}

/** E1216 for a value that a uniform does not take. */
function wrongValue(uniform: EffectUniform, value: UniformValue, call: string): EngineError {
	return new EngineError(
		'E1216',
		`${call}() got ${JSON.stringify(value)} for the ${uniform.type} uniform ${uniform.name}; it takes ${takes(uniform.type)}.`,
	);
}

/**
 * Throws E1216 for a value that a uniform does not take: a number of another kind, an array of
 * another length or with an element that is not a finite number, or a color it cannot read.
 */
function checkUniform(uniform: EffectUniform, value: UniformValue, call: string): void {
	const count = UNIFORM_FLOATS[uniform.type];
	if (count === 1) {
		const whole = uniform.type !== 'f32';
		if (typeof value !== 'number' || !Number.isFinite(value) || (whole && !Number.isInteger(value)))
			throw wrongValue(uniform, value, call);
		if (uniform.type === 'u32' && value < 0) throw wrongValue(uniform, value, call);
		return;
	}
	if (uniform.type === 'vec3f' && !Array.isArray(value)) {
		if (hexValue(value as string | number) < 0) throw invalidColor(value, call);
		return;
	}
	if (!Array.isArray(value) || value.length !== count) throw wrongValue(uniform, value, call);
	for (const n of value)
		if (typeof n !== 'number' || !Number.isFinite(n)) throw wrongValue(uniform, value, call);
}

/**
 * Writes a uniform's value into `out` at the uniform's offset. A `vec3f` takes an sRGB color too,
 * which becomes linear. Development builds check the value first. It allocates nothing: an array
 * goes in through the typed array's own copy, which reads no element into a number of its own.
 */
function writeUniform(
	out: Float32Array,
	uniform: EffectUniform,
	value: UniformValue,
	call: string,
): void {
	if (DEV) checkUniform(uniform, value, call);
	const at = uniform.offset;
	if (typeof value === 'number') {
		out[at] = value;
		return;
	}
	if (Array.isArray(value)) {
		out.set(value, at);
		return;
	}
	const hex = hexValue(value as string | number);
	if (hex < 0) throw invalidColor(value, call);
	fromHex(linear, hex);
	out[at] = linear[0] as number;
	out[at + 1] = linear[1] as number;
	out[at + 2] = linear[2] as number;
}

/**
 * The sketch's custom effects in run order, and the custom tone curve, as the core draws them.
 */
export class EffectChain {
	/** The effects that run, in order. */
	private readonly chain: Effect[] = [];
	/** How many effects were added, which orders effects of the same order value. */
	private added = 0;
	/** The core's block of one effect's uniforms, through a view made again after memory grew. */
	private block: Float32Array | undefined;
	private generation = -1;

	constructor(
		private readonly core: CoreMemory,
		private readonly templates: ShaderTemplates,
	) {}

	/** True while at least one effect runs. */
	get any(): boolean {
		return this.chain.length > 0;
	}

	/**
	 * Adds an effect and returns it. Throws E1215 for WGSL that the plugin did not compile as an
	 * effect, E1216 for a wrong uniform, E1203 for an order that is not a number, and E1213 when
	 * the most effects already run.
	 */
	add(options: EffectOptions, call: string): Effect {
		const compiled = compiledEffect(options?.wgsl, call);
		const order = options.order ?? 0;
		if (typeof order !== 'number' || !Number.isFinite(order))
			throw new EngineError('E1203', `${call}() got ${String(order)} for order.`);
		if (this.chain.length >= EFFECT_MAX)
			throw new EngineError(
				'E1213',
				`${call}() got effect ${this.chain.length + 1}, and at most ${EFFECT_MAX} effects run at once. Remove an effect first, or join effects that read only their own pixel into one WGSL function.`,
			);
		const uniforms = new Map(compiled.uniforms.map((u) => [u.name, u]));
		const template = this.templates.of(compiled, () => [
			{ kind: 'effect', variants: compiled.variants, locations: [], textures: 0 },
		]);
		const effect = new Effect(template, compiled.depth, uniforms, order, this.added);
		const first = options.uniforms ?? {};
		for (const name in first) {
			const value = (first as Record<string, UniformValue | undefined>)[name];
			if (value !== undefined)
				writeUniform(effect.values, uniformOf(effect, name, call), value, call);
		}
		this.added++;
		let place = this.chain.length;
		while (place > 0 && (this.chain[place - 1] as Effect).order > order) place--;
		this.chain.splice(place, 0, effect);
		this.sendFrom(place, call);
		return effect;
	}

	/**
	 * Changes one uniform of a live effect, from the next frame on. Throws E1101 for an effect that
	 * was removed and E1216 for a wrong uniform. It allocates nothing.
	 */
	setUniform(effect: Effect, name: string, value: UniformValue, call: string): void {
		if (!(effect instanceof Effect))
			throw new EngineError('E1216', `${call}() got ${String(effect)}, which is not an effect.`);
		if (!effect.live)
			throw new EngineError('E1101', `${call}() got an effect that post.removeEffect() removed.`);
		writeUniform(effect.values, uniformOf(effect, name, call), value, call);
		this.send(effect, call);
	}

	/** Removes a live effect from the next frame on. An effect that was removed stays removed. */
	remove(effect: Effect, call: string): void {
		if (!(effect instanceof Effect))
			throw new EngineError('E1216', `${call}() got ${String(effect)}, which is not an effect.`);
		const place = this.chain.indexOf(effect);
		if (place < 0) return;
		this.chain.splice(place, 1);
		effect.place = -1;
		this.sendFrom(place, call);
	}

	/**
	 * Makes the final pass map HDR color with a custom tone curve, or with the built-in curves with
	 * `undefined`. Throws E1215 for WGSL that the plugin did not compile as a tone curve.
	 */
	setToneCurve(wgsl: CompiledWgsl | string | undefined, call: string): void {
		const { core } = this;
		if (wgsl === undefined) {
			core.check(core.glue.setToneCurve(0), call, undefined, true);
			return;
		}
		if (typeof wgsl !== 'object' || wgsl?.kind !== 'toneCurve')
			throw new EngineError(
				'E1215',
				typeof wgsl === 'string'
					? `${call}() got a tone curve as text, which the null3D Vite plugin did not compile. Tag the WGSL with a /* wgsl */ comment, or import it from a .wgsl file.`
					: `${call}() got ${kindOf(wgsl)} for toneMapping, which takes a built-in curve's name or WGSL that declares fn toneCurve.`,
			);
		const curve = wgsl as CompiledToneCurve;
		const template = this.templates.of(curve, () => [
			{ kind: 'final', variants: curve.variants, locations: [], textures: 0 },
			{ kind: 'finalBloom', variants: curve.variants, locations: [], textures: 0 },
		]);
		core.check(core.glue.setToneCurve(template), call, undefined, true);
	}

	/** Gives the core every effect from place `from` on, and drops the places after the last. */
	private sendFrom(from: number, call: string): void {
		const { chain } = this;
		for (let place = from; place < chain.length; place++) {
			const effect = chain[place] as Effect;
			effect.place = place;
			this.send(effect, call);
		}
		const { core } = this;
		core.check(core.glue.setEffect(chain.length, 0, 0), call, undefined, true);
	}

	/** Gives the core one effect at its place, with its uniforms. */
	private send(effect: Effect, call: string): void {
		const { core } = this;
		if (!this.block || this.generation !== core.generation) {
			this.block = core.f32(core.glue.effectValues(), EFFECT_FLOATS);
			this.generation = core.generation;
		}
		this.block.set(effect.values);
		const flags = effect.depth ? EFFECT_DEPTH : 0;
		core.check(core.glue.setEffect(effect.place, effect.template, flags), call, undefined, true);
	}
}

/** The uniform `name` of an effect, or throws E1216. */
function uniformOf(effect: Effect, name: string, call: string): EffectUniform {
	const uniform = effect.uniforms.get(name);
	if (uniform) return uniform;
	const names = [...effect.uniforms.keys()].join(', ') || 'none';
	throw new EngineError(
		'E1216',
		`${call}() got ${name}, which is not a uniform of the effect's WGSL. Its uniforms: ${names}.`,
	);
}

/** What a value is, for an error. */
function kindOf(value: unknown): string {
	if (typeof value === 'object' && value !== null && 'kind' in value)
		return `compiled WGSL of the kind ${JSON.stringify((value as CompiledWgsl).kind)}`;
	return String(value);
}

/** An effect's compiled WGSL, or throws E1215 for WGSL that the plugin did not compile as one. */
function compiledEffect(wgsl: unknown, call: string): CompiledEffect {
	if (typeof wgsl === 'object' && wgsl !== null && (wgsl as CompiledWgsl).kind === 'effect')
		return wgsl as CompiledEffect;
	throw new EngineError(
		'E1215',
		typeof wgsl === 'string'
			? `${call}() got WGSL as text, which the null3D Vite plugin did not compile. Tag the WGSL with a /* wgsl */ comment, or import it from a .wgsl file.`
			: `${call}() got ${kindOf(wgsl)}, which is not an effect. An effect's WGSL declares fn effect(input: EffectInput) -> vec4f.`,
	);
}
