# D-222: One job builds the pages that the real-browser shards load

Status: decided. Date: 23 October 2026. Task: none.

Summary: Each of the 44 `real-browsers` shards built the benchmark pages and the startup pages before its first page. In run 39554447893, Safari's shard 19 spent 10.8 of its 23 minutes on them, and printed nothing meanwhile. The `bench` shards and the `allocation` jobs built the benchmark pages too. One job, `load-pages`, now builds them once on Linux and uploads them, and every job that serves them downloads them and builds none.

## Question

The Safari shards were the longest jobs of a full run, at 20 to 24 minutes for about 12 minutes of pages. What did each shard do before its first page, and did each shard need to do it?

## Rule

[D-218](D-218-efficient-ci-jobs.md): a job reuses what another job built and never builds it again, and a step that runs for minutes prints its progress.

## Data

| Measure | Result |
| --- | --- |
| Safari, shard 19 of 22, run 39554447893: the step's start to the dev server's start | 10.8 min, with no output |
| The same shard's pages | about 12 min |
| The benchmark pages' build and the startup pages' build on the Mac | 2.6 GB in 7,246 files, and 2.5 GB or more in about 6,300 files each, almost all of it shader modules |

How the data was produced: the shard's job log, and the run record that it uploaded, whose dev server log starts once the builds end.

## Decision

- `bun tests/lib/load-server.ts` makes every load build, and prints each build's time.
- The `load-pages` job runs it once, after the build and city jobs, and hands both folders on through `.github/actions/load-pages`, which stores each content once (see the update below).
- Each `real-browsers` shard downloads them and sets `NULL3D_LOAD_PAGES=prebuilt`: the runner then builds none, and stops with the command to run when a build that its plan loads is missing.
- The `bench` shards and the `allocation` jobs download them too, with the same switch. The benchmark pages' server, `serveBenchPages`, and the benchmark tests' Playwright server then serve the build as it is.

## Update, 23 October 2026: each content once

In full run 39854225392 the artifact took 139 s to upload, and its 51 downloads took 94 s at the median on Linux and 147 s on macOS, 86 runner-minutes in all.

| Measure | Result |
| --- | --- |
| The artifact, at the fastest level | 2.01 GB, 19,827 files, 8.52 GB unpacked |
| The distinct contents among them | 7,271 files, 2.90 GB, 0.71 GB compressed |

How the data was produced: the zip's central directory, read from the artifact's last 8 MB with an HTTP range request, which lists each file's size and checksum. Each page's build writes the whole shader set, so the startup pages and the benchmark pages repeat most of their files.

- `bun tools/link-duplicates.ts` makes each set of files with equal contents one file with several names. `tar` then stores each content once, and `zstd` compresses the archive on every core. The upload stores it as it is, at level 0.
- Each job that serves the builds downloads the archive and unpacks it, through the same action.

## Consequences

- `tests/lib/load-server.ts` holds the switch and the script. `tests/real-browsers.ts` and `bench/lib/serve.ts` make their builds through it, and `bench/playwright.config.ts` reads the switch.
- `tools/lib/ci-workflow.test.ts` checks that only `load-pages` makes the builds, and that a job with the switch waits for that job and downloads its files through `.github/actions/load-pages`, which no job bypasses.
- [Image tests](../image-tests.md#ci) describes the job.
