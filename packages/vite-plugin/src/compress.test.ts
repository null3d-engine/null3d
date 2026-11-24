// The compressing steps of the dev server and the preview, each on a server of its own. The dev
// server's answers are written as Vite writes its modules (headers, then the whole body at the end)
// and as Vite's static files go (writeHead, then the body in pieces). The preview's step answers the
// build's files itself.
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import {
	createServer,
	type IncomingHttpHeaders,
	type IncomingMessage,
	request,
	type Server,
	type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	brotliCompressSync,
	brotliDecompressSync,
	constants,
	createGzip,
	gunzipSync,
} from 'node:zlib';
import type { Connect } from 'vite';
import {
	acceptedEncoding,
	CompressedBodies,
	compressAnswers,
	compressedFiles,
	fromLoopback,
} from './compress.ts';

const MODULE = `export const shader = \`${'vec4 color = vec4(1.0);\n'.repeat(4000)}\`;\n`;
const PICTURE = Buffer.alloc(3000, 7);
/** A model whose bytes compress no further, as one whose textures are compressed images. */
const PACKED_MODEL = randomBytes(64 * 1024);

/** Text that Brotli's best quality makes smaller than its fast one: words picked by an integer hash. */
function wordy(words: number): Buffer {
	const vocabulary = ['vec4', 'color', 'light', 'normal', 'shadow', 'fog', 'return', 'let', 'fn'];
	let state = 12345;
	const out: string[] = [];
	for (let i = 0; i < words; i++) {
		state = (Math.imul(state, 1103515245) + 12345) >>> 0;
		out.push(`${vocabulary[state % vocabulary.length]}${(state >>> 8) % 97}`);
	}
	return Buffer.from(out.join(' '));
}

interface Answer {
	status: number;
	headers: IncomingHttpHeaders;
	body: Buffer;
}

