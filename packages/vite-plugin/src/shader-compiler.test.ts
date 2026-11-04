import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { MIRROR_FLOOR, WET_ROAD } from '../../../examples/showroom/floor';
import { scaledBudget } from '../../../tests/lib/run-budget.ts';
import {
	type ShaderVariant as EngineShaderVariant,
	everyShader,
} from '../../engine/src/generated/shaders';
import {
	buildShaders,
	compileMaterial,
	compileShader,
	type MaterialSource,
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

/**
 * The type a generated shader declares at a group and binding, as its WGSL writes it, or undefined
 * when it declares nothing there. The declaration may put a newline between the attributes and
 * `var`.
 */
function bindingType(source: string, group: number, binding: number): string | undefined {
	const pattern = new RegExp(
		`@group\\(${group}\\)\\s*@binding\\(${binding}\\)\\s*var\\s+[^:]*:\\s*([^;]+);`,
	);
	return pattern.exec(source)?.[1]?.trim();
}

/**
 * The number of bindings a generated shader declares in one group. Two shaders that declare
 * different counts do not put the same resource at the same index, so one index means nothing
 * across them.
 */
function bindingCount(source: string, group: number): number {
	return source.match(new RegExp(`@group\\(${group}\\)\\s*@binding\\(`, 'g'))?.length ?? 0;
}

/**
 * The frame group's binding that a material compiled against an older frame layout gets wrong: the
 * ambient occlusion map's texture array. The failure messages read it too, so a message cannot
 * name an index other than the one compared.
 */
const FRAME_BINDING = 11;

/** A material's problems as one line, for a test's failure message. */
function materialProblems(name: string, problems: readonly ShaderProblem[]): string {
	return `${name}: ${problems.map((problem) => problem.message).join('; ')}`;
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

	// A few of the engine's small shaders, which is the scale a build tool passes: a project's own
	// manifest. The whole engine manifest takes the module about twelve minutes, past this test's
	// limit. `standard_maps` alone holds 11,456 builds, and `probe_grid`, at 2.4% of the builds,
	// would take most of this test's time. The shader crate's own test compares every entry of the
	// repository through the module, one entry at a time, and the module hands an entry's answer
	// over in pieces (`.dev/implementation-notes.md`).
	const ENGINE_SHADERS = ['decal', 'final', 'line', 'texcoords', 'unlit'];

	it(
		"gives the native build's output for the engine's shaders",
		async () => {
			const result = buildShaders(engineShaderInputs(ENGINE_SHADERS));
			if (!result.ok) throw new Error(result.problems.map((p) => p.message).join('\n'));
			const whole = await everyShader();
			// Every name asked for is an entry of the engine's own manifest, so its variants are there.
			const expected = Object.fromEntries(ENGINE_SHADERS.map((name) => [name, whole[name]!]));
			expect(result.output.shaders).toEqual(expected);
		},
		scaledBudget(180_000),
	);
	it(
		'builds the showroom floors with the frame bindings the standard material declares',
		() => {
			// A material that compiled against an older frame group keeps its own binding declarations.
			// The pipeline then fails to build with E1404, which reads like an engine fault. Compare every
			// variant of the demo's own custom materials with a plain material built by the same compiler:
			// a binding that differs names the binding and both dimensions here, not in a browser.
			const plain: MaterialSource = {
				path: 'standard-material.wgsl',
				source:
					'fn surface(input: SurfaceInput) -> Surface {\n    return defaultSurface(input);\n}',
			};
			const standard = compileMaterial(plain);
			if (!standard.ok) throw new Error(materialProblems(plain.path, standard.problems));
			// A rename or a reformat in the generated WGSL leaves both sides undefined, and two
			// undefined readings compare equal. The comparison needs a reference to agree with.
			const reads = Object.values(standard.material.variants).some(
				(declaration) => declaration.wgsl && bindingType(declaration.wgsl.source, 0, FRAME_BINDING),
			);
			if (!reads)
				throw new Error(
					`the standard material declares a type at @group(0) @binding(${FRAME_BINDING}) in no variant, so there is nothing for the demo to compare against`,
				);
			for (const [name, source] of [
				['the mirror floor', MIRROR_FLOOR],
				['the wet road', WET_ROAD],
			] as const) {
				const built = compileMaterial({ path: `showroom ${name}`, source });
				if (!built.ok) throw new Error(materialProblems(name, built.problems));
				// A variant without WGSL on either side is skipped, and a skipped variant is not
				// checked. So every variant that has WGSL must be compared, not merely one of them.
				const withWgsl = Object.values(built.material.variants).filter(
					(declaration) => declaration.wgsl,
				).length;
				let compared = 0;
				for (const [variant, declaration] of Object.entries(built.material.variants)) {
					const expectedVariant = standard.material.variants[variant];
					if (!declaration.wgsl || !expectedVariant?.wgsl) continue;
					compared += 1;
					const ownCount = bindingCount(declaration.wgsl.source, 0);
					const expectedCount = bindingCount(expectedVariant.wgsl.source, 0);
					const at = `@group(0) @binding(${FRAME_BINDING})`;
					if (ownCount !== expectedCount)
						throw new Error(
							`${name} declares ${ownCount} bindings in group 0 in its ${variant} variant, where the standard material declares ${expectedCount}, so ${at} need not name the same resource`,
						);
					const own = bindingType(declaration.wgsl.source, 0, FRAME_BINDING);
					const expected = bindingType(expectedVariant.wgsl.source, 0, FRAME_BINDING);
					if (own === undefined && expected === undefined)
						throw new Error(
							`neither ${name} nor the standard material declares a type at ${at} in its ${variant} variant, so the comparison has nothing to check`,
						);
					if (own === expected) continue;
					throw new Error(
						`${name} declares ${own ?? 'nothing'} at ${at} in its ${variant} variant, where the standard material declares ${expected ?? 'nothing'}`,
					);
				}
				if (withWgsl === 0)
					throw new Error(`${name} has no variant with WGSL, so the guard compared nothing`);
				if (compared !== withWgsl)
					throw new Error(
						`${name} compared ${compared} of its ${withWgsl} variants with WGSL, because the standard material has no variant of the rest by name`,
					);
			}
		},
		scaledBudget(300_000),
	);
});
