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

/** A file of at least this size can take seconds to compress, so the server says what it is doing. */
const SLOW_BYTES = 256 * 1024;

/** Once this much compression time has passed, the server prints a line with the running rate. */
const COMPRESSION_REPORT_MS = 60_000;

/** Compresses a file's bytes, off this thread, at the Brotli quality that the size report measures. */
async function encode(raw: Buffer, compressed: boolean, what?: string): Promise<Encoded> {
	const etag = `W/"${createHash('sha1').update(raw).digest('hex').slice(0, 16)}"`;
	if (!compressed) return { bodies: { identity: raw }, etag };
	// A run reads the log to see what the server is doing, so a large file is named while it is
	// compressed and again when it ends. Nothing here may go quiet for minutes: a job that is killed
	// during a silent step leaves a log with no output at all, which tells a reader nothing.
	const loud = what !== undefined && raw.length >= SLOW_BYTES;
	if (loud)
		console.log(`null3d load server: compressing ${what} (${Math.round(raw.length / 1024)} KB)`);
	const started = Date.now();
	try {
		const [br, gz] = await Promise.all([
			brotli(raw, {
				params: {
					[constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
					[constants.BROTLI_PARAM_SIZE_HINT]: raw.length,
				},
			}),
			gzipped(raw, { level: constants.Z_BEST_COMPRESSION }),
		]);
		if (loud) console.log(`null3d load server: compressed ${what} in ${Date.now() - started} ms`);
		return { bodies: { identity: raw, br, gzip: gz }, etag };
	} catch (error) {
		console.error(
			`null3d load server: could not compress ${what ?? 'a file'} after ${Date.now() - started} ms: ${String(error)}`,
		);
		throw error;
	}
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

/** What the ready route answers: how many files the builds it serves hold, and the builds they are of. */
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
	/** The last readiness line printed, so a caller that asks every few seconds is not answered twice. */
	let announced = '';
	/** What compressing has cost so far, printed as a rate, so a slow run shows in the log. */
	const cost = { files: 0, bytes: 0, ms: 0 };
	let nextCostLine = COMPRESSION_REPORT_MS;

	/**
	 * Notes what one compression cost. Every minute of compression prints a line with the running
	 * rate, so a run that compresses far more than it should, as a file that no store holds, or a
	 * machine under another load, shows as a figure in the log rather than as minutes of silence.
	 */
	const noteCompression = (ms: number, bytes: number): void => {
		cost.files++;
		cost.bytes += bytes;
		cost.ms += ms;
		if (cost.ms < nextCostLine) return;
		nextCostLine += COMPRESSION_REPORT_MS;
		const mb = cost.bytes / 1048576;
		const seconds = cost.ms / 1000;
		console.log(
			`null3d load server: compressed ${cost.files} files, ${mb.toFixed(1)} MB, in ${seconds.toFixed(1)} s (${(mb / seconds).toFixed(2)} MB/s)`,
		);
	};

	/** A file's bodies, compressed once per build. The first ask for a file pays for it. */
	const encodedFile = (file: string): Promise<Encoded> => {
		const current = version(file);
		const cached = files.get(file);
		if (cached?.version === current) return cached.encoded;
		const raw = readFileSync(file);
		const started = Date.now();
		const encoded = encode(raw, COMPRESSED.has(extname(file)), file);
		void encoded.then(
			() => noteCompression(Date.now() - started, raw.length),
			() => noteCompression(Date.now() - started, raw.length),
		);
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
			const raw = Buffer.from(markCore(readFileSync(file), randomBytes(16)));
			const started = Date.now();
			const copy = encode(raw, true, `a marked copy of ${file}`);
			void copy.then(
				() => noteCompression(Date.now() - started, raw.length),
				() => noteCompression(Date.now() - started, raw.length),
			);
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
	 * What the builds the caller names hold, without compressing any of them. A build's files are
	 * those its prefix reaches, so a file of another build's folder is left out. The server compresses
	 * a file when a load first asks for it, so a run never waits for work that prints nothing, and a
	 * caller pays only for the files its own loads ask for.
	 */
	function readiness(needed: readonly string[]): Readiness | undefined {
		const present = builds.filter(
			({ dir, name }) => existsSync(dir) && (needed.length === 0 || needed.includes(name)),
		);
		if (present.length === 0) return undefined;
		const files = present.reduce(
			(total, build) =>
				total + buildFiles(build.dir).filter((path) => buildOf(path, builds) === build).length,
			0,
		);
		return { files, builds: present.map(({ name }) => name) };
	}

	const json = (res: ServerResponse, status: number, body: unknown) =>
		send(res, status, JSON.stringify(body));

	return (req, res, next) => {
		const url = req.url ?? '/';
		const load = parseDownloadsPath(url);
		if (load) return json(res, 200, takeTally(load));
		if (url.startsWith(LOAD_READY_ROUTE)) {
			// The caller names the builds it will load, so the answer says whether they are here.
			const asked = new URL(url, 'http://localhost').searchParams.get('builds') ?? '';
			const ready = readiness(asked.split(',').filter(Boolean));
			const summary = ready
				? `${ready.builds.join(', ')}: ${ready.files} files`
				: 'no production build';
			// A run reads the log to see that the server answered, so the line is printed once per
			// answer rather than once per ask, which the caller repeats every few seconds.
			if (summary !== announced) {
				console.log(`null3d load server: ready to serve ${summary}, each file on its first ask`);
				announced = summary;
			}
			return json(
				res,
				ready ? 200 : 404,
				ready ?? { error: 'no production build to serve; build one first' },
			);
		}
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
/**
 * How long a caller keeps asking a server that has not answered yet, and how long it waits between
 * asks. The route answers from the builds on disk and compresses nothing, so an ask is normally
 * answered in one round trip. A device reaches the Mac's HTTPS server over the Mac's own name, where
 * a single fetch can still time out: measured on 15 October 2026, a fetch failed with `The operation
 * timed out.` after 361 seconds, while the same call over HTTP waited and succeeded. So a caller asks
 * again rather than let one attempt's timeout end the run, and the server prints one line when it
 * answers, which names the builds it serves and the files they hold.
 */
const READY_BUDGET_MS = 5 * 60_000;
const READY_RETRY_MS = 5_000;

export async function prepareLoads(serverUrl: string, needed: readonly string[]): Promise<void> {
	// The caller names the builds its loads reach, so the server answers for those and no others.
	const asked = needed.length > 0 ? `?builds=${encodeURIComponent(needed.join(','))}` : '';
	const started = performance.now();
	let response: Response;
	for (;;) {
		try {
			response = await localFetch(`${serverUrl}${LOAD_READY_ROUTE}${asked}`);
			break;
		} catch (error) {
			if (performance.now() - started > READY_BUDGET_MS) throw error;
			await new Promise((resolve) => setTimeout(resolve, READY_RETRY_MS));
		}
	}
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
