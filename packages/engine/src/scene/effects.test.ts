import { describe, expect, it } from 'bun:test';
import type { EngineError } from '../errors/engine-error';
import * as C from '../generated/core';
import type { CustomShader } from '../shared/images';
import type { Effect } from './effects';
import type { CoreMemory } from './memory';
import { Post } from './post';
import type { CompiledWgsl } from './resources';
import { ShaderTemplates } from './shader-templates';
import { Texture } from './textures';

/** Pieces whose builds each add `size` characters of WGSL to a host. */
function pieces(size: number) {
	const builds = {
		webgpu: { permutation: 0, wgsl: { items: ['x'.repeat(size)], run: 'run' }, glsl: null },
	};
	return { group: builds, fold: builds };
}

/** A compiled effect with the given uniforms, as the plugin gives it. */
function effectWgsl(
	uniforms: { name: string; type: string; offset: number }[] = [],
	depth = false,
	joins = true,
	size = 100,
	textures: { name: string; offset: number }[] = [],
): CompiledWgsl {
	return {
		kind: 'effect',
		uniforms,
		depth,
		joins: joins && textures.length === 0,
		textures,
		variants: {},
		// An effect with textures has no pieces, as the build gives it.
		pieces: textures.length > 0 ? { group: {}, fold: {} } : pieces(size),
	} as unknown as CompiledWgsl;
}

/** A compiled tone curve. */
const CURVE = { kind: 'toneCurve', variants: {}, pieces: pieces(50) } as unknown as CompiledWgsl;

/**
 * A post object whose core keeps the effects that `setEffect` sets, in place, as the core's list
 * does, and records each `setToneCurve` and `setOutput` call and each shader sent to the thread
 * that draws.
 */
function post(hdrEffects = true, join = true) {
	// The core's memory, with the block of values first and the block of texture handles after it.
	const memory = new ArrayBuffer(512);
	const block = new Float32Array(memory, 0, C.EFFECT_FLOATS);
	const effects: { template: number; flags: number; values: number[]; textures: number[] }[] = [];
	const handles = new Uint32Array(memory, 256, C.EFFECT_TEXTURES);
	const groups: [number, number][] = [];
	let fold: [number, number] = [0, 0];
	const curves: number[] = [];
	const sent: [number, CustomShader][] = [];
	let setEffects = 0;
	const core = {
		generation: 0,
		f32: (_address: number, length: number) => new Float32Array(length),
		heap: (type: typeof Float32Array | typeof Uint32Array) => new type(memory),
		glue: {
			postValues: () => 0,
			effectValues: () => 0,
			effectTextures: () => 256,
			setOutput: () => 0,
			setEffect(index: number, template: number, flags: number) {
				setEffects++;
				if (template === 0) effects.length = Math.min(effects.length, index);
				else effects[index] = { template, flags, values: [...block], textures: [...handles] };
				return 0;
			},
			setToneCurve(template: number) {
				curves.push(template);
				return 0;
			},
			setEffectGroup(index: number, length: number, template: number) {
				groups[index] = [length, template];
				return 0;
			},
			setEffectFold(index: number, template: number) {
				fold = [index, template];
				return 0;
			},
		},
		check: (result: number) => result,
		holdViews: () => {},
	} as unknown as CoreMemory;
	const templates = new ShaderTemplates((template, shader) => sent.push([template, shader]));
	return {
		post: new Post(core, hdrEffects, true, undefined, templates, join),
		effects,
		/** The group that starts at each place that runs, as its length and template. */
		groups: () => groups.slice(0, effects.length),
		fold: () => fold,
		curves,
		sent,
		calls: () => setEffects,
	};
}

