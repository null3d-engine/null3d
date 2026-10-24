# D-249: A milestone branch's pushes run its quick checks, in the branch's caches

Status: decided by the owner on 24 October 2026, landed in ci/milestone-push-runs. Date: 2026-10-24.
Task: none.

Summary: Each push to a milestone branch, such as `m3-start`, now runs the quick checks as a push
run, and CI answers no pull request event. The milestone's pull request runs kept caches that the
full runs started by hand on the branch could not read, and the other way round. On 24 October 2026,
118 passed parts ran in both kinds of run, about 490 job-minutes in 14 hours.

## Question

The quick checks of a milestone ran as its pull request's runs, and its full runs as runs started by
hand on its branch. GitHub keeps a pull request's caches apart from its branch's. How can each run
reuse the work that the other kind saved?

## Rule

- A part that passed on the same inputs in one run of the milestone is not run again in another.
- Every started run still ends with a result ([D-244](D-244-pull-request-runs-wait.md)).
- A quick run judges no less than the pull request's runs did: every commit of the milestone, and
  the milestone's growth in size since main.

## Data

A pass key names the inputs of a part that passed, and a later run with the same key skips the part.
Each saved key belongs to the branch or the pull request of the run that saved it. These are the keys
saved from 00:00 to about 14:00 UTC on 24 October 2026, from `gh cache list --key passed-`:

| Measure | Count | Job-minutes each | Job-minutes |
| --- | --- | --- | --- |
| Pass keys saved, distinct | 352 | | |
| Saved under both the branch and the pull request | 118 | | about 490 |
| Of those, `shader-compiler` shards | 96 | about 4 | about 390 |
| Of those, the shader build's determinism part | 5 | about 6 | about 30 |
| Of those, the plugin's and the packing test's parts | 17 | 3 to 7 | about 70 |

- Pull request run 40071296434 saved the 20 `shader-compiler` keys at 06:48. Full run 40072668205 of
  the branch, started at 07:04, missed every one of them and ran the 20 shards again: 82 job-minutes.
- The branch held the determinism part's key from 06:35. The pull request run missed it at 06:43 and
  ran the part again for 6.1 minutes.
- The pull request's runs also kept their own shader entries, Rust builds and size memo, beside the
  branch's. These cost time too, which the table does not count.

## Decision

The owner chose to move the quick checks to the branch's pushes. The other choice was to start
each full run by marking the pull request ready. That keeps both kinds of run in the pull request's
caches, but changes the pull request's state for each full run.

- `ci.yml` runs on a push to `main` or to a branch named `m<number>-start`, and when started by
  hand. It has no `pull_request` trigger.
- Each pushed branch has one concurrency group, and a run started by hand a group of its own. Only a
  push to main cancels a run in progress, as before.
- A push to a milestone branch runs the quick checks. Every job of the full run takes one condition,
  which leaves out that push, and `ci-passed` lets those jobs skip in such a run alone.
- On every run but a push to main, the commit check reads every commit after the merge base with
  main. The size check compares with that merge base. A newer push can drop a waiting run, so a
  check of each push alone would miss the dropped push's commits.
- The release gate counts a CI run only when it is a push to main or a run started by hand.

## Consequences

- The `changes` job goes. All its answers came from the pull request event. On the other events every
  run tested the code, and only a docs-only pull request drew the skills' sketches. So the docs-only
  skip and the `skill-sketches` job go too. The quick checks now start without waiting for a
  decision job. [D-99](D-99-no-merge-queue.md) records what the pull request events ran.
- The milestone's pull request still shows the checks of its head commit, which the push runs give.
  A quick run's `ci-passed` passes with the full run's jobs skipped, so the pull request stays a
  draft until a full run of its head passes.
- A full run started while the quick run of the same commit runs would run the same jobs at once.
  The landing session starts it once that quick run ends, or cancels the quick run first.
- The pull request's caches go unused, and GitHub removes them after 7 days.
- `.dev/pull-requests.md` lists what CI runs where, and `.dev/devices.md` when the real-browser jobs
  run.
