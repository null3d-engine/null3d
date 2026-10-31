# D-259: The CI session checks and pushes each landing on the milestone branch

Status: decided by the owner. Built: the CI session's seven checks on each landing range, and the
push hook's landing checks. The checks include the whole unit suite, the tests that hold gigabytes
of memory and the fresh-project test. Task: none.

Summary: The coordinator's landing session merges helpers' branches, and the CI session checks each
range and pushes it to the milestone branch. The CI session refuses a range that fails a check, and
a fresh helper reads the CI session's own commits before it pushes them. An author's own checks
miss faults that CI's quick run then shows, as the data lists.

## Question

Who checks a landing before it reaches the milestone branch, which every helper and CI read?

## Rule

- No commit reaches the branch on its author's own check alone.
- The checks find before the push the faults of CI's quick run that a local run can find.
- A refusal names the commit, the file and the command that shows the fault.

## Data

Faults that reached the milestone branch, each past its author's own check:

| Fault | What CI showed |
| --- | --- |
| Two parts of the size report shared a name, so the second of each was never looked for | Every size part failed on a file it did not name, while the same commit passed on a Mac |
| A test pinned the start's budget at a figure other than its 194 KB | The unit tests failed on the budget |
| A shader test placed the split-sum table at a column other than its own | The unit tests failed on the column |
| A merge of a branch made before a history rewrite brought the rewritten commits back | The commit check failed on two commits without their trailers |
| A budget for each file that loads after the start passed the size report's tests, but the add-on check command, the command line tool's `check-addon`, holds its own copy of the figure | The unit tests failed on the add-on check's budget |

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
- the fresh-project test, `bun run test:packages`. It passes the checkout's engine `src/generated`
  folder to each step's build when that folder holds the shader modules, so a caller need not set
  `NULL3D_ENGINE_SHADERS`. It packs every public package as CI's `packages` job does. A range can
  pass the other six checks and fail that job, as when the wind add-on's shader library does not
  compile in the package.

The CI session runs every unit test and every heavy check, not only the tests of the changed code.
A test far from a change can pin a figure that the change moves. The add-on check command, the
command line tool's `check-addon`, holds its own copy of the budget for each file that loads after
the start. Its test compares that copy with the engine's.

The fresh-project test runs on every range, as CI's `packages` job runs on every push: that job has
no pass key. The test and the pack that it calls read far more than `packages/`, `examples/`,
`tools/lib/pack.ts` and `tests/fresh-project.ts`. They also read these:

- the project template, `tests/fixtures/fresh-project/`, and the root `package.json`, whose pins
  the project installs;
- `tsconfig.web.base.json`, which the test copies for the website build, and the model
  `tests/pages/assets/models/asset-scene.glb`;
- the root `docs/` folder and the two license files, which the pack copies into the packages;
- the helpers that the test and the pack import, such as `tools/lib/packages.ts`;
- the WebAssembly cores, the asset tool and the shader compiler, which `bun run build` makes from
  `crates/` and the pack puts in the tarballs.

A range that changes only `docs/`, or only the WGSL library in `crates/null3d-shaders/`, can fail
that job. A list of the paths that start the test would have to follow every import and every copy,
and nothing would keep it full. So the seven checks are the same for every range.
`.dev/pull-requests.md` says the same.

The checks run in the landing checkout, on the head that the landing session hands over. Nothing
commits in that checkout until the checks end. A commit that lands there during the checks splits
them: the steps before it read one tree, and the steps after it read another. The checks then run
again on the new head.

When all seven checks pass, the CI session pushes with `NULL3D_MILESTONE_LANDING=1`. The push hook
reads the messages and trailers from where the branch left main, as CI's `commits` job does. It
checks the merges and copies among the commits that the range adds. It also runs the guards over the
tree, the quick check (`bun run check`) among them. A fresh helper reads the CI session's own
commits before the CI session pushes them. A history rewrite needs the owner's word.

The owner's rule for tasks: a task is not done because its author says so. When a
helper reports a task complete, a fresh agent tries to disprove it, against the task's finish line,
the helper's evidence and the code. Only its cleared verdict lets the task be ticked or its branch
land. The checker is never the author, and never the session that pushes that branch.

## Consequences

- `tools/hooks/pre-push.ts` checks a landing's commits, and its refusal names the session that checks
  the landings. It refuses a landing when the checkout lacks the pushed commit as its HEAD, the
  branch's commit on the remote, or a copy of main. The refusal says what to fetch or check out.
- The copy check, `tools/hooks/check-copies.ts`, refuses a second copy of a commit that the branch
  already holds. A merge of a branch made before a history rewrite brings such copies back. The 14
  known pairs on the branch pass by their ids, so the copy check lets the branch land on main. Each
  of the two checks has its tests.
- A push of the branch onto main runs the merge check over every merge, and 9 merges on the
  milestone branch fail it. By the owner's ruling, the 9 stay, named as known in
  `tools/hooks/check-merges.ts`, and the rule holds for every other merge. Their content is on the
  branch, and rewriting them would risk more than it fixes.
- The GPU check's and the Mac references' trailers are read over the whole range. An earlier commit
  of the branch may carry the trailer that a later one needs, so the hook reads the messages over the
  whole branch. Read over their own commits alone, landings that CI passed fail such a trailer,
  among them 642c8e9ed and 0e88e6b86.
- `AGENTS.md` and `.dev/pull-requests.md` name the CI session as the one that pushes, and the guide
  holds the task rule.
- The landing session keeps the pull request's description, the task ticks and the status log.
