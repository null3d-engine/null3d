import { describe, expect, it } from 'bun:test';
import type { Rollup, UserConfig } from 'vite';
import { fixture } from '../../../tools/lib/fixture';
import null3d, { CORE_FILES, earlyCoreTag, missingCoreFiles } from './index';

/** A project with the engine package installed, holding the given core files. */
function project(files: readonly string[]): string {
	const engine = 'node_modules/@null3d/engine';
	return fixture({
		'package.json': '{"name":"demo","private":true}',
		[`${engine}/package.json`]: JSON.stringify({
			name: '@null3d/engine',
			exports: {
				'.': './lib/index.js',
				'./wasm/*': './dist/wasm/*',
				'./package.json': './package.json',
			},
		}),
		[`${engine}/lib/index.js`]: '',
		...Object.fromEntries(files.map((file) => [`${engine}/dist/wasm/${file}`, 'x'])),
	});
}

describe('missingCoreFiles', () => {
	it('is null when the project does not install the engine', () => {
		expect(missingCoreFiles(fixture({ 'package.json': '{}' }))).toBeNull();
	});

	it('lists each core file the engine package lacks', () => {
		expect(missingCoreFiles(project([]))).toEqual([...CORE_FILES]);
		expect(missingCoreFiles(project(CORE_FILES.slice(1)))).toEqual(CORE_FILES.slice(0, 1));
		expect(missingCoreFiles(project(CORE_FILES))).toEqual([]);
	});
});

describe('the HTTPS server', () => {
	it('serves HTTP/1.1 only, with the certificate from the certificate folder', () => {
		const root = fixture({ 'cert/cert.pem': 'CERT', 'cert/key.pem': 'KEY' });
		const plugin = null3d({ https: true, certDir: 'cert' });
		const config = (plugin.config as (c: object, e: object) => UserConfig)(
			{ root },
			{ mode: 'development', command: 'serve' },
		);
		for (const server of [config.server, config.preview]) {
			const https = server?.https as { cert: Buffer; ALPNCallback: () => string };
			expect(String(https.cert)).toBe('CERT');
			expect(https.ALPNCallback()).toBe('http/1.1');
		}
	});
});

describe('earlyCoreTag', () => {
	const chunk = (fileName: string, code: string, imports: string[] = []) =>
		({ type: 'chunk', fileName, code, imports }) as unknown as Rollup.OutputChunk;
	const asset = (fileName: string) =>
		({ type: 'asset', fileName }) as unknown as Rollup.OutputAsset;
	const early = chunk(
		'assets/early-core-AbCd1234.js',
		'new URL("null3d_bg-Thr00000.wasm",import.meta.url);new URL("null3d_bg-Sgl00000.wasm",import.meta.url)',
	);
	const page = chunk('assets/page-AbCd1234.js', 'import "./engine-AbCd1234.js"', [
		'assets/engine-AbCd1234.js',
	]);
	const bundle = (engineCode: string): Rollup.OutputBundle =>
		Object.fromEntries(
			[
				early,
				page,
				chunk('assets/engine-AbCd1234.js', engineCode),
				asset('assets/null3d_bg-Thr00000.wasm'),
				asset('assets/null3d_bg-Sgl00000.wasm'),
				asset('assets/other-Xy000000.wasm'),
			].map((file) => [file.fileName, file]),
		);
	const loadsCore = bundle('fetch(new URL("null3d_bg-Thr00000.wasm",import.meta.url))');

	it('adds the early script to a page whose chunks load the core, first in its head', () => {
		expect(earlyCoreTag(early, page, loadsCore, 'tests/pages/engine.html', './')).toEqual({
			tag: 'script',
			attrs: { type: 'module', async: true, src: '../../assets/early-core-AbCd1234.js' },
			injectTo: 'head-prepend',
		});
	});

	it("gives the address from the page with a relative base, and from the base's root otherwise", () => {
		const src = (htmlFile: string, base: string) =>
			earlyCoreTag(early, page, loadsCore, htmlFile, base)?.attrs?.src;
		expect(src('index.html', './')).toBe('./assets/early-core-AbCd1234.js');
		expect(src('index.html', '')).toBe('./assets/early-core-AbCd1234.js');
		expect(src('play/index.html', '/')).toBe('/assets/early-core-AbCd1234.js');
		expect(src('index.html', 'https://cdn.example.com/game/')).toBe(
			'https://cdn.example.com/game/assets/early-core-AbCd1234.js',
		);
	});

	it('leaves out a page whose chunks load no core, or another WebAssembly file', () => {
		expect(earlyCoreTag(early, page, bundle('let x = 1'), 'index.html', '/')).toBeUndefined();
		expect(
			earlyCoreTag(
				early,
				page,
				bundle('new URL("other-Xy000000.wasm",import.meta.url)'),
				'index.html',
				'/',
			),
		).toBeUndefined();
	});
});