describe('post.addEffect', () => {
	it('runs effects by order, ties in the order they were added, and sends each shader once', () => {
		const { post: output, effects, sent } = post();
		const tint = effectWgsl();
		const blur = effectWgsl([], true);
		output.addEffect({ wgsl: tint, order: 2 });
		output.addEffect({ wgsl: blur });
		output.addEffect({ wgsl: tint, order: 2 });
		// Each WGSL's shader goes once; the templates of joined shaders come between them.
		const own = sent.filter(([, shader]) => shader.kind === 'effect').map(([t]) => t);
		expect(own).toHaveLength(2);
		const [tintTemplate, blurTemplate] = own as [number, number];
		expect(tintTemplate).toBe(C.SHADING_CUSTOM_FIRST);
		expect(effects.map((e) => [e.template, e.flags])).toEqual([
			[blurTemplate, C.EFFECT_DEPTH],
			[tintTemplate, 0],
			[tintTemplate, 0],
		]);
		expect(output.needsHdr).toBe(true);
	});

	it('writes uniforms where the build placed them, colors as linear, and allocates no view', () => {
		const { post: output, effects } = post();
		const wgsl = effectWgsl([
			{ name: 'amount', type: 'f32', offset: 0 },
			{ name: 'steps', type: 'u32', offset: 1 },
			{ name: 'tint', type: 'vec3f', offset: 4 },
		]);
		const effect = output.addEffect({ wgsl, uniforms: { amount: 0.5, tint: '#ffffff' } });
		expect(effects[0]?.values.slice(0, 7)).toEqual([0.5, 0, 0, 0, 1, 1, 1]);
		output.setEffectUniform(effect, 'steps', 4);
		output.setEffectUniform(effect, 'tint', [0.25, 0.5, 0.75]);
		expect(effects[0]?.values.slice(0, 7)).toEqual([0.5, 4, 0, 0, 0.25, 0.5, 0.75]);
	});

	it('refuses WGSL that is not an effect, a wrong uniform, and a ninth effect', () => {
		const { post: output } = post();
		const code = (call: () => unknown) => {
			try {
				call();
			} catch (error) {
				return (error as EngineError).code;
			}
			return 'none';
		};
		expect(code(() => output.addEffect({ wgsl: 'fn effect() {}' }))).toBe('E1215');
		expect(code(() => output.addEffect({ wgsl: CURVE }))).toBe('E1215');
		const wgsl = effectWgsl([{ name: 'amount', type: 'f32', offset: 0 }]);
		const effect = output.addEffect({ wgsl });
		const loose = effect as Effect<Record<string, unknown>>;
		expect(code(() => output.setEffectUniform(loose, 'speed', 1))).toBe('E1216');
		expect(code(() => output.setEffectUniform(loose, 'amount', [1, 2]))).toBe('E1216');
		expect(code(() => output.addEffect({ wgsl, order: Number.NaN }))).toBe('E1203');
		for (let k = 1; k < C.EFFECT_MAX; k++) output.addEffect({ wgsl });
		expect(code(() => output.addEffect({ wgsl }))).toBe('E1213');
		output.removeEffect(effect);
		expect(code(() => output.setEffectUniform(effect, 'amount', 1))).toBe('E1101');
	});

	it('removes an effect and moves the ones after it up, and a second removal does nothing', () => {
		const { post: output, effects, calls } = post();
		const a = output.addEffect({ wgsl: effectWgsl() });
		const b = output.addEffect({ wgsl: effectWgsl([], true) });
		expect(output.takeNewPipelines()).toBe(true);
		output.removeEffect(a);
		expect(output.takeNewPipelines()).toBe(false);
		expect(a.live).toBe(false);
		expect(b.live).toBe(true);
		expect(effects.map((e) => e.flags)).toEqual([C.EFFECT_DEPTH]);
		const before = calls();
		output.removeEffect(a);
		expect(calls()).toBe(before);
		output.removeEffect(b);
		expect(effects).toEqual([]);
		expect(output.needsHdr).toBe(false);
	});
});

describe('a custom tone curve', () => {
	it('takes two templates, and a built-in curve takes its place again', () => {
		const { post: output, curves, sent } = post();
		output.set({ toneMapping: CURVE });
		expect(output.takeNewPipelines()).toBe(true);
		output.set({ toneMapping: CURVE });
		expect(output.takeNewPipelines()).toBe(false);
		const first = C.SHADING_CUSTOM_FIRST;
		expect(curves).toEqual([first]);
		expect(sent.map(([template, shader]) => [template, shader.kind])).toEqual([
			[first, 'final'],
			[first + 1, 'finalBloom'],
		]);
		expect(sent[0]?.[1].pieces).toBeDefined();
		expect(output.needsHdr).toBe(true);
		output.set({ toneMapping: 'agx' });
		expect(curves).toEqual([first, 0]);
		expect(output.needsHdr).toBe(false);
		expect(output.takeNewPipelines()).toBe(true);
		output.set({ toneMapping: 'aces' });
		expect(output.takeNewPipelines()).toBe(false);
	});

	it('refuses a curve that the plugin did not compile, and a name it does not know', () => {
		const { post: output } = post();
		expect(() => output.set({ toneMapping: 'fn toneCurve(c: vec3f) -> vec3f' })).toThrow(
			'did not compile',
		);
		expect(() => output.set({ toneMapping: 'filmic' as 'agx' })).toThrow('which is not');
	});
});

