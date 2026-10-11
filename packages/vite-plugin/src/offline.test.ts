import { describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Rollup } from 'vite';
import { fixture } from '../../../tools/lib/fixture';
import {
	engineModule,
	FEATURE_MODULES,
	featureOf,
	type ListedFile,
	listedFiles,
	offlineFiles,
	type WorkerFile,
	workerFilesPlugin,
} from './offline';
import { null3dPackages } from './package-files';

/** A file of a build with nothing in it but the given fields. */
function file(fileName: string, fields: Partial<ListedFile> = {}): ListedFile {
	return { fileName, entry: false, modules: [], imports: [], loads: [], ...fields };
}

describe('featureOf', () => {
	it("names each shader feature as createEngine's preload does", () => {
		expect(featureOf('generated/shaders-skinning-glsl-draw-index-tone-map-half')).toBe('skinning');
		expect(featureOf('generated/shaders-instance-index-wgsl')).toBe('instance_index');
		expect(featureOf('generated/shaders-sky-wgsl-tone-map')).toBe('sky');
	});

	it("puts the start's shader modules and the other engine modules in the start", () => {
		expect(featureOf('generated/shaders-glsl-draw-index-half')).toBeUndefined();
		expect(featureOf('generated/shaders-wgsl')).toBeUndefined();
		expect(featureOf('generated/shaders')).toBeUndefined();
		expect(featureOf('workers/job-worker')).toBeUndefined();
	});

	it('names the features of the loaders', () => {
		expect(featureOf('scene/gltf-meshopt')).toBe('gltf');
		expect(featureOf('vendor/basis/basis_transcoder.wasm')).toBe('ktx2');
		expect(featureOf('scene/panorama')).toBe('environment');
		expect(featureOf('generated/shaders-environment-glsl')).toBe('environment');
	});

	it("names modules that the engine's source holds", () => {
		const engine = join(import.meta.dirname, '../../engine');
		for (const modules of Object.values(FEATURE_MODULES))
			for (const module of modules) {
				const path = module.endsWith('.wasm')
					? module
					: module.startsWith('vendor/')
						? `${module}.js`
						: `src/${module}.ts`;
				expect(`${module}: ${existsSync(join(engine, path))}`).toBe(`${module}: true`);
			}
	});
});

describe('engineModule', () => {
	const root = fixture({
		'app/node_modules/@null3d/engine/package.json': '{"name":"@null3d/engine"}',
		'app/node_modules/@null3d/controls/package.json': '{"name":"@null3d/controls"}',
		'repo/packages/engine/package.json': '{"name":"@null3d/engine"}',
	});
	const packageOf = null3dPackages();

	it("names a module by its path in the engine's source or built folder", () => {
		const installed = join(root, 'app/node_modules/@null3d/engine');
		expect(engineModule(join(installed, 'lib/scene/ktx2.js'), packageOf)).toBe('scene/ktx2');
		expect(engineModule(join(installed, 'dist/wasm/single/null3d_bg.wasm'), packageOf)).toBe(
			'dist/wasm/single/null3d_bg.wasm',
		);
		const source = join(root, 'repo/packages/engine');
		expect(engineModule(join(source, 'src/scene/ktx2.ts?worker'), packageOf)).toBe('scene/ktx2');
	});

	it("leaves out other packages' modules, the project's and virtual ones", () => {
		const controls = join(root, 'app/node_modules/@null3d/controls/lib/orbit.js');
		expect(engineModule(controls, packageOf)).toBeUndefined();
		expect(engineModule(join(root, 'app/src/main.ts'), packageOf)).toBeUndefined();
		expect(engineModule('\0vite/preload-helper.js', packageOf)).toBeUndefined();
	});
});

