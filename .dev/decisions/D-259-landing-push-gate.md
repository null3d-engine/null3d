# D-259: The CI session checks and pushes each landing on the milestone branch

Status: decided by the owner on 25 October 2026. Date: 2026-10-25. Task: none.

Summary: The coordinator's landing session merges helpers' branches, and the CI session checks each
range and pushes it to the milestone branch. The CI session refuses a range that fails a check, and
a fresh helper reads the CI session's own commits before it pushes them. On 25 October 2026 several
landings reached the branch with faults that their authors' own checks had missed.

## Question

Who checks a landing before it reaches the milestone branch, which every helper and CI read?

## Rule

- No commit reaches the branch on its author's own check alone.
- The check runs the commands that CI's quick run runs, so that a fault shows before the push and
  not one run later.
- A refusal names the commit, the file and the command that shows the fault.

## Data

Faults that reached the milestone branch on 25 October 2026, each past its author's own check:

| Fault | What CI showed |
| --- | --- |
| Two parts of the size report shared a name, so the second of each was never looked for | Every size part failed on a file it did not name, while the same commit passed on a Mac |
| A test still expected the start's budget before it rose to 194 KB | The unit tests failed on the budget |
| A shader test still placed the split-sum table at its old column | The unit tests failed on the column |
| A merge of a branch from before the history rewrite brought the rewritten commits back | The commit check failed on two commits without their trailers |

How the data was produced: the failed jobs of runs 40162969636, 40163662542 and 40161667279, read
with `gh api repos/null3d-engine/null3d/actions/jobs/<id>/logs`.

## Look

The options do not change how anything looks.

## Decision

The CI session checks and pushes. The landing session hands it each range with its base and head,
and names the CI session's own commits in it. The CI session runs `bun run check`, `bun run limits`
read row by row, and `bun run typecheck`. It also runs `cargo check --workspace` through the job
queue, `bun run build:check-size`, and the tests of the code that the commits change. Then it pushes with
`NULL3D_MILESTONE_LANDING=1`. The push hook checks the messages, trailers and merges of the commits
that the range adds, as a push to main does. It also runs the guards over the tree. A fresh helper reads
the CI session's own commits before the CI session pushes them. A history rewrite still needs the
owner's word.

## Consequences

- `tools/hooks/pre-push.ts` checks the commits that a landing adds, and its refusal names the session
  that checks the landings. `tools/hooks/pre-push.test.ts` covers both.
- `AGENTS.md` and `.dev/pull-requests.md` name the CI session as the one that pushes.
- The landing session keeps the pull request's description, the task ticks and the status log.
