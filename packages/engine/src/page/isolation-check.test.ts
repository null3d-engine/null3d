import { describe, expect, it } from 'bun:test';
import { lostIsolationWarning } from './isolation-check';

describe('lostIsolationWarning', () => {
	it('warns when a service worker controls a page that is not isolated', () => {
		expect(lostIsolationWarning({ isolated: false, controlled: true })).toContain(
			'Cross-Origin-Embedder-Policy',
		);
	});

	it('stays quiet for an isolated page, and for a page that no service worker controls', () => {
		expect(lostIsolationWarning({ isolated: true, controlled: true })).toBeUndefined();
		expect(lostIsolationWarning({ isolated: false, controlled: false })).toBeUndefined();
	});
});
