// The dev server's step for BrowserStack Local's tunnel, on a server of its own whose answers are
// written as Vite writes its modules (headers, then the whole body at the end) and as Vite's static
// files go (writeHead, then the body in pieces).
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { createServer, type IncomingHttpHeaders, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { tunnelMiddleware } from './tunnel-server.ts';

const MODULE = `export const shader = \`${'vec4 color = vec4(1.0);\n'.repeat(4000)}\`;\n`;
const PICTURE = Buffer.alloc(3000, 7);

let server: Server;
let port = 0;

beforeAll(async () => {
	server = createServer((req, res) => {
		tunnelMiddleware(req, res, () => {
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
			} else {
				res.setHeader('Content-Type', 'application/json');
				res.setHeader('Cache-Control', 'no-cache');
				res.setHeader('ETag', 'r');
				res.end('{"ok":true}');
			}
		});
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	port = (server.address() as AddressInfo).port;
});

afterAll(() => {
	server.close();
});

interface Answer {
	status: number;
	headers: IncomingHttpHeaders;
	body: Buffer;
}

/** Asks the server for a path by a host name, and returns the answer's bytes as sent. */
function get(path: string, host: string, headers: Record<string, string> = {}): Promise<Answer> {
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

const TUNNEL = 'bs-local.com:3001';

describe('tunnel server', () => {
	it('leaves requests by any other host name as they are', async () => {
		const answer = await get('/module.ts', `localhost:${port}`);
		expect(answer.headers['cache-control']).toBe('no-cache');
		expect(answer.headers['content-encoding']).toBeUndefined();
		expect(answer.body.toString()).toBe(MODULE);
	});

	it('sends a module through the tunnel with Brotli, its other headers as they were', async () => {
		const answer = await get('/module.ts', TUNNEL);
		expect(answer.status).toBe(200);
		expect(answer.headers['cache-control']).toBe('no-cache');
		expect(answer.headers.etag).toBe('W/"m"');
		expect(answer.headers['content-encoding']).toBe('br');
		expect(answer.headers.vary).toBe('Origin, Accept-Encoding');
		expect(Number(answer.headers['content-length'])).toBe(answer.body.length);
		expect(answer.body.length).toBeLessThan(MODULE.length / 20);
		expect(brotliDecompressSync(answer.body).toString()).toBe(MODULE);
	});

	it('compresses a file sent in pieces after writeHead, with gzip when Brotli is not accepted', async () => {
		const answer = await get('/static.wasm', TUNNEL, { 'accept-encoding': 'gzip' });
		expect(answer.headers['content-encoding']).toBe('gzip');
		expect(Number(answer.headers['content-length'])).toBe(answer.body.length);
		expect(gunzipSync(answer.body).toString()).toBe(MODULE);
	});

	it('sends a picture and a "not changed" answer as they are', async () => {
		const picture = await get('/picture.png', TUNNEL);
		expect(picture.headers['content-encoding']).toBeUndefined();
		expect(picture.body.equals(PICTURE)).toBe(true);
		const unchanged = await get('/module.ts', TUNNEL, { 'if-none-match': 'W/"m"' });
		expect(unchanged.status).toBe(304);
		expect(unchanged.body.length).toBe(0);
	});

	it("leaves the server's own routes, and answers to a browser that takes no compression", async () => {
		const own = await get('/__null3d/report', TUNNEL);
		expect(own.headers['cache-control']).toBe('no-cache');
		expect(own.headers['content-encoding']).toBeUndefined();
		const plain = await get('/module.ts', TUNNEL, { 'accept-encoding': 'identity' });
		expect(plain.headers['content-encoding']).toBeUndefined();
		expect(plain.body.toString()).toBe(MODULE);
	});
});
