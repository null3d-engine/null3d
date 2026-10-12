// Rules of the runner page that need no browser: how long a test page may take when its own pace
// shows that it needs longer than its time limit, as the shaders page does on a slow device, and
// how a finished page counts while the run goes on.

/** The most time a page may ask for, as a share of its time limit. */
export const MOST_TIME_SHARE = 3;

/**
 * How much longer than its measured pace a page expects the rest of its work to take, as a share.
 * It leaves room for a slower batch later on.
 */
export const PACE_MARGIN = 1.5;

/**
 * When a page expects to end, in seconds since it started: now, plus its remaining steps at the pace
 * it measured since `startMs`, with the margin, plus `afterSeconds` for the work that follows them.
 */
export function expectedEndSeconds(
	nowMs: number,
	startMs: number,
	done: number,
	total: number,
	afterSeconds: number,
): number {
	const restMs = ((nowMs - startMs) / done) * (total - done) * PACE_MARGIN;
	return (nowMs + restMs) / 1000 + afterSeconds;
}

/**
 * The time in seconds that the runner page gives a page: its limit, or longer when the page expects
 * to end later, up to a few times the limit.
 */
export function grantedSeconds(limitSeconds: number, endsBy: number | undefined): number {
	if (endsBy === undefined || !Number.isFinite(endsBy)) return limitSeconds;
	return Math.max(limitSeconds, Math.min(Math.ceil(endsBy), limitSeconds * MOST_TIME_SHARE));
}

/** A test page's result as the runner page reads it. */
export interface FinishedPage {
	ok: boolean;
	error?: string;
	failures?: unknown;
}

/**
 * How a finished page counts in the runner page's report while the run goes on: failed when the
 * page failed, or when it finished but lists failures of its own, as the shaders page lists each
 * program that did not link. The run's judgement at its end fails such a page too, so the report
 * never counts it as passed.
 */
export function liveOutcome(result: FinishedPage): { passed: boolean; error?: string } {
	const listed = Array.isArray(result.failures) ? result.failures.length : 0;
	if (!result.ok) return { passed: false, error: result.error };
	if (listed === 0) return { passed: true };
	return { passed: false, error: `${listed} ${listed === 1 ? 'failure' : 'failures'} listed` };
}
