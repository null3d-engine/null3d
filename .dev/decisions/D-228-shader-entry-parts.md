# D-228: The shader cache keeps parts of an entry

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
