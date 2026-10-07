// The server side of loads of production builds: the engine test page's build, which startup
// measurements load, and the benchmark pages' build, which benchmark runs on phones and tablets
// load. A Vite plugin serves both builds under the load addresses of load-routes.ts, on the dev
// server and on `vite preview`, and counts what it sent for each load. It serves each file as a
// host that compresses its files ahead of time would, with Brotli, and with the caching that the
// null3D Vite plugin gives a production build: hashed files are immutable, and the page is checked
// again on each visit. Each build has relative addresses, so a load's prefix reaches every file that
// the page, its workers and the engine core ask for.
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join } from 'node:path';
import { promisify } from 'node:util';
import { brotliCompress, constants, gzip } from 'node:zlib';
import type { Connect, Plugin } from 'vite';
import {
	ISOLATION_HEADERS,
	immutableAssetsMiddleware,
} from '../../packages/vite-plugin/src/index.ts';
import {
	type DownloadedFile,
	type Downloads,
	LOAD_READY_ROUTE,
	LOAD_ROUTE,
	type Load,
	loadedFile,
	parseDownloadsPath,
	parseLoadPath,
} from './load-routes.ts';
import { send } from './report-collector.ts';
import { localFetch, REPO_ROOT } from './server.ts';

/** Where the startup build goes. */
export const STARTUP_PAGES_DIR = join(REPO_ROOT, 'target/startup-pages');
/** Where the benchmark pages' build goes. */
export const BENCH_PAGES_DIR = join(REPO_ROOT, 'target/bench-pages');
/** The Vite config of the benchmark pages' build, from a copy of the repository's root. */
const BENCH_CONFIG = 'bench/vite.pages.config.ts';

/** Runs `vite build` in the repository copy at `root`, with `env` added. */
function viteBuild(root: string, args: readonly string[], env: Record<string, string> = {}): void {
	const build = spawnSync('bunx', ['vite', 'build', ...args], {
		cwd: root,
		encoding: 'utf8',
		env: { ...process.env, ...env },
	});
	if (build.status !== 0)
		throw new Error(`the production build failed:\n${build.stdout}\n${build.stderr}`);
}

/**
 * The test pages that the startup build holds besides the engine test page, each built on its own
 * so the engine test page stays as the startup benchmark loads it: the texture cache page, which
 * times loads of KTX2 files.
 */
const STARTUP_EXTRA_PAGES = ['texture-cache'];

/**
 * Builds the engine test page for production with relative addresses, into its own folder, so a
 * build for the other tests never replaces the files that a startup run serves. The other startup
 * pages add their files to it.
 */
export function buildStartupPages(): void {
	const args = ['--base', './', '--outDir', STARTUP_PAGES_DIR];
	viteBuild(REPO_ROOT, args);
	for (const page of STARTUP_EXTRA_PAGES) viteBuild(REPO_ROOT, args, { NULL3D_BUILD_PAGE: page });
}

/**
 * Builds the benchmark pages of the repository copy at `root` for production, into `outDir`, as
 * `bench/vite.pages.config.ts` says. A copy from before that file is built with this copy's.
 */
export function buildBenchPages(root = REPO_ROOT, outDir = BENCH_PAGES_DIR): void {
	const config = existsSync(join(root, BENCH_CONFIG)) ? root : REPO_ROOT;
	viteBuild(root, ['--config', join(config, BENCH_CONFIG), '--outDir', outDir], {
		NULL3D_BENCH_ROOT: root,
	});
}

/** A production build that the load routes serve. */
export interface LoadBuild {
	name: string;
	/** The start of the paths of the build's files; the first build whose start fits serves a path. */
	prefix: string;
	dir: string;
}

/**
 * The builds the load routes serve, and how to make each. Every file of the benchmark pages' build
 * lies under bench/, and the startup build holds the rest.
 */
export const LOAD_BUILDS: readonly (LoadBuild & { build(): void })[] = [
	{
		name: 'benchmark pages',
		prefix: 'bench/',
		dir: BENCH_PAGES_DIR,
		build: () => buildBenchPages(),
	},
	{ name: 'startup', prefix: '', dir: STARTUP_PAGES_DIR, build: buildStartupPages },
];

/** The build of `builds` that serves the file at `path`, a path in a build. */
function buildOf<T extends LoadBuild>(path: string, builds: readonly T[]): T | undefined {
	return builds.find(({ prefix }) => path.startsWith(prefix));
}

/** The builds that loads of these addresses need, each once. */
export function buildsForLoads(paths: readonly string[]): (typeof LOAD_BUILDS)[number][] {
	return LOAD_BUILDS.filter((build) =>
		paths.some((path) => {
			const file = loadedFile(path);
			return file !== undefined && buildOf(file, LOAD_BUILDS) === build;
		}),
	);
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

/** What the ready route answers: how many files the server prepared, and the builds they are of. */
interface Readiness {
	files: number;
	builds: string[];
}

/** Every file of a build, by its path in the build. */
function buildFiles(dir: string): string[] {
	return readdirSync(dir, { recursive: true, encoding: 'utf8' })
		.map((path) => path.replaceAll('\\', '/'))
		.filter((path) => statSync(join(dir, path)).isFile());
}

/**
 * Serves the builds in `builds` for loads, and answers the routes that tools ask: what the server
 * sent for a load, and which builds it is ready to serve.
 */
export function loadMiddleware(
	builds: readonly LoadBuild[] = LOAD_BUILDS,
): Connect.NextHandleFunction {
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
		const build = buildOf(asked.path, builds);
		const file = build ? join(build.dir, asked.path) : '';
		if (!build || !existsSync(file) || !statSync(file).isFile()) {
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

	/**
	 * Compresses every file of each build there is, and a copy of each core, ahead of the first load.
	 * A build's files are those its prefix reaches, so a file of another build's folder is left out.
	 */
	async function prepare(): Promise<Readiness | undefined> {
		const present = builds.filter(({ dir }) => existsSync(dir));
		if (present.length === 0) return undefined;
		const paths = present.flatMap((build) =>
			buildFiles(build.dir)
				.filter((path) => buildOf(path, builds) === build)
				.map((path) => join(build.dir, path)),
		);
		await Promise.all([
			...paths.map(encodedFile),
			...paths.filter((file) => extname(file) === '.wasm').flatMap(markedCopies),
		]);
		return { files: paths.length, builds: present.map(({ name }) => name) };
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
						: json(res, 404, { error: 'no production build to serve; build one first' }),
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
export function loadServer(): Plugin {
	const middleware = loadMiddleware();
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
 * Asks the server at `serverUrl`, as this computer reaches it, to prepare its builds for loads, and
 * checks that it serves each build `needed` names. It throws when the server cannot, as a server
 * started before the load routes, or before they served that build.
 */
export async function prepareLoads(serverUrl: string, needed: readonly string[]): Promise<void> {
	const response = await localFetch(`${serverUrl}${LOAD_READY_ROUTE}`);
	const answer = (await response.json().catch(() => ({}))) as Partial<Readiness> & {
		error?: string;
	};
	// A server from before the benchmark pages' build served the startup build alone.
	const served = answer.builds ?? ['startup'];
	const missing = needed.filter((name) => !served.includes(name));
	if (response.ok && missing.length === 0) return;
	const problem = response.ok
		? `it serves no ${missing.join(' or ')} build; restart its dev server, which predates that build`
		: (answer.error ?? 'restart its dev server, which predates the load routes');
	throw new Error(`${serverUrl} cannot serve the loads (HTTP ${response.status}): ${problem}`);
}
