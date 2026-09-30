import { describe, expect, test } from 'bun:test';
import { chooseBaseline } from './baseline';

/** A history of main, oldest first; a commit's ancestors are the commits before it. */
const MAIN = ['a1', 'b2', 'c3', 'd4', 'e5'];
const before = (commit: string) => (other: string) =>
	MAIN.indexOf(other) >= 0 && MAIN.indexOf(other) < MAIN.indexOf(commit);

describe('the baseline of a push to main', () => {
	test('is the newest commit that a successful job measured', () => {
		expect(chooseBaseline('e5', ['c3', 'b2', 'a1'], before('e5'))).toBe('c3');
	});

	test('covers the commits that got no job of their own', () => {
		// d4 waited while c3's job ran, and e5 replaced it, so e5's job measures d4's change too.
		expect(chooseBaseline('e5', ['c3'], before('e5'))).toBe('c3');
	});

	test('skips the new commit, so a job run again still compares it with an older commit', () => {
		expect(chooseBaseline('e5', ['e5', 'c3'], before('e5'))).toBe('c3');
	});

	test('skips a commit that is not in the new commit history', () => {
		expect(chooseBaseline('c3', ['x9', 'e5', 'b2'], before('c3'))).toBe('b2');
	});

	test('is null when no successful job measured an earlier commit', () => {
		expect(chooseBaseline('b2', [], before('b2'))).toBeNull();
		expect(chooseBaseline('b2', ['b2', 'e5'], before('b2'))).toBeNull();
	});
});
