import { afterAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { join } from 'node:path';
import { CompilerPool } from './compile-pool';
import { LOAD_BUILDS, ShaderPack, UNPACK } from './pack';
import type { CompiledMaterial, CompiledWgsl, GlslProgram, ShaderVariant } from './shader-types';
import { compileLiteral, compileWgslFile, findTaggedWgsl, WGSL_TAG } from './wgsl';

/** Library text that every build shares, as the engine's standard material's builds do. */
const LIBRARY = Array.from(
	{ length: 40 },
	(_, i) =>
		`fn library_${i}(x: f32) -> f32 {\n    let a = x * ${i}.0;\n    let b = a + 0.5;\n    return a * b;\n}`,
).join('\n');

/** A GLSL stage whose text holds the library and a line of its own. */
const stage = (own: string) => ({
	source: `#version 300 es\n${LIBRARY}\nvoid main() {\n    ${own};\n}\n`,
	uniformBlocks: [{ name: 'Frame', group: 0, binding: 0 }],
	textures: [],
});

/** One variant of a material, for both GPU paths. */
function variant(permutation: number): ShaderVariant {
	const main: GlslProgram = {
		vertex: stage(`v${permutation}`),
		fragment: stage(`f${permutation}`),
	};
	return {
		permutation,
		wgsl: {
			source: `${LIBRARY}\n@fragment fn fs_${permutation}() {}\n`,
			pipelines: { main: { vertex: 'vs', fragment: `fs_${permutation}` } },
		},
		glsl: { main },
	};
}

/** A custom material with many variants that share their library text. */
function material(variants: number): CompiledMaterial {
	return {
		kind: 'material',
		functions: ['surface'],
		uniforms: [{ name: 'tint', type: 'vec3f', offset: 0 }],
		textures: [],
		variants: Object.fromEntries(
			Array.from({ length: variants }, (_, i) => [`standard_${i}`, variant(i)]),
		),
		locations: [0, 1],
		attributes: 0,
		baseColor: true,
		objectIds: false,
		sceneDepth: false,
	};
}

/** The folders of the modules that the tests ran. */
const folders: string[] = [];
afterAll(() => {
	for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

/**
 * Runs a module's code and returns what it exports by default. Each module gets a folder of its
 * own, since Bun keeps what it read of a folder when it resolved an earlier import there.
 */
async function run(code: string, others: Record<string, string> = {}): Promise<unknown> {
	const folder = mkdtempSync(join(tmpdir(), 'null3d-pack-'));
	folders.push(folder);
	for (const [name, text] of Object.entries(others)) writeFileSync(join(folder, name), text);
	const file = join(folder, 'module.mjs');
	writeFileSync(file, code);
	return ((await import(file)) as { default: unknown }).default;
}

describe('ShaderPack', () => {
	it('gives back every value of the compiled shaders when the module runs', async () => {
		const pack = new ShaderPack();
		const a = material(12);
		const b = material(5);
		const code = `export default [${pack.value(a)}, ${pack.value(b, 'sketch.ts:1')}];\n${pack.unpacker()}`;
		expect(await run(code)).toEqual([a, { ...b, hot: 'sketch.ts:1' }]);
	});

	it('keeps shared text once, so the module is a small part of the full values', () => {
		const pack = new ShaderPack();
		const shader = material(64);
		const code = `export default ${pack.value(shader)};\n${pack.unpacker()}`;
		expect(code.length).toBeLessThan(JSON.stringify(shader).length / 10);
	});

	it('works for a shader that the module uses before the function is declared', async () => {
		const pack = new ShaderPack();
		const shader = material(2);
		const code = `const first = ${pack.value(shader)};\nexport default first.variants.standard_1.glsl.main.fragment.source;\n${pack.unpacker()}`;
		expect(await run(code)).toBe(stage('f1').source);
	});

	it("builds the text of the GPU path that the page reads, and never the other path's", async () => {
		const pack = new ShaderPack();
		const shader = material(3);
		const code = `const shader = ${pack.value(shader)};\nconst wgsl = shader.variants.standard_2.wgsl.source;\nexport default [wgsl, ${UNPACK}.paths.map((path) => path.tables !== undefined)];\n${pack.unpacker()}`;
		expect(await run(code)).toEqual([variant(2).wgsl?.source, [true, false]]);
	});

	it('gives a material whose builds load on first use a function that imports its share of a set', async () => {
		const pack = new ShaderPack();
		const shader = material(2);
		const set = new ShaderPack();
		const records = [{}, { standard_skin: variant(7) }];
		const code = `export default ${pack.value(shader, undefined, 1)};\n${pack.unpacker()}\nfunction ${LOAD_BUILDS}(target, set) {\n\treturn import('./set.mjs').then((module) => ({ default: target + ' ' + set === 'wgsl 64' ? module.default : [] }));\n}\n`;
		const setCode = `export default ${set.value(records)};\n${set.unpacker()}`;
		const loaded = (await run(code, { 'set.mjs': setCode })) as CompiledMaterial;
		const { builds, ...rest } = loaded;
		expect(rest).toEqual(shader);
		expect(await builds?.('wgsl', 64)).toEqual(records[1] as Record<string, ShaderVariant>);
		expect(await builds?.('glsl', 0)).toEqual({});
	});

	it('needs no function in a module without compiled shaders', () => {
		const pack = new ShaderPack();
		expect(pack.empty).toBe(true);
		pack.value(material(1));
		expect(pack.empty).toBe(false);
		expect(pack.unpacker()).toContain(`function ${UNPACK}(`);
	});
});

/**
 * `bun run test:shader-compiler` sets this. The compiler must be built first with `bun run build`,
 * so plain `bun run test` skips the test that compiles.
 */
const COMPILES = process.env.NULL3D_SHADER_COMPILER !== undefined;

/** The folders whose modules hold the repository's own WGSL: the test sketches and the demos. */
const WGSL_FOLDERS = ['tests/pages', 'tests/fixtures', 'examples'];

/** Every module of those folders with WGSL, as the plugin compiles it: scripts and `.wgsl` files. */
function wgslModules(root: string): string[] {
	const files: string[] = [];
	for (const folder of WGSL_FOLDERS)
		for (const file of readdirSync(join(root, folder), { recursive: true, encoding: 'utf8' })) {
			if (file.includes('node_modules')) continue;
			const path = join(root, folder, file);
			if (
				path.endsWith('.wgsl') ||
				(/\.[cm]?[jt]sx?$/.test(path) && WGSL_TAG.test(readFileSync(path, 'utf8')))
			)
				files.push(path);
		}
	return files.sort();
}

/** The time that compiling every module of the repository may take on a CI runner. */
const COMPILE_ALL_MS = 600_000;

/** A module's compiled shaders, as the plugin compiles them. Shaders that do not compile are left out. */
async function compiledShaders(file: string, compiler: CompilerPool): Promise<CompiledWgsl[]> {
	const code = readFileSync(file, 'utf8');
	const compiled = file.endsWith('.wgsl')
		? [await compileWgslFile(file, file, code, compiler)]
		: await Promise.all(
				findTaggedWgsl(code, file).map((literal) =>
					compileLiteral(literal, code, file, file, compiler),
				),
			);
	return compiled.flatMap((result) => ('shader' in result ? [result.shader] : []));
}

describe.skipIf(!COMPILES)('ShaderPack with the compiler', () => {
	// The test runs no dev server beside the compiles, so its pool takes every core.
	const compiler = new CompilerPool(availableParallelism());
	afterAll(() => compiler.close());

	it(
		"gives back every byte of each compiled shader in the repository's modules",
		async () => {
			const root = join(import.meta.dir, '../../..');
			const modules = await Promise.all(
				wgslModules(root).map((file) => compiledShaders(file, compiler)),
			);
			let full = 0;
			let packed = 0;
			let shaders = 0;
			// Modules that show a compile error, such as the error tests' sketches, carry no shader.
			for (const values of modules.filter((values) => values.length > 0)) {
				const pack = new ShaderPack();
				const module = `export default [${values.map((value) => pack.value(value)).join(',\n')}];\n${pack.unpacker()}`;
				expect(await run(module)).toEqual(values);
				full += JSON.stringify(values).length;
				packed += module.length;
				shaders += values.length;
			}
			expect(shaders).toBeGreaterThan(30);
			console.log(
				`${shaders} compiled shaders: ${(full / 1e6).toFixed(1)} MB in full, ${(packed / 1e6).toFixed(1)} MB packed`,
			);
			expect(packed).toBeLessThan(full / 4);
		},
		COMPILE_ALL_MS,
	);
});
