import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { build, createServer, type Rollup } from 'vite';
import { fixture } from '../../../tools/lib/fixture';
import { WGSL_UPDATE_EVENT } from './hot';
import null3d, { type Null3dPluginOptions } from './index';
import type { ShaderProblem } from './shader-compiler';
import type { CompiledMaterial, CompiledShader } from './shader-types';
import {
	codeFrame,
	compileTaggedWgsl,
	compileWgsl,
	compileWgslFile,
	findTaggedWgsl,
	placeOf,
	type WgslCompile,
	wgslError,
} from './wgsl';

/** The hint that the tests' compiles end their message about a missing entry point with. */
const HINT = 'HINT';

/**
 * `bun run test:shader-compiler` sets this. The shader compiler must be built first with
 * `bun run build`, so plain `bun run test` skips the tests that compile.
 */
const ENABLED = process.env.NULL3D_SHADER_COMPILER !== undefined;

/** A render shader that imports `null3d::math`, with code for WebGL2 behind the shader def. */
const SHADER = `#import null3d::math

@vertex
fn vs_main(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
    return vec4f(f32(index), 0.0, 0.0, 1.0);
}

@fragment
fn fs_main() -> @location(0) vec4f {
#ifdef WEBGL2
    return vec4f(null3d::math::square(0.25));
#else
    return vec4f(null3d::math::square(0.5));
#endif
}
`;

/** A substitution as the code of a template literal holds it, which tagged WGSL cannot hold. */
// biome-ignore lint/suspicious/noTemplateCurlyInString: the tests write a substitution into code.
const SUBSTITUTION = '${count}';

/** The 1-based line and column of the first `needle` in a text. */
function where(text: string, needle: string): string {
	const { line, column } = placeOf(text, text.indexOf(needle));
	return `${line}:${column}`;
}

/** A problem that the compiler reports in `src/sketch.ts`, the path that the tests compile. */
function problem(line: number | null, column: number | null, variants = ['webgpu', 'webgl2']) {
	return {
		file: 'src/sketch.ts',
		line,
		column,
		feature: null,
		message: 'expected `;`',
		variants,
	} satisfies ShaderProblem;
}

describe('findTaggedWgsl', () => {
	it('finds each template literal right after a wgsl block comment', () => {
		const code = [
			'const a: number = 1;',
			'const glow = /* wgsl */ `@fragment fn fs() {}`;',
			'const tight = /*wgsl*/`fn a() {}`;',
			'const spaced = /*  wgsl  */',
			'  `fn b() {}`;',
		].join('\n');
		const found = findTaggedWgsl(code, 'src/sketch.ts');
		expect(found.map((tagged) => tagged.source)).toEqual([
			'@fragment fn fs() {}',
			'fn a() {}',
			'fn b() {}',
		]);
		const [first] = found;
		expect(code.slice(first?.start, first?.end)).toBe('`@fragment fn fs() {}`');
		expect(found.every((tagged) => tagged.substitution === null)).toBe(true);
	});

	it('ignores the tag in strings and line comments, other comments, and other values', () => {
		const code = [
			"const text = '/* wgsl */ `fn a() {}`';",
			'// const commented = /* wgsl */ `fn b() {}`;',
			'const other = /* glsl */ `void main() {}`;',
			'const named = /* wgsl */ source;',
			'const plain = `fn c() {}`;',
		].join('\n');
		expect(findTaggedWgsl(code, 'src/sketch.ts')).toEqual([]);
	});

	it('gives the place of a substitution, and makes Windows line ends plain', () => {
		const code = `const count = 4;\nconst s = /* wgsl */ \`const N = ${SUBSTITUTION}u;\r\nfn f() {}\`;\n`;
		const [tagged] = findTaggedWgsl(code, 'src/sketch.ts');
		expect(tagged?.substitution).toBe(code.indexOf(SUBSTITUTION));
		expect(tagged?.source).toBe(`const N = ${SUBSTITUTION}u;\nfn f() {}`);
	});

	it('reads the TypeScript of .ts files, and gives nothing for code that does not parse', () => {
		const typed = 'const s: string = /* wgsl */ `fn f() {}` as string;\n';
		expect(findTaggedWgsl(typed, 'src/sketch.ts')).toHaveLength(1);
		expect(findTaggedWgsl('const s = /* wgsl */ `fn f() {}`;\nconst = ;\n', 'a.ts')).toEqual([]);
	});
});

