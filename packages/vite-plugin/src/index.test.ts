import { describe, expect, it } from 'bun:test';
import type { UserConfig } from 'vite';
import { fixture } from '../../../tools/lib/fixture';
import null3d, { CORE_FILES, missingCoreFiles } from './index';

/** A project with the engine package installed, holding the given core files. */
function project(files: readonly string[]): string {
	const engine = 'node_modules/@null3d/engine';
	return fixture({
		'package.json': '{"name":"demo","private":true}',
		[`${engine}/package.json`]: JSON.stringify({
			name: '@null3d/engine',
			exports: { '.': './index.js', './wasm/*': './dist/wasm/*' },
		}),
		[`${engine}/index.js`]: '',
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
