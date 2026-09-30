import { describe, expect, it } from 'bun:test';
import {
	type BuiltFile,
	DOWNLOADS,
	downloadSizes,
	ENGINE_SOURCE,
	findEngineParts,
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
		expect(REPORTED_FILES).toContain('js/render-worker-webgpu.js');
		expect(REPORTED_FILES).toContain('js/render-worker-webgl2.js');
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

	it('names by a module that several files hold the file that earlier parts leave', () => {
		const ordered = [
			{ name: 'page.js', module: 'page/engine.ts' },
			{ name: 'fast-worker.js', module: 'workers/fast-worker.ts' },
			{ name: 'worker.js', module: 'workers/worker.ts' },
		];
		const fast = built('fast-F1.js', ['workers/worker.ts', 'workers/fast-worker.ts']);
		const found = findEngineParts([page, fast, worker], ordered);
		expect(found.get('fast-worker.js')?.file).toBe('fast-F1.js');
		expect(found.get('worker.js')?.file).toBe('worker-W1.js');
	});

	it('finds a file that another file loaded on demand imports', () => {
		const chain = [
			...parts,
			{ name: 'worker-shared.js', module: 'render/shared.ts', loadedBy: 'worker-renderer.js' },
		];
		const renderer = built('draw-W2.js', ['render/draw.ts'], 'from"./shared-W3.js"');
		const shared = built('shared-W3.js', ['render/shared.ts']);
		const found = findEngineParts([page, pageRenderer, worker, renderer, shared], chain);
		expect(found.get('worker-shared.js')?.file).toBe('shared-W3.js');
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

	it("fails when a part's file also holds a page's own code", () => {
		const mixed = built('engine-T1.js', ['page/engine.ts'], '', ['tests/pages/engine.ts']);
		expect(() => findEngineParts([mixed, worker], parts)).toThrow(
			"page.js (engine-T1.js) also holds a page's own code (tests/pages/engine.ts)",
		);
	});
});

describe('DOWNLOADS', () => {
	it('gives each thread mode on each GPU path, with the renderers of that path only', () => {
		expect(DOWNLOADS.map(({ mode }) => mode)).toEqual(
			['WebGPU', 'WebGL2'].flatMap((path) =>
				['pipelined', 'low latency', 'drawing on the main thread', 'single-threaded'].map(
					(mode) => `${mode}, ${path}`,
				),
			),
		);
		for (const { mode, parts } of DOWNLOADS) {
			const other = mode.endsWith('WebGPU') ? 'webgl2' : 'webgpu';
			expect(parts.filter((part) => part.includes(other))).toEqual([]);
			for (const part of parts) expect(REPORTED_FILES).toContain(`js/${part}`);
		}
	});
});

describe('downloadSizes', () => {
	it("adds up each mode's parts, and counts a part the build lacks as nothing", () => {
		const sizes = new Map([
			['page.js', { raw: 100, brotli: 40 }],
			['worker.js', { raw: 50, brotli: 20 }],
		]);
		const downloads = [
			{ mode: 'both', parts: ['page.js', 'worker.js'] },
			{ mode: 'page only', parts: ['page.js', 'page-renderer.js'] },
		];
		expect(downloadSizes(sizes, downloads)).toEqual([
			{ mode: 'both', size: { raw: 150, brotli: 60 } },
			{ mode: 'page only', size: { raw: 100, brotli: 40 } },
		]);
	});
});