/** Starts a server that runs `steps` in turn, then `last`, on a free port of the loopback. */
async function serve(
	steps: Connect.NextHandleFunction[],
	last: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<{ server: Server; port: number }> {
	const server = createServer((req, res) => {
		const run = (at: number): void => {
			const step = steps[at];
			if (!step) {
				last(req, res);
				return;
			}
			step(req, res, (error?: unknown) => {
				if (error) {
					res.statusCode = 500;
					res.end(String(error));
				} else run(at + 1);
			});
		};
		run(0);
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	return { server, port: (server.address() as AddressInfo).port };
}

/** Asks a server for a path by a host name, and returns the answer's bytes as sent. */
function get(
	port: number,
	path: string,
	host: string,
	headers: Record<string, string> = {},
): Promise<Answer> {
	return new Promise((resolve, reject) => {
		const req = request(
			{ port, path, headers: { host, 'accept-encoding': 'gzip, deflate, br', ...headers } },
			(res) => {
				const chunks: Buffer[] = [];
				res.on('data', (chunk: Buffer) => chunks.push(chunk));
				res.on('end', () =>
					resolve({
						status: res.statusCode ?? 0,
						headers: res.headers,
						body: Buffer.concat(chunks),
					}),
				);
			},
		);
		req.on('error', reject);
		req.end();
	});
}

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

describe('fromLoopback', () => {
	const asked = (remoteAddress: string, host: string) =>
		fromLoopback({ socket: { remoteAddress }, headers: { host } } as unknown as IncomingMessage);

	it('takes the loopback by a loopback name, a phone over USB among them', () => {
		expect(asked('127.0.0.1', 'localhost:5174')).toBe(true);
		expect(asked('::1', '[::1]:5174')).toBe(true);
		expect(asked('::ffff:127.0.0.1', '127.0.0.1:5173')).toBe(true);
		expect(asked('127.0.0.1', 'demo.localhost')).toBe(true);
		const overHttp2 = {
			socket: { remoteAddress: '::1' },
			headers: { ':authority': 'localhost:5174' },
		};
		expect(fromLoopback(overHttp2 as unknown as IncomingMessage)).toBe(true);
	});

	it('counts a tunnel by its host name, and any other peer, as remote', () => {
		expect(asked('127.0.0.1', 'bs-local.com:3001')).toBe(false);
		expect(asked('192.168.1.20', 'localhost:5174')).toBe(false);
		expect(asked('100.64.0.7', '100.64.0.2:5174')).toBe(false);
		expect(asked('192.168.1.20', 'my-mac.local:5174')).toBe(false);
	});
});

describe('compressAnswers', () => {
	let server: Server;
	let port = 0;
	const REMOTE = 'bs-local.com:3001';

	beforeAll(async () => {
		({ server, port } = await serve([compressAnswers((req) => !fromLoopback(req))], (req, res) => {
			if (req.url === '/module.ts') {
				if (req.headers['if-none-match'] === 'W/"m"') {
					res.statusCode = 304;
					res.end();
					return;
				}
				res.setHeader('Content-Type', 'text/javascript');
				res.setHeader('Cache-Control', 'no-cache');
				res.setHeader('Etag', 'W/"m"');
				res.setHeader('Vary', 'Origin');
				res.statusCode = 200;
				res.end(MODULE);
			} else if (req.url === '/static.wasm') {
				res.writeHead(200, {
					'Content-Type': 'application/wasm',
					'Content-Length': MODULE.length,
					'Cache-Control': 'no-cache',
					ETag: 'W/"s"',
				});
				for (let at = 0; at < MODULE.length; at += 1000) res.write(MODULE.slice(at, at + 1000));
				res.end();
			} else if (req.url === '/picture.png') {
				res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache', ETag: 'p' });
				res.end(PICTURE);
			} else if (req.url === '/encoded.js') {
				res.writeHead(200, { 'Content-Type': 'text/javascript', 'Content-Encoding': 'br' });
				res.end(brotliCompressSync(MODULE));
			} else if (req.url === '/scene.gltf') {
				res.writeHead(200, { 'Content-Type': 'model/gltf+json' });
				res.end(MODULE);
			} else if (req.url === '/packed.glb') {
				res.writeHead(200, { 'Content-Type': 'model/gltf-binary' });
				res.end(PACKED_MODEL);
			} else if (req.url === '/events') {
				res.writeHead(200, { 'Content-Type': 'text/event-stream' });
				res.end(`data: ${MODULE}\n\n`);
			} else {
				res.setHeader('Content-Type', 'application/json');
				res.end('{"ok":true}');
			}
		}));
	});

	afterAll(() => {
		server.close();
	});

	it('leaves requests from the loopback by a loopback name as they are', async () => {
		const answer = await get(port, '/module.ts', `localhost:${port}`);
		expect(answer.headers['cache-control']).toBe('no-cache');
		expect(answer.headers['content-encoding']).toBeUndefined();
		expect(answer.body.toString()).toBe(MODULE);
	});

	it('sends a module to a remote request with Brotli, its other headers as they were', async () => {
		const answer = await get(port, '/module.ts', REMOTE);
		expect(answer.status).toBe(200);
		expect(answer.headers['cache-control']).toBe('no-cache');
		expect(answer.headers.etag).toBe('W/"m"');
		expect(answer.headers['content-encoding']).toBe('br');
		expect(answer.headers.vary).toBe('Origin, Accept-Encoding');
		expect(Number(answer.headers['content-length'])).toBe(answer.body.length);
		expect(answer.body.length).toBeLessThan(MODULE.length / 20);
		expect(brotliDecompressSync(answer.body).toString()).toBe(MODULE);
		const again = await get(port, '/module.ts', REMOTE);
		expect(again.body.equals(answer.body)).toBe(true);
	});

	it('compresses a file sent in pieces after writeHead, with gzip when Brotli is not accepted', async () => {
		const answer = await get(port, '/static.wasm', REMOTE, { 'accept-encoding': 'gzip' });
		expect(answer.headers['content-encoding']).toBe('gzip');
		expect(Number(answer.headers['content-length'])).toBe(answer.body.length);
		expect(gunzipSync(answer.body).toString()).toBe(MODULE);
	});

	it('sends a picture, a "not changed" answer and a small answer as they are', async () => {
		const picture = await get(port, '/picture.png', REMOTE);
		expect(picture.headers['content-encoding']).toBeUndefined();
		expect(picture.body.equals(PICTURE)).toBe(true);
		const unchanged = await get(port, '/module.ts', REMOTE, { 'if-none-match': 'W/"m"' });
		expect(unchanged.status).toBe(304);
		expect(unchanged.body.length).toBe(0);
		const small = await get(port, '/report', REMOTE);
		expect(small.headers['content-encoding']).toBeUndefined();
		expect(small.body.toString()).toBe('{"ok":true}');
	});

	it('compresses a glTF model, and sends one that compresses no further as it is', async () => {
		const scene = await get(port, '/scene.gltf', REMOTE);
		expect(scene.headers['content-encoding']).toBe('br');
		expect(brotliDecompressSync(scene.body).toString()).toBe(MODULE);
		const packed = await get(port, '/packed.glb', REMOTE);
		expect(packed.headers['content-encoding']).toBeUndefined();
		expect(Number(packed.headers['content-length'])).toBe(PACKED_MODEL.length);
		expect(packed.body.equals(PACKED_MODEL)).toBe(true);
	});

	it('leaves an encoded answer, an event stream and a browser that takes no compression', async () => {
		const encoded = await get(port, '/encoded.js', REMOTE);
		expect(encoded.headers['content-encoding']).toBe('br');
		expect(brotliDecompressSync(encoded.body).toString()).toBe(MODULE);
		const events = await get(port, '/events', REMOTE);
		expect(events.headers['content-encoding']).toBeUndefined();
		const plain = await get(port, '/module.ts', REMOTE, { 'accept-encoding': 'identity' });
		expect(plain.headers['content-encoding']).toBeUndefined();
		expect(plain.body.toString()).toBe(MODULE);
	});
});

/**
 * A step that compresses with gzip as Vite's preview server does: it wraps the answer's functions
 * after the steps before it, sends the headers through the wrapped writeHead once it starts, and
 * writes the gzip stream's bytes through the functions that it wrapped, as they come.
 */
const laterGzip: Connect.NextHandleFunction = (_req, res, next) => {
	const { writeHead, write, end } = res;
	let gzip: ReturnType<typeof createGzip> | undefined;
	const start = () => {
		res.setHeader('Content-Encoding', 'gzip');
		res.removeHeader('Content-Length');
		gzip = createGzip();
		gzip.on('data', (chunk: Buffer) => (write as (chunk: Buffer) => boolean).call(res, chunk));
		gzip.on('end', () => (end as () => ServerResponse).call(res));
		(writeHead as (status: number) => ServerResponse).call(res, res.statusCode);
	};
	res.writeHead = function (this: ServerResponse, status: number, headers?: unknown) {
		res.statusCode = status;
		for (const [name, value] of Object.entries((headers ?? {}) as Record<string, string>))
			res.setHeader(name, value);
		return res;
	} as ServerResponse['writeHead'];
	res.write = function (this: ServerResponse, chunk: unknown) {
		if (!gzip) start();
		return (gzip as NonNullable<typeof gzip>).write(chunk as Buffer);
	} as ServerResponse['write'];
	res.end = function (this: ServerResponse, chunk?: unknown) {
		if (!gzip) start();
		(gzip as NonNullable<typeof gzip>).end(chunk as Buffer | undefined);
		return res;
	} as ServerResponse['end'];
	next();
};

describe('compressAnswers before a step that compresses itself', () => {
	let server: Server;
	let port = 0;

	beforeAll(async () => {
		// The page's file goes as a file server sends it: writeHead, the bytes, and the end only after
		// the later step's gzip stream has written its first bytes.
		({ server, port } = await serve([compressAnswers(() => true), laterGzip], (_req, res) => {
			res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Length': String(MODULE.length) });
			res.write(MODULE);
			setTimeout(() => res.end(), 50);
		}));
	});

	afterAll(() => {
		server.close();
	});

	it('leaves the later step in place, so the answer keeps every byte', async () => {
		const answer = await get(port, '/page.html', `localhost:${port}`);
		expect(answer.headers['content-encoding']).toBe('gzip');
		expect(gunzipSync(answer.body).toString()).toBe(MODULE);
	});
});

describe('compressedFiles', () => {
	let server: Server;
	let port = 0;
	let dir = '';
	const HOST = 'phone.example:5173';
	const SCRIPT = 'assets/index-AbCd1234.js';
	const core = wordy(20_000);

	beforeAll(async () => {
		dir = mkdtempSync(join(tmpdir(), 'null3d-compressed-files-'));
		mkdirSync(join(dir, 'assets'));
		writeFileSync(join(dir, SCRIPT), MODULE);
		writeFileSync(join(dir, 'assets/core-AbCd1234.wasm'), core);
		writeFileSync(join(dir, 'assets/picture.png'), PICTURE);
		writeFileSync(join(dir, 'small.json'), '{"ok":true}');
		writeFileSync(join(tmpdir(), 'null3d-outside.js'), MODULE);
		const cache: Connect.NextHandleFunction = (req, res, next) => {
			if (req.url?.startsWith('/demo/assets/')) res.setHeader('Cache-Control', 'immutable');
			next();
		};
		({ server, port } = await serve(
			[cache, compressedFiles(dir, '/demo/', { 'Cross-Origin-Embedder-Policy': 'require-corp' })],
			(_req, res) => {
				res.statusCode = 404;
				res.end('the file server');
			},
		));
	});

	afterAll(() => {
		server.close();
		rmSync(dir, { recursive: true, force: true });
		rmSync(join(tmpdir(), 'null3d-outside.js'), { force: true });
	});

	it("answers a build's script with Brotli and the file server's headers", async () => {
		const answer = await get(port, `/demo/${SCRIPT}?v=1`, HOST);
		expect(answer.status).toBe(200);
		expect(answer.headers['content-type']).toBe('text/javascript');
		expect(answer.headers['content-encoding']).toBe('br');
		expect(answer.headers['cache-control']).toBe('immutable');
		expect(answer.headers['cross-origin-embedder-policy']).toBe('require-corp');
		expect(answer.headers.vary).toBe('Accept-Encoding');
		expect(answer.headers.etag).toMatch(/^W\/"\d+-\d+"$/);
		expect(Number(answer.headers['content-length'])).toBe(answer.body.length);
		expect(brotliDecompressSync(answer.body).toString()).toBe(MODULE);
		const unchanged = await get(port, `/demo/${SCRIPT}`, HOST, {
			'if-none-match': String(answer.headers.etag),
		});
		expect(unchanged.status).toBe(304);
		expect(unchanged.body.length).toBe(0);
	});

	it('answers WebAssembly with gzip when Brotli is not accepted, and a small file as it is', async () => {
		const wasm = await get(port, '/demo/assets/core-AbCd1234.wasm', HOST, {
			'accept-encoding': 'gzip',
		});
		expect(wasm.headers['content-type']).toBe('application/wasm');
		expect(wasm.headers['content-encoding']).toBe('gzip');
		expect(gunzipSync(wasm.body).equals(core)).toBe(true);
		const small = await get(port, '/demo/small.json', HOST);
		expect(small.headers['content-encoding']).toBeUndefined();
		expect(small.headers['cache-control']).toBe('no-cache');
		expect(small.body.toString()).toBe('{"ok":true}');
	});

	it('leaves pictures, ranges, missing files, other addresses and paths outside the build', async () => {
		const passed = async (path: string, headers: Record<string, string> = {}) =>
			(await get(port, path, HOST, headers)).body.toString();
		expect(await passed('/demo/assets/picture.png')).toBe('the file server');
		expect(await passed(`/demo/${SCRIPT}`, { range: 'bytes=0-9' })).toBe('the file server');
		expect(await passed('/demo/assets/missing.js')).toBe('the file server');
		expect(await passed(`/${SCRIPT}`)).toBe('the file server');
		expect(await passed('/demo/..%2Fnull3d-outside.js')).toBe('the file server');
		expect(await passed(`/demo/${SCRIPT}`, { 'accept-encoding': 'identity' })).toBe(
			'the file server',
		);
	});

	it('sends a changed file afresh', async () => {
		const file = join(dir, 'assets/changing-AbCd1234.js');
		writeFileSync(file, MODULE);
		utimesSync(file, 1000, 1000);
		const first = await get(port, '/demo/assets/changing-AbCd1234.js', HOST);
		writeFileSync(file, `${MODULE}// more\n`);
		utimesSync(file, 2000, 2000);
		const second = await get(port, '/demo/assets/changing-AbCd1234.js', HOST);
		expect(second.headers.etag).not.toBe(first.headers.etag);
		expect(brotliDecompressSync(second.body).toString()).toBe(`${MODULE}// more\n`);
	});
});

describe('CompressedBodies', () => {
	const raw = wordy(20_000);
	const read = async () => raw;
	/** The body that `bodies` gives for `key`, which these bytes always compress into. */
	const compressed = async (bodies: CompressedBodies, key: string, bytes = read) => {
		const body = await bodies.body(key, 'br', bytes);
		if (!body) throw new Error(`${key} went uncompressed`);
		return body;
	};
	const best = brotliCompressSync(raw, {
		params: { [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY },
	}).length;

	/** Waits until `check` holds, or fails after two seconds. */
	async function until(check: () => Promise<boolean>): Promise<void> {
		for (let tries = 0; tries < 200; tries++) {
			if (await check()) return;
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		throw new Error('the condition never held');
	}

	it('keeps a body and answers the same bytes from it', async () => {
		const bodies = new CompressedBodies(false);
		let reads = 0;
		const counted = async () => {
			reads++;
			return raw;
		};
		const first = await compressed(bodies, 'a', counted);
		const second = await compressed(bodies, 'a', counted);
		expect(second).toBe(first);
		expect(reads).toBe(1);
		expect(brotliDecompressSync(first).equals(raw)).toBe(true);
	});

	it('compresses again at the best quality only once no request is in flight', async () => {
		const bodies = new CompressedBodies(true, 5);
		const busy = new EventEmitter() as ServerResponse;
		bodies.track(busy);
		const first = await compressed(bodies, 'b');
		expect(first.length).toBeGreaterThan(best);
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(await compressed(bodies, 'b')).toBe(first);
		busy.emit('close');
		await until(async () => (await compressed(bodies, 'b')).length === best);
		expect(brotliDecompressSync(await compressed(bodies, 'b')).equals(raw)).toBe(true);
	});

	it('keeps the fast body when the bytes changed before the best quality', async () => {
		const bodies = new CompressedBodies(true, 5);
		let changed = false;
		const first = await compressed(bodies, 'c', async () => {
			if (changed) throw new Error('changed');
			return raw;
		});
		changed = true;
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(await compressed(bodies, 'c')).toBe(first);
	});
});