describe('joined effects', () => {
	it('groups each effect with the ones after it that read their own pixel, and folds the last group', () => {
		const { post: output, groups, fold, sent } = post();
		const own = effectWgsl();
		const neighbors = effectWgsl([], false, false);
		output.addEffect({ wgsl: own });
		output.addEffect({ wgsl: own });
		output.addEffect({ wgsl: neighbors });
		output.addEffect({ wgsl: own });
		const kinds = new Map(sent.map(([template, shader]) => [template, shader]));
		const [first, second, third, fourth] = groups();
		// The first two join; the neighbor reader starts a group, and the last effect joins it.
		expect(first?.[0]).toBe(2);
		expect(kinds.get(first?.[1] ?? 0)?.kind).toBe('effectGroup');
		expect(second).toEqual([0, 0]);
		expect(third?.[0]).toBe(2);
		expect(fourth).toEqual([0, 0]);
		const [from, template] = fold();
		expect(from).toBe(2);
		const folded = kinds.get(template);
		expect(folded?.kind).toBe('effectFold');
		expect(folded?.members?.map((m) => m.slot)).toEqual([2, 3]);
		expect(folded?.curve).toBeUndefined();
		// A group's builds wait for the thread that draws to join them.
		expect(Object.keys(kinds.get(first?.[1] ?? 0)?.variants ?? { x: 1 })).toEqual([]);
	});

	it('splits a group whose pieces pass the cap, and folds a curve with the last group', () => {
		const { post: output, groups, fold, sent } = post();
		const large = effectWgsl([], false, true, 12 * 1024);
		output.addEffect({ wgsl: large });
		output.addEffect({ wgsl: large });
		expect(groups()).toEqual([
			[1, 0],
			[1, 0],
		]);
		// The last group alone is within the fold's cap only for a smaller effect.
		expect(fold()).toEqual([1, 0]);
		output.removeEffect(output.addEffect({ wgsl: large }));
		const { post: small, fold: smallFold, sent: smallSent } = post();
		small.addEffect({ wgsl: effectWgsl() });
		small.set({ toneMapping: CURVE });
		const folded = new Map(smallSent).get(smallFold()[1]);
		expect(folded?.kind).toBe('effectFold');
		const curve = smallSent.find(([, shader]) => shader.kind === 'final')?.[0];
		expect(folded?.curve).toBe(curve);
		expect(sent.length).toBeGreaterThan(0);
	});

	it('draws a group or a fold whose pipeline failed one pass each from then on', () => {
		const { post: output, groups, fold } = post();
		output.addEffect({ wgsl: effectWgsl() });
		output.addEffect({ wgsl: effectWgsl() });
		const group = groups()[0]?.[1] ?? 0;
		const folded = fold()[1];
		expect(group).not.toBe(0);
		output.dropJoin(group);
		expect(groups()[0]).toEqual([2, 0]);
		expect(fold()[1]).toBe(folded);
		output.dropJoin(folded);
		expect(fold()).toEqual([0, 0]);
		// A change of the chain asks for neither again.
		output.addEffect({ wgsl: effectWgsl(), order: -1 });
		output.removeEffect(output.addEffect({ wgsl: effectWgsl(), order: -1 }));
		expect(groups().every(([, template]) => template !== group)).toBe(true);
	});

	it('draws an effect with textures in a pass of its own, which nothing joins or folds', () => {
		const { post: output, groups, fold, effects, sent } = post();
		const own = effectWgsl();
		const glow = effectWgsl([], false, true, 100, [
			{ name: 'glow', offset: 31 },
			{ name: 'dust', offset: 30 },
		]);
		const texture = Object.assign(Object.create(Texture.prototype), { handle: 9, depth: 1 });
		output.addEffect({ wgsl: own });
		output.addEffect({ wgsl: glow, textures: { glow: texture } as never });
		output.addEffect({ wgsl: own });
		expect(groups().map((group) => group?.[0])).toEqual([1, 1, 1]);
		// The effect after it folds into the final pass alone.
		expect(fold()[0]).toBe(2);
		output.removeEffect(output.addEffect({ wgsl: own, order: -1 }));
		const last = output.addEffect({ wgsl: glow, order: 1 });
		expect(fold()).toEqual([3, 0]);
		output.removeEffect(last);
		const textured = effects[1];
		expect(textured?.textures.slice(0, 2)).toEqual([9, 0]);
		// The texture that the option leaves out samples as white.
		expect(textured?.values[30]).toBe(-1);
		const shader = sent.find(([, shader]) => shader.textures === 2);
		expect(shader?.[1].kind).toBe('effect');
		let wrong = 'none';
		try {
			output.addEffect({ wgsl: glow, textures: { halo: texture } as never });
		} catch (error) {
			wrong = (error as EngineError).code;
		}
		expect(wrong).toBe('E1216');
	});

	it('joins nothing with ?join=off', () => {
		const { post: output, groups, fold } = post(true, false);
		output.addEffect({ wgsl: effectWgsl() });
		output.addEffect({ wgsl: effectWgsl() });
		expect(groups()).toEqual([
			[1, 0],
			[1, 0],
		]);
		expect(fold()).toEqual([1, 0]);
	});
});
