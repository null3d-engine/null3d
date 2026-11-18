# D-379: Each piece of work lands on main through a pull request of its own

Status: decided by the owner, and built: CI runs every job on each pull request to main, the push hook refuses a direct push to main, and the milestone branch's gate and tools are gone. It supersedes [D-157](D-157-direct-pushes-to-main.md), [D-244](D-244-pull-request-runs-wait.md), [D-249](D-249-milestone-push-runs.md), [D-259](D-259-landing-push-gate.md) and [D-268](D-268-three-sessions.md).

Summary: Each piece of work gets its own branch and its own pull request against main, and it lands when CI's full run of that pull request passes and it merges. No milestone branch batches work any more. The 0.2 release work landed as one pull request of 5,701 commits, whose last run skipped every browser job, and its merge failed 28 of main's 238 jobs.

## Question

How does work reach main, so that CI judges each change in full before it lands, and a failure never reaches main untested?

## Rule

The owner's ruling, in their words: "We are no longer doing massive PR releases like the 0.2 release work (#549, from the milestone branch m3-start). We will now do individual PRs for work." And: "if we need to update our build config and workflow for this then do so."

- Every change that reaches main has passed CI's full run, the browser, picture, showcase, benchmark page and real-browser jobs included.
- A failure shows on the pull request that causes it, not on main after the merge.

## Data

| Measure | The 0.2 release work's pull request (#549) |
| --- | --- |
| Time open | 26 days |
| Commits | 5,701 |
| Files changed | 5,258, with 725,998 lines added |
| CI runs on the milestone branch, of its last 200 | 174 push runs, which ran the quick checks only, and 26 full runs started by hand |
| The branch's last run before the merge | A push run, 43907083769, which passed with every browser, picture and benchmark job skipped |
| Main's run of the merge, 43915033296 | 28 of 238 jobs failed |
| Main's run two merges later, 44198085348 | 30 of 206 jobs failed |

Pull request #555 existed only to repair main after that merge. Its description says that the branch's last run "skipped every browser, picture and benchmark job, so these failures reached main untested". It redrew 24 Mac pictures, mended the car paint's shader build and fixed the nightly benchmark's start.

[D-157](D-157-direct-pushes-to-main.md) rejected pull requests because GitHub's Mac machines served about one CI run at a time, and a run took about an hour. That no longer holds. The organization's plan runs up to 500 jobs at once, 50 of them on macOS, and a full run takes about as long as its longest job ([D-194](D-194-ci-jobs-in-parallel-on-enterprise.md)).

How the data was produced: `gh api repos/null3d-engine/null3d/pulls/549`, `gh run list --workflow ci.yml --branch m3-start --limit 200`, and `gh run view <run> --json jobs` for main's runs.

## Look

The options do not change how anything looks.

## Decision

Each piece of work gets its own branch from main and its own pull request against main. Helpers that share one piece of work push their own branches, and the coordinator merges them into that work's branch.

- **CI runs every job on each pull request to main.** The workflow answers `pull_request` events on main, with GitHub's default types: opened, each new push, and reopened. It has no path filter, because `ci-passed` must answer every pull request. Pushes to main and runs started by hand keep their full runs.
- **A newer push to a pull request cancels its run in progress.** Each pull request has its own concurrency group, and main has one. The newest push holds every change of the older one, so only its result counts. A run started by hand keeps a group of its own, and no push cancels it.
- **The required checks stay `ci-passed` and the title check.** Main's rule requires both, and the repository merges by squash only. `gh pr merge --squash --auto` merges a pull request once both pass.
- **A pull request's run restores its own caches first, then main's.** It saves its caches too, so its next push reuses its shader entries and builds. Main's runs keep the caches that every pull request restores.
- **A pull request from a fork gets no secret and no write access.** GitHub gives its run a read-only token. No job reads a secret, and the one job that writes, the `generated` branch's, runs on a push to main alone. A workflow test holds both.
- **The commit check runs on each pull request.** It reads every commit from the merge base with main to the pull request's head: commitlint, the trailer check and the merge check. On a push to main it skips, and `ci-passed` accepts that skip there alone. A squash merge writes one commit whose message holds the others', and the pull request's run checked each of them.
- **The push hook refuses a direct push to main.** It says to open a pull request. A direct push from a machine skipped the pull request's run, which is the path that let failures reach main. Only in an emergency that the owner calls, a `Push-Check-Skipped: <reason>` trailer lets such a push through. The release job's commit comes from CI, which runs no hook.
- **A task is not done because its author says so.** Before its pull request merges, a fresh agent that did not write the work tries to disprove it. This rule of D-259 holds.

Options rejected:

- **Keep the milestone branch and run the full checks on each of its pushes.** The branch would still batch weeks of work into one pull request that no reader can review, and one merge that carries every fault at once.
- **Keep direct pushes to main, with the local check before each push.** The local check runs no browser, picture or real-browser job. D-157's reason for it, one CI run at a time, no longer holds.
- **Keep the local check on a direct push to main, for the owner's pushes.** It kept a second way to land, with a job queue lane, a cargo step and an ssh keepalive to maintain, for a path that work no longer takes. An emergency push skips the check anyway.
- **Let a newer push to a pull request wait for the run in progress, as D-244 chose for the milestone branch.** The older run's result is about code that the pull request no longer holds. It spends up to a full run's job-minutes for a result nobody reads.
- **Run the quick checks on a pull request and the full run on main alone.** That is the fault this record fixes: failures reach main untested.
- **A merge queue.** [D-99](D-99-no-merge-queue.md) gives the reasons, and they still hold: a flaky job removes good changes from the queue.

## Consequences

- `ci.yml` answers pull requests to main, pushes to main and runs started by hand. The milestone branch's trigger, the full-run condition of the browser jobs and the quick run that `ci-passed` accepted are gone. `tools/lib/ci-workflow.test.ts` guards the events, the concurrency, the skips and the fork rules.
- `tools/hooks/pre-push.ts` refuses a direct push to main and runs nothing else. The landing gate, the milestone status check, the crate tests, the job queue steps and the ssh keepalive check are gone, with their tests.
- The status tool is gone: `tools/pr-status.ts`, its command and `tools/task-evidence.ts`. They rebuilt the milestone pull request's description, and no other tool read them.
- The `Task:` footer rule is gone, with `tools/hooks/check-task.ts` and `tools/hooks/task-ids.txt`. Only the status tool read the footers. A pull request names its work itself. A `Task:` footer that a message still carries is harmless.
- The copy check, `tools/hooks/check-copies.ts`, is gone. It kept a second copy of a commit off main. A squash merge writes one new commit, so no copy reaches main.
- The merge check, `tools/hooks/check-merges.ts`, runs in CI's commit check on each pull request. Its list of known merges stays: a branch that still holds the 0.2 release work's history reaches them.
- A squash merge writes each squashed commit's message into the body of main's commit, and GitHub adds its co-authors after them. Git reads only the last block as trailers, so main's size check would miss a `Size-Growth:` line. `keptCommits` in `tools/hooks/check-trailers.ts` gathers every squashed commit's trailers into one block, and the size check and the trailer check read that.
- `bun run limits` runs before a pull request opens or takes a push.
- `AGENTS.md` and `.dev/pull-requests.md` describe the new flow. [Releases](../releases.md) describes how a release counts main's runs.
