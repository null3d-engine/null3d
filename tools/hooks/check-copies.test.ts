import { describe, expect, it } from 'bun:test';
import { type CommitLine, copiesOf, KNOWN_COPIES } from './check-copies';

const DATE = '2026-10-25T10:00:00+08:00';
const commit = (sha: string, subject = 'fix(size): name the part', date = DATE): CommitLine => ({
	sha,
	date,
	subject,
});

describe('copiesOf', () => {
	it('finds a commit of the range that repeats one the head already reaches', () => {
		const reached = [commit('new'), commit('old'), commit('other', 'feat: other')];
		expect(copiesOf(reached, new Set(['old']), () => 'same change')).toEqual([['old', 'new']]);
	});

	it('passes a cherry-pick whose original the head no longer reaches', () => {
		// A fix taken onto a rewritten history keeps its subject and date, but the old copy is gone.
		expect(copiesOf([commit('picked')], new Set(['picked']), () => 'same change')).toEqual([]);
	});

	it('passes two commits that share a subject and a date but not a change', () => {
		const reached = [commit('a'), commit('b')];
		expect(copiesOf(reached, new Set(['b']), (sha) => `change of ${sha}`)).toEqual([]);
	});

	it('leaves a pair that the branch already held before the range', () => {
		const reached = [commit('a'), commit('b'), commit('pushed', 'feat: new')];
		expect(copiesOf(reached, new Set(['pushed']), () => 'same change')).toEqual([]);
	});

	it('passes a pair that the branch took before the rule, by its ids', () => {
		const reached = [commit('a'), commit('b')];
		expect(copiesOf(reached, new Set(['a', 'b']), () => 'same change', [['b', 'a']])).toEqual([]);
		// Fourteen pairs, by full ids, so a copy under another id is still refused.
		expect(KNOWN_COPIES).toHaveLength(14);
		for (const pair of KNOWN_COPIES) for (const sha of pair) expect(sha).toMatch(/^[0-9a-f]{40}$/);
	});

	it('names a pair once when both of its commits are in the range', () => {
		const reached = [commit('a'), commit('b')];
		expect(copiesOf(reached, new Set(['a', 'b']), () => 'same change')).toEqual([['a', 'b']]);
	});

	it('reads the changes of the pairs that share a subject and a date, and no others', () => {
		const read: string[] = [];
		const reached = [commit('a'), commit('b'), commit('c', 'feat: c'), commit('d', 'feat: d')];
		copiesOf(reached, new Set(['a', 'c']), (sha) => {
			read.push(sha);
			return sha;
		});
		expect(read.sort()).toEqual(['a', 'b']);
	});
});
