# D-222: The pages that the real-browser shards load build once, in jobs of their own

Status: decided and built. Task: none.

Summary: Two jobs make the load builds once, each on a Linux machine of its own. The `load-pages` job builds the benchmark pages and the city, the `load-startup-pages` job the startup pages, and every job that serves a build downloads it. In run 39554447893 each of the 44 `real-browsers` shards built both before its first page, and Safari's shard 19 spent 10.8 of its 23 minutes on them, with no output.

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
- Two jobs run it after the build job, on two machines at the same time. The `load-pages` job builds the benchmark pages and S6's city, and the `load-startup-pages` job builds the startup pages. Each hands its folder on through `.github/actions/archive` with `link` set, which stores each content once ([Each content once](#each-content-once)).
- Each build's readers differ. The `bench` shards and the `allocation` jobs serve only the benchmark pages and load S6's city files. Only 8 of each browser's real-browser pages load the startup pages, and the `real-browsers-prebuilt` job runs those. No job downloads both builds.
- Each job that serves a build waits only for the job that makes it, downloads the build and sets `NULL3D_LOAD_PAGES=prebuilt`. The runner then builds none, and stops with the command to run when a build that its plan loads is missing. The benchmark pages' server, `serveBenchPages`, and the benchmark tests' Playwright server serve the build as it is.

### Options rejected

- Both builds in one job, one after the other: the benchmark and allocation jobs would wait for the startup build too, 67 s in run 40056066922.
- Both builds at the same time on one runner. Test run 40053641808 took 61 s for the benchmark pages and 126 s for the startup pages. In turn they take 59 s and 75 s (run 40049563192), so building both at once saves about 8 s. Each build alone holds 13 to 14 GB at its peak, and the two together leave 1.4 GB of the runner's 16 GB free.

## Each content once

As a zip artifact at the fastest level, in full run 39854225392, the builds took 139 s to upload, and their 51 downloads took 94 s at the median on Linux and 147 s on macOS, 86 runner-minutes in all.

| Measure | Result |
| --- | --- |
| The artifact, at the fastest level | 2.01 GB, 19,827 files, 8.52 GB unpacked |
| The distinct contents among them | 7,271 files, 2.90 GB, 0.71 GB compressed |

How the data was produced: the zip's central directory, read from the artifact's last 8 MB with an HTTP range request, which lists each file's size and checksum. Each page's build writes the whole shader set, so the startup pages and the benchmark pages repeat most of their files.

- `bun tools/link-duplicates.ts` makes each set of files with equal contents one file with several names. `tar` then stores each content once, and `zstd` compresses the archive on every core. The upload stores it as it is, at level 0.
- Each job that serves a build downloads its archive and unpacks it, through the same action.

## Consequences

- `tests/lib/load-server.ts` holds the switch and the script. `tests/real-browsers.ts` and `bench/lib/serve.ts` make their builds through it, and `bench/playwright.config.ts` reads the switch.
- `tools/lib/ci-workflow.test.ts` checks that each load build runs in a job of its own, `load-pages` or `load-startup-pages`, and that every job that serves it waits for that job. The builds travel through `.github/actions/archive`, which no job bypasses for this artifact or the build job's.
- [Image tests](../image-tests.md#ci) describes the jobs.
