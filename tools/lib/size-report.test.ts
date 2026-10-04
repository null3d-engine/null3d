import { describe, expect, it } from 'bun:test';
import {
	type BuiltFile,
	budgetProblems,
	DOWNLOADS,
	downloadSizes,
	ENGINE_SOURCE,
	FIRST_USE_SHADER_BUDGET,
	findEngineParts,
	findTranscoderFiles,
	isFirstUseShaderPart,
	LATER_BUDGET,
	LATER_PARTS,
	measure,
	REPORTED_FILES,
	type SizeEntry,
	START_BUDGET,
} from './size-report';

/** A size with the same figure in each column, or a figure for each. */
const size = (raw: number, gzip = raw, brotli = raw): SizeEntry => ({ raw, gzip, brotli });

describe('measure', () => {
	it('measures raw, gzip and Brotli sizes', () => {
		const measured = measure(Buffer.alloc(10_000, 7));
		expect(measured.raw).toBe(10_000);
		expect(measured.gzip).toBeLessThan(100);
		expect(measured.brotli).toBeLessThan(100);
	});

	it("finds repeats beyond gzip's 32 KB window only with Brotli", () => {
		let seed = 1;
		const noise = () => {
			seed ^= seed << 13;
			seed ^= seed >>> 17;
			seed ^= seed << 5;
			return seed & 0xff;
		};
		const block = Buffer.from(Array.from({ length: 40_000 }, noise));
		const measured = measure(Buffer.concat([block, block]));
		expect(measured.gzip).toBeGreaterThan(70_000);
		expect(measured.brotli).toBeLessThan(measured.gzip / 1.8);
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
		const wgsl = built('shaders-wgsl-P1.js', ['generated/shaders-wgsl.js'], 'wgsl');
		const wgslCopy = built('shaders-wgsl-W1.js', ['generated/shaders-wgsl.js'], 'wgsl, longer');
		const glsl = built('shaders-glsl-W2.js', ['generated/shaders-glsl.js'], 'glsl');
		const files = [page, pageRenderer, worker, workerRenderer, wgsl, glsl, wgslCopy];
		const found = findEngineParts(files, parts, shaders);
		expect([...found].slice(4).map(([name, file]) => [name, file.file])).toEqual([
			['shaders-wgsl.js', 'shaders-wgsl-W1.js'],
			['shaders-glsl.js', 'shaders-glsl-W2.js'],
		]);
		const skin = built('shaders-glsl-skin-W3.js', ['generated/shaders-glsl-skin.js']);
		expect(() => findEngineParts([...files, skin], parts, shaders)).toThrow(
			"shaders-glsl-skin-W3.js holds the shader build's device module of shaders-glsl-skin.js, which the size report does not name",
		);
	});

	it("names the files of each feature's shader modules after their modules, after the start's", () => {
		const shaders = ['shaders-wgsl.js'];
		const wgsl = built('shaders-wgsl-P1.js', ['generated/shaders-wgsl.js'], 'wgsl');
		const bloom = built('shaders-bloom-wgsl-P2.js', ['generated/shaders-bloom-wgsl.js'], 'b');
		const sprites = built(
			'shaders-sprites-glsl-draw-index-P3.js',
			['generated/shaders-sprites-glsl-draw-index.js'],
			's',
		);
		const files = [page, pageRenderer, worker, workerRenderer, sprites, wgsl, bloom];
		const found = findEngineParts(files, parts, shaders);
		expect([...found.keys()].slice(4)).toEqual([
			'shaders-wgsl.js',
			'shaders-bloom-wgsl.js',
			'shaders-sprites-glsl-draw-index.js',
		]);
	});

	it("fails when a part's file also holds a page's own code", () => {
		const mixed = built('engine-T1.js', ['page/engine.ts'], '', ['tests/pages/engine.ts']);
		expect(() => findEngineParts([mixed, worker], parts)).toThrow(
			"page.js (engine-T1.js) also holds a page's own code (tests/pages/engine.ts)",
		);
	});
});

describe('isFirstUseShaderPart', () => {
	it("is true for a feature's shader modules and false for the start's", () => {
		for (const part of [
			'shaders-sprites-glsl-draw-index.js',
			'shaders-bloom-wgsl.js',
			'shaders-occlusion-culling-wgsl-half.js',
		])
			expect(isFirstUseShaderPart(part)).toBe(true);
		for (const part of [
			'shaders-wgsl.js',
			'shaders-glsl-draw-index-tone-map.js',
			'shaders-glsl-skin.js',
			'shaders.js',
		])
			expect(isFirstUseShaderPart(part)).toBe(false);
	});
});

