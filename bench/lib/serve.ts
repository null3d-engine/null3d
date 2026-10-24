// Serves the benchmark pages to the tools that run them on this computer. By default they get the
// production build, as a developer ships the engine: bench/vite.pages.config.ts builds the pages,
// and `vite preview` serves the build. The development option serves the dev server's pages
// instead, where the engine runs its development checks. A comparison keeps each checkout's build
// with a stamp of the sources that it came from, and builds it again only when they change.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	BENCH_PAGES_DIR,
	buildBenchPages,
	LOAD_BUILDS,
	LOAD_PAGES_SWITCH,
	makeLoadBuild,
} from '../../tests/lib/load-server.ts';
import {
	type DevServer,
	PREVIEW_PORT,
	REPO_ROOT,
	startPreview,
	startServer,
	startServerAt,
} from '../../tests/lib/server.ts';
import { BuildNames } from './source-names';

/** The option that picks the dev server's pages. */
export const DEV_OPTION = '--dev';

/** Which pages a run measured, in a few words for its report. */
export const pagesText = (dev: boolean) =>
	dev ? 'development pages, with development checks' : 'production build';

/** The benchmark pages' server, and for a production build, the names of the build's functions. */
export interface BenchPages extends DevServer {
	names?: BuildNames;
}

export interface ServeOptions {
	/** Serve the dev server's pages, whose engine runs its development checks. */
	dev?: boolean;
	/** The copy of the repository whose pages to serve: this one by default. */
	root?: string;
	/**
	 * The port. By default a build takes the preview port, and the dev server's pages come from this
	 * copy's dev server, which the tool reuses when it already runs.
	 */
	port?: number;
	/** Where the build goes: target/bench-pages by default. */
	outDir?: string;
	/** Keep the build in `outDir` when it came from the sources that the copy holds now. */
	reuse?: boolean;
}

/** The folder in which a comparison builds the pages of one of its two checkouts. */
export const comparePagesDir = (build: 'baseline' | 'new') =>
	join(REPO_ROOT, `target/bench-pages-${build}`);

/** The file in a build's folder that holds the stamp of the sources that the build came from. */
const STAMP_FILE = 'sources-stamp.txt';

/**
 * The folders of the engine's build, which bun run build writes and git ignores: the WebAssembly
 * files and the generated modules. The pages take them in as they are.
 */
const ENGINE_BUILD = ['packages/engine/dist', 'packages/engine/src/generated'];

/** A line for a file: its path, size and time, so that a file written again changes the line. */
function fileLine(root: string, path: string): string[] {
	const stat = statSync(join(root, path), { throwIfNoEntry: false });
	return stat?.isFile() ? [`${path}\0${stat.size}\0${stat.mtimeMs}`] : [];
}

/**
 * The stamp of the sources at `root` as they are now: the commit, every change to it that git
 * sees, the files that git does not track yet, and the engine's build. A build of the pages with
 * the same stamp came from the same sources.
 */
export function sourcesStamp(root: string): string {
	const git = (...args: string[]) =>
		execFileSync('git', ['-C', root, ...args], { maxBuffer: 1 << 30 });
	const hash = createHash('sha256');
	hash.update(git('rev-parse', 'HEAD'));
	hash.update(git('diff', 'HEAD', '--binary'));
	const paths = git('ls-files', '--others', '--exclude-standard', '-z').toString().split('\0');
	for (const folder of ENGINE_BUILD)
		if (existsSync(join(root, folder)))
			for (const path of readdirSync(join(root, folder), { recursive: true, encoding: 'utf8' }))
				paths.push(join(folder, path));
	hash.update(
		paths
			.filter(Boolean)
			.sort()
			.flatMap((path) => fileLine(root, path))
			.join('\n'),
	);
	return hash.digest('hex');
}

/** The stamp of the sources that the build in `outDir` came from, or null without one. */
function builtStamp(outDir: string): string | null {
	const file = join(outDir, STAMP_FILE);
	return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

/** True when `outDir` holds a build of the pages of the sources at `root` as they are now. */
export const benchPagesFresh = (root: string, outDir: string) =>
	builtStamp(outDir) === sourcesStamp(root);

/**
 * Builds the pages of the copy at `root` into `outDir`, unless the build there came from the same
 * sources. Returns true when it built them.
 */
export function ensureBenchPages(root: string, outDir: string): boolean {
	const stamp = sourcesStamp(root);
	if (builtStamp(outDir) === stamp) return false;
	buildBenchPages(root, outDir);
	writeFileSync(join(outDir, STAMP_FILE), stamp);
	return true;
}

/**
 * Serves a build of the benchmark pages that is already made, such as a prepared baseline's, from
 * the copy of the repository at `root`.
 */
export async function serveBuiltPages(
	outDir: string,
	port: number,
	root = REPO_ROOT,
): Promise<BenchPages> {
	const server = await startPreview(outDir, port, '/bench/pages/index.html', root);
	return { ...server, names: new BuildNames(outDir) };
}

/** Builds and serves the benchmark pages, or serves the dev server's pages. */
export async function serveBenchPages({
	dev = false,
	root = REPO_ROOT,
	port,
	outDir = BENCH_PAGES_DIR,
	reuse = false,
}: ServeOptions = {}): Promise<BenchPages> {
	if (dev) return port === undefined ? startServer() : startServerAt(root, port);
	// A build that an earlier step made serves as it is when the switch says so, as in CI.
	const load = LOAD_BUILDS.find((build) => build.dir === outDir);
	if (load && process.env[LOAD_PAGES_SWITCH] === 'prebuilt') makeLoadBuild(load);
	else if (reuse) ensureBenchPages(root, outDir);
	else buildBenchPages(root, outDir);
	return serveBuiltPages(outDir, port ?? PREVIEW_PORT, root);
}
