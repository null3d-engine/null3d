# D-99: Full CI on pull requests and on main, with no merge queue

Status: superseded by [D-157](D-157-direct-pushes-to-main.md): work lands on main by direct push, and no branch opens a pull request. It replaced [D-86](D-86-ci-runs-per-event.md). The parts below still hold, as the owner decided them: no merge queue, every job on each push to main, and main's daily benchmark run.

Summary: Main has no merge queue, because in one day the queue ran 53 times for 32 pull requests and only 2 of its failures were real faults. Every push to main runs every CI job, and a newer push cancels main's older run. Main's speed comparison runs once a day at 19:07 UTC, with S5 and S6, in 8 shards of 2 pages.

## Question

A merge queue tests each change on top of main and the changes ahead of it. Most of its failures are flaky jobs, and each one puts good changes out of the queue. Does the queue's check of combined code repay that cost, or should full CI run on the change and on main itself?

## Rule

Every commit that lands on main has passed every job, before it lands or on main itself. A flaky job must not hold back changes that it says nothing about. Code that only fails in combination with other changes must still be caught before more work builds on it.

## Data

| Measure | Figure | Source |
| --- | --- | --- |
| Merge queue runs in one day, 08:02 to 22:46 (UTC+8) | 53 runs for 32 pull requests: 28 passed, 9 failed, 15 were cancelled and 1 was still running | `gh run list --workflow ci.yml --event merge_group` |
| Time of a queue run that passed | 14 to 43 minutes, median 23 | The same 28 runs, from start to last update |
| Jobs that failed in the 9 failed runs | Safari 2, Firefox 3, Chrome browser shards 3, benchmark page shards 2, the size check 1. A run can fail in more than one job | `gh run view <run> --json jobs` |
| Failures that were faults of the pull request | 2: #397's `Size-Growth:` trailer, which sat on a merge commit and was lost in the squash, and #346's Firefox E1404 on Linux, an engine fault that #401 fixed | A review of each failed job's log, [Implementation notes](../implementation-notes.md) |
| Other failures | Load-related timing on SwiftShader (S4's short benchmark run), and Safari's memory refusals, which came from the test pages (#392) | [Benchmarks](../benchmarks.md), [Implementation notes](../implementation-notes.md) |
| Pull requests of the 32 that merged with no passing queue run | 6: #389, #390, #391, #401, #402 and #403 | Merged pull requests matched against the queue's passing runs |

Both real faults show on a full run of the change itself. The Firefox fault of #346 is in the change's own code. The lost trailer of #397 shows when the size check reads the trailers of the commits that main keeps, as it does.

## Rejected options

- A merge queue that runs every job on the combined code. A flaky job removes the change and makes every change behind it build again. In the day above, 6 pull requests merged without a passing queue run, and branches in the queue refuse pushes.
- The queue with a group size of 1. It lands one change per 23-minute run at best, about 2 an hour, below the merge rate. A flaky job still removes the change.
- A light queue that runs only the quick checks. It keeps the queue's removals, read-only branches and order, for checks that local tests and main's full run already cover.
- Full CI on each pull request before it merges, which this record first chose. [D-157](D-157-direct-pushes-to-main.md) gives why direct pushes replace it: one CI run takes about an hour, and up to 8 pull requests waited for CI at once.

## What still holds

- Every push to main runs every job, on the code that landed. The Rust jobs, `docs-and-tools`, `packages` and the size check run there too. The size check compares with main's commit before the push and reads the trailers of the commits that main keeps. Its job keeps the commit's sizes for the runs that build on it.
- `tools/hooks/check-trailers.ts` and the size check read their commits through one function, `keptCommits`, which leaves out merge commits.
- Main's runs share one concurrency group with `cancel-in-progress`. A burst of pushes then runs every job once, on the newest main, which holds every change. Without it, a burst of pushes can leave 3 full runs of main waiting more than 30 minutes for runners.
- A commit whose run was cancelled has no full run of its own. So a release or gate on exactly that commit starts a run by hand, which the Release workflow and the exit gate accept. `bun run test:browser-weights` reads only main's runs that passed and ran the browser job, so cancelled runs drop out of it.
- CI's Chrome tests draw on SwiftShader only, and Firefox on Linux draws with a software renderer. The Mac's real GPU gets no run in CI, apart from Safari. So a branch runs the browser and image tests of the areas that it touches on the Mac's GPU before it lands ([D-157](D-157-direct-pushes-to-main.md)).

## Playwright's install on a stalled package mirror

The step that installs Playwright's Chromium gives up on a stalled package mirror. Without a limit, a browser shard can wait 14 minutes on Ubuntu's mirror until the job's limit cancels it. A longer job limit would only wait longer on a dead mirror.

- apt waits at most 20 seconds per connection and tries 3 times. The whole install gets 5 minutes and one retry.
- The install's time limit stops Playwright's installer, but not the apt process that the installer started. That process keeps apt's lock, and a retry would stop with "Could not get lock /var/lib/apt/lists/lock" (run 37689924511). So the retry stops the leftover apt process first. It waits up to 30 seconds for apt's locks, and it finishes any half-done install with `dpkg --configure -a`.

## Main's benchmark run once a day, with S5 and S6

The owner chose that main's speed comparison runs once a day, not every hour, and compares S5 and S6 too. The workflow runs at 19:07 UTC, in the hour with the fewest merges to main, so CI's Safari jobs need the Mac machines least then. The search for main's last measured commit reads 30 runs, which cover about a month without a merge.

With S5 and S6 the plan has 16 pages. The owner's rule says that each CI job should take at most 15 minutes, and stops it at 20. A compared page took 3.6 to 3.8 minutes in main's runs, and the step that compares one S6 page took 5.3 to 5.9 minutes with the pages' production build. So the pages run in 8 shards of 2 pages. Two full runs on main took 9.2 to 10.7 minutes per shard with the cache of the city files, and up to 11.4 when it missed. An S6 shard whose cache misses would take about 13 minutes. GitHub gives 5 Mac machines at once, so the last shards wait for a machine. That costs the run's time, not a job's. [Benchmarks](../benchmarks.md#the-benchmark-job-in-ci) gives the figures.

The shards never build the job's own checkout, so the comparison must not serve either build from it: the sample environment map then fails, and every S6 page times out. A cache of the city files must not serve the files of another sample pin either. The benchmark guide and AGENTS.md record both.