describe('the places of problems', () => {
	it('counts lines from 1 and columns in UTF-16 code units from 1', () => {
		const text = 'ab\n😀x\n';
		expect(placeOf(text, 0)).toEqual({ line: 1, column: 1 });
		expect(placeOf(text, 3)).toEqual({ line: 2, column: 1 });
		expect(placeOf(text, text.indexOf('x'))).toEqual({ line: 2, column: 3 });
	});

	it('puts a caret under the column, past tabs, with the lines around it', () => {
		const text = 'one\ntwo\n\tthree\nfour\nfive\nsix';
		expect(codeFrame(text, 3, 3)).toBe(
			['1 | one', '2 | two', '3 | \tthree', '  | \t ^', '4 | four', '5 | five'].join('\n'),
		);
	});

	it('moves problems in tagged WGSL to their place in the module, and shows the first', () => {
		const code = 'const a = 1;\nconst s = /* wgsl */ `fn f() {\n  let y = 2.0 3.0;\n}`;\n';
		const [tagged] = findTaggedWgsl(code, 'src/sketch.ts');
		if (!tagged) throw new Error('no tagged WGSL');
		const origin = { path: 'src/sketch.ts', ...placeOf(code, tagged.start + 1) };
		const library = { ...problem(2, 5), file: 'null3d::math' };
		const failed: WgslCompile = {
			ok: false,
			problems: [library, problem(1, 4), problem(2, 15, ['webgl2'])],
			builds: ['webgpu', 'webgl2'],
		};
		const error = wgslError(failed, tagged.source, origin, '/project/src/sketch.ts', code);
		expect(error.message.split('\n')).toEqual([
			'null3D could not compile the WGSL:',
			'null3d::math:2:5: expected `;`',
			'src/sketch.ts:2:26: expected `;`',
			'src/sketch.ts:3:15: expected `;` (in the WebGL2 build)',
		]);
		expect(error.loc).toEqual({ file: '/project/src/sketch.ts', line: 2, column: 26 });
		expect(error.frame).toContain(
			'2 | const s = /* wgsl */ `fn f() {\n  |                          ^',
		);
	});

	it('refuses a substitution at its place, after a character of two code units', async () => {
		const code = `const a = 1;\nconst s = /* wgsl */ \`😀 ${SUBSTITUTION}\`;\n`;
		const result = await compileTaggedWgsl(code, '/project/src/sketch.ts', 'src/sketch.ts');
		if (!('error' in result)) throw new Error('the substitution passed');
		const at = placeOf(code, code.indexOf(SUBSTITUTION));
		expect(at).toEqual({ line: 2, column: 26 });
		expect(result.error.message).toContain('\nsrc/sketch.ts:2:26: a template literal that');
		expect(result.error.loc).toEqual({ file: '/project/src/sketch.ts', ...at });
	});

	it('counts the columns of problems in characters, as the compiler does', () => {
		const source = 'fn 😀() {}\nfn f() {}\n';
		const origin = { path: 'src/sketch.ts', line: 1, column: 1 };
		const failed: WgslCompile = { ok: false, problems: [problem(1, 4)], builds: ['webgpu'] };
		const error = wgslError(failed, source, origin, '/project/src/sketch.ts', source);
		expect(error.loc.column).toBe(4);
		const after = wgslError({ ...failed, problems: [problem(1, 5)] }, source, origin, 'x', source);
		expect(after.loc.column).toBe(6);
	});
});

/** The compiled WGSL of a compile that should pass, or the failure's message. */
function passed(result: WgslCompile) {
	if (!result.ok) throw new Error(result.problems.map((p) => p.message).join('\n'));
	return result.shader;
}

