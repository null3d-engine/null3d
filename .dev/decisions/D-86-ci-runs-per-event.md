# D-86: Which CI jobs run on a pull request, in the merge queue and on main

Status: decided by the owner on 2026-10-06, until the 1.0 release. Date: 2026-10-06.

Summary: The merge queue runs every job. A pull request runs the quick checks, without the browser and benchmark page shards, and its author runs the browser tests of the areas it changes. A push to main runs only what keeps the caches and the commit's sizes, since main gets the exact commit that the queue tested.

## Question

CI ran its full suite three times for each pull request that merged: on the pull request, in the merge queue and again on main. The runs filled GitHub's runners, and merge queue runs waited for them. Which jobs must each event run?

## Rule

Every commit that lands on main passes every job once, before it lands. A run that only repeats a check of the same code is cut. A job that keeps something later runs need stays: a cache, or a commit's sizes for the size check.

## Data

| Measure | Figure | Source |
| --- | --- | --- |
| Runs from 2 October 2026 to the morning of 6 October, about 60 merged pull requests | 238 on pull requests (40 failed), 206 in the merge queue (59 failed, 29%), 115 on main (11 failed) | The coordinator's count of the CI workflow's runs |
| A merge queue run | About 32 minutes, about half of it waiting for a free runner | The same count |
| Runner time of one full run | 95 to 107 runner minutes in 18 jobs. The 7 browser shards and the 2 benchmark page shards take 73 to 82 of them | The 5 newest successful runs on main and on pull requests, 6 October 2026 |
| Time of a pull request's run, start to end | 29 to 42 minutes | The 5 newest successful pull request runs, 6 October 2026 |
| The commit that lands on main | The same commit as the merge queue run's head: main's 156c0621d is the head of queue run 37401235420 | `gh run list --commit` |
| Runners | GitHub Free: 20 Linux jobs and 5 macOS jobs at once. The queue builds 3 entries at a time | The repository's plan and its merge queue rule |

GitHub's cache rules decide where caches can be saved. A run restores the caches of its own branch and of the default branch, and a pull request's run also those of its base branch. A run never restores the caches of a sibling branch. A merge queue run has a branch of its own, `gh-readonly-queue/main/...`, so a cache that it saves serves no pull request. Main's runs must therefore still save the caches.

## Decision

| Event | Jobs |
| --- | --- |
| Pull request | `build`, `docs-and-tools` (lint, type check, docs and skills checks, unit tests, commit messages and trailers), `rust-lint`, `rust-tests`, `size-base`, `wasm-checks` (the size check), `shader-compiler`, `packages` |
| Merge queue | Every job: those above, the 7 `browser` shards, the 2 `bench` shards and the 4 `real-browsers` shards |
| Started by hand (`workflow_dispatch`) | Every job, as in the merge queue, on the branch that the run names |
| Push to main | `build` and `main-keep`, which keeps the commit's sizes and the caches of the packages, Playwright's Chromium and the sample content. `rust-lint`, `rust-tests`, `shader-compiler` and `size-base` only keep their Rust caches. They stop after the cache step when its key matches exactly, which is the case unless the Rust inputs changed |

- The queue already tests the exact commit that lands on main, so main's run repeated the queue's checks. A run on main now takes about 9 runner minutes in 7 jobs, against about 100 in 18.
- A pull request's run drops the browser and benchmark page shards, about 79 of its 103 runner minutes. The Rust tests stay: they take about 8.5 minutes.
- `ci-passed` accepts a job that its own condition skipped on a pull request or on main. In the queue and in a run started by hand, every job must pass. The queue's rule requires only `ci-passed` and `squash-title`, so it needs no change.
- Before a pull request joins the queue, its author runs the browser and image tests of the areas that it changes. They run on both GPU sets ([Pull requests](../pull-requests.md#what-ci-runs-where)). The queue still runs every test. But a failure there removes the pull request, and the queue's next run starts again.

### Merges by hand

The owner asked whether to drop the merge queue, and kept it, with this split. The owner may merge a pull request by hand when it is urgent, its checks are green, and it is up to date with main. Nothing else may be merging then. Main's run does not test such a commit again. So before it serves as a gate or release commit, it gets a full run started by hand:

```sh
gh workflow run ci.yml --ref main
```

The run tests main's newest commit, so start it before anything else merges. The exit gate and the Release workflow accept that run as they accept the queue's.

### Until 1.0

This split holds until the 1.0 release. After 1.0, pull requests run the browser tests on each push again. To switch back, set the condition of the `browser` and `bench` jobs in `.github/workflows/ci.yml` to `github.event_name != 'push'`. They then run on pull requests too. Then drop the rule that authors run the browser tests before the queue from [Pull requests](../pull-requests.md#what-ci-runs-where). The `real-browsers` jobs were queue-only before this decision, and they stay so. Main's slim run and the run by hand stay. [Releases](../releases.md#versions) lists the switch among the steps of 1.0.

## Consequences

- `.github/workflows/ci.yml` gives each job its events. The new `main-keep` job measures the `build` job's files and keeps their sizes. Before, `wasm-checks` checked main's sizes against the commit before, which the queue had already checked. The size check's base no longer has a case for a push to main.
- `.github/actions/playwright-chromium` and `.github/actions/samples` take `cache-only`. `main-keep` uses it, so it downloads nothing when the cache already holds the version.
- CI can be started by hand, and such a run runs every job.
- The Release workflow reads the newest full CI run of main's newest commit: the queue's or one started by hand, not main's own run. The queue's run is complete before the commit lands, so the workflow no longer waits for CI.
- The exit gate's `workflows` step reads the same full run of the gate commit. Main's own run no longer runs the image test manifest. A gate commit with no full run fails the step, until a run started by hand passes.
- [Pull requests](../pull-requests.md#what-ci-runs-where) lists what runs where.
