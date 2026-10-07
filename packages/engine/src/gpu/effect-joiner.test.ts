import { describe, expect, it } from 'bun:test';
import { PERMUTATION_DEPTH_MULTISAMPLED } from '../generated/gpu';
import type { ShaderVariants } from '../generated/shaders';
import type { PieceBuilds } from './effect-join';
import { joinShaders, replaceFunction } from './effect-joiner';

/** A host as naga writes it: a helper, the chain, and an entry point that calls the chain. */
const HOST_WGSL = `struct EffectInput {
    color: vec4<f32>,
}

fn effect_chain(effect_chain_input: EffectInput) -> vec4<f32> {
    return effect_chain_input.color;
}

@fragment
fn effect_fs() -> @location(0) vec4<f32> {
    var input: EffectInput;
    if true {
        return effect_chain(input);
    }
    return effect_chain(input);
}
`;

const HOST_GLSL = `#version 300 es
struct EffectInput {
    vec4 color;
};
uniform highp sampler2D _group_0_binding_1_fs;

vec4 effect_chain(EffectInput effect_chain_input) {
    return effect_chain_input.color;
}

void main() {
    EffectInput input_;
    _fs2p_location0 = effect_chain(input_);
}
`;

const HOST: ShaderVariants = {
	webgpu: { permutation: 0, wgsl: { source: HOST_WGSL, pipelines: {} }, glsl: null },
	webgl2: {
		permutation: 0,
		wgsl: null,
		glsl: {
			main: {
				vertex: { source: 'vertex', uniformBlocks: [], textures: [] },
				fragment: {
					source: HOST_GLSL,
					uniformBlocks: [],
					textures: [{ name: '_group_0_binding_1_fs', group: 0, binding: 1, sampler: null }],
				},
			},
		},
	},
};

/** An effect's pieces: a shared helper and a run function of its own, for both paths. */
function pieces(own: string, depth = false): PieceBuilds {
	const wgsl = { items: ['fn helper() {}\n', `fn ${own}_run() {}\n`], run: `${own}_run` };
	const builds: Record<string, PieceBuilds[string]> = {
		webgpu: { permutation: 0, wgsl, glsl: null },
		webgl2: {
			permutation: 0,
			wgsl: null,
			glsl: {
				items: ['void helper() {}\n', `vec4 ${own}_run() {}\n`],
				run: `${own}_run`,
				uniformBlocks: [],
				// The piece samples the input, which the host only loads.
				textures: [
					{
						name: '_group_0_binding_1_fs',
						group: 0,
						binding: 1,
						sampler: { group: 0, binding: 2 },
					},
				],
			},
		},
	};
	if (depth)
		builds.webgpu_depth_multisampled = {
			permutation: PERMUTATION_DEPTH_MULTISAMPLED,
			wgsl: { items: ['fn helper_ms() {}\n', `fn ${own}_run() {}\n`], run: `${own}_run` },
			glsl: null,
		};
	return builds;
}

describe('joinShaders', () => {
	it('puts each member before the chain once, and chains them by slot', () => {
		const joined = joinShaders(
			HOST,
			[
				{ pieces: pieces('a'), slot: 2 },
				{ pieces: pieces('b'), slot: 3 },
				{ pieces: pieces('a'), slot: 4 },
			],
			undefined,
			'wgsl',
		);
		const source = joined.webgpu?.wgsl?.source ?? '';
		expect(source.match(/fn helper\(\)/g)).toHaveLength(1);
		expect(source.match(/fn a_run\(\)/g)).toHaveLength(1);
		expect(source).toContain(
			'    link.color = a_run(link, 2u);\n    link.color = b_run(link, 3u);\n    link.color = a_run(link, 4u);\n',
		);
		// The host's own chain is gone, and its calls stay.
		expect(source).not.toContain('return effect_chain_input.color;');
		expect(source.match(/effect_chain\(input\)/g)).toHaveLength(2);
		expect(source.indexOf('fn helper()')).toBeLessThan(source.indexOf('fn effect_chain('));
		expect(Object.keys(joined)).toEqual(['webgpu']);
	});

	it('makes a multisampled twin on WebGPU when a member reads depth', () => {
		const joined = joinShaders(
			HOST,
			[
				{ pieces: pieces('a'), slot: 0 },
				{ pieces: pieces('b', true), slot: 1 },
			],
			undefined,
			'wgsl',
		);
		expect(Object.keys(joined).sort()).toEqual(['webgpu', 'webgpu_depth_multisampled']);
		const twin = joined.webgpu_depth_multisampled;
		expect(twin?.permutation).toBe(PERMUTATION_DEPTH_MULTISAMPLED);
		expect(twin?.wgsl?.source).toContain('fn helper_ms()');
		// A member without depth takes its one build in the twin too.
		expect(twin?.wgsl?.source).toContain('fn a_run()');
	});

	it('joins GLSL with the pieces textures in place of the hosts', () => {
		const joined = joinShaders(
			HOST,
			[
				{ pieces: pieces('a'), slot: 0 },
				{ pieces: pieces('b'), slot: 1 },
			],
			undefined,
			'glsl',
		);
		const fragment = joined.webgl2?.glsl?.main?.fragment;
		expect(fragment?.source).toContain('vec4 effect_chain(EffectInput start) {');
		expect(fragment?.source.match(/void helper\(\)/g)).toHaveLength(1);
		expect(fragment?.textures).toEqual([
			{ name: '_group_0_binding_1_fs', group: 0, binding: 1, sampler: { group: 0, binding: 2 } },
		]);
		expect(joined.webgl2?.glsl?.main?.vertex.source).toBe('vertex');
	});

	it('puts a tone curve in place of the hook', () => {
		const host = HOST_WGSL.replace(
			'@fragment',
			'fn tone_curve_hook(tone_curve_hook_color: vec3<f32>) -> vec3<f32> {\n    return tone_curve_hook_color;\n}\n\n@fragment',
		);
		const curve: PieceBuilds = {
			webgpu: {
				permutation: 0,
				wgsl: { items: ['fn c_toneCurve() {}\n'], run: 'c_toneCurve' },
				glsl: null,
			},
		};
		const joined = joinShaders(
			{ webgpu: { permutation: 0, wgsl: { source: host, pipelines: {} }, glsl: null } },
			[{ pieces: pieces('a'), slot: 0 }],
			curve,
			'wgsl',
		);
		const source = joined.webgpu?.wgsl?.source ?? '';
		expect(source).toContain(
			'fn c_toneCurve() {}\n\nfn tone_curve_hook(color: vec3<f32>) -> vec3<f32> {\n    return saturate(c_toneCurve(color));\n}\n',
		);
		expect(source).not.toContain('return tone_curve_hook_color;');
	});
});

describe('replaceFunction', () => {
	it('finds the definition, not an indented call or a nested block', () => {
		const text =
			'fn f() {\n    g(1);\n}\n\nfn g(x: f32) {\n    if x > 0 {\n        g(x);\n    }\n}\n\nfn h() {}\n';
		expect(replaceFunction(text, 'g', ['fn item() {}'], 'fn g() {}\n')).toBe(
			'fn f() {\n    g(1);\n}\n\nfn item() {}\nfn g() {}\n\nfn h() {}\n',
		);
		expect(() => replaceFunction(text, 'missing', [], '')).toThrow('no function missing');
	});
});
