# D-86: Which CI jobs run on a pull request, in the merge queue and on main

Status: superseded by [D-99](D-99-no-merge-queue.md), which [D-157](D-157-direct-pushes-to-main.md) supersedes in turn. Work lands on main by direct push, with no merge queue, and every push to main runs every CI job. Decided by the owner.

Summary: Superseded: every push to main runs every CI job ([D-99](D-99-no-merge-queue.md)). Two reasons from this record still hold. GitHub's cache rules make main's runs save the caches, and the browser and benchmark page shards take most of a full run's runner time.

## Question

Which CI jobs must each event run? Every commit on main must pass every job, without runs that only repeat a check of the same code.

## Rule

Every commit that lands on main passes every job once. A run that only repeats a check of the same code is cut. A job that keeps something later runs need stays: a cache, or a commit's sizes for the size check.

## Data

| Measure | Figure | Source |
| --- | --- | --- |
| Runner time of one full run | 95 to 107 runner minutes in 18 jobs. The 7 browser shards and the 2 benchmark page shards take 73 to 82 of them | The 5 newest successful runs on main and on pull requests at the count |
| Time of a run with every job, start to end | 29 to 42 minutes | The 5 newest successful pull request runs at the count |
| Runners | GitHub Free: 20 Linux jobs and 5 macOS jobs at once | The repository's plan |

GitHub's cache rules decide where caches can be saved. A run restores the caches of its own branch and of the default branch, and a pull request's run also those of its base branch. A run never restores the caches of a sibling branch. So a cache that a run on another branch saves serves no other branch, and main's runs must save the caches that every run restores.

## What still holds

- Main's runs save the caches of the packages, Playwright's Chromium and the sample content. The actions `.github/actions/playwright-chromium` and `.github/actions/samples` take `cache-only`, so a job that only keeps a cache downloads nothing when the cache already holds the version.
- CI can be started by hand (`workflow_dispatch`), and such a run runs every job.
