import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import {
	type ShaderVariant as EngineShaderVariant,
	everyShader,
} from '../../engine/src/generated/shaders';
import {
	buildShaders,
	compileShader,
	type ShaderBuildInputs,
	type ShaderProblem,
	type ShaderSource,
} from './shader-compiler';
import type { ShaderVariant } from './shader-types';

/**
 * `bun run test:shader-compiler` sets this. The module must be built first with `bun run build`,
 * so plain `bun run test` skips these tests.
 */
const ENABLED = process.env.NULL3D_SHADER_COMPILER !== undefined;

/** True only when the compiler's variant record and the engine's are the same type. */
const SAME_RECORDS: [ShaderVariant, EngineShaderVariant] extends [
	EngineShaderVariant,
	ShaderVariant,
]
	? true
	: never = true;

/** A mesh shader that imports `null3d::math`, and reads the draw index in its multi-draw variant. */
const MESH: ShaderSource = {
	path: 'src/shaders/mesh.wgsl',
	source: `enable draw_index;
#import null3d::math

struct Camera { view_projection: mat4x4f, }
@group(0) @binding(0) var<uniform> camera: Camera;

struct Offsets { values: array<vec4f, 4>, }
@group(1) @binding(0) var<uniform> offsets: Offsets;

@vertex
fn vs_main(
    @location(0) position: vec3f,
#ifdef DRAW_INDEX
    @builtin(draw_index) draw: u32,
#endif
) -> @builtin(position) vec4f {
    var moved = position * null3d::math::square(2.0);
#ifdef DRAW_INDEX
    moved += offsets.values[draw].xyz;
#endif
    return camera.view_projection * vec4f(moved, 1.0);
}

@fragment
fn fs_main() -> @location(0) vec4f {
    return vec4f(null3d::math::square(0.5));
}
`,
	pipelines: { main: { vertex: 'vs_main', fragment: 'fs_main' } },
	variants: {
		webgpu: { targets: ['wgsl'] },
		webgl2: { targets: ['glsl'] },
		webgl2_multi_draw: { defs: ['DRAW_INDEX'], targets: ['glsl'] },
	},
};

/** A fragment shader with one WGSL variant. */
function fragment(path: string, body: string): ShaderSource {
	return {
		path,
		source: `#import null3d::math\n\n@fragment\nfn fs_main() -> @location(0) vec4f {\n${body}}\n`,
		variants: { webgpu: { targets: ['wgsl'] } },
	};
}

/** The problems of a compile that should fail. */
function problemsOf(shader: ShaderSource): readonly ShaderProblem[] {
	const result = compileShader(shader);
	if (result.ok) throw new Error(`${shader.path} compiled, but it should fail`);
	return result.problems;
}

/**
 * The repository's shader manifest and WGSL files, as `bun run shaders` reads them. Given names,
 * the manifest holds only those shaders and the files hold only theirs beside the library modules,
 * which is the shape a build tool passes for a project.
 */
function engineShaderInputs(names?: readonly string[]): ShaderBuildInputs {
	const crate = join(import.meta.dir, '../../../crates/null3d-shaders');
	const read = (path: string) => readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
	const folder = join(crate, 'wgsl');
	const files = readdirSync(folder, { recursive: true, encoding: 'utf8' })
		.filter((file) => file.endsWith('.wgsl'))
		.map((file) => [file.split(sep).join('/'), read(join(folder, file))]);
	const manifest = read(join(crate, 'shaders.toml'));
	if (!names) return { manifest, files: Object.fromEntries(files) };
	// Keep the tables of the named shaders. The first-use tables go: they name shaders that the
	// narrowed manifest no longer holds. An entry shader whose table goes leaves the files too,
	// because every file that is not a library module needs a table.
	const kept = new Set(names);
	const held = new Set<string>();
	const lines: string[] = [];
	let skipping = false;
	let table: string | undefined;
	for (const line of manifest.split('\n')) {
		const header = /^\[([^\]]+)\]$/.exec(line)?.[1];
		if (header) {
			table = header;
			const name = header.startsWith('shaders.') ? header.slice('shaders.'.length) : undefined;
			skipping = header.startsWith('first_use.') || (name !== undefined && !kept.has(name));
		}
		if (skipping) continue;
		const file = table?.startsWith('shaders.') ? /^file = "([^"]+)"$/.exec(line)?.[1] : undefined;
		if (file) held.add(file);
		lines.push(line);
	}
	return {
		manifest: lines.join('\n'),
		files: Object.fromEntries(
			files.filter((entry) => {
				const path = entry[0] ?? '';
				return held.has(path) || path.startsWith('lib/');
			}),
		),
	};
}

