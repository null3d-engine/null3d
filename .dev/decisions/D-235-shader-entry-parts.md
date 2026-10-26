# D-235: The shader cache keeps parts of an entry

Status: decided. Date: 22 October 2026. Task: none.

Summary: The per-entry shader cache now keeps a part of an entry's builds beside the entry's key. A build that misses the whole entry joins a complete set of parts into it. So the `shader-entries` jobs split the builds by cost, as the shader tests do, and the textured standard material no longer sets their time. With two jobs of whole entries, one took 23.2 minutes whenever the shaders changed, and every later job waited for it. Six jobs should each take about a sixth of the work.

## Question

The `shader-entries` jobs fill the per-entry cache before the build job, so the build job compiles no entry itself. A cache entry held a whole entry, so the jobs split whole entries. `standard_maps` makes 77.8% of the builds, so its job held that share, however many jobs ran. How can the work split evenly?

## Rule

- A shader build's output must not depend on how its work was split, or on what the cache held.
- A cache entry never answers for inputs other than its own: its key and its dependencies' contents must match.
- A rule of [D-218](D-218-efficient-ci-jobs.md): steps that do not depend on each other run apart. A split follows measured cost, and the costliest unit splits too.

## Data

| Measure | Result |
| --- | --- |
| `shader-entries` (1 of 2), run 39799984654 of 22 October 2026, the job with `standard_maps` | 23.2 min |
| `shader-entries` (2 of 2), the same run | 6.0 min |
| The build job's compile of all 73 entries, run 39274030849 | about 26 min |
| `standard_maps`' share of the manifest's builds | 77.8% |

How the data was produced: the job times of the named runs from `gh api repos/{owner}/{repo}/actions/runs/<run>/jobs`.

## Decision

- A build that compiles one part of an entry, as `ShardPlan::by_build` cuts it, stores the part in a file of its own: `<entry>.<key>.part-<i>-of-<n>.json`. The key is the whole entry's, so a part answers only for the same entry, source, table and compiler.
- A build of the whole entry that misses its file looks for a complete set of parts of one count, by their file names. It reads each part with the usual key and dependency checks, and joins their builds. Each build of an entry compiles on its own, so the joined builds are the builds of a whole compile. It stores the joined entry whole and removes the parts. A set with a part that does not read is passed over, and the entry compiles.
- A build of one part reads its builds from the whole entry when the cache holds it. So a shard reuses what an earlier build of the whole stored, however that build split.
- `shader-build --entries-shard` splits by build, and CI runs six `shader-entries` jobs.

The shader tests' shards already split by build, and build without the cache, so they do not change.

## Consequences

