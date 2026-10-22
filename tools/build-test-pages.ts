// Writes the production build of the test pages, which the production build tests serve, into
// target/production-pages: the pages named on the command line, or every page when none is named.
// Run from the repository root, after `bun run build`:
//   bun tools/build-test-pages.ts [page...]
// The builds run one at a time, and each takes the machine's lock of page builds: each page's build
// bundles the whole shader set, which takes about 10 GB of memory at its peak and one core, so two
// at once would not fit a CI machine.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { PRODUCTION_BUILD_PAGES } from '../tests/lib/server.ts';
import { acquirePageBuildLock, secondsSince } from './lib/build-cache.ts';

const root = join(import.meta.dirname, '..');

/** The pages that `named` asks for, in build order, or every page when it names none. */
export function pagesToBuild(named: readonly string[]): string[] {
	const pages: readonly string[] = PRODUCTION_BUILD_PAGES;
	const unknown = named.filter((page) => !pages.includes(page));
	if (unknown.length > 0)
		throw new Error(
			`no test page is named ${unknown.join(', ')}; the pages are ${PRODUCTION_BUILD_PAGES.join(', ')}`,
		);
	return pages.filter((page) => named.length === 0 || named.includes(page));
}

function main(): void {
	for (const page of pagesToBuild(process.argv.slice(2))) {
		const started = performance.now();
		const release = acquirePageBuildLock();
		// The build lists every file that it writes, thousands of shader modules for each page, so it
		// reports only its warnings and errors.
		const build = spawnSync('bunx', ['vite', 'build', '--logLevel', 'warn'], {
			cwd: root,
			stdio: 'inherit',
			env: { ...process.env, NULL3D_BUILD_PAGE: page },
		});
		release();
		if (build.status !== 0) throw new Error(`the build of the ${page} page failed`);
		console.log(`Built the ${page} page in ${secondsSince(started)} s.`);
	}
}

if (import.meta.main) {
	try {
		main();
	} catch (e) {
		console.error(`error: ${(e as Error).message}`);
		process.exit(1);
	}
}