describe.skipIf(!ENABLED)('the shader compiler', () => {
	it('writes the records that the engine takes', () => {
		expect(SAME_RECORDS).toBe(true);
	});

	it('compiles a shader that imports null3d::math to WGSL, GLSL and multi-draw GLSL', () => {
		const result = compileShader(MESH);
		if (!result.ok) throw new Error(result.problems.map((p) => p.message).join('\n'));
		const { webgpu, webgl2, webgl2_multi_draw } = result.variants;

		expect(webgpu?.glsl).toBeNull();
		expect(webgpu?.wgsl?.source).toContain('fn square(x: f32) -> f32');
		expect(webgpu?.wgsl?.source).not.toContain('draw_index');
		expect(webgpu?.wgsl?.pipelines).toEqual({ main: { vertex: 'vs_main', fragment: 'fs_main' } });

		const plain = webgl2?.glsl?.main;
		expect(webgl2?.wgsl).toBeNull();
		expect(plain?.vertex.source.split('\n')[0]).toBe('#version 300 es');
		expect(plain?.vertex.source).not.toContain('gl_DrawID');
		expect(plain?.fragment.source).toContain('float square(float x)');
		expect(plain?.vertex.uniformBlocks.map(({ group, binding }) => [group, binding])).toEqual([
			[0, 0],
		]);

		const multiDraw = webgl2_multi_draw?.glsl?.main?.vertex;
		expect(multiDraw?.source.split('\n').slice(0, 2)).toEqual([
			'#version 300 es',
			'#extension GL_ANGLE_multi_draw : require',
		]);
		expect(multiDraw?.source).toContain('uint(gl_DrawID)');
		for (const block of multiDraw?.uniformBlocks ?? [])
			expect(multiDraw?.source).toContain(`uniform ${block.name} {`);
		expect(multiDraw?.uniformBlocks.map(({ group, binding }) => [group, binding])).toEqual([
			[0, 0],
			[1, 0],
		]);
	});

	it('reports a syntax error after a library call at its line and column', () => {
		const shader = fragment(
			'src/shaders/broken.wgsl',
			'    let y = null3d::math::square(2.0) 3.0;\n    return vec4f(y);\n',
		);
		expect(problemsOf(shader)).toEqual([
			{
				file: 'src/shaders/broken.wgsl',
				line: 5,
				column: 39,
				feature: null,
				message: 'expected `;`, found "3.0"',
				variants: ['webgpu'],
			},
		]);
	});

	it('reports a type error in a library call at its argument', () => {
		const shader = fragment(
			'src/shaders/typed.wgsl',
			'    return vec4f(null3d::math::square(2u));\n',
		);
		const [problem] = problemsOf(shader);
		expect([problem?.file, problem?.line, problem?.column]).toEqual([
			'src/shaders/typed.wgsl',
			5,
			39,
		]);
		expect(problem?.message).toContain("doesn't match the type");
	});

	it('reports a language feature outside the portable three once, with each variant', () => {
		const shader: ShaderSource = {
			...fragment(
				'src/shaders/swizzle.wgsl',
				'    var color = vec4f(0.0);\n    color.rgb = vec3f(null3d::math::square(0.5));\n    return color;\n',
			),
			variants: { plain: { targets: ['wgsl'] }, bright: { defs: ['BRIGHT'], targets: ['wgsl'] } },
		};
		const problems = problemsOf(shader);
		expect(problems).toHaveLength(1);
		expect(problems[0]).toMatchObject({
			file: 'src/shaders/swizzle.wgsl',
			line: 6,
			column: 10,
			feature: 'swizzle_assignment',
			variants: ['bright', 'plain'],
		});
		expect(problems[0]?.message).toEndWith(
			' See https://github.com/null3d-engine/null3d/blob/main/docs/shaders/wgsl-rules.md',
		);
	});

	it('checks the request', () => {
		const [noPipeline] = problemsOf({ ...MESH, pipelines: {} });
		expect(noPipeline?.message).toStartWith(
			'variants.webgl2 targets "glsl", but the shader names no pipelines.',
		);
		const [unknownField] = problemsOf({ ...MESH, defines: [] } as ShaderSource);
		expect(unknownField?.message).toStartWith(
			"the shader compiler's request is not valid: unknown field `defines`",
		);
	});

	// A few of the engine's shaders, which is the scale a build tool passes: a project's own
	// manifest. The whole engine manifest takes the module about twelve minutes and answers with
	// about 1.7 GB of JSON, more than this test's limit and more than a 32-bit module may hold
	// beside its builds (`.dev/implementation-notes.md`). `standard_maps` alone holds 11,456
	// builds. The shader crate's own test compares every entry of the repository through the
	// module, one entry at a time.
	const ENGINE_SHADERS = ['decal', 'final', 'line', 'texcoords', 'unlit', 'probe_grid'];

	it("gives the native build's output for the engine's shaders", async () => {
		const result = buildShaders(engineShaderInputs(ENGINE_SHADERS));
		if (!result.ok) throw new Error(result.problems.map((p) => p.message).join('\n'));
		const whole = await everyShader();
		const expected = Object.fromEntries(ENGINE_SHADERS.map((name) => [name, whole[name]]));
		expect(result.output.shaders).toEqual(expected);
	}, 180_000);
});
