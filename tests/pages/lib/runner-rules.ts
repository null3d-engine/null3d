// Rules of the runner page that need no browser: how long a test page may take when its files load
// slowly, or when its own pace shows that it needs longer than its time limit, as the shaders page
// does on a slow device, and how a finished page counts while the run goes on.

/** The most time a page may ask for, as a share of its time limit. */
export const MOST_TIME_SHARE = 3;

/**
 * How often a runner page rewrites its heartbeat record while it waits on a page. The runner tool
 * counts a runner page that writes nothing for a page's limit and a little more as stopped. A page
 * may get longer than its limit, so the record shows the tool that the runner page still runs.
 * The beat comes well within the shortest such quiet time.
 */
export const HEARTBEAT_SECONDS = 20;

/** The name of a runner page's heartbeat record in a run. */
export const HEARTBEAT_NAME = 'heartbeat';

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
 * The time in seconds that the runner page gives a page: its limit plus the time that it spent
 * loading files, or longer when the page expects to end later, up to a few times the limit. A
 * device that reaches the server through a slow link, as the cloud's devices do through their
 * tunnel, then gets the time its loads take, and a page whose own work is slow still fails.
 */
export function grantedSeconds(
	limitSeconds: number,
	endsBy: number | undefined,
	loadingSeconds = 0,
): number {
	const expected = endsBy !== undefined && Number.isFinite(endsBy) ? endsBy : 0;
	const asked = Math.max(limitSeconds + loadingSeconds, expected);
	return Math.max(limitSeconds, Math.min(Math.ceil(asked), limitSeconds * MOST_TIME_SHARE));
}

/**
 * The seconds in which at least one of `loads` was in flight, each a start and an end in
 * milliseconds: the time that a page spent loading files, with loads at the same time counted once.
 */
export function loadingSeconds(loads: readonly (readonly [number, number])[]): number {
	const sorted = [...loads].sort(([a], [b]) => a - b);
	let total = 0;
	let to = Number.NEGATIVE_INFINITY;
	for (const [start, end] of sorted) {
		const from = Math.max(start, to);
		if (end > from) total += end - from;
		to = Math.max(to, end);
	}
	return total / 1000;
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
