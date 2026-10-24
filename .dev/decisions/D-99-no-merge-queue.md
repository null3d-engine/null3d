# D-99: Full CI on pull requests and on main, with no merge queue

Status: superseded by [D-157](D-157-direct-pushes-to-main.md) on 13 October 2026: work lands by direct push, and no branch opens a pull request. Decided by the owner on 2026-10-07 at 22:56 (UTC+8). It replaced [D-86](D-86-ci-runs-per-event.md). Date: 2026-10-07.

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
- A newer merge to main cancels main's older run still in progress. So a burst of merges runs every job once, on the newest main, which holds every merged change. The owner added this rule on 8 October 2026 at about 00:20 (UTC+8). That night's first merges had left 3 full runs of main waiting more than 30 minutes for runners, behind the full runs of pull requests. A merge whose run was cancelled has no full run of its own. So a release or gate on exactly that commit starts a run by hand (see Consequences).
- Before a pull request merges, its author tests it combined with main and with each pull request that will merge before it ([the history below](#how-a-pull-request-merged)). Main's full run is the last check of combined code.
- The size and trailer checks of a pull request read only the commits that main's squash keeps: every commit but merge commits. So a trailer that the squash would drop fails on the pull request.

## Consequences

- `.github/workflows/ci.yml` starts on the pull request events above. The `browser`, `bench` and `real-browsers` jobs skip only a draft pull request. `ci-passed` accepts a skipped job only there.
- Main's run no longer stops after keeping caches. Its Rust jobs run their checks, and `docs-and-tools`, `packages` and the size check run on main too. The size check on main compares with the commit before and reads the squash commit's trailers. Its job keeps the commit's sizes for the runs that build on it, which the `main-keep` job did before; the full jobs keep the other caches. Each run on main therefore takes about as long as a pull request's.
- `tools/hooks/check-trailers.ts` and the size check read their commits through one function, `keptCommits`, which leaves out merge commits. Before, the size check read merge commits' trailers too.
- The Release workflow and the exit gate's `workflows` step count main's own run of the commit, or a run started by hand. A pull request's run does not count, because it tested the pull request on an older main. A run on main from before this change kept only caches, so a commit from then still needs a run started by hand.
- `bun run test:browser-weights` reads main's runs that passed and ran the browser job, instead of the queue's.
- The `rust-tests` job's time limit is 25 minutes, up from 15. On 7 and 8 October its shader-build tests took 264 to 400 seconds each, depending on the runner. On 12 October 2026 it went back to 15 minutes: since no test runs a full shader build of its own, the job took 5.0 to 9.0 minutes in 46 passing runs ([Branches and parallel work](../pull-requests.md#cis-jobs)). So the job hit 15 minutes in 3 of 4 runs of #399 and in #410's run, which changes no Rust code. Main's runs took about 9 minutes. The coordinator raised it on 8 October at about 01:00 (UTC+8), so that a slow runner does not fail a pull request.
- The step that installs Playwright's Chromium gives up on a stalled package mirror. Main's run after #410 lost 2 browser shards on 8 October: each waited 14 minutes on Ubuntu's mirror while installing packages, until the job's limit cancelled it. apt now waits at most 20 seconds per connection and tries 3 times, and the whole install gets 5 minutes and one retry. A longer job limit would only wait longer on a dead mirror.
- That retry failed at once in pull request run 37689924511 on 8 October. Ubuntu's Azure mirror answered nothing, so the first install reached its 5 minutes. The time limit stopped Playwright's installer, but not the apt process that the installer had started. That process kept apt's lock, and the retry stopped with "Could not get lock /var/lib/apt/lists/lock". The retry now stops the leftover apt process first. It waits up to 30 seconds for apt's locks, and it finishes any half-done install with `dpkg --configure -a`.
- Main's runs share one concurrency group, `ci-main`, with `cancel-in-progress`. The Release workflow and the exit gate already accept a run started by hand, which covers a commit whose own run was cancelled. The weights tool reads only runs that passed, so cancelled runs drop out of it.
- More macOS time: each full run takes 2 macOS jobs. With 5 at once, two full runs and the hourly benchmark run fill them.
- The workflow kept its `merge_group` trigger only while main's rules still used the queue. Nothing read the queue's runs any more. On 24 October 2026 main's one ruleset held only the rule that CI must pass, so the trigger left both workflows, with the size check's base for a merge group.

## Addendum, 2026-10-12: main's benchmark run once a day, with S5 and S6

The owner chose on 8 October 2026 that main's speed comparison runs once a day, not every hour, and compares S5 and S6 too. The workflow runs at 19:07 UTC, in the hour with the fewest merges to main, so CI's Safari jobs need the Mac machines least then. The search for main's last measured commit reads 30 runs, which cover about a month without a merge.

With S5 and S6 the plan has 16 pages. The owner's rule of 12 October 2026 says that each CI job should take at most 15 minutes, and stops it at 20. A compared page took 3.6 to 3.8 minutes in main's runs, and the step that compares one S6 page took 5.3 to 5.9 minutes with the pages' production build. So the pages run in 8 shards of 2 pages. On 13 October 2026, two full runs on main took 9.2 to 10.7 minutes per shard with the cache of the city files, and up to 11.4 when it missed. An S6 shard whose cache misses would take about 13 minutes. GitHub gives 5 Mac machines at once, so the last shards wait for a machine. That costs the run's time, not a job's. [Benchmarks](../benchmarks.md#the-benchmark-job-in-ci) gives the figures.

Until 12 October 2026, every S6 page in CI's benchmark job timed out. The comparison served both builds from the job's own checkout, which the shards never build, so the sample environment map failed. A cache of the city files also kept files of an older sample pin. Both are fixed, and the benchmark guide and AGENTS.md record them.

## History: the pull-request flow until 13 October 2026

[D-157](D-157-direct-pushes-to-main.md) replaced this flow. [Branches and parallel work](../pull-requests.md) gives the flow in use. This section keeps the old one, for readers of older records and for the pull-request events that `ci.yml` still answers.

### How a pull request merged

- A pull request merged by squash once its full CI run passed. Main's rules required two checks: `ci-passed`, and `squash-title` from the PR title workflow, which checked the squash's line with commitlint and the docs style check.
- The author marked a pull request ready for review only when its work was complete, with `gh pr ready <number>`. That started its full run, and so did each later push. A full run took about 100 runner minutes and 2 macOS jobs.
- The author merged with `gh pr merge <number> --squash` once the checks passed, or added `--auto`. Before that, the author tested the pull request with current main and with each pull request about to merge before it, in a scratch branch.
- When main's run failed, nothing merged until a fix landed.

### What CI ran on each event

Each event runs every job, apart from a draft or a docs-only pull request, by the owner's decision of 7 October 2026 (this record).

| Event | Jobs |
| --- | --- |
| Draft pull request | The quick checks: `build`, `docs-and-tools`, `rust-lint`, `rust-tests`, `size-base`, `wasm-checks`, `shader-compiler` and `packages` |
| Docs-only pull request | `build` and `docs-and-tools`, and `skill-sketches` when the pull request changes the skills' or the cookbook's Markdown and is no draft ([Docs-only pull requests](#docs-only-pull-requests)) |
| Pull request ready for review: opened, pushed, reopened, or marked ready | Every job: the quick checks, the 7 `browser` shards and the job of the tests that run alone, the 2 `bench` shards, and the `real-browsers` shards in Safari and Firefox |
| Push to main | Every job, on the code that the merge made. Main's jobs also keep the caches, and `wasm-checks` keeps the commit's sizes |
| Started by hand | Every job, on the branch that the run names: `gh workflow run ci.yml --ref main` |
| Merge queue | Every job, only while main's rules still use the queue |

- A new push to a pull request cancels the run of its older push. Runs on main each have a group of their own, so a merge never cancels main's run of the merge before.
- CI's Chrome tests draw on SwiftShader only, and Firefox on Linux draws with a software renderer. The Mac's real GPU gets no run in CI, apart from Safari. So run the browser and image tests of the areas that a pull request touches once on the Mac's GPU, before it is ready for review. Run `bun run test:browser` with Playwright's `--grep` or a spec file, and `bun run test:images` with `--grep`. A change that Safari or Firefox may treat differently also runs `bun run test:real-browsers Safari Firefox` ([Device sessions](../devices.md)).
- Before 6 October 2026, every pull request and every push to main ran the full suite, about 100 runner minutes each. GitHub Free runs 20 Linux jobs at once, so the queue's runs waited for runners for about half of their 32 minutes. From 6 to 7 October 2026, pull requests ran only the quick checks, and the queue ran the rest ([D-86](D-86-ci-runs-per-event.md)).

### Docs-only pull requests

A pull request that changes only docs files runs only the checks that read them. CI's first job, `changes`, decides it from the diff of the merge commit with main. A renamed file counts as its old path and its new path.

- Docs files are Markdown files anywhere, and every file in `.dev/`, `docs/` and `skills/`. Only the `docs-and-tools` job reads them, in its docs, style, skills and type checks, the skill validator and the unit tests. Nothing in the engine, the Rust crates, the benchmarks or the test pages reads them. That holds for `docs/data/threejs-mapping.json` too: only the docs generator, the skills check and their unit tests read it.
- `build` still runs, because `docs-and-tools` needs its shader modules.
- The browser tests draw each complete sketch in the skills' and the cookbook's Markdown (`tests/image/skill-sketches.spec.ts`). So when a docs-only pull request that is no draft changes Markdown in `skills/` or `docs/cookbook/`, the `skill-sketches` job runs that one test file. In a full run, the `browser` shards draw the sketches, and `skill-sketches` skips.
- Every other job skips. That is the Rust jobs, the size check, the shader compiler and the packages test. It is also the browser, benchmark page, allocation, Safari and Firefox jobs.
- A pull request that changes any other file runs every job. That includes `.github/`, `package.json` and the tools.
- Each push to main runs every job, so main's run still tests the docs change with everything else.
- The reason: a full run takes about 30 jobs. GitHub Free runs 20 Linux jobs at once, and few macOS jobs. On 11 October 2026, with 6 or more pull requests open, main's own run waited over 90 minutes for runners. A docs-only run takes 4 short jobs, `ci-passed` among them, or 5 with the sketches.
- A new test that reads a docs file must run in `docs-and-tools`. If it cannot, add the file's path to the `changes` job as a code path. Otherwise a docs-only pull request skips the test, and only main's run finds a failure.
- The `changes` job's log lists the pull request's files and its four answers: `code`, `full`, `allocation` and `sketches`. `ci-passed` prints them too.
