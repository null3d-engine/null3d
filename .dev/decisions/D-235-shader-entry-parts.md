# D-235: The shader cache keeps parts of an entry

Status: decided and built. Not measured yet: the time cost of the memory work for a build that compiles every entry, which needs a quiet machine. Task: none.

Summary: The per-entry shader cache keeps parts of an entry's builds beside the entry's key, and a build of the whole entry joins a complete set. So CI's sixteen `shader-entries` jobs split the builds by cost, as the shader tests do, and the textured standard material does not set their time. With two jobs of whole entries, the job with `standard_maps` took 23.2 minutes whenever the shaders changed, and every job after it waited.

## Question

The `shader-entries` jobs fill the per-entry cache before the build job, so the build job compiles no entry itself. A cache entry that holds a whole entry makes the jobs split whole entries. The entry `standard_maps` makes 77.8% of the builds, so its job holds that share, however many jobs run. How can the work split evenly?

## Rule

- A shader build's output must not depend on how its work was split, or on what the cache held.
- A cache entry never answers for inputs other than its own: its key and its dependencies' contents must match.
- A rule of [D-218](D-218-efficient-ci-jobs.md): steps that do not depend on each other run apart. A split follows measured cost, and the costliest unit splits too.

## Data

| Measure | Result |
| --- | --- |
| `shader-entries` (1 of 2), run 39799984654, the job with `standard_maps` | 23.2 min |
| `shader-entries` (2 of 2), the same run | 6.0 min |
| The build job's compile of all 73 entries, run 39274030849 | about 26 min |
| `standard_maps`' share of the manifest's builds | 77.8% |

How the data was produced: the job times of the named runs from `gh api repos/{owner}/{repo}/actions/runs/<run>/jobs`.

## Decision

