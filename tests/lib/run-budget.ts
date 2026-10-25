// The budget that a run gives each of its checks, in milliseconds. Both runs state it: `tests/unit.ts`
// for the groups of the unit run and `tests/heavy-checks.ts` for the checks that run apart, so every
// check of the suite is measured against one figure ([Test memory](../../.dev/tests.md)).
//
// Bun's default of five seconds is a budget rather than a measurement. A check's work is bounded, but
// its time is not: a check that computes takes about ten times as long on a loaded machine as on an
// idle one. So the budget is the idle budget times the machine's 1-minute load per core when a group
// starts, rounded up, at least 1 and at most 4:
//
//   budget = 30 s × min(4, max(1, ceil(load ÷ cores)))
//
// An idle machine, or one loaded at most to its core count, gets 30 s. A load of 71 on 18 cores, as
// on 26 October 2026, gives ceil(3.94) = 4, so 120 s; there a WebGL2 program reflection check took
// 55.6 s. Each run's line names a budget above 30 s, which shows what a CI runner gets. The factor is
// coarse on purpose: a load of 19 on 18 cores doubles the budget, so a doubled budget says the
// machine was busy, not that a check got slower. The cap keeps the budget at most four times the
// idle one.
//
// A check that states its own budget, for one check or for its file, wraps it in `scaledBudget`,
// which multiplies it by the factor that the run read when the group started. The run hands that factor to the group's process in the environment, so a stated budget
// and the run's budget grow from the same reading. A file that `bun test` runs alone reads the load
// itself. A stated budget that does not scale wins over the run's, so on a loaded machine it can be
// the smaller of the two: a file that set 60 s timed out at 60 s while the run gave 120 s.
import { availableParallelism, loadavg } from 'node:os';

/** The budget on a machine whose 1-minute load is at most its count of cores. */
export const CHECK_TIMEOUT_MS = 30_000;

/** The most that the machine's load multiplies the budget by. */
export const MAX_LOAD_FACTOR = 4;

/** The environment variable through which a run hands its load factor to a group's process. */
export const LOAD_FACTOR_ENV = 'NULL3D_LOAD_FACTOR';

/** How many times the idle budget a group that starts now gets, at the machine's `load` on its `cores`. */
export function loadFactor(load = loadavg()[0] ?? 0, cores = availableParallelism()): number {
	return Math.min(MAX_LOAD_FACTOR, Math.max(1, Math.ceil(load / cores)));
}

/** The budget for a group of checks at a load factor. */
export function checkTimeoutMs(factor = loadFactor()): number {
	return CHECK_TIMEOUT_MS * factor;
}

/** The factor that a run handed to this process, or the machine's own when no run handed one. */
export function runLoadFactor(
	env: Readonly<Record<string, string | undefined>> = process.env,
	machineFactor: () => number = loadFactor,
): number {
	const handed = Number(env[LOAD_FACTOR_ENV]);
	return Number.isInteger(handed) && handed >= 1 && handed <= MAX_LOAD_FACTOR
		? handed
		: machineFactor();
}

/** A budget that a check states for itself, grown by the same factor as the run's budget. */
export function scaledBudget(
	ms: number,
	env?: Readonly<Record<string, string | undefined>>,
): number {
	return ms * runLoadFactor(env);
}

/** The note that a run's line adds when the load raised its budget, or nothing. */
export function budgetNote(timeoutMs: number): string {
	return timeoutMs > CHECK_TIMEOUT_MS ? `, ${timeoutMs / 1000} s a check at this load` : '';
}