/** The compiled whole shader. */
function compiled(result: WgslCompile): CompiledShader {
	const shader = passed(result);
	if (shader.kind !== 'shader') throw new Error('the WGSL compiled as a custom material');
	return shader;
}

/** The compiled custom material. */
function material(result: WgslCompile): CompiledMaterial {
	const shader = passed(result);
	if (shader.kind !== 'material') throw new Error('the WGSL compiled as a whole shader');
	return shader;
}

/** A surface function that stripes the standard look by the first texture coordinates. */
const SURFACE = `#import null3d::math::{square}

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    s.roughness = square(fract(input.uv.x * 4.0));
    return s;
}
`;

/** The message of a compile that should fail. */
function failure(result: WgslCompile): ShaderProblem {
	if (result.ok) throw new Error('the WGSL compiled, but it should fail');
	expect(result.problems).toHaveLength(1);
	return result.problems[0] as ShaderProblem;
}

describe.skipIf(!ENABLED)('compileWgsl', () => {
	it('builds WGSL for WebGPU and GLSL for WebGL2 with the WEBGL2 shader def', async () => {
		const shader = compiled(await compileWgsl('src/glow.wgsl', SHADER, HINT));
		expect(shader.webgpu.glsl).toBeNull();
		expect(shader.webgpu.wgsl?.source).toContain('fn square(x: f32) -> f32');
		expect(shader.webgpu.wgsl?.source).toContain('square(0.5f)');
		expect(shader.webgpu.wgsl?.pipelines).toEqual({
			fs_main: { vertex: 'vs_main', fragment: 'fs_main' },
		});
		const program = shader.webgl2?.glsl?.fs_main;
		expect(shader.webgl2?.wgsl).toBeNull();
		expect(program?.vertex.source.split('\n')[0]).toBe('#version 300 es');
		expect(program?.fragment.source).toContain('square(0.25)');
	});

	it('makes one pipeline for each fragment entry point, and none for compute alone', async () => {
		const two = `${SHADER}\n@fragment\nfn fs_red() -> @location(0) vec4f {\n    return vec4f(1.0, 0.0, 0.0, 1.0);\n}\n`;
		expect(
			Object.keys(compiled(await compileWgsl('a.wgsl', two, HINT)).webgl2?.glsl ?? {}),
		).toEqual(['fs_main', 'fs_red']);
		const compute =
			'@compute @workgroup_size(64)\nfn main(@builtin(global_invocation_id) id: vec3u) {\n}\n';
		const shader = compiled(await compileWgsl('a.wgsl', compute, HINT));
		expect(shader.webgl2).toBeNull();
		expect(shader.webgpu.wgsl?.source).toContain('@compute @workgroup_size(64, 1, 1)');
	});

	it('explains WGSL whose entry points make no render pipeline', async () => {
		const none = failure(
			await compileWgsl('a.wgsl', 'fn helper() -> f32 {\n    return 1.0;\n}\n', HINT),
		);
		expect([none.line, none.column]).toEqual([1, 1]);
		expect(none.message).toStartWith(
			'the WGSL has no entry point and no function of a custom material or effect.',
		);
		expect(none.message).toEndWith(' HINT');
		const twice = SHADER.replace(
			'@fragment',
			'@vertex\nfn vs_other() -> @builtin(position) vec4f {\n    return vec4f(0.0);\n}\n\n@fragment',
		);
		const second = failure(await compileWgsl('a.wgsl', twice, HINT));
		expect([second.line, second.column]).toEqual([8, 1]);
		expect(second.message).toContain('more than one `@vertex` entry point');
		const alone = SHADER.slice(0, SHADER.indexOf('@fragment'));
		expect(failure(await compileWgsl('a.wgsl', alone, HINT)).message).toContain(
			'no `@fragment` one',
		);
	});

	it('builds an effect into the effect template, with its uniforms and depth read', async () => {
		const effect = /* wgsl */ `struct Uniforms { amount: f32, tint: vec3f }

fn effect(input: EffectInput) -> vec4f {
    let fade = clamp(effectDistance(input.uv) * 0.01, 0.0, 1.0);
    return vec4f(mix(input.color.rgb, uniforms.tint, fade * uniforms.amount), input.color.a);
}
`;
		const result = await compileWgsl('src/fog.wgsl', effect, HINT);
		if (!result.ok) throw new Error(JSON.stringify(result.problems));
		const built = result.shader;
		if (built.kind !== 'effect') throw new Error(`a ${built.kind}`);
		expect(built.uniforms.map((u) => [u.name, u.type, u.offset])).toEqual([
			['amount', 'f32', 0],
			['tint', 'vec3f', 4],
		]);
		expect(built.depth).toBe(true);
		expect(Object.keys(built.variants).sort()).toEqual([
			'webgl2',
			'webgpu',
			'webgpu_depth_multisampled',
		]);
		expect(built.variants.webgl2?.glsl?.main?.fragment.source).toContain('#version 300 es');
	});

	it("stops a script at the line of a bad effect's problem in the script", async () => {
		const code = [
			"import { defineSketch } from '@null3d/engine';",
			'',
			'const fade = /* wgsl */ `',
			'fn effect(input: EffectInput) -> vec4f {',
			'    return input.color * strength;',
			'}',
			'`;',
			'',
		].join('\n');
		const result = await compileTaggedWgsl(code, '/project/src/sketch.ts', 'src/sketch.ts');
		if (!('error' in result)) throw new Error('the bad effect compiled');
		expect(result.error.loc).toEqual({ file: '/project/src/sketch.ts', line: 5, column: 26 });
		expect(result.error.message).toContain('src/sketch.ts:5:26:');
	});

	it('builds a tone curve into the final pass, and names a bad effect line', async () => {
		const curve = 'fn toneCurve(color: vec3f) -> vec3f {\n    return color / (1.0 + color);\n}\n';
		const result = await compileWgsl('src/curve.wgsl', curve, HINT);
		if (!result.ok) throw new Error(JSON.stringify(result.problems));
		expect(result.shader.kind).toBe('toneCurve');
		const bad = 'fn effect(input: EffectInput) -> vec4f {\n    return input.color * missing;\n}\n';
		const problem = failure(await compileWgsl('src/bad.wgsl', bad, HINT));
		expect([problem.file, problem.line]).toEqual(['src/bad.wgsl', 2]);
	});

	it('builds a surface function into every variant of the standard material', async () => {
		const built = material(await compileWgsl('src/stripes.wgsl', SURFACE, HINT));
		expect(built.functions).toEqual(['surface']);
		// Each WebGL2 build has a twin that skins, for skinned meshes.
		const plain = [
			'webgl2',
			'webgl2_alpha_mask',
			'webgl2_alpha_mask_receive_shadows',
			'webgl2_draw_index',
			'webgl2_draw_index_alpha_mask',
			'webgl2_draw_index_alpha_mask_receive_shadows',
			'webgl2_draw_index_receive_shadows',
			'webgl2_draw_index_tone_map',
			'webgl2_draw_index_tone_map_alpha_mask',
			'webgl2_draw_index_tone_map_alpha_mask_receive_shadows',
			'webgl2_draw_index_tone_map_receive_shadows',
			'webgl2_draw_index_tone_map_vertex_color',
			'webgl2_draw_index_tone_map_vertex_color_alpha_mask',
			'webgl2_draw_index_tone_map_vertex_color_alpha_mask_receive_shadows',
			'webgl2_draw_index_tone_map_vertex_color_receive_shadows',
			'webgl2_draw_index_vertex_color',
			'webgl2_draw_index_vertex_color_alpha_mask',
			'webgl2_draw_index_vertex_color_alpha_mask_receive_shadows',
			'webgl2_draw_index_vertex_color_receive_shadows',
			'webgl2_receive_shadows',
			'webgl2_tone_map',
			'webgl2_tone_map_alpha_mask',
			'webgl2_tone_map_alpha_mask_receive_shadows',
			'webgl2_tone_map_receive_shadows',
			'webgl2_tone_map_vertex_color',
			'webgl2_tone_map_vertex_color_alpha_mask',
			'webgl2_tone_map_vertex_color_alpha_mask_receive_shadows',
			'webgl2_tone_map_vertex_color_receive_shadows',
			'webgl2_vertex_color',
			'webgl2_vertex_color_alpha_mask',
			'webgl2_vertex_color_alpha_mask_receive_shadows',
			'webgl2_vertex_color_receive_shadows',
			'webgpu',
			'webgpu_alpha_mask',
			'webgpu_alpha_mask_receive_shadows',
			'webgpu_receive_shadows',
			'webgpu_tone_map',
			'webgpu_tone_map_alpha_mask',
			'webgpu_tone_map_alpha_mask_receive_shadows',
			'webgpu_tone_map_receive_shadows',
			'webgpu_tone_map_vertex_color',
			'webgpu_tone_map_vertex_color_alpha_mask',
			'webgpu_tone_map_vertex_color_alpha_mask_receive_shadows',
			'webgpu_tone_map_vertex_color_receive_shadows',
			'webgpu_vertex_color',
			'webgpu_vertex_color_alpha_mask',
			'webgpu_vertex_color_alpha_mask_receive_shadows',
			'webgpu_vertex_color_receive_shadows',
		];
		const skinned = plain.filter((name) => name.startsWith('webgl2')).map((name) => `${name}_skin`);
		expect(Object.keys(built.variants).sort()).toEqual([...plain, ...skinned].sort());
		const webgpu = built.variants.webgpu;
		expect(webgpu?.wgsl?.source).toMatch(/fn surface\(\w+: SurfaceInput\) -> Surface/);
		expect(webgpu?.wgsl?.pipelines).toEqual({ main: { vertex: 'vs', fragment: 'fs' } });
		expect(built.variants.webgl2?.glsl?.main?.fragment.source).toContain('#version 300 es');
	});

	it('gives the place of each uniform that struct Uniforms declares', async () => {
		const tinted = `struct Uniforms { strength: f32, tint: vec3f }\n\n${SURFACE.replace(
			'return s;',
			's.baseColor = material.tint * material.strength;\n    return s;',
		)}`;
		const built = material(await compileWgsl('src/tinted.wgsl', tinted, HINT));
		expect(built.uniforms).toEqual([
			{ name: 'strength', type: 'f32', offset: 0 },
			{ name: 'tint', type: 'vec3f', offset: 4 },
		]);
		expect(material(await compileWgsl('src/stripes.wgsl', SURFACE, HINT)).uniforms).toEqual([]);
	});

	it('builds a vertex offset alone as a custom material', async () => {
		const wave =
			'fn vertexOffset(input: VertexInput) -> vec3f {\n    return input.normal * sin(input.uv.x);\n}\n';
		const built = material(await compileWgsl('src/wave.wgsl', wave, HINT));
		expect(built.functions).toEqual(['vertexOffset']);
		expect(built.variants.webgpu?.wgsl?.source).toContain('fn vertexOffset(');
	});

	it('builds a mesh shader of its own as a full shader of a custom material', async () => {
		const full = `#import null3d::mesh::{InstanceIn, clip_position, find_instance, finish}

@vertex
fn vs(@location(0) position: vec3f, @location(2) uv: vec2f, i: InstanceIn) -> @builtin(position) vec4f {
    return clip_position(find_instance(i), position + vec3f(uv, 0.0));
}

@fragment
fn fs(@builtin(position) pixel: vec4f) -> @location(0) vec4f {
    return finish(vec3f(0.5), pixel.xy);
}
`;
		const built = material(await compileWgsl('src/full.wgsl', full, HINT));
		expect(built.functions).toEqual([]);
		expect(built.locations).toEqual([0, 2]);
		expect(built.baseColor).toBe(false);
		expect(Object.keys(built.variants).sort()).toEqual([
			'webgl2',
			'webgl2_draw_index',
			'webgl2_draw_index_tone_map',
			'webgl2_tone_map',
			'webgpu',
			'webgpu_receive_shadows',
			'webgpu_tone_map',
			'webgpu_tone_map_receive_shadows',
		]);
		expect(compiled(await compileWgsl('src/glow.wgsl', SHADER, HINT)).kind).toBe('shader');
	});

	it('places problems of a surface function in its own lines', async () => {
		const broken = SURFACE.replace('4.0));', '4.0)) 2.0;');
		const syntax = failure(await compileWgsl('src/stripes.wgsl', broken, HINT));
		expect(`${syntax.line}:${syntax.column}`).toBe(where(broken, '2.0;'));
		const wrong = SURFACE.replace('-> Surface', '-> vec4f');
		const signature = failure(await compileWgsl('src/stripes.wgsl', wrong, HINT));
		expect([signature.line, signature.column]).toEqual([3, 4]);
		expect(signature.message).toBe(
			'`surface` does not have the signature that the engine calls. Declare it as `fn surface(input: SurfaceInput) -> Surface`.',
		);
		const clash = `${SURFACE}\nfn shade(x: f32) -> f32 {\n    return x;\n}\n`;
		const twice = failure(await compileWgsl('src/stripes.wgsl', clash, HINT));
		expect(twice.line).toBe(9);
		expect(twice.message).toContain('redefinition of `shade`');
	});

	it('names the build that a problem is in', async () => {
		const broken = SHADER.replace('square(0.25)', 'square(0.25) 1.0');
		const result = await compileWgsl('src/glow.wgsl', broken, HINT);
		if (result.ok) throw new Error('the WGSL compiled, but it should fail');
		const error = wgslError(
			result,
			broken,
			{ path: 'src/glow.wgsl', line: 1, column: 1 },
			'x',
			broken,
		);
		expect(error.message).toContain(`src/glow.wgsl:${where(broken, '1.0);\n#else')}: `);
		expect(error.message).toEndWith('(in the WebGL2 build)');
	});

	it("builds a user's compare-exchange with a warning that Safari 27.0 cannot compile it", async () => {
		const claim = `var<workgroup> slots: array<atomic<u32>, 64>;

@compute @workgroup_size(64)
fn main(@builtin(local_invocation_index) lane: u32) {
    let claim = atomicCompareExchangeWeak(&slots[lane], 0u, 1u);
}
`;
		const result = await compileWgslFile('src/claim.wgsl', 'x', claim);
		if (!('shader' in result)) throw new Error(result.error.message);
		expect(result.warnings).toHaveLength(1);
		const [warning] = result.warnings;
		expect(warning).toStartWith(
			`null3D: src/claim.wgsl:${where(claim, 'atomicCompareExchangeWeak')}: \`atomicCompareExchangeWeak\` does not compile on Safari 27.0`,
		);
		expect(warning).toContain('321006@main');
	});
});

