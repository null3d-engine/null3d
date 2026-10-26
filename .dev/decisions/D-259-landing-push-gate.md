# D-259: The CI session checks and pushes each landing on the milestone branch

Status: decided by the owner on 25 October 2026. The same day, a fault passed the tests that the CI
session ran on the code that a landing changed. So the CI session now runs all the unit tests and
all the tests that hold gigabytes of memory, on every landing that it pushes. Date: 2026-10-25.
Task: none.

Summary: The coordinator's landing session merges helpers' branches, and the CI session checks each
range and pushes it to the milestone branch. The CI session refuses a range that fails a check, and
a fresh helper reads the CI session's own commits before it pushes them. On 25 October 2026 several
landings reached the branch with faults that their authors' own checks had missed.

## Question

Who checks a landing before it reaches the milestone branch, which every helper and CI read?

## Rule

- No commit reaches the branch on its author's own check alone.
- The checks find before the push the faults of CI's quick run that a local run can find.
- A refusal names the commit, the file and the command that shows the fault.

## Data

Faults that reached the milestone branch on 25 October 2026, each past its author's own check:

| Fault | What CI showed |
| --- | --- |
| Two parts of the size report shared a name, so the second of each was never looked for | Every size part failed on a file it did not name, while the same commit passed on a Mac |
| A test still expected the start's budget before it rose to 194 KB | The unit tests failed on the budget |
| A shader test still placed the split-sum table at its old column | The unit tests failed on the column |
| A merge of a branch from before the history rewrite brought the rewritten commits back | The commit check failed on two commits without their trailers |
| A raised budget for each file that loads after the start passed the size report's tests, but the add-on check command, the command line tool's `check-addon`, holds its own copy of the figure | The unit tests failed on the add-on check's budget |

How the data was produced: the failed jobs of runs 40162969636, 40163662542, 40161667279 and
40181840016, read with `gh api repos/null3d-engine/null3d/actions/jobs/<id>/logs`.

## Look

The options do not change how anything looks.

## Decision

The CI session checks and pushes. The landing session hands it each range with its base and head,
and names the CI session's own commits in it. The CI session runs seven checks on the range, and
sends each slow one through the job queue:

- `bun run limits`, read row by row;
- the type check, `bun run typecheck`;
- `cargo check --workspace`;
- the size check, `bun run build:check-size`;
- the whole unit suite, `bun run test`;
- the heavy checks, `bun run test:heavy`: the tests that hold gigabytes of memory, which the unit
  suite leaves out;
- for a range that changes a file under `packages/`, the fresh-project test, `bun run test:packages`.
  It needs `NULL3D_ENGINE_SHADERS` set to the engine's `src/generated` folder. It packs every public
  package as CI's `packages` job does. On 26 October 2026 a range passed the other six checks and
  failed that job, because the wind add-on's shader library did not compile when the package built.

The CI session runs every unit test and every heavy check, not only the tests of the changed code.
A test far from a change can pin a figure that the change moves. The add-on check command, the
command line tool's `check-addon`, holds its own copy of the budget for each file that loads after
the start. Its test compares that copy with the engine's.

When all seven checks pass, the CI session pushes with `NULL3D_MILESTONE_LANDING=1`. The push hook
reads the messages and trailers from where the branch left main, as CI's `commits` job does. It
checks the merges and copies among the commits that the range adds. It also runs the guards over the
tree, the quick check (`bun run check`) among them. A fresh helper reads the CI session's own
commits before the CI session pushes them. A history rewrite still needs the owner's word.

The owner added a rule for tasks the same day: a task is not done because its author says so. When a
helper reports a task complete, a fresh agent tries to disprove it, against the task's finish line,
the helper's evidence and the code. Only its cleared verdict lets the task be ticked or its branch
land. The checker is never the author, and never the session that pushes that branch.

## Consequences

- `tools/hooks/pre-push.ts` checks a landing's commits, and its refusal names the session that checks
  the landings. It refuses a landing when the checkout lacks the pushed commit as its HEAD, the
  branch's commit on the remote, or a copy of main. The refusal says what to fetch or check out.
- The copy check, `tools/hooks/check-copies.ts`, refuses a second copy of a commit that the branch
  already holds. A merge of a branch from before a history rewrite brings such copies back. The 14
  pairs that the branch took before the rule pass by their ids, so the copy check lets the branch
  land on main. Each of the two checks has its tests.
- The merge check refused 9 merges on the milestone branch, from before this decision. A push of
  the branch onto main runs it over every merge. The owner ruled the same day that the 9 stay, named
  as known in `tools/hooks/check-merges.ts`, and that the rule holds for every other merge. Their
  content is on the branch, and rewriting them would risk more than it fixes.
- The GPU check's and the Mac references' trailers are read over the whole range. An earlier commit
  of the branch may carry the trailer that a later one needs, so the hook reads the messages over the
  whole branch. Read over their own commits alone, recent landings that CI passed failed
  such a trailer, among them 642c8e9ed and 0e88e6b86.
- `AGENTS.md` and `.dev/pull-requests.md` name the CI session as the one that pushes, and the guide
  holds the task rule.
- The landing session keeps the pull request's description, the task ticks and the status log.
