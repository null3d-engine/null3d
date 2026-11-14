// Writes the production build of the test pages, which the production build tests serve, into
// target/production-pages: the pages named on the command line, or every page when none is named.
// Run from the repository root, after `bun run build`:
//   bun tools/build-test-pages.ts [page...]
// Up to four pages build at once, each into a folder of its own, and the folders merge into the
// output folder when the builds finish. A build reads about a gigabyte and holds one core, so four
// leave most of the machine's memory and cores free, and the eight pages take two rounds.
import { spawn } from 'node:child_process';
import { mkdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { PRODUCTION_BUILD_PAGES } from '../tests/lib/server.ts';
import { acquirePageBuildLock, secondsSince } from './lib/build-cache.ts';
import { refuseStaleCore } from './lib/core-sources.ts';
import { refuseInQuietWindow } from './lib/quiet-window.ts';

const root = join(import.meta.dirname, '..');

/** Where the merged build lands, which the production tests serve. */
const OUTPUT = join(root, 'target/production-pages');

/** Where each page's build writes before the merge. */
const STAGING = join(root, 'target/production-pages.staging');

/**
 * The most page builds that run at once. Each writes into a folder of its own, so the builds share
 * no output; they cost about a gigabyte and a core each.
 */
const MOST_AT_ONCE = 4;

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

/** Builds one page into its staging folder, and gives back whether the build passed. */
function buildPage(page: string): Promise<boolean> {
	const started = performance.now();
	return new Promise((resolve) => {
		// The build lists every file that it writes, thousands of shader modules for each page, so it
		// reports only its warnings and errors.
		const build = spawn(
			'bunx',
			['vite', 'build', '--logLevel', 'warn', '--outDir', join(STAGING, page)],
			{ cwd: root, stdio: 'inherit', env: { ...process.env, NULL3D_BUILD_PAGE: page } },
		);
		let ended = false;
		const end = (passed: boolean) => {
			if (ended) return;
			ended = true;
			if (passed) console.log(`Built the ${page} page in ${secondsSince(started)} s.`);
			else console.error(`the build of the ${page} page failed`);
			resolve(passed);
		};
		build.once('error', () => end(false));
		build.once('close', (code) => end(code === 0));
	});
}

/** Builds the pages, as many at once as MOST_AT_ONCE, and gives back the ones that failed. */
async function buildAll(pages: readonly string[]): Promise<string[]> {
	const failed: string[] = [];
	let next = 0;
	const worker = async () => {
		for (let at = next++; at < pages.length; at = next++) {
			const page = pages[at] as string;
			if (!(await buildPage(page))) failed.push(page);
		}
	};
	await Promise.all(Array.from({ length: Math.min(MOST_AT_ONCE, pages.length) }, worker));
	return failed;
}

/**
 * Moves each page's build into the output folder. The engine test page starts the folder again, as
 * its build does, and each other page adds a folder of its own under `assets`, so the moves rename
 * whole folders rather than copy their files. Each build writes its own list of files, and the last
 * page's list stays, as the builds of one tree leave it.
 */
function mergeStaged(pages: readonly string[]): void {
	if (pages.includes('engine')) rmSync(OUTPUT, { recursive: true, force: true });
	mkdirSync(join(OUTPUT, 'tests/pages'), { recursive: true });
	for (const page of pages) {
		const stage = join(STAGING, page);
		renameSync(
			join(stage, 'tests/pages', `${page}.html`),
			join(OUTPUT, 'tests/pages', `${page}.html`),
		);
		if (page === 'engine') {
			renameSync(join(stage, 'assets'), join(OUTPUT, 'assets'));
		} else {
			mkdirSync(join(OUTPUT, 'assets'), { recursive: true });
			rmSync(join(OUTPUT, 'assets', page), { recursive: true, force: true });
			renameSync(join(stage, 'assets', page), join(OUTPUT, 'assets', page));
		}
		renameSync(join(stage, 'null3d-files.json'), join(OUTPUT, 'null3d-files.json'));
	}
}

async function main(): Promise<void> {
	refuseInQuietWindow('The test page build');
	refuseStaleCore(root);
	const pages = pagesToBuild(process.argv.slice(2));
	// One batch of builds holds the machine's page-build lock, so another checkout's page build waits
	// for the whole batch, merge included, rather than loading the machine beside it.
	const release = acquirePageBuildLock();
	try {
		rmSync(STAGING, { recursive: true, force: true });
		const failed = await buildAll(pages);
		if (failed.length > 0) throw new Error(`the build of the ${failed.join(', ')} page failed`);
		mergeStaged(pages);
	} finally {
		rmSync(STAGING, { recursive: true, force: true });
		release();
	}
}

if (import.meta.main) {
	try {
		await main();
	} catch (e) {
		console.error(`error: ${(e as Error).message}`);
		process.exit(1);
	}
}