/** A project with a page that starts a sketch, which imports WGSL in both ways. */
const PROJECT = {
	'index.html': '<!doctype html><script type="module" src="./src/page.ts"></script>',
	'src/page.ts': "export const sketch = new URL('./sketch.ts', import.meta.url);\n",
	'src/shaders/glow.wgsl': SHADER,
	'src/sketch.ts': `import glow from './shaders/glow.wgsl';
import text from './shaders/glow.wgsl?raw';

const defineSketch = (setup: () => unknown) => setup;
const note = '/* wgsl */ \`not WGSL\`';

export default defineSketch(() => ({
	glow,
	text,
	note,
	inline: /* wgsl */ \`
@vertex
fn vs_main() -> @builtin(position) vec4f {
    return vec4f(0.0);
}

@fragment
fn fs_main() -> @location(0) vec4f {
    return vec4f(1.0);
}
\`,
}));
`,
	'node_modules/other/index.js': 'export const kept = /* wgsl */ `not WGSL either`;\n',
};

/**
 * A folder that holds the project with some files changed, by its real path: Vite names the
 * files that it resolves by their real paths.
 */
function project(changes: Record<string, string> = {}): string {
	return realpathSync(fixture({ ...PROJECT, ...changes }));
}

/** Builds a project in memory with the plugin, and returns its chunks, or throws its error. */
async function buildProject(
	root: string,
	options: Null3dPluginOptions = {},
): Promise<Rollup.OutputChunk[]> {
	const result = await build({
		root,
		configFile: false,
		logLevel: 'silent',
		plugins: [null3d(options)],
		build: { write: false },
	});
	const outputs = Array.isArray(result) ? result : [result];
	return outputs.flatMap((output) =>
		'output' in output ? output.output.filter((file) => file.type === 'chunk') : [],
	);
}

