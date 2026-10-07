# D-99: Full CI on pull requests and on main, with no merge queue

Status: decided by the owner on 2026-10-07 at 22:56 (UTC+8). It replaces [D-86](D-86-ci-runs-per-event.md). Main's rules keep the merge queue until the pull request that makes this change merges, and the maintainers then remove the queue from the rules. Date: 2026-10-07.

Summary: Every pull request that is ready for review runs every CI job, and merges once its run passes. A draft runs only the quick checks. Every push to main runs every job again, and a red main stops all merging until it is fixed. On 7 October 2026 the queue ran 53 times for 32 pull requests. Only 2 of its failures were real faults, and 6 pull requests merged without a passing queue run.

## Question

The merge queue tested each pull request on top of main and the pull requests ahead of it. Only the queue ran the browser, benchmark page, Safari and Firefox jobs ([D-86](D-86-ci-runs-per-event.md)). Most of its failures were flaky jobs, and each one put good pull requests out of the queue. Does the queue's check of combined code repay that cost, or should full CI run on the pull request itself?

## Rule

Every commit that lands on main has passed every job, on the pull request or on main itself. A flaky job must not hold back pull requests that it says nothing about. Code that only fails in combination with other pull requests must still be caught before more work builds on it.

## Data

| Measure | Figure | Source |
| --- | --- | --- |
| Merge queue runs, 7 October 2026, 08:02 to 22:46 (UTC+8) | 53 runs for 32 pull requests: 28 passed, 9 failed, 15 were cancelled and 1 was still running | `gh run list --workflow ci.yml --event merge_group` |
| Time of a queue run that passed | 14 to 43 minutes, median 23 | The same 28 runs, from start to last update |
| Jobs that failed in the 9 failed runs | Safari 2, Firefox 3, Chrome browser shards 3, benchmark page shards 2, the size check 1. A run can fail in more than one job | `gh run view <run> --json jobs` |
| Failures that were faults of the pull request | 2: #397's `Size-Growth:` trailer, which sat on a merge commit and was lost in the squash, and #346's Firefox E1404 on Linux, an engine fault that #401 fixed | A review of each failed job's log, [Implementation notes](../implementation-notes.md) |
| Other failures | Load-related timing on SwiftShader (S4's short benchmark run), and Safari's memory refusals, which came from the test pages (#392) | [Benchmarks](../benchmarks.md), [Implementation notes](../implementation-notes.md) |
| Pull requests merged on 7 October 2026 with no passing queue run | 6 of 32: #389, #390, #391, #401, #402 and #403 | Merged pull requests matched against the queue's passing runs |
| Machines | GitHub Free: 20 Linux jobs and 5 macOS jobs at once. A full run takes 2 macOS jobs (Safari), and the hourly benchmark run takes 3 | [Device sessions](../devices.md), [Benchmarks](../benchmarks.md) |

Both real faults show on a full run of the pull request itself. The Firefox fault of #346 is in the pull request's own code. The lost trailer of #397 shows when the pull request's size check reads the trailers as the squash keeps them. The check now reads them that way.

## Options

| Option | What runs where | For | Against |
| --- | --- | --- | --- |
| A. Keep the queue as it is | Pull requests run the quick checks; the queue runs every job on the combined code | It checks the exact commit that lands, combined with the pull requests ahead | A flaky job removes the pull request and makes every pull request behind it build again. On 7 October 2026, 6 pull requests merged without a passing queue run. Branches in the queue refuse pushes |
| B. The queue with a group size of 1 | As A, one queue run at a time | No rebuilds behind a failure | One pull request per 23-minute run at best: about 2 an hour, below the day's merge rate. A flaky job still removes the pull request |
| C. Full CI on pull requests, no queue (chosen) | Pull requests ready for review and main run every job; drafts run the quick checks | A flaky job holds back only its own pull request, and a rerun of that job needs no new queue run. The real faults of the day both show on the pull request | No automatic check of combined code before the merge. More macOS time: each push to a ready pull request runs Safari |
| D. A light queue | Pull requests run every job; the queue runs only the quick checks | Keeps a combined check of the build, types and unit tests | The queue's removals, its read-only branches and its order stay, for checks that the authors' tests before a merge and main's full run already cover |

## Decision

Option C. The owner decided it on 7 October 2026 at 22:56 (UTC+8), from that day's figures. The queue mostly ran flaky Safari jobs again and removed good pull requests. Its two real catches would also fail a full run of the pull request.

Rules:

- CI runs every job on each pull request that is ready for review. It runs on opening, on each push, on reopening and when a draft becomes ready. GitHub runs it on its merge of the pull request into main. A draft pull request runs only the quick checks, so unfinished work holds no browser or macOS machines.
- A new push to a pull request cancels the run of its older push.
- A pull request merges once its run passes, by hand or with automatic merging, by squash only.
- Every push to main runs every job again, on the code that the merge made. If main's run fails, nothing merges until a fix lands.
- Before a pull request merges, its author tests it combined with main and with each pull request that will merge before it ([Pull requests](../pull-requests.md#before-a-merge)). Main's full run is the last check of combined code.
- The size and trailer checks of a pull request read only the commits that main's squash keeps: every commit but merge commits. So a trailer that the squash would drop fails on the pull request.

## Consequences

- `.github/workflows/ci.yml` starts on the pull request events above. The `browser`, `bench` and `real-browsers` jobs skip only a draft pull request. `ci-passed` accepts a skipped job only there.
- Main's run no longer stops after keeping caches. Its Rust jobs run their checks, and `docs-and-tools`, `packages` and the size check run on main too. The size check on main compares with the commit before and reads the squash commit's trailers. Its job keeps the commit's sizes for the runs that build on it, which the `main-keep` job did before; the full jobs keep the other caches. Each run on main therefore takes about as long as a pull request's.
- `tools/hooks/check-trailers.ts` and the size check read their commits through one function, `keptCommits`, which leaves out merge commits. Before, the size check read merge commits' trailers too.
- The Release workflow and the exit gate's `workflows` step count main's own run of the commit, or a run started by hand. A pull request's run does not count, because it tested the pull request on an older main. A run on main from before this change kept only caches, so a commit from then still needs a run started by hand.
- `bun run test:browser-weights` reads main's runs that passed and ran the browser job, instead of the queue's.
- More macOS time: each full run takes 2 macOS jobs. With 5 at once, two full runs and the hourly benchmark run fill them.
- The workflow keeps its `merge_group` trigger only while main's rules still use the queue. Nothing reads the queue's runs any more.
