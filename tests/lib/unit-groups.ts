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

/**
 * A group of the run: the paths it takes, and any paths under one of them that another group owns and
 * this one leaves out.
 */
export interface UnitGroup {
	/** The paths the group runs. */
	readonly paths: readonly string[];
	/** Patterns under `paths` that the group leaves out, because a group of their own holds them. */
	readonly ignore?: readonly string[];
}

/**
 * The species walk's slices, which take a group each. The walk is the run's longest single piece of
 * work, and the run starts a group only after the one before it has ended, so one group of it sets
 * the run's floor whatever the lanes.
 */
const SPECIES_SLICES: readonly string[] = readdirSync(
	join(REPO_ROOT, 'packages/vegetation/src/species'),
)
	.filter((name) => /^species-slice-\d+\.test\.ts$/.test(name))
	.map((name) => `packages/vegetation/src/species/${name}`)
	.sort();

/** The groups one package folder takes: the folder, and a group per slice that the folder leaves out. */
function groupsOfPackage(name: string): UnitGroup[] {
	const paths = [`packages/${name}`];
	if (name !== 'vegetation' || SPECIES_SLICES.length === 0) return [{ paths }];
	const ignore = SPECIES_SLICES.map((slice) => `**/${slice.split('/').pop()}`);
	return [{ paths, ignore }, ...SPECIES_SLICES.map((slice) => ({ paths: [slice] }))];
}

/**
 * The groups of the run: the tools, each package, the benchmark's scenes and pages, the test
 * helpers, and every demo folder that holds a test file.
 */
export const UNIT_GROUPS: readonly UnitGroup[] = [
	{ paths: ['tools'] },
	...readdirSync(join(REPO_ROOT, 'packages')).flatMap((name) => groupsOfPackage(name)),
	{ paths: ['bench/scenes', 'bench/pages', 'bench/lib'] },
	{ paths: ['tests/lib'] },
	{ paths: foldersHoldingTests('examples').map((name) => `examples/${name}`) },
];
