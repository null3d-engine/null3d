# D-194: CI spreads its work over many machines at once

Status: decided. Date: 19 and 20 October 2026. Task: none.

Summary: The organization moved to GitHub Enterprise, which runs 180 jobs at once where the free plan ran 20. CI split its slow jobs into many short ones. A warm run took 43 minutes and a cold one 131. Most of that was waiting for machines and building every shader on one machine, several times over.

## Question

CI took over an hour, and runs that changed the shader compiler took over two. Of main's and the integration branch's last 100 runs on 19 October 2026, 8 passed, 20 failed and 71 were cancelled by a newer push. How should CI get faster: more machines, faster machines, or less work?

## Rule

- A run should take about as long as its longest job. Waiting for a machine should add almost nothing.
- Every job should take at most about 15 minutes, as the owner ruled on 12 October 2026.
- No check is dropped. A job may reuse a result only when every input of that result is the same.
- The cost stays small. The owner ruled out paying for every minute of a third-party runner service.

## Data

| Measure | Figure |
| --- | --- |
| Warm run, main, run 39064752033, 17 October 2026 | 43 minutes; 52 jobs; the last Safari shard waited 24.4 minutes for a machine; Linux jobs waited up to 18 |
| Cold run, integration branch, run 39191671424, 19 October 2026 | 131 minutes; Safari waited up to 43 minutes; Firefox up to 25 |
| Its `build` job | 31.4 minutes, 29.7 of them in the shader build: 73 of 73 entries compiled, none reused |
| Its whole shader build test | 105.3 minutes, then failed |
| Its `shader-compiler` job | 89.6 minutes, then cancelled |
| Its size check | 23 of 24 minutes compressing about 6,000 files, 2.5 GB |
| Runner minutes, 200 runs of 12 to 19 October 2026 | 44,683 on Linux, 8,597 on macOS |
| Whole shader build test, four shards of every fourth entry, Mac, 19 October 2026 | 1,862.9, 6.9, 33.5 and 65.6 seconds |
| The textured standard material, `standard_maps` | 53,160 of 68,369 builds, 77.8%; about 80% of the time in sample builds |
| The determinism check, comparing `lit` in place of `standard_maps`, Mac | 113.6 seconds, against 1,862.9 |
| GitHub's free plan | 20 jobs at once, 5 of them on macOS |
| GitHub Team, $4 a seat a month | 60 jobs at once, still 5 on macOS |
| GitHub Enterprise, $21 a seat a month | 500 jobs and 50 macOS jobs at once by GitHub's docs; the enterprise's hosted runners page shows 180 |
| Standard runners on a public repository | Free on every plan |
| Blacksmith or WarpBuild for every job | About $6,500 a month at that week's minutes, most of it macOS |
| GitHub's larger runners on Enterprise | $0.042 a minute for 16 cores, billed on public repositories too |

How the data was produced: GitHub's jobs API gave each job's start, end and runner. It covered the named runs and every CI run from 12 to 19 October 2026. Prices and limits come from GitHub's, Blacksmith's and WarpBuild's pricing and limits pages, read on 19 October 2026.

## Decision

The owner chose Enterprise for one seat on 19 October 2026, and declined Blacksmith. The owner also raised the repository's cache limit to 30 GB. Team was not enough, because it keeps macOS at 5, and the Safari shards set the warm run's length. A third-party service would charge for minutes that are free today, for a few minutes more of speed once the queue is gone. GitHub's larger runners stay an option for one job that still sets a run's length, after the owner sees its cost.

With the queue gone, CI splits its slow jobs:

- The browser tests run in 40 shards, and the tests that run alone in 3. The showcase HUD test splits into three tests, each in a job of its own.
- The real-browser jobs run 22 shards for each browser. Each Safari shard holds at most 9.1 minutes of pages in the model, from the times run 39291513923 measured.
- The benchmark page tests run in 5 shards. Three of them split the parity tests.
- The size check measures the engine test page in 4 parts at once, and each part compresses on every core.
- Every run saves its caches, so a pull request's next push reuses what the last one built.

The shader work also got smaller:

- The Rust test jobs build the shader crates optimized. The dev profile optimized only the dependencies, so the crates' own code ran unoptimized in their tests. A build that took the build job 26.5 minutes took 105 there.
- The shader tests split the manifest by each entry's build cost, not by every nth entry. The test of every shader also splits the costliest entries' builds, so each of its 4 shards holds about 25% of a whole build. The shader compiler test runs in 8 shards, split the same way. It builds through WebAssembly, one thread to a process, and 4 shards took 20 to 25.5 minutes in run 39291513923.
- The determinism check runs in a job of its own. It compared the textured standard material, which makes 77.8% of the builds, and built it twice. It compares the untextured standard material instead, which still makes every kind of module.
- Two `shader-entries` jobs compile the build job's shader entries, so the build job compiles none itself.
- A shader test part that passed with the same inputs in an earlier run passes at once. Its key hashes every file its tests read: the shader crates, `null3d-gpu`, the Cargo files, the toolchain and nextest's settings.

## Consequences

- `.github/workflows/ci.yml` holds the new jobs and shard lists. `tools/lib/ci-workflow.test.ts` checks that every job gates `ci-passed`, and that a job skips only on the answer `ci-passed` expects. It also checks that each shard list runs each shard once.
- `tests/lib/runs.test.ts` holds each real-browser shard to 10 minutes of pages in Safari. The job's limit is 30 minutes, which leaves room for a runner page that goes quiet.
- The first 30 browser weights halved the 15 earlier ones, since GitHub's jobs API failed during an incident on 19 October 2026. Those shards took up to 17.7 minutes in run 39291513923. Weights from the median times of runs 39291513923 and 39306888159 give 40 shards a slowest shard of 10.0 minutes in the model, under a 25-minute limit.
- During GitHub's Actions incident of 19 October 2026, from about 15:00 UTC, the enterprise ran only 5 to 14 jobs at once. Check the first runs after it for jobs that wait.
- One limit stays. A per-entry cache entry holds a whole entry, and the module exports test renders whole modules. So the `shader-entries` shard and the module exports shard with `standard_maps` each hold about 78% of a whole build. The next step stores a cache entry for each part of an entry, under the whole entry's key and the part. A build that misses the whole entry then merges a complete set of parts. The `shader-entries` jobs can then split by build, as the test shards do. A larger runner for that one shard is the other option, with the owner's approval of its cost.
- [Branches and parallel work](../pull-requests.md#cis-jobs), [Image tests](../image-tests.md#ci), [Benchmarks](../benchmarks.md) and [Device sessions](../devices.md#browser-apps-on-the-mac) describe the jobs.
