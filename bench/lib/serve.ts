// Serves the benchmark pages to the tools that run them on this computer. By default they get the
// production build, as a developer ships the engine: bench/vite.pages.config.ts builds the pages,
// and `vite preview` serves the build. The development option serves the dev server's pages
// instead, where the engine runs its development checks.
import { BENCH_PAGES_DIR, buildBenchPages } from '../../tests/lib/load-server.ts';
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
}

/** Builds and serves the benchmark pages, or serves the dev server's pages. */
export async function serveBenchPages({
	dev = false,
	root = REPO_ROOT,
	port,
	outDir = BENCH_PAGES_DIR,
}: ServeOptions = {}): Promise<BenchPages> {
	if (dev) return port === undefined ? startServer() : startServerAt(root, port);
	buildBenchPages(root, outDir);
	const server = await startPreview(outDir, port ?? PREVIEW_PORT, '/bench/pages/index.html');
	return { ...server, names: new BuildNames(outDir) };
}
