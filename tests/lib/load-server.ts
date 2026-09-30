// The server side of startup measurements. A Vite plugin serves the production build of the engine
// test page under the load addresses of load-routes.ts, on the dev server and on `vite preview`,
// and counts what it sent for each load. It serves each file as a host that compresses its files
// ahead of time would, with Brotli, and with the caching that the null3D Vite plugin gives a
// production build: hashed files are immutable, and the page is checked again on each visit. The
// build has relative addresses, so a load's prefix reaches every file that the page, its workers
// and the engine core ask for.
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join } from 'node:path';
import { promisify } from 'node:util';
import { brotliCompress, constants, gzip } from 'node:zlib';
import { ISOLATION_HEADERS, immutableAssetsMiddleware } from '@null3d/vite-plugin';
import type { Connect, Plugin } from 'vite';
import {
	type DownloadedFile,
	type Downloads,
	LOAD_READY_ROUTE,
	LOAD_ROUTE,
	type Load,
	parseDownloadsPath,
	parseLoadPath,
} from './load-routes.ts';
import { send } from './report-collector.ts';
import { localFetch, REPO_ROOT } from './server.ts';

/** Where the startup build goes, from the repository's root. */
const STARTUP_PAGES = 'target/startup-pages';
export const STARTUP_PAGES_DIR = join(REPO_ROOT, STARTUP_PAGES);

/**
 * Builds the engine test page for production with relative addresses, into its own folder, so a
 * build for the other tests never replaces the files that a startup run serves.
 */
export function buildStartupPages(): void {
	const args = ['vite', 'build', '--base', './', '--outDir', STARTUP_PAGES];
	const build = spawnSync('bunx', args, { cwd: REPO_ROOT, encoding: 'utf8' });
	if (build.status !== 0)
		throw new Error(`the production build failed:\n${build.stdout}\n${build.stderr}`);
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.json': 'application/json',
	'.wasm': 'application/wasm',
	'.css': 'text/css; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
};
/** Files a host compresses: text, scripts and WebAssembly. */
const COMPRESSED = new Set(['.html', '.js', '.json', '.wasm', '.css', '.svg']);

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

/** A file's bodies, each ready to send, and the tag that a browser checks its cached copy with. */
interface Encoded {
	bodies: { identity: Buffer; br?: Buffer; gzip?: Buffer };
	etag: string;
}

const brotli = promisify(brotliCompress);
const gzipped = promisify(gzip);

