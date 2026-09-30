import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import type { Downloads } from './load-routes.ts';
import {
	acceptedEncoding,
	buildsForLoads,
	LOAD_BUILDS,
	type LoadBuild,
	loadMiddleware,
	MARK_SECTION,
	markCore,
} from './load-server.ts';

/** A module with one exported function, `one`, which returns 1. */
const MODULE = Uint8Array.from([
	0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7f, 0x03,
	0x02, 0x01, 0x00, 0x07, 0x07, 0x01, 0x03, 0x6f, 0x6e, 0x65, 0x00, 0x00, 0x0a, 0x06, 0x01, 0x04,
	0x00, 0x41, 0x01, 0x0b,
]);

const one = (bytes: Uint8Array) =>
	(new WebAssembly.Instance(new WebAssembly.Module(bytes)).exports.one as () => number)();

describe('markCore', () => {
	it('adds a custom section right after the header, and the module still runs', () => {
		const mark = Uint8Array.from([1, 2, 3, 4]);
		const marked = markCore(MODULE, mark);
		expect(WebAssembly.validate(marked)).toBe(true);
		expect(one(marked)).toBe(1);
		const [section] = WebAssembly.Module.customSections(
			new WebAssembly.Module(marked),
			MARK_SECTION,
		);
		expect([...new Uint8Array(section as ArrayBuffer)]).toEqual([1, 2, 3, 4]);
		expect([...marked.subarray(0, 9)]).toEqual([...MODULE.subarray(0, 8), 0]);
		expect([...marked.subarray(-MODULE.length + 8)]).toEqual([...MODULE.subarray(8)]);
	});

	it('refuses bytes that are not a module', () => {
		expect(() => markCore(new TextEncoder().encode('<html>'), new Uint8Array(4))).toThrow(
			'not a WebAssembly module',
		);
	});
});

describe('acceptedEncoding', () => {
	it('prefers Brotli, then gzip, and skips what a weight of 0 refuses', () => {
		expect(acceptedEncoding('gzip, deflate, br, zstd')).toBe('br');
		expect(acceptedEncoding('gzip, deflate')).toBe('gzip');
		expect(acceptedEncoding('br;q=0, gzip;q=0.5')).toBe('gzip');
		expect(acceptedEncoding('BR')).toBe('br');
		expect(acceptedEncoding('')).toBe('identity');
		expect(acceptedEncoding(undefined)).toBe('identity');
	});
});

interface Reply {
	status: number;
	headers: Record<string, string | string[] | undefined>;
	body: Buffer;
}

describe('buildsForLoads', () => {
	it('names the build each load address needs, once, and none for other addresses', () => {
		const names = (paths: string[]) => buildsForLoads(paths).map(({ name }) => name);
		const startup = '/__null3d/load/cold/{run}.{runner}.engine-1/tests/pages/engine.html?seconds=2';
		const bench = '/__null3d/load/warm/{run}.{runner}.bench/bench/pages/null3d/s1.html?gpu=webgl2';
		expect(names([startup, startup])).toEqual(['startup']);
		expect(names([bench, startup])).toEqual(['benchmark pages', 'startup']);
		expect(names(['/bench/pages/null3d/s1.html?hold', '/tests/pages/engine.html'])).toEqual([]);
		expect(LOAD_BUILDS.map(({ prefix }) => prefix)).toEqual(['bench/', '']);
	});
});