- `crates/null3d-shaders/src/cache.rs` gains part files, `Cache::load_part` and `Cache::store_part`, and `Cache::load` joins parts. `build_entries` in `crates/null3d-shaders/src/lib.rs` reads and stores parts, where it skipped the cache before.
- `crates/null3d-shaders/tests/cache.rs` checks four things. Shards' parts join into the whole entry and leave no part behind. A part reads its builds from a whole entry. An incomplete set compiles the entry. A whole build reuses everything that build-cost shards stored.
- A change to the shader crate changes the compiler's stamp. So the first build after this change compiles every entry once, on each machine and in CI.
- [Branches and parallel work](../pull-requests.md#builds) describes the parts, and `tools/lib/ci-workflow.test.ts` checks that each `shader-entries` job runs once.

## Update, 23 October 2026: the join's memory

The first join stopped CI's `build` job in three runs in a row: 39953294861, 39954868489 and 39956576359. Each job died about 70 seconds into the shader build, with exit code 143 and "The runner has received a shutdown signal". The runner had run out of memory. The change was reverted, and it came back with the join below.

| Measure | Result |
| --- | --- |
| `standard_maps`, the whole entry's file | 2.3 GB, of which 2.0 GB are its 22,009 shared texts |
| `standard_maps`, six part files | 0.88 GB each, 5.3 GB together: each part repeats the shared texts |
| `standard_maps`, its 53,160 builds expanded | 6.3 GB: each of 92,552 references copies a shared text |
| The shader build's peak, the first join | 22.0 GB resident, 20.9 GB footprint |
| The shader build's peak, a whole-entry read before this update | 16.3 GB resident, 15.3 GB footprint |
| The shader build's peak, the join below | 14.1 GB resident, 12.8 GB footprint |
| The shader build's peak, a whole-entry read after this update | 14.0 GB resident, 13.0 GB footprint |
| The shader build's peak, the join with each source held once in memory | 7.3 GB resident, 5.8 GB footprint |
| The shader build's peak, a whole-entry read with each source held once in memory | 6.9 GB resident, 6.6 GB footprint |
| The memory of CI's `ubuntu-latest` runner | 16 GB |

How the data was produced: the six `shader-entries` artifacts of run 39953294861 went into a cache folder on the Mac. A checkout of that run's commit, dc2ed4f8b, gives the same inputs and compiler stamp as CI. For each row, `/usr/bin/time -l` ran `shader-build --root <checkout> --cache <folder> --stamp <stamp>` on a fresh copy of the folder. Every run reused all 74 entries. The expanded size is the sum of the texts that the references name, counted by a script over the whole entry's file.

The first join expanded all six parts at once. To store the joined entry, it then made a second copy of every build as JSON values, and a third as one JSON text.

- The parts now join in their stored form, one at a time. The join holds each shared text once and renumbers each part's references to the joined list. The joined entry streams to its file, and its builds expand once, at the end, as a read of the whole entry expands them.
- Every store streams its JSON to the file, and the text sharing moves each text instead of copying it.
- A read drops the file's bytes once it has parsed them. When the builds expand, the last reference to a text takes it, and the others copy it.
- A shard that reads its part from the whole entry narrows the entry in its stored form, so only the part's builds expand.

The expanded builds were then most of the peak, and they grow with the manifest. So, at the owner's word the same day, the builds share their sources in memory too:

- The WGSL and GLSL sources of the shader output types are shared texts (`Arc<str>`). A build that the cache gives back holds its entry's one copy of each source, not a copy of its own.
- The cache file stores each build in a typed form whose sources are numbers in the entry's list of sources, which a read hands out as shared texts. The format before held the builds as JSON values with `{"$text": n}` references, which a read copied into each build. The cache's format version went from 2 to 3, so the first build after the change compiles every entry once.
- The two rows with each source held once in memory used the same data, converted to the new format by a script, and a build of the tool that keeps the old format version so that the file names still match. Both runs found the shader modules already up to date, so the output is byte for byte the same.

The budget: the shader build runs alone in the `build` job, since `tools/build-wasm.ts` finishes the shader modules before it starts the WebAssembly builds. Its peak, the join included, stays at or below a read of the whole entry, and leaves room under the runner's memory: about 9 GB on this data. A change that raises the peak states the new figure, measured as above. On Linux the shader build prints its peak at the end of its report, from the kernel's high-water mark, so each CI log shows it.

`crates/null3d-shaders/tests/cache.rs` checks that the joined entry reads back, and that it holds each shared text once, as an entry built whole does. A unit test in `cache.rs` checks that the builds a read gives back share one copy of a source in memory.

## Update, 24 October 2026: eight jobs

CI runs eight `shader-entries` jobs in place of six. With six, each took 4.7 to 6.7 minutes in run 39968242466, with about 16.7% of the builds. In run 40016767660 one runner in eastus2 compiled its share at about a third of that rate. It ran out of the job's 20-minute limit halfway. The diagnostic runs 39997019327 and 40000657532 found one runner 2 to 3.6 times slower than another on the same build. So the shares need room for a slow runner, rather than the job a longer limit. Eight jobs give each about 12.5% of the builds, in about three quarters of the time. A slow runner's share then takes about 15 minutes, which fits.

## Update, 24 October 2026: one archive for each job's entries

Each `shader-entries` job hands its entries to the `build` job as one tar file compressed with zstd, through `.github/actions/archive`, in place of the artifact's own zip. The zip compresses each file alone, on one core, and the entries repeat much of their text from file to file. In run 40022423739 the six jobs' zips came to 1.28 GB, each job took up to 31 s to upload its own, and the `build` job took 94 s to download them all, while every later job waited. On this Mac the per-entry cache of one compiler, 76 entries in 2.6 GB, made a 609 MB zip in 46 s and a 40 MB archive in 1 s. The `build` job now takes every archive by the pattern of their names and unpacks each into the per-entry cache. In test run 40027205919, with the Actions cache's fallback keys off so that the eight jobs compiled every entry, their archives came to 7.4 to 8.6 MB each, 65 MB in all, and each upload took 2 s. The `build` job downloaded and unpacked them in 8 s, and its shader build compiled no entry and reused all 74.

## Update, 24 October 2026: twelve jobs

CI runs twelve `shader-entries` jobs in place of eight. In run 40046196327, which compiled every entry, the eight jobs compiled for 198 to 265 s each, 1,732 s in all, and took 3.9 to 5.2 minutes with their setup of about 40 s. They sit at the head of the longest chain of a run that changes the shaders, before the `build` job. Twelve jobs give each about 8.3% of the builds, about 145 s of compiling on average, so the slowest job should take about 3.5 minutes. The four more jobs cost their setup, about 3 machine minutes a run that changes the shaders; a run that changes no shader looks the set up in the cache and compiles nothing.

## Update, 24 October 2026: sixteen jobs

CI runs sixteen `shader-entries` jobs in place of twelve. In test run 40062880929, which compiled every entry and a new compiler, the twelve jobs compiled for 119 to 197 s each and took 2.4 to 3.9 minutes. About 45 s of each compile step built the compiler's program, which the per-entry cache now keeps for later runs of the same stamp. The jobs head the longest chain of a run that changes the shaders, and the enterprise runs 500 jobs at once. So sixteen jobs give each about 6.3% of the builds. The slowest should then compile for about 150 s, and take about 3 minutes.


## Update, 26 October 2026: a build that compiles every entry

The rows above measure builds that read every entry from the cache. No row measured a build that compiles every entry. On a machine with 14 cores and 36 GB, such a build of 93720008d on 14 threads held 17.45 GB at its peak. The job queue on that machine gives 24 GB to all its jobs together, so the build could not run beside a page build.

Four things held the memory. Each one is now changed, and the modules stay byte for byte the same:

- Each build kept its own copy of its sources until the last build ended. A read from the cache shares them, and a compiled build did not. Now each build's sources become the run's one copy of each text as the build ends.
- Each thread's composers kept the library modules for every set of shader defs that the thread met. Now a thread's composers start again empty every 200 builds. On 7 threads, that cut the peak footprint from 6.51 GB to 3.45 GB, about 0.44 GB a thread. Only that count was measured. `NULL3D_SHADER_COMPOSER_BUILDS` sets another count, and 0 keeps the modules for the whole run.
- The build rendered all 5,965 modules, 3 GB of text, before it wrote the first one. Now each module is written as soon as it renders, so the run holds only the modules that it renders at that moment.
- A read of an entry held the file's bytes and the parsed entry at once: 2.3 GB of bytes for `standard_maps`. Now the read parses the file as it reads it.

In the table, a GB is 10<sup>9</sup> bytes.

| Build of 93720008d | Threads | Peak footprint | Peak resident | Processor time | Wall time |
| --- | --- | --- | --- | --- | --- |
| Before the change, compiles every entry, back to back with the next row | 14 | 16.10 GB | 19.48 GB | 5,069 s | 412 s |
| All four changes, compiles every entry, back to back with the row above | 14 | 3.87 GB | 5.40 GB | 5,259 s | 423 s |
| Shared sources, modules written as they render | 14 | 9.06 GB | 9.47 GB | 4,759 s | 816 s |
| The same | 7 | 6.51 GB | 6.80 GB | 4,552 s | 858 s |
| The same, with composers that start again every 200 builds | 7 | 3.45 GB | 4.52 GB | 4,537 s | 938 s |
| Before the change, reads every entry | 14 | 6.79 GB | 7.09 GB | 66 s | 31 s |
| All four changes, reads every entry | 14 | 3.49 GB | 3.71 GB | 66 s | 28 s |

How the data was produced: each row ran `/usr/bin/time -l target/shader/shader-build --root <copy> --cache <folder> --stamp <name>`, with `NULL3D_SHADER_THREADS` set to the thread count. The copy held only the manifest and the shader folder, with an empty output folder, and the cache folder started empty. The rows that read every entry used the folder that the cold build of the same compiler wrote. The first two rows ran one after the other as one timing run of the job queue, with no other job of the queue on the machine. Other sessions' work outside the queue kept the 1-minute load at 21 to 28 through both. The other rows that compile every entry shared the machine with other jobs, so their times only bound the cost. In every run, `diff -r` found the modules the same as those of the compiler before the change.

The cost: in the one pair measured back to back, the changed compiler took 3% more wall time and 4% more processor time. The load was 21 to 28 there, above the 8 that timing figures need. Processor time also moved by about 10% between the other runs. So the cost is within that noise, and a comparison on a quiet machine is still owed. The first build of 93720008d with the old compiler, through `bun tools/shaders.ts`, held 17.45 GB resident in 382 to 396 s. With all four changes, the same command held 5.65 GB resident in 497 s, on a busier machine. Those two ran outside the queue, as the shader build always does, so their times do not compare.

The budget: a build that compiles every entry now holds at most about 6.2 GB resident on 14 threads. Three runs measured 5.40, 5.65 and 6.20 GB. The last was the first build of the merged tree, on a busy machine. A read of every entry holds less than 4 GB. A change that raises either peak states the new figure, measured as above. Two tests check the sharing. One in `crates/null3d-shaders/tests/cache.rs` builds a small manifest and checks that builds with the same WGSL hold one copy of it; it fails with the sharing removed. A unit test in `output.rs` checks the WGSL module and both GLSL stages.