/** Compresses a file's bytes, off this thread, at the Brotli quality that the size report measures. */
async function encode(raw: Buffer, compressed: boolean): Promise<Encoded> {
	const etag = `W/"${createHash('sha1').update(raw).digest('hex').slice(0, 16)}"`;
	if (!compressed) return { bodies: { identity: raw }, etag };
	const [br, gz] = await Promise.all([
		brotli(raw, {
			params: {
				[constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
				[constants.BROTLI_PARAM_SIZE_HINT]: raw.length,
			},
		}),
		gzipped(raw, { level: constants.Z_BEST_COMPRESSION }),
	]);
	return { bodies: { identity: raw, br, gzip: gz }, etag };
}

const MODULE_HEADER = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
/** The name of the custom section that marks a cold load's core. */
export const MARK_SECTION = 'null3d-load';

function leb128(value: number): number[] {
	const bytes: number[] = [];
	let rest = value;
	do {
		const low = rest & 0x7f;
		rest >>>= 7;
		bytes.push(rest === 0 ? low : low | 0x80);
	} while (rest !== 0);
	return bytes;
}

/**
 * A copy of a WebAssembly module with a custom section of `mark` bytes right after its header, which
 * browsers skip. Chrome reuses a module compiled earlier in the same process when a download has the
 * same bytes, and it recognizes a module by the sections before its code. A section at the start
 * makes it compile each cold load's core from scratch, as a first visit does.
 */
export function markCore(core: Uint8Array, mark: Uint8Array): Uint8Array {
	if (!MODULE_HEADER.every((byte, i) => core[i] === byte))
		throw new Error('the core is not a WebAssembly module');
	const name = new TextEncoder().encode(MARK_SECTION);
	const payload = [...leb128(name.length), ...name, ...mark];
	const section = [0, ...leb128(payload.length), ...payload];
	const marked = new Uint8Array(core.length + section.length);
	marked.set(core.subarray(0, MODULE_HEADER.length));
	marked.set(section, MODULE_HEADER.length);
	marked.set(core.subarray(MODULE_HEADER.length), MODULE_HEADER.length + section.length);
	return marked;
}

/** Marked copies of each core that the server keeps ready, so no cold load waits for Brotli. */
const MARKED_AHEAD = 2;

const version = (file: string) => {
	const { mtimeMs, size } = statSync(file);
	return `${mtimeMs}:${size}`;
};

/** Every file of a build, by its path in the build. */
function buildFiles(dir: string): string[] {
	return readdirSync(dir, { recursive: true, encoding: 'utf8' })
		.map((path) => path.replaceAll('\\', '/'))
		.filter((path) => statSync(join(dir, path)).isFile());
}

/**
 * Serves the build in `dir` for loads, and answers the routes that tools ask: what the server sent
 * for a load, and whether it is ready to serve the build.
 */
export function loadMiddleware(dir = STARTUP_PAGES_DIR): Connect.NextHandleFunction {
	const files = new Map<string, { version: string; encoded: Promise<Encoded> }>();
	const marked = new Map<string, { version: string; ready: Promise<Encoded>[] }>();
	const tallies = new Map<string, { firstAt: number; files: DownloadedFile[] }>();

	/** A file's bodies, compressed once per build. */
	const encodedFile = (file: string): Promise<Encoded> => {
		const current = version(file);
		const cached = files.get(file);
		if (cached?.version === current) return cached.encoded;
		const encoded = encode(readFileSync(file), COMPRESSED.has(extname(file)));
		files.set(file, { version: current, encoded });
		return encoded;
	};

	/** The copies of a core made so far, topped up in the background. */
	const markedCopies = (file: string) => {
		const current = version(file);
		let pool = marked.get(file);
		if (pool?.version !== current) {
			pool = { version: current, ready: [] };
			marked.set(file, pool);
		}
		while (pool.ready.length < MARKED_AHEAD) {
			const copy = encode(Buffer.from(markCore(readFileSync(file), randomBytes(16))), true);
			// A failure surfaces when a load takes the copy, not as an unhandled rejection now.
			copy.catch(() => {});
			pool.ready.push(copy);
		}
		return pool.ready;
	};

	const takeMarkedCopy = (file: string): Promise<Encoded> => {
		const copy = markedCopies(file).shift() as Promise<Encoded>;
		markedCopies(file);
		return copy;
	};

	const tallyKey = ({ kind, key }: Load) => `${kind}/${key}`;

	/** What the server sent for a load since it was last asked; the count then starts afresh. */
	const takeTally = (load: Load): Downloads => {
		const tally = tallies.get(tallyKey(load));
		tallies.delete(tallyKey(load));
		const sent = tally?.files ?? [];
		return {
			requests: sent.length,
			bytes: sent.reduce((sum, file) => sum + file.bytes, 0),
			files: sent,
		};
	};

	async function serve(req: IncomingMessage, res: ServerResponse, url: string): Promise<void> {
		const arrived = performance.now();
		const asked = parseLoadPath(url);
		for (const [name, value] of Object.entries(ISOLATION_HEADERS)) res.setHeader(name, value);
		if (!asked) {
			res.statusCode = 404;
			res.end();
			return;
		}
		const tally = tallies.get(tallyKey(asked)) ?? { firstAt: arrived, files: [] };
		tallies.set(tallyKey(asked), tally);
		const record = (status: number, bytes: number, encoding: Encoding) =>
			tally.files.push({
				path: asked.path,
				status,
				bytes,
				encoding,
				atMs: Math.round(arrived - tally.firstAt),
			});
		const file = join(dir, asked.path);
		if (!existsSync(file) || !statSync(file).isFile()) {
			res.statusCode = 404;
			res.end();
			record(404, 0, 'identity');
			return;
		}
		// The null3D plugin's caching of a production build, for the file's path in the build.
		immutableAssetsMiddleware({ url: `/${asked.path}` } as IncomingMessage, res, () => {});
		if (!res.hasHeader('Cache-Control')) res.setHeader('Cache-Control', 'no-cache');
		const marks = asked.kind === 'cold' && extname(file) === '.wasm';
		const encoded = await (marks ? takeMarkedCopy(file) : encodedFile(file));
		res.setHeader('Content-Type', CONTENT_TYPES[extname(file)] ?? 'application/octet-stream');
		if (COMPRESSED.has(extname(file))) res.setHeader('Vary', 'Accept-Encoding');
		const wanted = acceptedEncoding(req.headers['accept-encoding']);
		const encoding: Encoding = encoded.bodies[wanted] ? wanted : 'identity';
		if (!marks) {
			res.setHeader('ETag', encoded.etag);
			if (req.headers['if-none-match'] === encoded.etag) {
				res.statusCode = 304;
				res.end();
				record(304, 0, encoding);
				return;
			}
		}
		const body = encoded.bodies[encoding] ?? encoded.bodies.identity;
		if (encoding !== 'identity') res.setHeader('Content-Encoding', encoding);
		res.setHeader('Content-Length', body.length);
		res.statusCode = 200;
		res.end(req.method === 'HEAD' ? undefined : body);
		record(200, body.length, encoding);
	}

	/** Compresses every file of the build and a copy of each core ahead of the first load. */
	async function prepare(): Promise<{ files: number } | undefined> {
		if (!existsSync(dir)) return undefined;
		const paths = buildFiles(dir).map((path) => join(dir, path));
		await Promise.all([
			...paths.map(encodedFile),
			...paths.filter((file) => extname(file) === '.wasm').flatMap(markedCopies),
		]);
		return { files: paths.length };
	}

	const json = (res: ServerResponse, status: number, body: unknown) =>
		send(res, status, JSON.stringify(body));

	return (req, res, next) => {
		const url = req.url ?? '/';
		const load = parseDownloadsPath(url);
		if (load) return json(res, 200, takeTally(load));
		if (url === LOAD_READY_ROUTE)
			return void prepare().then(
				(ready) =>
					ready
						? json(res, 200, ready)
						: json(res, 404, { error: `no startup build in ${dir}; build it first` }),
				(error: unknown) => json(res, 500, { error: String(error) }),
			);
		if (!url.startsWith(LOAD_ROUTE)) return next();
		serve(req, res, url).catch((error: unknown) => {
			if (res.headersSent) res.destroy();
			else json(res, 500, { error: String(error) });
		});
	};
}

/** The plugin that adds the load routes to the dev server and to `vite preview`. */
export function loadServer(dir = STARTUP_PAGES_DIR): Plugin {
	const middleware = loadMiddleware(dir);
	return {
		name: 'null3d-load-server',
		configureServer(server) {
			server.middlewares.use(middleware);
		},
		configurePreviewServer(server) {
			server.middlewares.use(middleware);
		},
	};
}

/**
 * Asks the server at `serverUrl`, as this computer reaches it, to prepare the build for loads. It
 * throws when the server cannot serve them, as a server started before the load routes existed.
 */
export async function prepareLoads(serverUrl: string): Promise<void> {
	const response = await localFetch(`${serverUrl}${LOAD_READY_ROUTE}`);
	if (response.ok) return;
	const { error } = (await response.json().catch(() => ({}))) as { error?: string };
	throw new Error(
		`${serverUrl} cannot serve startup loads (HTTP ${response.status}): ${error ?? 'restart its dev server, which predates the load routes'}`,
	);
}
