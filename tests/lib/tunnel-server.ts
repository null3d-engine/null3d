// The dev server's answers to BrowserStack's devices, which reach this computer through
// BrowserStack Local's tunnel by the name bs-local.com. Each request through the tunnel waits about
// a third of a second, the browser sends at most six at once over HTTP/1.1, and the tunnel carries
// well under a megabyte a second, while one page of the device runner asks for a few hundred files
// and many megabytes. The devices' browsers accept the dev server's certificate as an exception, so
// they keep no file in their cache and ask for every file again on each page. So for this host
// alone, text and WebAssembly answers go compressed with Brotli or gzip, which makes the largest
// modules, strings of shader source, a hundred times smaller. Requests by any other name, and the
// server's own routes, are unchanged.
import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from 'node:http';
import { promisify } from 'node:util';
import { brotliCompress, constants, gzip } from 'node:zlib';
import type { Connect, Plugin } from 'vite';
import { acceptedEncoding } from './load-server.ts';

/** The name by which BrowserStack's devices reach this computer through BrowserStack Local. */
const TUNNEL_HOST = 'bs-local.com';

/** The routes of the repository's own servers, which choose their own caching and compression. */
const OWN_ROUTES = '/__null3d/';

/** Answers worth compressing: scripts, WebAssembly, styles, pages and other text. */
const COMPRESSIBLE = /^(text\/|application\/(javascript|json|wasm|xml)|image\/svg)/;

const brotli = promisify(brotliCompress);
const gzipped = promisify(gzip);

/** Whether a request came through the tunnel, by the host name it asked for. */
function throughTunnel(req: IncomingMessage): boolean {
	const host = req.headers.host ?? '';
	return host === TUNNEL_HOST || host.startsWith(`${TUNNEL_HOST}:`);
}

/** Whether to compress an answer whose headers are final. */
function compressible(req: IncomingMessage, res: ServerResponse): boolean {
	return (
		req.method === 'GET' &&
		res.statusCode === 200 &&
		!res.hasHeader('Content-Encoding') &&
		COMPRESSIBLE.test(String(res.getHeader('Content-Type') ?? ''))
	);
}

/** Puts the headers given to writeHead on the response, so they can change before they go out. */
function setHeaders(res: ServerResponse, headers: OutgoingHttpHeaders | unknown[]): void {
	if (!Array.isArray(headers)) {
		for (const [name, value] of Object.entries(headers))
			if (value !== undefined) res.setHeader(name, value);
		return;
	}
	// A flat list of names and values, or a list of pairs.
	const pairs = Array.isArray(headers[0])
		? (headers as [string, string][])
		: headers.flatMap((_, i) =>
				i % 2 === 0 ? [[headers[i], headers[i + 1]] as [string, string]] : [],
			);
	for (const [name, value] of pairs) res.setHeader(name, value);
}

/**
 * Holds back a tunnel answer's headers until its first bytes, then, when the answer is worth it,
 * collects its body and sends it compressed.
 */
export const tunnelMiddleware: Connect.NextHandleFunction = (req, res, next) => {
	const encoding = acceptedEncoding(req.headers['accept-encoding']);
	if (!throughTunnel(req) || req.url?.startsWith(OWN_ROUTES) || encoding === 'identity')
		return next();
	const { writeHead, write, end } = res;
	const sendRest = end as (...args: unknown[]) => ServerResponse;
	const restore = () => {
		res.writeHead = writeHead;
		res.write = write;
		res.end = end;
	};
	let chunks: Buffer[] | undefined;
	const toBuffer = (chunk: unknown, textEncoding?: unknown) =>
		Buffer.isBuffer(chunk)
			? chunk
			: chunk instanceof Uint8Array
				? Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
				: Buffer.from(
						String(chunk),
						typeof textEncoding === 'string' ? (textEncoding as BufferEncoding) : 'utf8',
					);
	// Decides once, at the first bytes or the end, whether this answer is collected and compressed.
	const start = (): boolean => {
		if (!compressible(req, res)) {
			restore();
			return false;
		}
		chunks = [];
		return true;
	};
	res.writeHead = function (this: ServerResponse, status: number, ...rest: unknown[]) {
		res.statusCode = status;
		if (typeof rest[0] === 'string') res.statusMessage = rest.shift() as string;
		if (rest[0]) setHeaders(res, rest[0] as OutgoingHttpHeaders);
		return res;
	} as ServerResponse['writeHead'];
	res.write = function (this: ServerResponse, chunk: unknown, ...rest: unknown[]) {
		if (!chunks && !start())
			return (write as (...args: unknown[]) => boolean).call(res, chunk, ...rest);
		chunks?.push(toBuffer(chunk, rest[0]));
		return true;
	} as ServerResponse['write'];
	res.end = function (this: ServerResponse, ...args: unknown[]) {
		if (!chunks && !start()) return sendRest.apply(res, args);
		const [last] = args;
		if (last !== undefined && last !== null && typeof last !== 'function')
			chunks?.push(toBuffer(last, args[1]));
		const done = args.find((arg) => typeof arg === 'function') as (() => void) | undefined;
		const raw = Buffer.concat(chunks ?? []);
		const compress =
			encoding === 'br'
				? brotli(raw, {
						params: {
							[constants.BROTLI_PARAM_QUALITY]: 5,
							[constants.BROTLI_PARAM_SIZE_HINT]: raw.length,
						},
					})
				: gzipped(raw);
		compress.then(
			(body) => {
				restore();
				res.setHeader('Content-Encoding', encoding);
				res.setHeader('Content-Length', body.length);
				const vary = res.getHeader('Vary');
				res.setHeader('Vary', vary ? `${vary}, Accept-Encoding` : 'Accept-Encoding');
				sendRest.call(res, body, done);
			},
			(e: Error) => {
				restore();
				res.statusCode = 500;
				res.removeHeader('Content-Length');
				res.setHeader('Content-Type', 'text/plain');
				sendRest.call(res, `null3D: compressing ${req.url} for the tunnel failed: ${e.message}`);
			},
		);
		return res;
	} as ServerResponse['end'];
	next();
};

/**
 * The dev server's step for requests that come through BrowserStack Local, ahead of every other
 * step, so it sees each answer of the dev server and its plugins.
 */
export function tunnelServer(): Plugin {
	return {
		name: 'null3d-tunnel-server',
		enforce: 'pre',
		configureServer(server) {
			server.middlewares.use(tunnelMiddleware);
		},
	};
}
