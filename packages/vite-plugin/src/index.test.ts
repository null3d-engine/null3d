import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { ResolvedConfig, UserConfig } from 'vite';
import { fixture } from '../../../tools/lib/fixture';
import null3d, { CORE_FILES, missingCoreFiles, NOTICES_FILE, thirdPartyNotices } from './index';

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

/** A project that depends on the given null3D packages, each installed with the given notices. */
function noticesProject(packages: Record<string, string | null>): string {
	const files: Record<string, string> = {
		'package.json': JSON.stringify({
			name: 'demo',
			private: true,
			dependencies: Object.fromEntries(Object.keys(packages).map((name) => [name, '*'])),
		}),
	};
	for (const [name, notices] of Object.entries(packages)) {
		files[`node_modules/${name}/package.json`] = JSON.stringify({
			name,
			exports: { './package.json': './package.json' },
		});
		if (notices !== null) files[`node_modules/${name}/THIRD-PARTY-NOTICES.txt`] = `${notices}\n`;
	}
	return fixture(files);
}

/** The plugin's hooks after Vite resolves a config for the given command and worker format. */
function resolvedPlugin(root: string, command: 'build' | 'serve', format: 'es' | 'iife' = 'es') {
	const warnings: string[] = [];
	const plugin = null3d();
	const config = {
		command,
		root,
		base: '/',
		build: { assetsDir: 'assets', ssr: false },
		worker: { format },
		logger: { warn: (message: string) => warnings.push(message) },
	} as unknown as ResolvedConfig;
	(plugin.configResolved as (c: ResolvedConfig) => void)(config);
	const emitted: object[] = [];
	(plugin.generateBundle as (this: object) => void).call({
		emitFile: (file: object) => emitted.push(file),
	});
	return { warnings, emitted };
}

describe('the third-party notices', () => {
	it("joins the notices of each null3D package that the project depends on, the engine's first", () => {
		const root = noticesProject({
			'@null3d/physics': 'physics notices',
			'@null3d/engine': 'engine notices',
			'@null3d/controls': null,
		});
		expect(thirdPartyNotices(root)).toBe('engine notices\n\nphysics notices\n');
		expect(thirdPartyNotices(fixture({ 'package.json': '{}' }))).toBeNull();
	});

	it('writes the notices beside the page in a production build only', () => {
		const root = noticesProject({ '@null3d/engine': 'engine notices' });
		expect(resolvedPlugin(root, 'build').emitted).toEqual([
			{ type: 'asset', fileName: NOTICES_FILE, source: 'engine notices\n' },
		]);
		expect(resolvedPlugin(root, 'serve').emitted).toEqual([]);
	});

	it("holds each licence and notice of the engine's third-party code word for word", () => {
		const engine = join(import.meta.dir, '../../engine');
		const notices = readFileSync(join(engine, 'THIRD-PARTY-NOTICES.txt'), 'utf8');
		const meshopt = dirname(
			createRequire(join(engine, 'package.json')).resolve('meshoptimizer/package.json'),
		);
		for (const file of [
			join(engine, 'vendor/basis/LICENSE'),
			join(engine, 'vendor/basis/NOTICE'),
			join(engine, 'vendor/basis/LICENSE-zstd'),
			join(meshopt, 'LICENSE.md'),
		])
			expect(notices).toContain(readFileSync(file, 'utf8').trim());
		const { version } = JSON.parse(readFileSync(join(meshopt, 'package.json'), 'utf8'));
		expect(notices).toContain(`meshoptimizer ${version}`);
	});
});

describe('the worker format', () => {
	it('warns when workers do not build as ES modules', () => {
		const root = fixture({ 'package.json': '{}' });
		expect(resolvedPlugin(root, 'build').warnings).toEqual([]);
		expect(resolvedPlugin(root, 'build', 'iife').warnings).toEqual([
			expect.stringContaining('workers build as iife, not as ES modules'),
		]);
	});
});

describe('the test switches in the address', () => {
	const define = (options: Parameters<typeof null3d>[0], mode: string) =>
		(null3d(options).config as (c: object, e: object) => UserConfig)(
			{ root: fixture({ 'package.json': '{}' }) },
			{ mode, command: 'build' },
		).define;

	it('leaves the choice to the engine without the option: development builds read them', () => {
		expect(define({}, 'production')).toEqual({ __NULL3D_DEV__: 'false' });
		expect(define({}, 'development')).toEqual({ __NULL3D_DEV__: 'true' });
	});

	it('lets a production build read them when the option asks', () => {
		expect(define({ urlSwitches: true }, 'production')).toEqual({
			__NULL3D_DEV__: 'false',
			__NULL3D_URL_SWITCHES__: 'true',
		});
	});
});
