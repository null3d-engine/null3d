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
| The memory of CI's `ubuntu-latest` runner | 16 GB |

How the data was produced: the six `shader-entries` artifacts of run 39953294861 went into a cache folder on the Mac. A checkout of that run's commit, dc2ed4f8b, gives the same inputs and compiler stamp as CI. For each row, `/usr/bin/time -l` ran `shader-build --root <checkout> --cache <folder> --stamp <stamp>` on a fresh copy of the folder. Every run reused all 74 entries. The expanded size is the sum of the texts that the references name, counted by a script over the whole entry's file.

The first join expanded all six parts at once. To store the joined entry, it then made a second copy of every build as JSON values, and a third as one JSON text.

- The parts now join in their stored form, one at a time. The join holds each shared text once and renumbers each part's references to the joined list. The joined entry streams to its file, and its builds expand once, at the end, as a read of the whole entry expands them.
- Every store streams its JSON to the file, and the text sharing moves each text instead of copying it.
- A read drops the file's bytes once it has parsed them. When the builds expand, the last reference to a text takes it, and the others copy it.
- A shard that reads its part from the whole entry narrows the entry in its stored form, so only the part's builds expand.

The budget: the shader build runs alone in the `build` job, since `tools/build-wasm.ts` finishes the shader modules before it starts the WebAssembly builds. Its peak, the join included, stays at or below a read of the whole entry. It leaves room under the runner's memory: about 2 GB on this data. A change that raises the peak states the new figure, measured as above. The expanded builds are most of the peak, and they grow with the manifest. Holding each shared text once in memory, not a copy in each build, would cut `standard_maps` from 6.3 GB to about 2 GB. That change reaches the shader output types that the whole crate uses.

`crates/null3d-shaders/tests/cache.rs` checks that the joined entry reads back, and that it holds each shared text once, as an entry built whole does.
