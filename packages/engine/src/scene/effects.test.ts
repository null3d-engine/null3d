import { describe, expect, it } from 'bun:test';
import type { EngineError } from '../errors/engine-error';
import * as C from '../generated/core';
import type { CustomShader } from '../shared/images';
import type { Effect } from './effects';
import type { CoreMemory } from './memory';
import { Post } from './post';
import type { CompiledWgsl } from './resources';
import { ShaderTemplates } from './shader-templates';

/** A compiled effect with the given uniforms, as the plugin gives it. */
function effectWgsl(
	uniforms: { name: string; type: string; offset: number }[] = [],
	depth = false,
): CompiledWgsl {
	return { kind: 'effect', uniforms, depth, variants: {} } as unknown as CompiledWgsl;
}

/** A compiled tone curve. */
const CURVE = { kind: 'toneCurve', variants: {} } as unknown as CompiledWgsl;

/**
 * A post object whose core keeps the effects that `setEffect` sets, in place, as the core's list
 * does, and records each `setToneCurve` and `setOutput` call and each shader sent to the thread
 * that draws.
 */
function post(hdrEffects = true) {
	const block = new Float32Array(C.EFFECT_FLOATS);
	const effects: { template: number; flags: number; values: number[] }[] = [];
	const curves: number[] = [];
	const sent: [number, CustomShader][] = [];
	let setEffects = 0;
	const core = {
		generation: 0,
		f32: (_address: number, length: number) =>
			length === C.EFFECT_FLOATS ? block : new Float32Array(length),
		glue: {
			postValues: () => 0,
			effectValues: () => 8,
			setOutput: () => 0,
			setEffect(index: number, template: number, flags: number) {
				setEffects++;
				if (template === 0) effects.length = Math.min(effects.length, index);
				else effects[index] = { template, flags, values: [...block] };
				return 0;
			},
			setToneCurve(template: number) {
				curves.push(template);
				return 0;
			},
		},
		check: (result: number) => result,
	} as unknown as CoreMemory;
	const templates = new ShaderTemplates((template, shader) => sent.push([template, shader]));
	return {
		post: new Post(core, hdrEffects, true, undefined, templates),
		effects,
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
		const first = C.SHADING_CUSTOM_FIRST;
		expect(effects.map((e) => [e.template, e.flags])).toEqual([
			[first + 1, C.EFFECT_DEPTH],
			[first, 0],
			[first, 0],
		]);
		expect(sent.map(([template, shader]) => [template, shader.kind])).toEqual([
			[first, 'effect'],
			[first + 1, 'effect'],
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