describe('downloadSizes', () => {
	it("adds up each mode's parts, and counts a part the build lacks as nothing", () => {
		const sizes = new Map([
			['page.js', size(100, 50, 40)],
			['worker.js', size(50, 25, 20)],
		]);
		const downloads = [
			{ mode: 'both', parts: ['page.js', 'worker.js'], shaders: 'shaders-' },
			{ mode: 'page only', parts: ['page.js', 'page-renderer.js'], shaders: 'shaders-' },
		];
		expect(downloadSizes(sizes, downloads)).toEqual([
			{ mode: 'both', size: size(150, 75, 60) },
			{ mode: 'page only', size: size(100, 50, 40) },
		]);
	});

	it('adds the largest of the shader parts that a mode may load, in each column', () => {
		const sizes = new Map([
			['page.js', size(100, 50, 40)],
			['shaders-wgsl.js', size(30, 8, 5)],
			['shaders-glsl.js', size(60, 21, 9)],
			['shaders-glsl-draw-index.js', size(61, 20, 10)],
		]);
		const downloads = [
			{ mode: 'WebGPU', parts: ['page.js'], shaders: 'shaders-wgsl' },
			{ mode: 'WebGL2', parts: ['page.js'], shaders: 'shaders-glsl' },
		];
		expect(downloadSizes(sizes, downloads)).toEqual([
			{ mode: 'WebGPU', size: size(130, 58, 45) },
			{ mode: 'WebGL2', size: size(161, 71, 50) },
		]);
	});

	it("counts no feature's shader module, which loads on first use", () => {
		const sizes = new Map([
			['page.js', size(100, 50, 40)],
			['shaders-wgsl.js', size(30, 8, 5)],
			['shaders-sprites-wgsl.js', size(90, 30, 20)],
		]);
		const downloads = [{ mode: 'pipelined', parts: ['page.js'], shaders: 'shaders-' }];
		expect(downloadSizes(sizes, downloads)).toEqual([
			{ mode: 'pipelined', size: size(130, 58, 45) },
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
	/** Sizes whose start and later part are `start` and `chunk` in each column. */
	const sizes = (start: SizeEntry, chunk: SizeEntry) =>
		new Map([
			['page.js', size(start.raw - 1000, start.gzip - 1000, start.brotli - 1000)],
			['worker.js', size(600)],
			['shaders-wgsl.js', size(400)],
			['page-gltf.js', chunk],
		]);
	const plus = (budget: SizeEntry, extra: Partial<SizeEntry>) =>
		size(
			budget.raw + (extra.raw ?? 0),
			budget.gzip + (extra.gzip ?? 0),
			budget.brotli + (extra.brotli ?? 0),
		);

	it("passes a start and a later part at their budgets, with the owner's Brotli figures", () => {
		expect(START_BUDGET.brotli).toBe(140 * 1024);
		expect(LATER_BUDGET.brotli).toBe(16 * 1024);
		expect(budgetProblems(sizes(START_BUDGET, LATER_BUDGET), downloads, later)).toEqual([]);
	});

	it('names a start over its budget, and a later part over its own, which no start counts', () => {
		expect(
			budgetProblems(
				sizes(plus(START_BUDGET, { brotli: 1 }), plus(LATER_BUDGET, { brotli: 1 })),
				downloads,
				later,
			),
		).toEqual([
			'the engine JavaScript that a page downloads at its start in pipelined mode is 143,361 bytes after Brotli, over its 140 KB budget',
			'js/page-gltf.js, which loads after the start, is 16,385 bytes after Brotli, over its 16 KB budget',
		]);
	});

	it('names each column over its budget: gzip for gzip hosts, raw for hosts that send files as they are', () => {
		const problems = budgetProblems(
			sizes(plus(START_BUDGET, { gzip: 1 }), plus(LATER_BUDGET, { raw: 1 })),
			downloads,
			later,
		);
		expect(problems).toEqual([
			`the engine JavaScript that a page downloads at its start in pipelined mode is ${(START_BUDGET.gzip + 1).toLocaleString('en-US')} bytes after gzip, over its ${START_BUDGET.gzip / 1024} KB budget`,
			`js/page-gltf.js, which loads after the start, is ${(LATER_BUDGET.raw + 1).toLocaleString('en-US')} bytes uncompressed, over its ${LATER_BUDGET.raw / 1024} KB budget`,
		]);
	});

	it("names a feature's shader module over its budget in a column, which no start counts", () => {
		expect(FIRST_USE_SHADER_BUDGET.brotli).toBe(24 * 1024);
		const within = sizes(START_BUDGET, LATER_BUDGET);
		within.set('shaders-bloom-wgsl.js', FIRST_USE_SHADER_BUDGET);
		expect(budgetProblems(within, downloads, later)).toEqual([]);
		within.set('shaders-bloom-wgsl.js', plus(FIRST_USE_SHADER_BUDGET, { brotli: 1 }));
		expect(budgetProblems(within, downloads, later)).toEqual([
			'js/shaders-bloom-wgsl.js, the shader builds of a feature that loads on first use, is 24,577 bytes after Brotli, over its 24 KB budget',
		]);
	});
});
