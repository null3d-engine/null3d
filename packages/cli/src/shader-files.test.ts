// The page's build keeps the engine's shader builds out of the bundler: it marks their addresses so
// that the bundler leaves them alone, then links the files that the shader build wrote beside the
// scripts that name them. Each name carries the set's stamp, so a cached name never answers for
// another set. These checks hold both halves to that.
import { describe, expect, test } from 'bun:test';
import {
	existsSync,
	linkSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'vite';
import {
	FORCE_COPY_ENV,
	lineMap,
	linkFailure,
	linkShaderFiles,
	markShaderAddresses,
	setStamp,
	shaderFileName,
	shaderFiles,
} from './shader-files.js';

/** A folder that holds the named files, as a shader set's folder does. */
function folderWith(...names: string[]): string {
	const folder = mkdtempSync(join(tmpdir(), 'null3d-shader-files-'));
	for (const name of names) writeFileSync(join(folder, name), 'export {};\n');
	return folder;
}

describe('setStamp', () => {
	test('keeps the same stamp for a set that does not change', () => {
		const folder = folderWith('shaders-wgsl.js', 'shader-paragraphs-glsl-bump.js');
		expect(setStamp(folder)).toBe(setStamp(folder));
	});

	test('gives another stamp when a file of the set changes', () => {
		const folder = folderWith('shaders-wgsl.js');
		const before = setStamp(folder);
		writeFileSync(join(folder, 'shaders-wgsl.js'), 'export const SHADERS = { more: 1 };\n');
		expect(setStamp(folder)).not.toBe(before);
	});

	test('gives another stamp when a file joins or leaves the set', () => {
		const folder = folderWith('shaders-wgsl.js');
		const before = setStamp(folder);
		writeFileSync(join(folder, 'shader-paragraphs-glsl-bump.js'), 'export {};\n');
		const joined = setStamp(folder);
		expect(joined).not.toBe(before);
		writeFileSync(join(folder, 'notes.txt'), 'not a shader file\n');
		expect(setStamp(folder)).toBe(joined);
	});

	test('gives a stamp that a file name can carry', () => {
		expect(setStamp(folderWith('shaders-wgsl.js'))).toMatch(/^[0-9a-f]{8}$/);
	});
});

describe('shaderFileName', () => {
	test('puts the stamp before the extension', () => {
		expect(shaderFileName('shaders-wgsl.js', 'a1b2c3d4')).toBe('shaders-wgsl-a1b2c3d4.js');
	});
});

describe('markShaderAddresses', () => {
	test('marks the address of a shader file that the folder holds, and names the set', () => {
		const folder = folderWith('shaders-wgsl.js');
		const marked = markShaderAddresses(
			"const url = new URL('./shaders-wgsl.js', import.meta.url);\n",
			folder,
			'a1b2c3d4',
		);
		expect(marked?.files).toEqual(['shaders-wgsl.js']);
		expect(marked?.code).toContain(
			"new URL(/* @vite-ignore */ './shaders-wgsl-a1b2c3d4.js', import.meta.url)",
		);
	});

	test('marks an address written with double quotes as well', () => {
		const folder = folderWith('shaders-glsl-half.js');
		const marked = markShaderAddresses(
			'const url = new URL("./shaders-glsl-half.js", import.meta.url);\n',
			folder,
			'a1b2c3d4',
		);
		expect(marked?.code).toContain(
			'new URL(/* @vite-ignore */ "./shaders-glsl-half-a1b2c3d4.js", import.meta.url)',
		);
	});

	test('leaves a module whose folder holds no such file alone', () => {
		const marked = markShaderAddresses(
			"const url = new URL('./shaders-wgsl.js', import.meta.url);\n",
			folderWith('sketch.ts'),
			'a1b2c3d4',
		);
		expect(marked).toBeUndefined();
	});

	test('leaves an address of a file that is not a shader file alone', () => {
		const folder = folderWith('sketch.ts');
		const marked = markShaderAddresses(
			"const url = new URL('./sketch.ts', import.meta.url);\n",
			folder,
			'a1b2c3d4',
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

describe('linkFailure', () => {
	test('refuses a link across two volumes, which would copy the whole set, and names both ways out', () => {
		const action = linkFailure('EXDEV', '/cache/shaders-wgsl.js', '/build/assets/shaders-a1b2.js');
		const problem = 'problem' in action ? action.problem : '';
		expect(problem).toContain('/cache');
		expect(problem).toContain('/build/assets');
		expect(problem).toContain('TMPDIR');
		expect(problem).toContain(`${FORCE_COPY_ENV}=1`);
	});

	test('leaves a file in place, and copies one whose link failed for another reason', () => {
		expect(linkFailure('EEXIST', 'a', 'b')).toEqual({ skip: true });
		expect(linkFailure('EPERM', 'a', 'b')).toEqual({ copy: true });
	});

	test('copies a cross-volume link when the environment forces it', () => {
		expect(linkFailure('EXDEV', 'a', 'b', true)).toEqual({ copy: true });
		// A file already in place is not copied again, whatever the environment asks.
		expect(linkFailure('EEXIST', 'a', 'b', true)).toEqual({ skip: true });
	});
});

describe('a link across two volumes', () => {
	// `/dev/shm` is a second device on Linux, which is where the check runs. A platform that cannot
	// build the case skips; Linux must build it, so a runner without a second device fails here
	// rather than passing without the proof.
	test.skipIf(process.platform !== 'linux')(
		'refuses at first, then copies the set when the environment forces it',
		() => {
			/** The two folders, so that both are removed even when one of them never appears. */
			let source = '';
			let out = '';
			const before = process.env[FORCE_COPY_ENV];
			try {
				source = mkdtempSync(join('/dev/shm', 'null3d-shader-files-'));
				out = mkdtempSync(join(tmpdir(), 'null3d-shader-files-'));
				writeFileSync(join(source, 'shaders-wgsl.js'), 'export {};\n');
				/** The error's code, or undefined when the link crossed no volume. */
				let code: string | undefined;
				try {
					linkSync(join(source, 'shaders-wgsl.js'), join(out, 'probe.js'));
				} catch (error) {
					code = (error as NodeJS.ErrnoException).code;
				}
				expect(code).toBe('EXDEV');

				const stamps = new Map([[source, 'a1b2c3d4']]);
				const named = new Set([join(source, 'shaders-wgsl.js')]);
				delete process.env[FORCE_COPY_ENV];
				expect(() => linkShaderFiles([source], ['assets'], out, named, stamps)).toThrow(
					FORCE_COPY_ENV,
				);
				process.env[FORCE_COPY_ENV] = '1';
				linkShaderFiles([source], ['assets'], out, named, stamps);
				expect(existsSync(join(out, 'assets', 'shaders-wgsl-a1b2c3d4.js'))).toBe(true);
			} finally {
				if (before === undefined) delete process.env[FORCE_COPY_ENV];
				else process.env[FORCE_COPY_ENV] = before;
				if (source !== '') rmSync(source, { recursive: true, force: true });
				if (out !== '') rmSync(out, { recursive: true, force: true });
			}
		},
	);
});

describe('linkShaderFiles', () => {
	test('names a file that a script names by the set, and leaves the others as they are', () => {
		const folder = folderWith(
			'shaders-wgsl.js',
			'shader-paragraphs-glsl-bump.js',
			'core.ts',
			'notes.txt',
		);
		const stamps = new Map([[folder, 'a1b2c3d4']]);
		const named = new Set([join(folder, 'shaders-wgsl.js')]);
		const out = folderWith();
		linkShaderFiles([folder], ['assets'], out, named, stamps);
		expect(readdirSync(join(out, 'assets')).sort()).toEqual([
			'shader-paragraphs-glsl-bump.js',
			'shaders-wgsl-a1b2c3d4.js',
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
		const stamps = new Map([[folder, 'a1b2c3d4']]);
		const named = new Set([join(folder, 'shaders-wgsl.js')]);
		const out = folderWith();
		linkShaderFiles([folder], ['assets'], out, named, stamps);
		linkShaderFiles([folder], ['assets'], out, named, stamps);
		expect(readdirSync(join(out, 'assets'))).toEqual(['shaders-wgsl-a1b2c3d4.js']);
	});

	test('links into each folder that holds a script naming a shader file', () => {
		const folder = folderWith('shaders-wgsl.js');
		const stamps = new Map([[folder, 'a1b2c3d4']]);
		const named = new Set([join(folder, 'shaders-wgsl.js')]);
		const out = folderWith();
		linkShaderFiles([folder], ['assets', 'assets/workers'], out, named, stamps);
		expect(existsSync(join(out, 'assets/shaders-wgsl-a1b2c3d4.js'))).toBe(true);
		expect(existsSync(join(out, 'assets/workers/shaders-wgsl-a1b2c3d4.js'))).toBe(true);
	});
});

describe('the plugin in a build', () => {
	test('names the shader file by the set, links it, and writes no copy under another name', async () => {
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
		const shader = files.find((file) => /^assets\/shaders-wgsl-[0-9a-f]{8}\.js$/.test(file)) ?? '';
		expect(shader).not.toBe('');
		// The set's own file is linked under the name the address carries, and no plain copy is left.
		expect(files).not.toContain('assets/shaders-wgsl.js');
		const script = files.find((file) => /^assets\/index-.*\.js$/.test(file)) ?? '';
		expect(readFileSync(join(out, script), 'utf8')).toContain(
			`./${shader.slice('assets/'.length)}`,
		);
	});
});
