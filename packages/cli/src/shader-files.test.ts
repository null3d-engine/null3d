// The page's build keeps the engine's shader builds out of the bundler: it marks their addresses so
// that the bundler leaves them alone, then links the files that the shader build wrote beside the
// scripts that name them. These checks hold both halves to that.
import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'vite';
import { lineMap, linkShaderFiles, markShaderAddresses, shaderFiles } from './shader-files.js';

/** A folder that holds the named files, as a shader set's folder does. */
function folderWith(...names: string[]): string {
	const folder = mkdtempSync(join(tmpdir(), 'null3d-shader-files-'));
	for (const name of names) writeFileSync(join(folder, name), 'export {};\n');
	return folder;
}

describe('markShaderAddresses', () => {
	test('marks the address of a shader file that the folder holds', () => {
		const folder = folderWith('shaders-wgsl.js');
		const marked = markShaderAddresses(
			"const url = new URL('./shaders-wgsl.js', import.meta.url);\n",
			folder,
		);
		expect(marked?.files).toEqual(['shaders-wgsl.js']);
		expect(marked?.code).toContain(
			"new URL(/* @vite-ignore */ './shaders-wgsl.js', import.meta.url)",
		);
	});

	test('marks an address written with double quotes as well', () => {
		const folder = folderWith('shaders-glsl-half.js');
		const marked = markShaderAddresses(
			'const url = new URL("./shaders-glsl-half.js", import.meta.url);\n',
			folder,
		);
		expect(marked?.code).toContain(
			'new URL(/* @vite-ignore */ "./shaders-glsl-half.js", import.meta.url)',
		);
	});

	test('leaves a module whose folder holds no such file alone', () => {
		const marked = markShaderAddresses(
			"const url = new URL('./shaders-wgsl.js', import.meta.url);\n",
			folderWith('sketch.ts'),
		);
		expect(marked).toBeUndefined();
	});

	test('leaves an address of a file that is not a shader file alone', () => {
		const folder = folderWith('sketch.ts');
		const marked = markShaderAddresses(
			"const url = new URL('./sketch.ts', import.meta.url);\n",
			folder,
		);
		expect(marked).toBeUndefined();
	});
});

describe('lineMap', () => {
	test('maps the start of each line to the same line of the same source', () => {
		const map = lineMap('/engine/generated/shaders.ts', 'one\ntwo\nthree\n');
		expect(map.sources).toEqual(['/engine/generated/shaders.ts']);
		// One segment for each of the four lines, each naming its own original line.
		expect(map.mappings).toBe('AAAA;AACA;AACA;AACA');
	});
});

describe('linkShaderFiles', () => {
	test('links the shader files beside the scripts that name them, and no other file', () => {
		const folder = folderWith(
			'shaders-wgsl.js',
			'shader-paragraphs-glsl-bump.js',
			'core.ts',
			'notes.txt',
		);
		const out = folderWith();
		linkShaderFiles([folder], ['assets'], out);
		expect(readdirSync(join(out, 'assets')).sort()).toEqual([
			'shader-paragraphs-glsl-bump.js',
			'shaders-wgsl.js',
		]);
		// The set the shader build wrote keeps its files.
		expect(readdirSync(folder).sort()).toEqual([
			'core.ts',
			'notes.txt',
			'shader-paragraphs-glsl-bump.js',
			'shaders-wgsl.js',
		]);
	});

	test('a second build that names the same folder leaves the files in place', () => {
		const folder = folderWith('shaders-wgsl.js');
		const out = folderWith();
		linkShaderFiles([folder], ['assets'], out);
		linkShaderFiles([folder], ['assets'], out);
		expect(readdirSync(join(out, 'assets'))).toEqual(['shaders-wgsl.js']);
	});

	test('links into each folder that holds a script naming a shader file', () => {
		const folder = folderWith('shaders-wgsl.js');
		const out = folderWith();
		linkShaderFiles([folder], ['assets', 'assets/workers'], out);
		expect(existsSync(join(out, 'assets/shaders-wgsl.js'))).toBe(true);
		expect(existsSync(join(out, 'assets/workers/shaders-wgsl.js'))).toBe(true);
	});
});

describe('the plugin in a build', () => {
	test('links the shader file beside the script and writes no copy of it', async () => {
		const root = folderWith();
		const out = folderWith();
		writeFileSync(
			join(root, 'index.html'),
			'<!doctype html><script type="module" src="/main.js"></script>',
		);
		writeFileSync(
			join(root, 'main.js'),
			"const url = new URL('./shaders-wgsl.js', import.meta.url);\nconsole.log(url.href);\n",
		);
		writeFileSync(join(root, 'shaders-wgsl.js'), 'export const SHADERS = { probe: 1 };\n');
		await build({
			root,
			configFile: false,
			logLevel: 'silent',
			plugins: [shaderFiles()],
			build: { outDir: out, emptyOutDir: true },
		});
		const files = readdirSync(out, { recursive: true, encoding: 'utf8' }).map(String);
		expect(files).toContain('assets/shaders-wgsl.js');
		// The file keeps the name that the address names, so the build wrote no copy of its own.
		expect(files.some((file) => /shaders-wgsl-/.test(file))).toBe(false);
		const script = files.find((file) => /^assets\/index-.*\.js$/.test(file)) ?? '';
		expect(readFileSync(join(out, script), 'utf8')).toContain('./shaders-wgsl.js');
	});
});
