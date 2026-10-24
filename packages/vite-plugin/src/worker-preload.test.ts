import { describe, expect, it } from 'bun:test';
import MagicString from 'magic-string';
import type { Rollup } from 'vite';
import { emptyWorkerPreloads } from './index';
import { preloadImports, staticImports } from './worker-preload';

/** A worker bundle's chunks: the render worker, which loads either GPU path's file on demand. */
const CHUNKS = {
	'assets/render-worker.js': { imports: [] },
	'assets/webgpu.js': { imports: ['assets/render-worker.js', 'assets/shared.js'] },
	'assets/webgl2.js': { imports: ['assets/render-worker.js', 'assets/shared.js'] },
	'assets/shared.js': { imports: ['assets/render-worker.js'] },
	'assets/joiner.js': { imports: ['assets/render-worker.js'] },
};

/** The code of a chunk after the rewrite, or undefined when nothing changed. */
function rewrite(code: string, fileName = 'assets/render-worker.js'): string | undefined {
	const edited = new MagicString(code);
	return preloadImports(edited, fileName, CHUNKS) ? edited.toString() : undefined;
}

describe('staticImports', () => {
	it('gives a chunk with every chunk it imports, directly or through others', () => {
		expect([...staticImports('assets/webgpu.js', CHUNKS)].sort()).toEqual([
			'assets/render-worker.js',
			'assets/shared.js',
			'assets/webgpu.js',
		]);
	});
});

describe('preloadImports', () => {
	it("starts a file's imports that the chunk lacks together with the file", () => {
		expect(rewrite('const a=()=>import(`./webgpu.js`),b=()=>import("./webgl2.js");')).toBe(
			'const a=()=>(import(`./shared.js`).catch(()=>{}),import(`./webgpu.js`)),' +
				'b=()=>(import("./shared.js").catch(()=>{}),import("./webgl2.js"));',
		);
	});

	it('leaves an import alone when the chunk has loaded all that its file imports', () => {
		expect(rewrite('const j=()=>import(`./joiner.js`);')).toBeUndefined();
		expect(rewrite('const j=()=>import(`./joiner.js`);', 'assets/shared.js')).toBeUndefined();
	});

	it('leaves an import of a file outside the bundle alone', () => {
		expect(rewrite('const s=()=>import(`./sketch.js`);')).toBeUndefined();
	});

	it('names each file from the folder of the chunk that imports it', () => {
		const chunks = {
			'w/entry.js': { imports: [] },
			'w/paths/webgpu.js': { imports: ['w/entry.js', 'w/common/shared.js'] },
			'w/common/shared.js': { imports: [] },
		};
		const edited = new MagicString('import(`./paths/webgpu.js`)');
		expect(preloadImports(edited, 'w/entry.js', chunks)).toBe(true);
		expect(edited.toString()).toBe(
			'(import(`./common/shared.js`).catch(()=>{}),import(`./paths/webgpu.js`))',
		);
	});
});

describe('emptyWorkerPreloads', () => {
	it('empties the preload lists of a worker chunk and the chunks it imports', () => {
		const chunk = (code: string, imports: string[] = [], dynamicImports: string[] = []) =>
			({ type: 'chunk', imports, dynamicImports, code }) as unknown as Rollup.OutputChunk;
		const bundle = {
			'assets/sketch.js': chunk(
				'const a=__vitePreload(()=>import("./x.js"),__vite__mapDeps([0,1]),import.meta.url);',
				['assets/common.js'],
			),
			'assets/common.js': chunk(
				'const b=__vitePreload(()=>import("./task.js"),__vite__mapDeps([2,3]));',
				[],
				['assets/task.js'],
			),
			'assets/task.js': chunk('export function run() {}'),
			'assets/page.js': chunk('const c=__vitePreload(()=>import("./y.js"),__vite__mapDeps([4]));'),
		} as unknown as Rollup.OutputBundle;
		emptyWorkerPreloads(bundle, ['assets/sketch.js']);
		const code = (file: string) => (bundle[file] as Rollup.OutputChunk).code;
		expect(code('assets/sketch.js')).not.toContain('__vite__mapDeps(');
		expect(code('assets/common.js')).not.toContain('__vite__mapDeps(');
		// A chunk that no worker imports keeps its lists, so the page still preloads.
		expect(code('assets/page.js')).toContain('__vite__mapDeps([4])');
	});
});
