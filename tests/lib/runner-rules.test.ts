import { describe, expect, it } from 'bun:test';
import {
	expectedEndSeconds,
	grantedSeconds,
	liveOutcome,
	loadingSeconds,
	MOST_TIME_SHARE,
	PACE_MARGIN,
} from '../pages/lib/runner-rules.ts';

describe('expectedEndSeconds', () => {
	it('adds the remaining steps at the measured pace, with the margin, and the work after them', () => {
		// The Galaxy Tab A9 Plus: 288 of 378 programs after 136 s of checks that started at 64 s.
		const end = expectedEndSeconds(200_000, 64_000, 288, 378, 30);
		expect(end).toBeCloseTo(200 + (136 / 288) * 90 * PACE_MARGIN + 30, 6);
	});

	it('expects only the work after the steps once every step is done', () => {
		expect(expectedEndSeconds(90_000, 60_000, 32, 32, 30)).toBe(120);
	});
});

describe('grantedSeconds', () => {
	it("keeps the page's limit when the page expects to end within it, or says nothing", () => {
		expect(grantedSeconds(220, 150)).toBe(220);
		expect(grantedSeconds(220, undefined)).toBe(220);
		expect(grantedSeconds(220, Number.NaN)).toBe(220);
	});

	it('waits until the page expects to end, up to a few times the limit', () => {
		expect(grantedSeconds(220, 293.4)).toBe(294);
		expect(grantedSeconds(220, 5_000)).toBe(220 * MOST_TIME_SHARE);
	});
	it('adds the time that the page spent loading files, up to a few times the limit', () => {
		// The cloud iPad 10: a model page spent 24 to 28 s of its 30 loading files through the tunnel.
		expect(grantedSeconds(30, undefined, 26.4)).toBe(57);
		expect(grantedSeconds(30, undefined, 500)).toBe(30 * MOST_TIME_SHARE);
		// The page's own expected end wins when it is later.
		expect(grantedSeconds(220, 400, 70)).toBe(400);
		expect(grantedSeconds(220, 150, 70)).toBe(290);
	});
});

describe('loadingSeconds', () => {
	it('counts the time in which any load was in flight, with overlapping loads once', () => {
		expect(loadingSeconds([])).toBe(0);
		expect(loadingSeconds([[0, 1000]])).toBe(1);
		expect(
			loadingSeconds([
				[500, 2_000],
				[0, 1_000],
				[1_500, 1_800],
				[5_000, 6_500],
			]),
		).toBe(3.5);
	});
});

describe('liveOutcome', () => {
	it('counts a page that finished without failures as passed', () => {
		expect(liveOutcome({ ok: true })).toEqual({ passed: true });
		expect(liveOutcome({ ok: true, failures: [] })).toEqual({ passed: true });
	});

	it('counts a page that failed as failed, with its error', () => {
		expect(liveOutcome({ ok: false, error: 'no result within 220 s' })).toEqual({
			passed: false,
			error: 'no result within 220 s',
		});
	});

	it('counts a page that finished but lists failures as failed, as the judgement at the end does', () => {
		// The shaders page on the Galaxy Tab A9 Plus: 140 programs that did not link.
		const failures = Array.from({ length: 140 }, () => ({ stage: 'link', log: '' }));
		expect(liveOutcome({ ok: true, failures })).toEqual({
			passed: false,
			error: '140 failures listed',
		});
	});
});
