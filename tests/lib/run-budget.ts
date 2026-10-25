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
// idle one. A check that needs more than this states its own budget, which wins over it.
import { availableParallelism, loadavg } from 'node:os';

/** The budget on a machine whose 1-minute load is at most its count of cores. */
export const CHECK_TIMEOUT_MS = 30_000;

/** The most that the machine's load multiplies the budget by. */
export const MAX_LOAD_FACTOR = 4;

/** The budget for a group of checks that starts now, at the machine's `load` on its `cores`. */
export function checkTimeoutMs(load = loadavg()[0] ?? 0, cores = availableParallelism()): number {
	const factor = Math.min(MAX_LOAD_FACTOR, Math.max(1, Math.ceil(load / cores)));
	return CHECK_TIMEOUT_MS * factor;
}

/** The note that a run's line adds when the load raised its budget, or nothing. */
export function budgetNote(timeoutMs: number): string {
	return timeoutMs > CHECK_TIMEOUT_MS ? `, ${timeoutMs / 1000} s a check at this load` : '';
}
