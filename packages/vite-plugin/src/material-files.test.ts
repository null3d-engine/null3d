import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { devFileName, hotShaders, type ModuleShader, shaderValues } from './material-files';
import { compileHere, type MaterialFile } from './shader-compiler';
import type { BuiltMaterial, ShaderVariant } from './shader-types';
import { compileWgsl } from './wgsl';

/** `bun run test:shader-compiler` sets this, after `bun run build` built the shader compiler. */
const ENABLED = process.env.NULL3D_SHADER_COMPILER !== undefined;

/** A surface function that tints the standard look by a uniform. */
const surface = (tint: string) => `struct Uniforms {
    tint: vec3f,
}

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    s.baseColor = s.baseColor * material.tint * ${tint};
    return s;
}
`;

/** A custom material compiled from `wgsl`. */
async function material(wgsl: string): Promise<BuiltMaterial> {
	const result = await compileWgsl('src/tint.wgsl', wgsl, 'HINT');
	if (!result.ok) throw new Error(result.problems.map((p) => p.message).join('\n'));
	if (result.shader.kind !== 'material') throw new Error('the WGSL compiled as a whole shader');
	return result.shader;
}

/**
 * Imports a file's JavaScript, as the thread that draws does, and returns its list of builds. Each
 * file goes in a folder of its own, as Bun does not see a file added to a folder it has read.
 */
async function importFile(
	folder: string,
	file: MaterialFile,
): Promise<Record<string, ShaderVariant>[]> {
	const path = join(mkdtempSync(join(folder, 'file-')), devFileName(file));
	writeFileSync(path, file.source);
	return (await import(pathToFileURL(path).href)).SHADERS;
}

describe.skipIf(!ENABLED)('the files of custom materials', () => {
	it('hold every build once, by GPU path and fixed bits, with each material in its place', async () => {
		const shaders: ModuleShader[] = [
			{ shader: await material(surface('1.0')) },
			{
				shader: {
					kind: 'shader',
					webgpu: { permutation: 0, wgsl: null, glsl: null },
					webgl2: null,
				},
			},
			{ shader: await material(surface('0.5')), key: 'src/sketch.ts#2' },
		];
		const files: MaterialFile[] = [];
		const values = await shaderValues(shaders, compileHere, (file) => {
			files.push(file);
			return `url(${files.length - 1})`;
		});
		expect(files.map(({ name }) => name).sort()).toEqual([
			'glsl',
			'glsl-draw-index',
			'glsl-draw-index-tone-map',
			'glsl-tone-map',
			'wgsl',
			'wgsl-tone-map',
		]);
		// A material's value names the files by the code that the address gives, in place of its builds.
		expect(values[0]).not.toContain('"variants"');
		expect(values[0]).toContain(`"files":{"index":0,"wgsl":{`);
		expect(values[2]).toContain(`"hot":"src/sketch.ts#2","files":{"index":1,`);
		expect(values[1]).toBe(`(${JSON.stringify(shaders[1]?.shader)})`);
		for (const name of files.keys()) expect(values[0]).toContain(`: url(${name})`);

		const folder = mkdtempSync(join(tmpdir(), 'null3d-material-files-'));
		try {
			const builds = [0, 2].map((k) => (shaders[k]?.shader as BuiltMaterial | undefined)?.variants);
			const seen = [new Set<string>(), new Set<string>()];
			for (const file of files) {
				const list = await importFile(folder, file);
				expect(list).toHaveLength(2);
				for (const [index, held] of list.entries()) {
					for (const [name, build] of Object.entries(held)) {
						expect(build).toEqual(builds[index]?.[name] as ShaderVariant);
						expect(build.permutation & file.bits).toBe(file.bits);
						expect(build.wgsl === null).toBe(file.target === 'glsl');
						seen[index]?.add(name);
					}
				}
			}
			for (const [index, names] of seen.entries())
				expect([...names].sort()).toEqual(Object.keys(builds[index] ?? {}).sort());
		} finally {
			rmSync(folder, { recursive: true, force: true });
		}
	}, 60_000);

	it('write the text that the materials and their builds share once', async () => {
		const shaders = [
			{ shader: await material(surface('1.0')) },
			{ shader: await material(surface('0.5')) },
		];
		const files: MaterialFile[] = [];
		await shaderValues(shaders, compileHere, (file) => {
			files.push(file);
			return '""';
		});
		const folder = mkdtempSync(join(tmpdir(), 'null3d-material-files-'));
		try {
			for (const file of files) {
				const whole = JSON.stringify(await importFile(folder, file)).length;
				// Without sharing, the two materials' builds would take four times the room or more.
				expect(file.source.length * 4).toBeLessThan(whole);
			}
		} finally {
			rmSync(folder, { recursive: true, force: true });
		}
	}, 60_000);

	it('give a hot update the addresses of new files in place of the builds', async () => {
		const tint = await material(surface('1.0'));
		const [shader] = await hotShaders(
			[{ shader: tint, key: 'src/tint.wgsl' }],
			compileHere,
			(file) => `/null3d-materials/${file.name}.js`,
		);
		expect(shader).not.toHaveProperty('variants');
		expect(shader).toMatchObject({
			kind: 'material',
			hot: 'src/tint.wgsl',
			files: {
				index: 0,
				wgsl: { 0: '/null3d-materials/wgsl.js' },
				glsl: { 0: '/null3d-materials/glsl.js' },
			},
		});
	}, 60_000);
});
