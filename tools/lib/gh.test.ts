import { describe, expect, it } from 'bun:test';
import { passingError } from './gh.ts';

describe('the GitHub CLI runner', () => {
	it('tries again after a server error or a lost connection', () => {
		expect(passingError('HTTP 502: Bad Gateway')).toBe(true);
		expect(
			passingError(
				'Get "https://api.github.com/repos/o/r/actions/jobs/1/logs": dial tcp 20.205.243.168:443: connect: operation timed out',
			),
		).toBe(true);
		expect(passingError('read tcp: connection reset by peer')).toBe(true);
	});

	it('stops at once on an answer that a later try would repeat', () => {
		expect(passingError('HTTP 404: Not Found')).toBe(false);
		expect(passingError('HTTP 401: Bad credentials')).toBe(false);
	});
});
