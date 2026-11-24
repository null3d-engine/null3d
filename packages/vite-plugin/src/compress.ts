// Compressed answers from the dev server and from `vite preview`. A phone or tablet that reaches
// this computer over a network, a VPN or a tunnel waits a round trip for each request, and its
// browser sends at most six at once over HTTP/1.1, which these servers speak. The engine's largest
// files are text and WebAssembly: its core, its shader modules, which hold shader source as strings,
// and the builds of custom materials. Brotli makes them three to fifty times smaller. A glTF model's
// geometry shrinks too, while a model whose textures are compressed images barely does, so an
// answer that compression would not make smaller by a useful share goes as it is.
//
// The dev server compresses its answers to every request that does not come from this computer's
// loopback, at a Brotli quality that takes milliseconds, and keeps each result for the next answer
// with the same bytes. Answers over the loopback stay as they are: there the transfer costs nothing,
// and compression would only add time. A request through a tunnel, such as BrowserStack Local's,
// arrives over the loopback by another host name, so it counts as remote.
//
// The preview compresses for every request, as a host should: the build's text, WebAssembly and
// model files, and the answers of other plugins' routes. It answers first at the fast quality. While no request is in flight, it compresses each
// answered file again at Brotli's best quality, so later visits get the files at the size that a
// host which compresses its files ahead of time sends.
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { promisify } from 'node:util';
import { brotliCompress, constants, gzip } from 'node:zlib';
import type { Connect } from 'vite';

export type Encoding = 'br' | 'gzip' | 'identity';

/** The best compression that a request's Accept-Encoding header allows: Brotli, then gzip, then none. */
export function acceptedEncoding(header: string | undefined): Encoding {
	const accepted = new Set(
		(header ?? '').split(',').flatMap((part) => {
			const [name = '', ...params] = part.trim().toLowerCase().split(';');
			const weight = params.map((param) => param.trim()).find((param) => param.startsWith('q='));
			return weight !== undefined && Number(weight.slice(2)) === 0 ? [] : [name.trim()];
		}),
	);
	if (accepted.has('br')) return 'br';
	if (accepted.has('gzip')) return 'gzip';
	return 'identity';
}

