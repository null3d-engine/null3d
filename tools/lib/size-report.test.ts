import { describe, expect, it } from 'bun:test';
import {
	type BuiltFile,
	downloadSizes,
	ENGINE_SOURCE,
	findEngineParts,
	findTranscoderFiles,
	measure,
	REPORTED_FILES,
} from './size-report';

describe('measure', () => {
	it('measures raw and Brotli sizes', () => {
		const size = measure(Buffer.alloc(10_000, 7));
		expect(size.raw).toBe(10_000);
		expect(size.brotli).toBeLessThan(100);
	});
});

describe('REPORTED_FILES', () => {
	it("names each core build's module and glue, then each part of the engine's JavaScript", () => {
		expect(REPORTED_FILES.slice(0, 4)).toEqual([
			'threaded/null3d_bg.wasm',
			'threaded/null3d.js',
			'single/null3d_bg.wasm',
			'single/null3d.js',
		]);
		expect(REPORTED_FILES).toContain('js/page.js');
		expect(REPORTED_FILES).toContain('js/render-worker.js');
		expect(REPORTED_FILES).toContain('js/shaders-glsl-draw-index.js');
		expect(REPORTED_FILES.slice(-3)).toEqual([
			'ktx2/transcoder-worker.js',
			'ktx2/basis_transcoder.js',
			'ktx2/basis_transcoder.wasm',
		]);
	});
});

describe('findTranscoderFiles', () => {
	const names = [
		'basis_transcoder-JKal9Vjx.js',
		'null3d_bg-58dKJVnh.wasm',
		'transcoder-worker-D9ygJP1J.js',
		'basis_transcoder-DBaCnI5p.wasm',
		'ktx2-Cl41QH8w.js',
	];

	it("finds the build's copy of each of the transcoder's files by its name and hash", () => {
		expect([...findTranscoderFiles(names)]).toEqual([
			['transcoder-worker.js', 'transcoder-worker-D9ygJP1J.js'],
			['basis_transcoder.js', 'basis_transcoder-JKal9Vjx.js'],
			['basis_transcoder.wasm', 'basis_transcoder-DBaCnI5p.wasm'],
		]);
	});

	it('fails when a file is missing or there twice', () => {
		expect(() => findTranscoderFiles(names.slice(1))).toThrow(
			"basis_transcoder.js: expected one built copy of the KTX2 transcoder's file, found 0",
		);
		expect(() => findTranscoderFiles([...names, 'basis_transcoder-Ab_-cdEf.wasm'])).toThrow(
			'found 2',
		);
	});
});

/** A built file that holds the given engine modules and, after them, other sources. */
function built(file: string, modules: string[], text = '', others: string[] = []): BuiltFile {
	return { file, text, sources: [...modules.map((m) => ENGINE_SOURCE + m), ...others] };
}

