// The budget that a run gives each of its checks, in milliseconds. Both runs state it: `tests/unit.ts`
// for the groups of the unit run and `tests/heavy-checks.ts` for the checks that run apart, so every
// check of the suite is measured against one figure ([Test memory](../../.dev/tests.md)).
//
// Bun's default of five seconds is a budget rather than a measurement. A check that computes takes
// about ten times as long on a loaded machine as on an idle one, so the default failed for three
// checks that were right: the two that map a glow at every canvas, and a WebGL2 program reflection
// check. A check that needs more than this states its own budget, which wins over it.
export const CHECK_TIMEOUT_MS = 30_000;