/** A loopback address of this computer, as a socket reports its peer. */
const LOOPBACK_PEER = /^(?:127(?:\.\d{1,3}){3}|::1|::ffff:127(?:\.\d{1,3}){3})$/;
/** A host name that names this computer's loopback, with or without a port. */
const LOOPBACK_HOST = /^(?:localhost|[\w.-]+\.localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?$/i;

/**
 * Whether a request comes from this computer: over the loopback, and by a loopback host name. A
 * phone over USB, whose forwarding rule reaches the loopback, counts too. An HTTP/2 request names
 * its host in the `:authority` header.
 */
export function fromLoopback(req: IncomingMessage): boolean {
	const host = req.headers.host ?? req.headers[':authority'];
	return (
		LOOPBACK_PEER.test(req.socket?.remoteAddress ?? '') &&
		LOOPBACK_HOST.test(typeof host === 'string' ? host : '')
	);
}

const brotli = promisify(brotliCompress);
const gzipped = promisify(gzip);

/** Brotli's quality for an answer that waits on it: milliseconds for a module of megabytes. */
const FAST_QUALITY = 5;
/** Smaller answers go as they are: compression saves less than its own header costs. */
const SMALLEST = 1024;
/**
 * The share of its size that a compressed body must save for it to go compressed. Bytes that
 * compress no further, such as a model whose textures are compressed images, go as they are.
 */
const WORTH = 0.05;
/** What the kept bodies may hold in all. The least recently used go first. */
const KEPT_BYTES = 256 << 20;
/** How long the preview waits with no request in flight before it compresses a file again. */
const QUIET_MS = 1000;

function compress(raw: Buffer, encoding: 'br' | 'gzip', quality: number): Promise<Buffer> {
	return encoding === 'br'
		? brotli(raw, {
				params: {
					[constants.BROTLI_PARAM_QUALITY]: quality,
					[constants.BROTLI_PARAM_SIZE_HINT]: raw.length,
				},
			})
		: gzipped(raw);
}

/**
 * Compressed bodies, kept by a key that names their bytes and encoding, with null for bytes that
 * compression does not make smaller enough. With `best`, each Brotli body is compressed again at
 * the best quality while no request is in flight, one at a time, and that body replaces the first.
 */
export class CompressedBodies {
	readonly #kept = new Map<string, Buffer | null>();
	#keptBytes = 0;
	/** Bodies that wait for the best quality, by key, with the read of their raw bytes. */
	readonly #waiting = new Map<string, () => Promise<Buffer>>();
	#inFlight = 0;
	#upgrading = false;
	#quiet: ReturnType<typeof setTimeout> | undefined;
	readonly #best: boolean;
	readonly #quietMs: number;

	/**
	 * `best` turns on the second compression at the best quality, which waits until no request has
	 * been in flight for `quietMs`.
	 */
	constructor(best: boolean, quietMs = QUIET_MS) {
		this.#best = best;
		this.#quietMs = quietMs;
	}

	/**
	 * The body of the bytes that `key` names, in `encoding`: a kept one, or one compressed now from
	 * `raw`, which reads the bytes. Null when the bytes are best sent as they are. `raw` may be
	 * called again later, for the best quality, and fails when the bytes it would read are no longer
	 * the ones that `key` names.
	 */
	async body(
		key: string,
		encoding: 'br' | 'gzip',
		raw: () => Promise<Buffer>,
	): Promise<Buffer | null> {
		const name = `${encoding}:${key}`;
		const kept = this.#kept.get(name);
		if (kept !== undefined) {
			this.#kept.delete(name);
			this.#kept.set(name, kept);
			return kept;
		}
		const bytes = await raw();
		const compressed = await compress(bytes, encoding, FAST_QUALITY);
		const body = compressed.length <= bytes.length * (1 - WORTH) ? compressed : null;
		this.#keep(name, body);
		if (body && this.#best && encoding === 'br') this.#waiting.set(name, raw);
		return body;
	}

	/** Notes a request until its answer ends, so the best quality waits while one is in flight. */
	track(res: ServerResponse): void {
		if (!this.#best) return;
		this.#inFlight++;
		clearTimeout(this.#quiet);
		res.once('close', () => {
			this.#inFlight--;
			this.#schedule();
		});
	}

	#keep(name: string, body: Buffer | null): void {
		const old = this.#kept.get(name);
		if (old !== undefined) {
			this.#keptBytes -= old?.length ?? 0;
			this.#kept.delete(name);
		}
		this.#kept.set(name, body);
		this.#keptBytes += body?.length ?? 0;
		for (const [oldest, kept] of this.#kept) {
			if (this.#keptBytes <= KEPT_BYTES) break;
			this.#kept.delete(oldest);
			this.#waiting.delete(oldest);
			this.#keptBytes -= kept?.length ?? 0;
		}
	}

	#schedule(): void {
		if (this.#inFlight > 0 || this.#upgrading || this.#waiting.size === 0) return;
		clearTimeout(this.#quiet);
		this.#quiet = setTimeout(() => void this.#upgradeOne(), this.#quietMs);
		this.#quiet.unref?.();
	}

	async #upgradeOne(): Promise<void> {
		const next = this.#waiting.entries().next();
		if (this.#inFlight > 0 || next.done) return;
		const [name, raw] = next.value;
		this.#waiting.delete(name);
		this.#upgrading = true;
		try {
			const body = await compress(await raw(), 'br', constants.BROTLI_MAX_QUALITY);
			if (this.#kept.has(name)) this.#keep(name, body);
		} catch {
			// The file changed or went away; its next answer compresses the new bytes.
		} finally {
			this.#upgrading = false;
		}
		this.#schedule();
	}
}

/** Answers worth compressing: scripts, WebAssembly, glTF models, styles, pages and other text. */
const COMPRESSIBLE =
	/^(?:text\/(?!event-stream)|application\/(?:javascript|json|wasm|xml)|image\/svg|model\/gltf)/;

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

/** Marks an answer as one of several encodings of the same address. */
function addVary(res: ServerResponse): void {
	const vary = res.getHeader('Vary');
	if (!vary) res.setHeader('Vary', 'Accept-Encoding');
	else if (!/accept-encoding/i.test(String(vary)))
		res.setHeader('Vary', `${vary}, Accept-Encoding`);
}

/**
 * Compresses the answers of the steps after it, for the requests that `wanted` picks. It holds back
 * an answer's headers until its first bytes, then, when the answer is worth it, collects its body
 * and sends it compressed. An answer that is already encoded, or that is not text or WebAssembly,
 * goes as it is.
 */
export function compressAnswers(
	wanted: (req: IncomingMessage) => boolean,
	bodies = new CompressedBodies(false),
): Connect.NextHandleFunction {
	return (req, res, next) => {
		const encoding = acceptedEncoding(req.headers['accept-encoding']);
		if (encoding === 'identity' || req.method !== 'GET' || !wanted(req)) return next();
		const { writeHead, write, end } = res;
		const sendRest = end as (...args: unknown[]) => ServerResponse;
		/** True once the answer goes on as it is, or compressed: each call then passes straight on. */
		let through = false;
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
		const ownWriteHead = function (this: ServerResponse, status: number, ...rest: unknown[]) {
			if (through)
				return (writeHead as (...args: unknown[]) => ServerResponse).call(res, status, ...rest);
			res.statusCode = status;
			if (typeof rest[0] === 'string') res.statusMessage = rest.shift() as string;
			if (rest[0]) setHeaders(res, rest[0] as OutgoingHttpHeaders);
			return res;
		} as ServerResponse['writeHead'];
		/**
		 * Lets the answer go on: puts back the functions that this step replaced, and sends the
		 * headers that it held back. A later step, such as Vite's own compression in the preview
		 * server, may have wrapped the same functions over these. Its wrappers stay in place, and
		 * this step's functions then pass every call straight on: put back, the answer's last call
		 * would skip that step, and end the answer before the bytes it still holds.
		 */
		const handOn = () => {
			through = true;
			if (res.writeHead === ownWriteHead) res.writeHead = writeHead;
			if (res.write === ownWrite) res.write = write;
			if (res.end === ownEnd) res.end = end;
			if (!res.headersSent)
				(writeHead as (...args: unknown[]) => ServerResponse).call(res, res.statusCode);
		};
		// Decides once, at the first bytes or the end, whether this answer is collected and compressed.
		const start = (): boolean => {
			if (!compressible(req, res)) {
				handOn();
				return false;
			}
			chunks = [];
			return true;
		};
		const ownWrite = function (this: ServerResponse, chunk: unknown, ...rest: unknown[]) {
			if (through || (!chunks && !start()))
				return (write as (...args: unknown[]) => boolean).call(res, chunk, ...rest);
			chunks?.push(toBuffer(chunk, rest[0]));
			return true;
		} as ServerResponse['write'];
		const ownEnd = function (this: ServerResponse, ...args: unknown[]) {
			if (through || (!chunks && !start())) return sendRest.apply(res, args);
			const [last] = args;
			if (last !== undefined && last !== null && typeof last !== 'function')
				chunks?.push(toBuffer(last, args[1]));
			const done = args.find((arg) => typeof arg === 'function') as (() => void) | undefined;
			const raw = Buffer.concat(chunks ?? []);
			if (raw.length < SMALLEST) {
				res.setHeader('Content-Length', raw.length);
				handOn();
				return sendRest.call(res, raw, done);
			}
			const key = createHash('sha1').update(raw).digest('base64');
			bodies
				.body(key, encoding, async () => raw)
				.then(
					(body) => {
						if (body) res.setHeader('Content-Encoding', encoding);
						res.setHeader('Content-Length', (body ?? raw).length);
						addVary(res);
						handOn();
						sendRest.call(res, body ?? raw, done);
					},
					(e: Error) => {
						res.statusCode = 500;
						res.removeHeader('Content-Length');
						res.setHeader('Content-Type', 'text/plain');
						handOn();
						sendRest.call(res, `null3D: compressing ${req.url} failed: ${e.message}`);
					},
				);
			return res;
		} as ServerResponse['end'];
		res.writeHead = ownWriteHead;
		res.write = ownWrite;
		res.end = ownEnd;
		next();
	};
}

/**
 * The types of the build's files that the preview compresses, by extension. A file that compresses
 * no further, such as a model whose textures are compressed images, goes as it is.
 */
const FILE_TYPES: Readonly<Record<string, string>> = {
	'.glb': 'model/gltf-binary',
	'.gltf': 'model/gltf+json',
	'.bin': 'application/octet-stream',
	'.js': 'text/javascript',
	'.mjs': 'text/javascript',
	'.css': 'text/css',
	'.wasm': 'application/wasm',
	'.json': 'application/json',
	'.map': 'application/json',
	'.svg': 'image/svg+xml',
	'.txt': 'text/plain',
	'.xml': 'application/xml',
};

/**
 * Answers each request for a text, WebAssembly or model file of the build in `dir` compressed, with the
 * headers that the preview gives its files and `headers` added. The steps before it set the
 * caching. Other requests, and requests for a range or with no compression accepted, go on to the
 * preview's own file server. `base` is the start of every file's address.
 */
export function compressedFiles(
	dir: string,
	base: string,
	headers: OutgoingHttpHeaders = {},
	bodies = new CompressedBodies(true),
): Connect.NextHandleFunction {
	const root = normalize(dir + sep);
	return (req, res, next) => {
		bodies.track(res);
		const encoding = acceptedEncoding(req.headers['accept-encoding']);
		if (encoding === 'identity' || req.method !== 'GET' || req.headers.range) return next();
		const path = (req.url ?? '').split(/[?#]/)[0] ?? '';
		if (!path.startsWith(base)) return next();
		const type = FILE_TYPES[extname(path).toLowerCase()];
		if (!type) return next();
		let file: string;
		try {
			file = normalize(join(root, decodeURIComponent(path.slice(base.length))));
		} catch {
			return next();
		}
		if (!file.startsWith(root)) return next();
		const tagOf = (size: number, mtime: Date) => `W/"${size}-${mtime.getTime()}"`;
		void (async () => {
			const info = await stat(file).catch(() => undefined);
			if (!info?.isFile()) return next();
			const etag = tagOf(info.size, info.mtime);
			for (const [name, value] of Object.entries(headers))
				if (value !== undefined) res.setHeader(name, value);
			res.setHeader('Content-Type', type);
			res.setHeader('Last-Modified', info.mtime.toUTCString());
			res.setHeader('ETag', etag);
			if (!res.hasHeader('Cache-Control')) res.setHeader('Cache-Control', 'no-cache');
			addVary(res);
			if (req.headers['if-none-match'] === etag) {
				res.statusCode = 304;
				res.end();
				return;
			}
			const read = async () => {
				const now = await stat(file);
				if (tagOf(now.size, now.mtime) !== etag) throw new Error(`${file} changed`);
				return readFile(file);
			};
			const compressed =
				info.size < SMALLEST ? null : await bodies.body(`${file}\0${etag}`, encoding, read);
			if (compressed) res.setHeader('Content-Encoding', encoding);
			const body = compressed ?? (await readFile(file));
			res.setHeader('Content-Length', body.length);
			res.statusCode = 200;
			res.end(body);
		})().catch(next);
	};
}