describe('findEngineParts', () => {
	const parts = [
		{ name: 'page.js', module: 'page/engine.ts' },
		{ name: 'page-renderer.js', module: 'render/draw.ts', loadedBy: 'page.js' },
		{ name: 'worker.js', module: 'workers/worker.ts' },
		{ name: 'worker-renderer.js', module: 'render/draw.ts', loadedBy: 'worker.js' },
	];
	const page = built('src-A1.js', ['page/engine.ts'], 'import("./draw-P1.js")');
	const worker = built('worker-W1.js', ['workers/worker.ts'], 'import("./draw-W2.js")');
	const pageRenderer = built('draw-P1.js', ['render/draw.ts', 'gpu/backend.ts']);
	const workerRenderer = built('draw-W2.js', ['render/draw.ts', 'gpu/backend.ts']);
	const testPage = built('engine-T1.js', [], 'from"./src-A1.js"', ['tests/pages/engine.ts']);

	it('names each file by the engine module it holds, and a file loaded on demand by its loader', () => {
		const found = findEngineParts([testPage, workerRenderer, page, pageRenderer, worker], parts);
		expect([...found].map(([name, file]) => [name, file.file])).toEqual([
			['page.js', 'src-A1.js'],
			['page-renderer.js', 'draw-P1.js'],
			['worker.js', 'worker-W1.js'],
			['worker-renderer.js', 'draw-W2.js'],
		]);
	});

	it('leaves out a part loaded on demand that the build bundles into its loader', () => {
		const eager = built('worker-W1.js', ['workers/worker.ts', 'render/draw.ts']);
		const found = findEngineParts([page, pageRenderer, eager], parts);
		expect([...found.keys()]).toEqual(['page.js', 'page-renderer.js', 'worker.js']);
	});

	it('fails when a part has no file, or when a file holds engine code that no part names', () => {
		expect(() => findEngineParts([page, pageRenderer], parts)).toThrow(
			'worker.js: expected one built file that holds workers/worker.ts, found 0',
		);
		const stray = built('stray-S1.js', ['scene/scene.ts']);
		expect(() => findEngineParts([page, worker, stray], parts)).toThrow(
			'stray-S1.js holds engine code that the size report does not name',
		);
	});

	it("names each file of the shader build's device modules after its module, by its largest copy", () => {
		const shaders = ['shaders-wgsl.js', 'shaders-glsl.js'];
		const wgsl = built('shaders-wgsl-P1.js', ['generated/shaders-wgsl.ts'], 'wgsl');
		const wgslCopy = built('shaders-wgsl-W1.js', ['generated/shaders-wgsl.ts'], 'wgsl, longer');
		const glsl = built('shaders-glsl-W2.js', ['generated/shaders-glsl.ts'], 'glsl');
		const files = [page, pageRenderer, worker, workerRenderer, wgsl, glsl, wgslCopy];
		const found = findEngineParts(files, parts, shaders);
		expect([...found].slice(4).map(([name, file]) => [name, file.file])).toEqual([
			['shaders-wgsl.js', 'shaders-wgsl-W1.js'],
			['shaders-glsl.js', 'shaders-glsl-W2.js'],
		]);
		const skin = built('shaders-glsl-skin-W3.js', ['generated/shaders-glsl-skin.ts']);
		expect(() => findEngineParts([...files, skin], parts, shaders)).toThrow(
			"shaders-glsl-skin-W3.js holds the shader build's device module of shaders-glsl-skin.js, which the size report does not name",
		);
	});

	it("fails when a part's file also holds a page's own code", () => {
		const mixed = built('engine-T1.js', ['page/engine.ts'], '', ['tests/pages/engine.ts']);
		expect(() => findEngineParts([mixed, worker], parts)).toThrow(
			"page.js (engine-T1.js) also holds a page's own code (tests/pages/engine.ts)",
		);
	});
});

describe('downloadSizes', () => {
	it("adds up each mode's parts, and counts a part the build lacks as nothing", () => {
		const sizes = new Map([
			['page.js', { raw: 100, brotli: 40 }],
			['worker.js', { raw: 50, brotli: 20 }],
		]);
		const downloads = [
			{ mode: 'both', parts: ['page.js', 'worker.js'], shaders: 'shaders-' },
			{ mode: 'page only', parts: ['page.js', 'page-renderer.js'], shaders: 'shaders-' },
		];
		expect(downloadSizes(sizes, downloads)).toEqual([
			{ mode: 'both', size: { raw: 150, brotli: 60 } },
			{ mode: 'page only', size: { raw: 100, brotli: 40 } },
		]);
	});

	it('adds the largest of the shader parts that a mode may load', () => {
		const sizes = new Map([
			['page.js', { raw: 100, brotli: 40 }],
			['shaders-wgsl.js', { raw: 30, brotli: 5 }],
			['shaders-glsl.js', { raw: 60, brotli: 9 }],
			['shaders-glsl-draw-index.js', { raw: 61, brotli: 10 }],
		]);
		const downloads = [
			{ mode: 'WebGPU', parts: ['page.js'], shaders: 'shaders-wgsl' },
			{ mode: 'WebGL2', parts: ['page.js'], shaders: 'shaders-glsl' },
		];
		expect(downloadSizes(sizes, downloads)).toEqual([
			{ mode: 'WebGPU', size: { raw: 130, brotli: 45 } },
			{ mode: 'WebGL2', size: { raw: 161, brotli: 50 } },
		]);
	});
});
