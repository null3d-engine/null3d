// The groups of the unit run. A group is one `bun test` invocation, so the memory its files hold
// together is what the run pays for it, and the largest group sets the run's peak
// ([Test memory](../../.dev/tests.md)).
//
// The demos' group is read from the tree: every top-level folder under `examples` that holds a test
// file, at any depth, joins it. A demo folder that arrives with a test then runs without an edit
// here, and a demo folder that the run leaves out fails `unit-groups.test.ts`.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/** The repository, which the groups' paths are relative to. */
export const REPO_ROOT = join(import.meta.dirname, '..', '..');

/** The folder names that never reach the run: dependencies and build output. */
const SKIPPED_FOLDERS = new Set(['node_modules', 'target']);

/** The suffix that marks a test file. */
const TEST_SUFFIX = '.test.ts';

/** Whether `folder` holds a test file, directly or under a folder of its own. */
export function holdsTestFile(folder: string): boolean {
	for (const item of readdirSync(folder, { withFileTypes: true })) {
		if (item.isFile() && item.name.endsWith(TEST_SUFFIX)) return true;
		if (item.isDirectory() && !SKIPPED_FOLDERS.has(item.name)) {
			if (holdsTestFile(join(folder, item.name))) return true;
		}
	}
	return false;
}

/**
 * The top-level folders under `parent`, relative to the repository, that hold a test file at any
 * depth, sorted. A folder joins the unit run by holding one.
 */
export function foldersHoldingTests(parent: string): string[] {
	return readdirSync(join(REPO_ROOT, parent), { withFileTypes: true })
		.filter((item) => item.isDirectory() && holdsTestFile(join(REPO_ROOT, parent, item.name)))
		.map((item) => item.name)
		.sort();
}

/**
 * The groups of the run: the tools, each package, the benchmark's scenes and pages, the test
 * helpers, and every demo folder that holds a test file.
 */
export const UNIT_GROUPS: readonly (readonly string[])[] = [
	['tools'],
	...readdirSync(join(REPO_ROOT, 'packages')).map((name) => [`packages/${name}`]),
	['bench/scenes', 'bench/pages', 'bench/lib'],
	['tests/lib'],
	foldersHoldingTests('examples').map((name) => `examples/${name}`),
];