- A build that compiles one part of an entry, as `ShardPlan::by_build` cuts it, stores the part in a file of its own: `<entry>.<key>.part-<i>-of-<n>.json`. The key is the whole entry's, so a part answers only for the same entry, source, table and compiler.
- A build of the whole entry that misses its file looks for a complete set of parts of one count, by their file names. It reads each part with the usual key and dependency checks, and joins their builds. Each build of an entry compiles on its own, so the joined builds are the builds of a whole compile. It stores the joined entry whole and removes the parts. A set with a part that does not read is passed over, and the entry compiles.
- A build of one part reads its builds from the whole entry when the cache holds it. So a shard reuses what a build of the whole stored, however that build split.
- `shader-build --entries-shard` splits by build, and CI runs sixteen `shader-entries` jobs ([The number of jobs](#the-number-of-jobs)).

The shader tests' shards split by build, and build without the cache.

## Consequences

- `crates/null3d-shaders/src/cache.rs` holds part files, `Cache::load_part` and `Cache::store_part`, and `Cache::load` joins parts. `build_entries` in `crates/null3d-shaders/src/lib.rs` reads and stores parts.
- `crates/null3d-shaders/tests/cache.rs` checks four things. Shards' parts join into the whole entry and leave no part behind. A part reads its builds from a whole entry. An incomplete set compiles the entry. A whole build reuses everything that build-cost shards stored.
- A change to the shader crate changes the compiler's stamp. The first build after such a change then compiles every entry once, on each machine and in CI.
- [Branches and parallel work](../pull-requests.md#builds) describes the parts, and `tools/lib/ci-workflow.test.ts` checks that each `shader-entries` job runs once.

## The number of jobs

CI runs sixteen `shader-entries` jobs, so each takes about 6.3% of the builds. The slowest should then compile for about 150 s, and take about 3 minutes.

- The jobs head the longest chain of a run that changes the shaders, before the `build` job, and the enterprise runs 500 jobs at once.
- The shares need room for a slow runner, rather than the job a longer limit. The diagnostic runs 39997019327 and 40000657532 found one runner 2 to 3.6 times slower than another on the same build. In run 40016767660, with six jobs, one runner in eastus2 compiled its share at about a third of the usual rate. It ran out of the job's 20-minute limit halfway.
- Each job costs its setup, about 40 s. A run that changes no shader finds the set in the cache and compiles nothing.
- About 45 s of each compile step builds the compiler's program, which the per-entry cache keeps for later runs of the same stamp.

| Jobs | Run | Compile step per job | Job time |
| --- | --- | --- | --- |
| 6 | 39968242466 | about 16.7% of the builds each | 4.7 to 6.7 min |
| 8 | 40046196327, which compiled every entry | 198 to 265 s, 1,732 s in all | 3.9 to 5.2 min |
| 12 | test run 40062880929, which compiled every entry and a new compiler | 119 to 197 s | 2.4 to 3.9 min |

## The join's memory

A join can expand all six parts at once. To store the joined entry, it then makes a second copy of every build as JSON values, and a third as one JSON text. Such a join runs CI's `build` job out of memory. In runs 39953294861, 39954868489 and 39956576359, each job died about 70 seconds into the shader build. It exited with code 143 and "The runner has received a shutdown signal".

| Measure | Result |
| --- | --- |
| `standard_maps`, the whole entry's file | 2.3 GB, of which 2.0 GB are its 22,009 shared texts |
| `standard_maps`, six part files | 0.88 GB each, 5.3 GB together: each part repeats the shared texts |
| `standard_maps`, its 53,160 builds expanded | 6.3 GB: each of 92,552 references copies a shared text |
| The shader build's peak, a join that expands every part at once | 22.0 GB resident, 20.9 GB footprint |
| The shader build's peak, a whole-entry read that holds the file's bytes and copies each text | 16.3 GB resident, 15.3 GB footprint |
| The shader build's peak, the join in stored form | 14.1 GB resident, 12.8 GB footprint |
| The shader build's peak, a whole-entry read that drops the file's bytes and moves each text | 14.0 GB resident, 13.0 GB footprint |
| The shader build's peak, the join with each source held once in memory | 7.3 GB resident, 5.8 GB footprint |
| The shader build's peak, a whole-entry read with each source held once in memory | 6.9 GB resident, 6.6 GB footprint |
| The memory of CI's `ubuntu-latest` runner | 16 GB |

How the data was produced: the six `shader-entries` artifacts of run 39953294861 went into a cache folder on the Mac. A checkout of that run's commit, dc2ed4f8b, gives the same inputs and compiler stamp as CI. For each row, `/usr/bin/time -l` ran `shader-build --root <checkout> --cache <folder> --stamp <stamp>` on a fresh copy of the folder. Every run reused all 74 entries. The expanded size is the sum of the texts that the references name, counted by a script over the whole entry's file. The two rows with each source held once in memory used the same data, converted to the typed format by a script, and a build of the tool that keeps the data's format version so that the file names match. Both runs found the shader modules up to date, so the output is byte for byte the same.

- The parts join in their stored form, one at a time. The join holds each shared text once and renumbers each part's references to the joined list. The joined entry streams to its file, and its builds expand once, at the end, as a read of the whole entry expands them.
- Every store streams its JSON to the file, and the text sharing moves each text instead of copying it.
- A read drops the file's bytes once it has parsed them. When the builds expand, the last reference to a text takes it, and the others copy it.
- A shard that reads its part from the whole entry narrows the entry in its stored form, so only the part's builds expand.

With those, the expanded builds are most of the peak, and they grow with the manifest. So, by the owner's decision, the builds share their sources in memory too:

- The WGSL and GLSL sources of the shader output types are shared texts (`Arc<str>`). A build that the cache gives back holds its entry's one copy of each source, not a copy of its own.
- The cache file stores each build in a typed form whose sources are numbers in the entry's list of sources. A read hands them out as shared texts, so it copies no source into a build. The cache's format version is 3.

The budget: the shader build runs alone in the `build` job, since `tools/build-wasm.ts` finishes the shader modules before it starts the WebAssembly builds. Its peak, the join included, stays at or below a read of the whole entry, and leaves room under the runner's memory: about 9 GB on this data. A change that raises the peak states the new figure, measured as above. On Linux the shader build prints its peak at the end of its report, from the kernel's high-water mark, so each CI log shows it.

`crates/null3d-shaders/tests/cache.rs` checks that the joined entry reads back, and that it holds each shared text once, as an entry built whole does. A unit test in `cache.rs` checks that the builds a read gives back share one copy of a source in memory.

## One archive for each job's entries

Each `shader-entries` job hands its entries to the `build` job as one tar file compressed with zstd, through `.github/actions/archive`. A zip compresses each file alone, on one core, and the entries repeat much of their text from file to file. In run 40022423739 the six jobs' zips came to 1.28 GB, each job took up to 31 s to upload its own, and the `build` job took 94 s to download them all, while every job after it waited. On a Mac the per-entry cache of one compiler, 76 entries in 2.6 GB, made a 609 MB zip in 46 s and a 40 MB archive in 1 s. The `build` job takes every archive by the pattern of their names and unpacks each into the per-entry cache. In test run 40027205919, with the Actions cache's fallback keys off so that the eight jobs compiled every entry, their archives came to 7.4 to 8.6 MB each, 65 MB in all, and each upload took 2 s. The `build` job downloaded and unpacked them in 8 s, and its shader build compiled no entry and reused all 74.

## A build that compiles every entry

The shader build's peaks above come from builds that reused every entry. The table below adds builds that compile every entry. In this section a GB is 10<sup>9</sup> bytes.

Four things hold the memory of such a build. Each is handled so that the modules stay byte for byte the same:

- Each build's sources become the run's one copy of each text as the build ends. A read from the cache shares them, and a compiled build that kept its own copy until the last build ended would hold them all.
- A thread's composers start again empty every 200 builds. Composers that keep the library modules for every set of shader defs that the thread meets grow through the run. On 7 threads, the restart cuts the peak footprint from 6.51 GB to 3.45 GB, as rows 4 and 5 show. Only that count was measured. `NULL3D_SHADER_COMPOSER_BUILDS` sets another count, and 0 keeps the modules for the whole run.
- Each module is written as soon as it renders, so the run holds only the modules that it renders at that moment. All 5,965 modules take 3.16 GB on disk, as row 2 wrote them.
- A read parses an entry's file as it reads it, so it never holds the file's bytes and the parsed entry at once. The cache file of `standard_maps` that row 2 wrote holds 2.41 GB.

| Row | Build of 93720008d | Threads | Peak footprint | Peak resident | Processor time | Wall time |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Without the four, compiles every entry | 14 | 16.10 GB | 19.48 GB | 5,069 s | 412 s |
| 2 | With all four, compiles every entry | 14 | 3.87 GB | 5.40 GB | 5,259 s | 423 s |
| 3 | Shared sources, modules written as they render | 14 | 9.06 GB | 9.47 GB | 4,759 s | 816 s |
| 4 | The same as row 3 | 7 | 6.51 GB | 6.80 GB | 4,552 s | 858 s |
| 5 | Row 4, with composers that start again every 200 builds | 7 | 3.45 GB | 4.52 GB | 4,537 s | 938 s |
| 6 | Without the four, reads every entry | 14 | 6.79 GB | 7.09 GB | 66 s | 31 s |
| 7 | With all four, reads every entry | 14 | 3.49 GB | 3.71 GB | 66 s | 28 s |

How the data was produced: each row ran `/usr/bin/time -l target/shader/shader-build --root <copy> --cache <folder> --stamp <name>` through the job queue. `NULL3D_SHADER_THREADS` set the thread count. The copy held only the manifest and the shader folder. Its output folder and its cache folder started empty. Rows 6 and 7 instead read cache folders that cold builds wrote. Row 6 read one that a compiler without the four wrote, and row 7 the one that row 3's build wrote. The timing tool gave the peaks and the times. The processor time is its user time.

Rows 1 and 2 ran one after the other, as one timing run of the queue. During row 2 the queue closed the run's window, because the load stayed high. One queue job of about 15 seconds then ran beside it. Work outside the queue kept the 1-minute load at 21 to 28. Rows 3 to 7 shared the machine with other jobs, at loads that were not recorded. In every run, `diff -r` found the modules the same as those of a compiler without the four. A separate digest run took the SHA-256 of every generated file in five output sets, all from sources at 93720008d. It compared the lists in pairs. In all 5,965 files, rows 5 and 7 each matched a cold build of a compiler without the four. Row 2 matched row 1 in the same files.

One more full build ran outside the table. It was `bun tools/shaders.ts` on 14 threads, in a merge of the four onto the milestone branch at `67b59f4be`. Its report said that it compiled 80 entries and reused none. Once a second, `ps -o rss=` read the build program's resident memory in KiB, at a 1-minute load of about 23. A browser test ran beside it. The highest reading was 6.20 GB, so that build held at least 6.20 GB.

The cost: rows 1 and 2 show 3% more wall time and 4% more processor time with the four. They ran at a load above the 8 that timing figures need. So they cannot tell the cost from noise, and a comparison on a quiet machine is owed.

The budget: allow 6.5 GB resident for a build that compiles every entry on 14 threads. That leaves a small margin above the highest reading of the run outside the table. A read of every entry held 3.71 GB resident in row 7. A change that raises a peak states the new figure, measured as in the table. Two tests check the sharing. One in `crates/null3d-shaders/tests/cache.rs` builds a small manifest and checks that builds with the same WGSL hold one copy of it. With the sharing removed, it fails. A unit test in `output.rs` checks the WGSL module and both GLSL stages.
