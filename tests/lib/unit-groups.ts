// The groups of the unit run. A group is one `bun test` invocation, so the memory its files hold
// together is what the run pays for it, and the largest group sets the run's peak
// ([Test memory](../../.dev/tests.md)).
//
// The demos' group is read from the tree: every top-level folder under `examples` that holds a test
// file, at any depth, joins it. A demo folder that arrives with a test then runs without an edit
// here, and a demo folder that the run leaves out fails `unit-groups.test.ts`.
// A symbolic link is followed, so a linked folder's tests run too. A link back to a folder already
// read is not read again, and two links that point at each other with no folder behind them stop the
// walk with an error rather than hang. The rule covers files whose name ends with `.test.ts` inside a
// top-level folder, except under `node_modules` or `target`, which it skips at every depth. A test
// file directly under `examples`, and a test file with another extension, are outside it.
import { readdirSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** The repository, which the groups' paths are relative to. */
export const REPO_ROOT = join(import.meta.dirname, '..', '..');

/** The folder names that never reach the run: dependencies and build output. */
const SKIPPED_FOLDERS = new Set(['node_modules', 'target']);

/** The suffix that marks a test file. */
const TEST_SUFFIX = '.test.ts';

/** Whether `path` is a folder, following a symbolic link to one. */
function isFolder(path: string): boolean {
	return statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false;
}

/** Whether `folder` holds a test file, at any depth, with each folder read once. */
function holdsTestFileIn(folder: string, read: Set<string>): boolean {
	const real = realpathSync(folder);
	if (read.has(real)) return false;
	read.add(real);
	for (const item of readdirSync(folder, { withFileTypes: true })) {
		if (SKIPPED_FOLDERS.has(item.name)) continue;
		const child = join(folder, item.name);
		if (isFolder(child)) {
			if (holdsTestFileIn(child, read)) return true;
		} else if (item.name.endsWith(TEST_SUFFIX)) {
			if (statSync(child, { throwIfNoEntry: false })?.isFile()) return true;
		}
	}
	return false;
}

/** Whether `folder` holds a test file, directly or under a folder of its own. */
export function holdsTestFile(folder: string): boolean {
	return holdsTestFileIn(folder, new Set());
}

/**
 * The top-level folders under `parent`, relative to the repository, that hold a test file at any
 * depth, sorted. A folder joins the unit run by holding one.
 */
export function foldersHoldingTests(parent: string): string[] {
	return readdirSync(join(REPO_ROOT, parent), { withFileTypes: true })
		.filter((item) => !SKIPPED_FOLDERS.has(item.name))
		.map((item) => item.name)
		.filter((name) => isFolder(join(REPO_ROOT, parent, name)))
		.filter((name) => holdsTestFile(join(REPO_ROOT, parent, name)))
		.sort();
}

/** A group of the run: the paths it takes. */
export interface UnitGroup {
	/** The paths the group runs. */
	readonly paths: readonly string[];
	/**
	 * The seconds the group took in a whole run on the development Mac, from the run's own group
	 * lines. A group the run does not name weighs a second, so it starts with the short work.
	 */
	readonly seconds?: number;
}

/** The seconds each package's folder took in a whole run; a folder not named here weighs nothing. */
const PACKAGE_SECONDS: Readonly<Record<string, number>> = { cli: 23, engine: 18, 'vite-plugin': 2 };

/**
 * The groups of the run: the tools, each package, the benchmark's scenes and pages, the test
 * helpers, and every demo folder that holds a test file.
 *
 * They go longest first, because a lane takes the next group as soon as the one it holds ends: with
 * the long groups first both lanes stay busy to the end, and with them last one lane empties while
 * the other still works.
 */
export const UNIT_GROUPS: readonly UnitGroup[] = (
	[
		{ paths: ['tools'], seconds: 66 },
		...readdirSync(join(REPO_ROOT, 'packages')).map((name) => ({
			paths: [`packages/${name}`],
			seconds: PACKAGE_SECONDS[name] ?? 0,
		})),
		{ paths: ['bench/scenes', 'bench/pages', 'bench/lib'], seconds: 11 },
		{ paths: ['tests/lib'], seconds: 30 },
		{ paths: foldersHoldingTests('examples').map((name) => `examples/${name}`), seconds: 25 },
	] satisfies UnitGroup[]
).sort((a, b) => (b.seconds ?? 1) - (a.seconds ?? 1));
