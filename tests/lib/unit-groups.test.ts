// A demo folder that holds a test file must run. The demos' group is read from the tree, so a folder
// that arrives with a test joins it without an edit; this check fails when a folder holding one is
// left out of the groups that the run dispatches ([Test memory](../../.dev/tests.md)).
import { describe, expect, it } from 'bun:test';
import { foldersHoldingTests, UNIT_GROUPS } from './unit-groups.ts';

describe('the unit groups', () => {
	it('dispatch every demo folder that holds a test file', () => {
		const dispatched = new Set(UNIT_GROUPS.flat());
		const missing = foldersHoldingTests('examples').filter(
			(folder) => !dispatched.has(`examples/${folder}`),
		);
		expect(missing).toEqual([]);
	});

	it('leave the dependencies out of the demos, whatever test files they ship', () => {
		expect(foldersHoldingTests('examples')).not.toContain('node_modules');
	});
});