/** The error that a build of a project throws, with the plugin's fields. */
async function buildError(root: string): Promise<{ message: string; loc?: unknown }> {
	try {
		await buildProject(root);
	} catch (error) {
		const { errors } = error as { errors?: { message: string; loc?: unknown }[] };
		return errors?.[0] ?? (error as { message: string });
	}
	throw new Error('the build passed, but it should fail');
}

/** The sketch of the project, with its tagged WGSL broken at a known place. */
const BROKEN_SKETCH = PROJECT['src/sketch.ts'].replace('vec4f(1.0);', 'vec4f(1.0) 2.0;');

describe.skipIf(!ENABLED)('the plugin with WGSL in a project', () => {
	it('compiles the WGSL of a sketch in a production build', async () => {
		const chunks = await buildProject(project());
		const sketch = chunks.find((chunk) => chunk.facadeModuleId?.endsWith('src/sketch.ts'));
		expect(sketch?.code).toContain('#version 300 es');
		expect(sketch?.code).toContain('fn square(x: f32) -> f32');
		expect(sketch?.code).toContain('#import null3d::math');
		expect(sketch?.code).toContain('/* wgsl */ `not WGSL`');
		expect(sketch?.code).not.toContain(
			'fn vs_main() -> @builtin(position) vec4f {\\n    return vec4f(0.0);\\n}\\n\\n@fragment',
		);
	});

	it('writes the types of each WGSL file that a module imports beside it', async () => {
		const root = project();
		await buildProject(root);
		const declaration = readFileSync(join(root, 'src/shaders/glow.wgsl.d.ts'), 'utf8');
		expect(declaration).toContain('declare const shader: CompiledShader;');
		const off = project();
		await buildProject(off, { wgslDeclarations: false });
		expect(existsSync(join(off, 'src/shaders/glow.wgsl.d.ts'))).toBe(false);
	});

	it('stops a production build at the line and column of tagged WGSL', async () => {
		const root = project({ 'src/sketch.ts': BROKEN_SKETCH });
		const error = await buildError(root);
		const at = where(BROKEN_SKETCH, '2.0;');
		expect(error.message).toContain(`null3D could not compile the WGSL:\nsrc/sketch.ts:${at}: `);
		expect(error.loc).toEqual({ file: join(root, 'src/sketch.ts'), line: 19, column: 23 });
		expect(at).toBe('19:23');
	});

	it('stops a production build at the line and column of a WGSL file', async () => {
		const broken = SHADER.replace('square(0.5)', 'square(0.5u)');
		const root = project({ 'src/shaders/glow.wgsl': broken });
		const error = await buildError(root);
		expect(error.message).toContain(`src/shaders/glow.wgsl:${where(broken, 'u));')}: `);
		expect(error.loc).toEqual({ file: join(root, 'src/shaders/glow.wgsl'), line: 13, column: 42 });
	});

	it('refuses a substitution in tagged WGSL', async () => {
		const sketch = PROJECT['src/sketch.ts'].replace('vec4f(1.0);', `vec4f(${SUBSTITUTION});`);
		const error = await buildError(project({ 'src/sketch.ts': sketch }));
		const at = where(sketch, SUBSTITUTION);
		expect(error.message).toContain(`src/sketch.ts:${at}: a template literal`);
	});

	it('sends changed WGSL to the pages of the dev server without a reload', async () => {
		const surface =
			'fn surface(input: SurfaceInput) -> Surface {\n    return defaultSurface(input);\n}\n';
		const sketch = `const tint = /* wgsl */ \`${surface}\`;\nexport default tint;\n`;
		const root = project({ 'src/tint.wgsl': surface, 'src/tint.ts': sketch });
		const server = await createServer({
			root,
			configFile: false,
			logLevel: 'silent',
			plugins: [null3d({ wgslDeclarations: false })],
			server: { middlewareMode: true, watch: null },
		});
		const sent: { type: string; event?: string; data?: unknown; err?: { message: string } }[] = [];
		const hot = server.environments.client.hot;
		hot.send = (payload: unknown) => sent.push(payload as (typeof sent)[number]);
		/** Changes a file, and returns what the dev server sent the pages about it. */
		const change = async (path: string, text: string) => {
			writeFileSync(join(root, path), text);
			sent.length = 0;
			server.watcher.emit('change', join(root, path));
			for (let k = 0; k < 800 && sent.length === 0; k++) await Bun.sleep(25);
			return sent.slice();
		};
		try {
			const file = await server.transformRequest('/src/tint.wgsl');
			expect(file?.code).toContain('"hot":"src/tint.wgsl"}');
			const literal = await server.transformRequest('/src/tint.ts');
			expect(literal?.code).toMatch(/"hot": ?"src\/tint\.ts#0"/);

			const brighter = surface.replace('return', 'var s = defaultSurface(input);\n    return');
			const [update] = await change('src/tint.wgsl', brighter);
			expect(update?.type).toBe('custom');
			expect(update?.event).toBe(WGSL_UPDATE_EVENT);
			const updates = (data: unknown) =>
				(data as { updates: { key: string; shader: CompiledMaterial }[] }).updates.map(
					({ key, shader }) => [key, shader.kind],
				);
			expect(updates(update?.data)).toEqual([['src/tint.wgsl', 'material']]);
			const [literalUpdate] = await change('src/tint.ts', sketch.replace(surface, brighter));
			expect(updates(literalUpdate?.data)).toEqual([['src/tint.ts#0', 'material']]);

			const [error] = await change('src/tint.wgsl', brighter.replace('input);', 'input) 2.0;'));
			expect(error?.type).toBe('error');
			expect(error?.err?.message).toContain('null3D could not compile the WGSL:\nsrc/tint.wgsl:2:');
			// Code that changes outside the WGSL runs again, so Vite updates or reloads the page.
			const moved = await change('src/tint.ts', `${sketch}export const more = 1;\n`);
			expect(moved.some(({ type }) => type === 'custom')).toBe(false);
		} finally {
			await server.close();
		}
	}, 60_000);

	it('compiles WGSL in the dev server, and gives Vite the place of a problem', async () => {
		const root = project({ 'src/broken.ts': BROKEN_SKETCH });
		const server = await createServer({
			root,
			configFile: false,
			logLevel: 'silent',
			plugins: [null3d()],
			server: { middlewareMode: true, hmr: false, watch: null },
		});
		try {
			const sketch = await server.transformRequest('/src/sketch.ts');
			expect(sketch?.code).toContain('#version 300 es');
			expect(sketch?.code).not.toContain('-> @builtin(position) vec4f {');
			const file = await server.transformRequest('/src/shaders/glow.wgsl');
			expect(file?.code).toStartWith('export default ({"kind":"shader","webgpu":');
			const error = await server.transformRequest('/src/broken.ts').then(
				() => null,
				(e: { plugin?: string; loc?: unknown; frame?: string }) => e,
			);
			expect(error?.plugin).toBe('null3d');
			expect(error?.loc).toEqual({ file: join(root, 'src/broken.ts'), line: 19, column: 23 });
			expect(error?.frame).toContain(
				'19 |     return vec4f(1.0) 2.0;\n   |                       ^',
			);
		} finally {
			await server.close();
		}
	});
});