describe('offlineFiles', () => {
	/**
	 * A small build: a page, its script, the engine's worker, the start's shader module and the
	 * skinning one, a chunk of the KTX2 loader with the transcoder, and the glTF loader, which shares
	 * a chunk with the KTX2 loader and imports the KTX2 loader on demand.
	 */
	const build = [
		file('index.html', { entry: true, text: '<script src="/assets/index-a1.js"></script>' }),
		file('assets/index-a1.js', {
			entry: true,
			imports: ['assets/src-b2.js'],
			text: 'new Worker(new URL("./worker-c3.js", import.meta.url))',
		}),
		file('assets/src-b2.js', { modules: ['index'] }),
		file('assets/worker-c3.js', {
			modules: ['workers/sketch-worker'],
			loads: ['assets/ktx2-d4.js', 'assets/gltf-g7.js'],
			text: '"./shaders-wgsl-e5.js" "./shaders-skinning-wgsl-f6.js"',
		}),
		file('assets/shaders-wgsl-e5.js', { modules: ['generated/shaders-wgsl'] }),
		file('assets/shaders-skinning-wgsl-f6.js', { modules: ['generated/shaders-skinning-wgsl'] }),
		file('assets/ktx2-d4.js', {
			modules: ['scene/ktx2'],
			imports: ['assets/tasks-h8.js'],
			text: '"./basis_transcoder-i9.wasm"',
		}),
		file('assets/basis_transcoder-i9.wasm', { modules: ['vendor/basis/basis_transcoder.wasm'] }),
		file('assets/tasks-h8.js', { modules: ['shared/tasks'] }),
		file('assets/gltf-g7.js', {
			modules: ['scene/gltf'],
			imports: ['assets/tasks-h8.js'],
			loads: ['assets/ktx2-d4.js'],
		}),
		file('assets/index-a1.js.map'),
		file('assets/stray-j0.txt'),
	];

	it("lists the start's files and each feature's own", () => {
		const list = offlineFiles(build);
		expect(list.start).toEqual([
			'assets/index-a1.js',
			'assets/shaders-wgsl-e5.js',
			'assets/src-b2.js',
			'assets/stray-j0.txt',
			'assets/worker-c3.js',
			'index.html',
		]);
		expect(list.features).toEqual({
			gltf: ['assets/gltf-g7.js', 'assets/tasks-h8.js'],
			ktx2: ['assets/basis_transcoder-i9.wasm', 'assets/ktx2-d4.js', 'assets/tasks-h8.js'],
			skinning: ['assets/shaders-skinning-wgsl-f6.js'],
		});
	});

	it("keeps a feature's file in the start when a start file imports it statically", () => {
		const imported = build.map((f) =>
			f.fileName === 'assets/src-b2.js' ? { ...f, imports: ['assets/ktx2-d4.js'] } : f,
		);
		const list = offlineFiles(imported);
		expect(list.start).toContain('assets/ktx2-d4.js');
		expect(list.start).toContain('assets/tasks-h8.js');
		expect(list.features.ktx2).toEqual(['assets/basis_transcoder-i9.wasm']);
	});

	it("puts both GPU paths' renderers and their shared code in the start", () => {
		// The render worker loads one GPU path's renderers on demand, and starts the code that both
		// paths share beside them; each path's file imports that shared file.
		const worker = 'assets/render-worker-m2.js';
		const paths = ['assets/webgpu-renderers-n3.js', 'assets/webgl2-renderers-o4.js'];
		const shared = 'assets/scene-renderer-p5.js';
		const drawing = [
			...build.map((f) =>
				f.fileName === 'assets/index-a1.js'
					? {
							...f,
							text: `${f.text} new Worker(new URL("./render-worker-m2.js", import.meta.url))`,
						}
					: f,
			),
			file(worker, {
				modules: ['workers/render-worker'],
				loads: [...paths, shared],
				text: '"./shaders-wgsl-e5.js"',
			}),
			...paths.map((name, i) =>
				file(name, {
					modules: [i === 0 ? 'render/webgpu-renderers' : 'render/webgl2-renderers'],
					imports: [worker, shared],
				}),
			),
			file(shared, { modules: ['render/scene-renderer'], imports: [worker] }),
		];
		const list = offlineFiles(drawing);
		for (const name of [worker, ...paths, shared]) expect(list.start).toContain(name);
		for (const files of Object.values(list.features))
			for (const name of [...paths, shared]) expect(files).not.toContain(name);
	});

	it('gives a version that changes with the files', () => {
		const renamed = build.map((f) =>
			f.fileName === 'assets/stray-j0.txt' ? { ...f, fileName: 'assets/stray-k1.txt' } : f,
		);
		expect(offlineFiles(build).version).toBe(offlineFiles(build).version);
		expect(offlineFiles(renamed).version).not.toBe(offlineFiles(build).version);
	});
});

describe('listedFiles', () => {
	const root = fixture({ 'node_modules/@null3d/engine/package.json': '{"name":"@null3d/engine"}' });
	const engine = join(root, 'node_modules/@null3d/engine');
	const chunk = (fileName: string, code: string, fields: object = {}) =>
		({
			type: 'chunk',
			fileName,
			code,
			isEntry: false,
			moduleIds: [],
			imports: [],
			dynamicImports: [],
			...fields,
		}) as unknown as Rollup.OutputChunk;
	const asset = (fileName: string, source: string, originalFileNames: string[] = []) =>
		({ type: 'asset', fileName, source, originalFileNames }) as unknown as Rollup.OutputAsset;

	it("reads each worker build's record, and leaves out the list of files to fetch beside an import", () => {
		const workerFiles = new Map<string, WorkerFile>();
		const plugin = workerFilesPlugin(workerFiles);
		const workerBundle = {
			'assets/sketch-worker-a.js': chunk('assets/sketch-worker-a.js', '', {
				moduleIds: [join(engine, 'lib/workers/sketch-worker.js')],
				dynamicImports: ['assets/ktx2-b.js'],
			}),
		};
		(plugin.generateBundle as (o: object, b: object) => void)({}, workerBundle);
		const bundle = {
			'assets/sketch-worker-a.js': asset(
				'assets/sketch-worker-a.js',
				'const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/tasks-c.js"])))=>i.map(i=>d[i]);import("./ktx2-b.js")',
			),
			'assets/shaders-wgsl-d.js': asset('assets/shaders-wgsl-d.js', 'const PART_0 = 1;', [
				'node_modules/@null3d/engine/lib/generated/shaders-wgsl.js',
			]),
			'assets/main-e.js': chunk('assets/main-e.js', 'x', { isEntry: true }),
		} as Rollup.OutputBundle;
		const files = listedFiles(bundle, workerFiles, null3dPackages(), root);
		expect(files).toEqual([
			{
				fileName: 'assets/sketch-worker-a.js',
				entry: false,
				modules: ['workers/sketch-worker'],
				imports: [],
				loads: ['assets/ktx2-b.js'],
				text: 'import("./ktx2-b.js")',
			},
			{
				fileName: 'assets/shaders-wgsl-d.js',
				entry: false,
				modules: ['generated/shaders-wgsl'],
				imports: [],
				loads: [],
				text: undefined,
			},
			{
				fileName: 'assets/main-e.js',
				entry: true,
				modules: [],
				imports: [],
				loads: [],
				text: 'x',
			},
		]);
	});
});
