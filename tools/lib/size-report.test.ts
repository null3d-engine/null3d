import { describe, expect, it } from 'bun:test';
import {
	type BuiltFile,
	budgetProblems,
	DOWNLOADS,
	downloadSizes,
	ENGINE_SOURCE,
	findEngineParts,
	findTranscoderFiles,
	LATER_BUDGET_BYTES,
	LATER_PARTS,
	measure,
	ON_DEMAND_SHADER_BUDGET_BYTES,
	REPORTED_FILES,
	START_BUDGET_BYTES,
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

describe('LATER_PARTS', () => {
	it('holds the parts that load on first use or after the first frame, and no part of a start', () => {
		const names = LATER_PARTS.map(({ name }) => name);
		expect(names).toContain('page-gltf.js');
		expect(names).toContain('gltf-worker.js');
		expect(names).toContain('sketch-worker-ktx2.js');
		expect(names).toContain('page-stats-overlay.js');
		expect(names).toContain('sketch-worker-preset-check.js');
		for (const { parts } of DOWNLOADS) for (const part of parts) expect(names).not.toContain(part);
	});

	it('marks the preset check as the only part that loads after the first frame', () => {
		const after = LATER_PARTS.filter(({ afterFirstFrame }) => afterFirstFrame);
		expect(after.map(({ module }) => module)).toEqual([
			'sketch/preset-check.ts',
			'sketch/preset-check.ts',
		]);
	});
});

describe('budgetProblems', () => {
	const downloads = [{ mode: 'pipelined', parts: ['page.js', 'worker.js'], shaders: 'shaders-' }];
	const later = [{ name: 'page-gltf.js', module: 'scene/gltf.ts', loadedBy: 'page.js' }];
	const sizes = (start: number, chunk: number) =>
		new Map([
			['page.js', { raw: 0, brotli: start - 1000 }],
			['worker.js', { raw: 0, brotli: 600 }],
			['shaders-wgsl.js', { raw: 0, brotli: 400 }],
			['page-gltf.js', { raw: 0, brotli: chunk }],
		]);

	it('passes a start and a later part at their budgets', () => {
		expect(START_BUDGET_BYTES).toBe(140 * 1024);
		expect(LATER_BUDGET_BYTES).toBe(16 * 1024);
		expect(budgetProblems(sizes(START_BUDGET_BYTES, LATER_BUDGET_BYTES), downloads, later)).toEqual(
			[],
		);
	});

	it('holds shader modules of on-demand features to their own budget, which no start counts', () => {
		const morph = 'shaders-glsl-morph.js';
		const within = new Map([
			...sizes(START_BUDGET_BYTES, 0),
			[morph, { raw: 0, brotli: ON_DEMAND_SHADER_BUDGET_BYTES }],
		]);
		expect(budgetProblems(within, downloads, later, [morph])).toEqual([]);
		expect(downloadSizes(within, downloads)[0]?.size.brotli).toBe(START_BUDGET_BYTES);
		const over = new Map([
			...within,
			[morph, { raw: 0, brotli: ON_DEMAND_SHADER_BUDGET_BYTES + 1 }],
		]);
		expect(budgetProblems(over, downloads, later, [morph])).toEqual([
			'js/shaders-glsl-morph.js, the shader builds of a feature that loads on demand, is 24,577 bytes after Brotli, over its 24 KB budget',
		]);
	});

	it('names a start over its budget, and a later part over its own, which no start counts', () => {
		expect(
			budgetProblems(sizes(START_BUDGET_BYTES + 1, LATER_BUDGET_BYTES + 1), downloads, later),
		).toEqual([
			'the engine JavaScript that a page downloads at its start in pipelined mode is 143,361 bytes after Brotli, over its 140 KB budget',
			'js/page-gltf.js, which loads after the start, is 16,385 bytes after Brotli, over its 16 KB budget',
		]);
	});
});
