// A demo folder that holds a test file must run. The demos' group is read from the tree, so a folder
// that arrives with a test joins it without an edit; this check fails when a folder holding one is
// left out of the groups that the run dispatches ([Test memory](../../.dev/tests.md)).
//
// The walk below is written apart from the helper that the dispatcher uses, so a change that stops
// the helper finding a folder fails here instead of agreeing with it.
import { describe, expect, it } from 'bun:test';
import { readdirSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { foldersHoldingTests, UNIT_GROUPS } from './unit-groups.ts';

/** The repository, which the demos live in. */
const ROOT = join(import.meta.dirname, '..', '..');

/** The folders whose contents the run never reaches. */
const SKIPPED = new Set(['node_modules', 'target']);

/**
 * Whether `folder` holds a file named as a test, at any depth. Each entry is read by `stat`, which
 * follows a symbolic link; a link back to a folder already read is not read again.
 */
function holdsTest(folder: string, read = new Set<string>()): boolean {
	const real = realpathSync(folder);
	if (read.has(real)) return false;
	read.add(real);
	return readdirSync(folder, { withFileTypes: true }).some((entry) => {
		if (SKIPPED.has(entry.name)) return false;
		const child = join(folder, entry.name);
		const target = statSync(child, { throwIfNoEntry: false });
		if (target?.isDirectory()) return holdsTest(child, read);
		return target?.isFile() === true && entry.name.endsWith('.test.ts');
	});
}

describe('the unit groups', () => {
	it('dispatch every demo folder that holds a test file, and only those', () => {
		const expected = readdirSync(join(ROOT, 'examples'), { withFileTypes: true })
			.filter((entry) => !SKIPPED.has(entry.name))
			.map((entry) => entry.name)
			.filter((name) =>
				statSync(join(ROOT, 'examples', name), { throwIfNoEntry: false })?.isDirectory(),
			)
			.filter((name) => holdsTest(join(ROOT, 'examples', name)))
			.sort();
		expect(expected.length).toBeGreaterThan(0);
		const dispatched = [...new Set(UNIT_GROUPS.flatMap((group) => group.paths))]
			.filter((path) => path.startsWith('examples/'))
			.sort();
		expect(dispatched).toEqual(expected.map((name) => `examples/${name}`));
	});

	it('leave the dependencies out of the demos, whatever test files they ship', () => {
		expect(foldersHoldingTests('examples')).not.toContain('node_modules');
	});
});