describe('the load routes', () => {
	const build = mkdtempSync(join(tmpdir(), 'null3d-loads-'));
	const benchBuild = mkdtempSync(join(tmpdir(), 'null3d-bench-loads-'));
	const builds: LoadBuild[] = [
		{ name: 'benchmark pages', prefix: 'bench/', dir: benchBuild },
		{ name: 'startup', prefix: '', dir: build },
	];
	const html = `<!doctype html><script type="module" src="../../assets/engine-AbCd1234.js"></script>${' '.repeat(2000)}`;
	const benchHtml =
		'<!doctype html><script type="module" src="../../assets/s1-AbCd1234.js"></script>';
	const script = `export const engine = '${'x'.repeat(4000)}';`;
	let server: Server;
	let port = 0;

	/** A GET with raw bytes back, so the test sees each body as the server sent it. */
	const get = (path: string, headers: Record<string, string> = {}): Promise<Reply> =>
		new Promise((resolve, reject) => {
			const req = request({ port, path, headers }, (res) => {
				const chunks: Buffer[] = [];
				res.on('data', (chunk: Buffer) => chunks.push(chunk));
				res.on('end', () =>
					resolve({
						status: res.statusCode ?? 0,
						headers: res.headers,
						body: Buffer.concat(chunks),
					}),
				);
			});
			req.on('error', reject);
			req.end();
		});
	const downloads = async (kind: string, key: string) =>
		JSON.parse((await get(`/__null3d/downloads/${kind}/${key}`)).body.toString()) as Downloads;

	beforeAll(async () => {
		mkdirSync(join(build, 'tests/pages'), { recursive: true });
		mkdirSync(join(build, 'assets'));
		writeFileSync(join(build, 'tests/pages/engine.html'), html);
		writeFileSync(join(build, 'assets/engine-AbCd1234.js'), script);
		writeFileSync(join(build, 'assets/null3d_bg-Bt249kqm.wasm'), MODULE);
		// A file under bench/ in the startup build's folder belongs to no build, so no load gets it.
		mkdirSync(join(build, 'bench'));
		writeFileSync(join(build, 'bench/stray.html'), html);
		mkdirSync(join(benchBuild, 'bench/pages/null3d'), { recursive: true });
		mkdirSync(join(benchBuild, 'bench/assets'));
		writeFileSync(join(benchBuild, 'bench/pages/null3d/s1.html'), benchHtml);
		writeFileSync(join(benchBuild, 'bench/assets/s1-AbCd1234.js'), script);
		const middleware = loadMiddleware(builds);
		server = createServer((req, res) =>
			middleware(req, res, () => {
				res.statusCode = 418;
				res.end();
			}),
		);
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
		port = (server.address() as AddressInfo).port;
	});

	afterAll(() => {
		server.close();
		for (const dir of [build, benchBuild]) rmSync(dir, { recursive: true, force: true });
	});

	it('serves the page with the isolation headers, checked again on each visit', async () => {
		const page = await get('/__null3d/load/warm/w/tests/pages/engine.html?seconds=0.2', {
			'accept-encoding': 'gzip, deflate, br',
		});
		expect(page.status).toBe(200);
		expect(page.headers['cross-origin-opener-policy']).toBe('same-origin');
		expect(page.headers['cross-origin-embedder-policy']).toBe('require-corp');
		expect(page.headers['cache-control']).toBe('no-cache');
		expect(page.headers['content-type']).toBe('text/html; charset=utf-8');
		expect(page.headers['content-encoding']).toBe('br');
		expect(brotliDecompressSync(page.body).toString()).toBe(html);
		const again = await get('/__null3d/load/warm/w/tests/pages/engine.html', {
			'if-none-match': String(page.headers.etag),
		});
		expect(again.status).toBe(304);
		expect(again.body.length).toBe(0);
	});

	it("serves each build's files from its own folder, by the start of their paths", async () => {
		const page = await get('/__null3d/load/warm/b/bench/pages/null3d/s1.html?gpu=webgl2');
		expect(page.status).toBe(200);
		expect(page.body.toString()).toBe(benchHtml);
		expect(page.headers['cross-origin-embedder-policy']).toBe('require-corp');
		const module = await get('/__null3d/load/warm/b/bench/assets/s1-AbCd1234.js');
		expect(module.body.toString()).toBe(script);
		expect((await get('/__null3d/load/warm/b/bench/stray.html')).status).toBe(404);
		expect((await get('/__null3d/load/warm/b/tests/pages/engine.html')).status).toBe(200);
	});

	it('lets the browser keep hashed files, and compresses them as the browser allows', async () => {
		const brotli = await get('/__null3d/load/cold/c1/assets/engine-AbCd1234.js', {
			'accept-encoding': 'br',
		});
		expect(brotli.headers['cache-control']).toBe('public, max-age=31536000, immutable');
		expect(brotli.headers['content-type']).toBe('text/javascript; charset=utf-8');
		expect(brotliDecompressSync(brotli.body).toString()).toBe(script);
		const gzip = await get('/__null3d/load/cold/c1/assets/engine-AbCd1234.js', {
			'accept-encoding': 'gzip',
		});
		expect(gzip.headers['content-encoding']).toBe('gzip');
		expect(gunzipSync(gzip.body).toString()).toBe(script);
		const plain = await get('/__null3d/load/cold/c1/assets/engine-AbCd1234.js');
		expect(plain.headers['content-encoding']).toBeUndefined();
		expect(plain.body.toString()).toBe(script);
	});

	it('gives each cold load a core of its own, and warm loads the same core', async () => {
		const core = (kind: string, key: string) =>
			get(`/__null3d/load/${kind}/${key}/assets/null3d_bg-Bt249kqm.wasm`);
		const [first, second] = [(await core('cold', 'a')).body, (await core('cold', 'b')).body];
		expect(first.equals(second)).toBe(false);
		for (const marked of [first, second]) {
			expect(one(marked)).toBe(1);
			expect(
				WebAssembly.Module.customSections(new WebAssembly.Module(marked), MARK_SECTION),
			).toHaveLength(1);
		}
		const warm = await core('warm', 'w');
		expect(warm.headers['content-type']).toBe('application/wasm');
		expect([...warm.body]).toEqual([...MODULE]);
		expect((await core('warm', 'w')).body.equals(warm.body)).toBe(true);
	});

	it('tells what it sent for a load once, and then starts the count afresh', async () => {
		await downloads('cold', 'counted');
		await get('/__null3d/load/cold/counted/tests/pages/engine.html', { 'accept-encoding': 'br' });
		const script = await get('/__null3d/load/cold/counted/assets/engine-AbCd1234.js', {
			'accept-encoding': 'br',
		});
		await get('/__null3d/load/cold/counted/assets/missing.js');
		const sent = await downloads('cold', 'counted');
		expect(sent.requests).toBe(3);
		expect(sent.files.map(({ path, status, encoding }) => [path, status, encoding])).toEqual([
			['tests/pages/engine.html', 200, 'br'],
			['assets/engine-AbCd1234.js', 200, 'br'],
			['assets/missing.js', 404, 'identity'],
		]);
		expect(sent.files[1]?.bytes).toBe(script.body.length);
		expect(sent.bytes).toBe(sent.files.reduce((sum, file) => sum + file.bytes, 0));
		expect(sent.files[0]?.atMs).toBe(0);
		expect(await downloads('cold', 'counted')).toEqual({ requests: 0, bytes: 0, files: [] });
	});

	it('refuses addresses outside the build, and passes other routes on', async () => {
		expect((await get('/__null3d/load/cold/k/../../package.json')).status).toBe(404);
		expect((await get('/__null3d/load/cold/k/tests/pages')).status).toBe(404);
		expect((await get('/tests/pages/engine.html')).status).toBe(418);
	});

	it('prepares the builds before the first load, and says when it has none', async () => {
		const ready = await get('/__null3d/load-ready');
		expect(ready.status).toBe(200);
		expect(JSON.parse(ready.body.toString())).toEqual({
			files: 5,
			builds: ['benchmark pages', 'startup'],
		});
		const empty = loadMiddleware([{ name: 'startup', prefix: '', dir: join(build, 'missing') }]);
		const status = await new Promise<number>((resolve) => {
			const res = {
				statusCode: 0,
				setHeader() {},
				end() {
					resolve(res.statusCode);
				},
			};
			empty({ url: '/__null3d/load-ready' } as never, res as never, () => resolve(-1));
		});
		expect(status).toBe(404);
	});
});
