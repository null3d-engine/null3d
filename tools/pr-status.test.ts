import { describe, expect, it } from 'bun:test';
import { shallowRefusal } from './pr-status';

// A shallow clone keeps a stub of the branch: the tool once read 1 ticked task of 137 and exited 0
// against one. It must refuse and say what to run instead.
describe('shallowRefusal', () => {
	it('refuses a shallow clone and names the repair', () => {
		expect(shallowRefusal('true\n')).toContain('git fetch --unshallow origin');
	});

	it('lets a whole history through', () => {
		expect(shallowRefusal('false\n')).toBeNull();
	});
});
