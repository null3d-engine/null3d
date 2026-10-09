import { describe, expect, it } from 'bun:test';
import MagicString from 'magic-string';
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
