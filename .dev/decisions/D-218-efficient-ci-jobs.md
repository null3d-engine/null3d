# D-218: CI does each piece of work once, and only the work its checks need

Status: decided. Date: 22 October 2026. Task: none.

Summary: A review of CI run 39744891020 found the slowest jobs doing work twice or work that no check needed. One shard ran 11.4 minutes of plugin tests after its own build share. A test built 78% of all shader work to check six renders. Four jobs repeated another job's build and checks. CI now runs that work once, in parallel, under pass keys of exactly the files each part reads. AGENTS.md hard rule 37 and a unit test guard the rules. The estimated run time when shader inputs change drops from 29.5 to about 16 minutes.

## Question

The latest passing run of the milestone branch took 29.5 minutes. Two of its jobs took longer than 15 minutes, the most a CI job should take. What did they do, did CI need it, and how should CI's jobs be built so that such work does not come back? The owner's words on 22 October 2026: "ci jobs may take long on slow github machines, it's more about ensuring the jobs are architected efficiently, use cacheing where possible, avoid duplication of work or unnecessary work."

## Rule

- A job does a piece of work only when no other job does the same work on the same inputs.
- A job reuses what another job built, from an artifact or a cache, and never builds it again.
- A test builds only the inputs that its checks read.
- Steps that do not depend on each other run in jobs or processes of their own, and each uses every core.
- Every expensive step keeps its result in a cache, or records its pass, under a key of exactly the files that it reads.
- A long job is a sign to look for these faults. It is not a reason to raise its limit.

## Data

Run 39744891020 of 22 October 2026, on commit 4dc998d9f of the draft pull request #549, ran the quick checks only. Its shader inputs had changed, so every shader part ran in full.

| Measure | Result |
| --- | --- |
| The whole run, from the push to `ci-passed` | 29.5 min |
| Waiting while the cancelled run before it stopped | 1.4 min |
| `build` | 5.0 min, of which 3.0 min built three WebAssembly outputs one after another and 66 s uploaded the 453 MB artifact |
| `shader-compiler`, shard 1 of 8 | 22.0 min: its share of the build test in 10.1 min, then the plugin's compiler tests in 11.4 min |
| The plugin's packing test, "ShaderPack with the compiler" | 6.9 min |
| The plugin's test "gives the native build's output for the engine's shaders" | 2.6 min, against a limit of 3 |
| `shader-compiler`, shards 2 to 8 | 7.8 to 13.6 min |
| `rust-tests`, the shader module exports test, part 1 of 2 | 18.9 min, of which 18.1 min in the test, which built `standard_maps` alone, 77.8% of all builds |
| The same part in the four earlier runs that ran it in full | 13.8 to 24.7 min |
| `rust-tests`, the four whole shader build parts, in four earlier runs | 5.9 to 10.5 min each |
| The last 100 CI runs, since 20 October 2026 | 74 on the milestone branch: 4 passed, 13 failed, 56 cancelled by a newer push, 1 still running |

How the data was produced: `gh api repos/{owner}/{repo}/actions/runs/<run>/jobs` gave the job and step times of this run and of the branch's earlier runs. The logs of the slowest steps gave the times of single tests.

## What each slow job did

- **`shader-compiler`, shard 1.** Every shard builds its share of the shader build natively and runs every check that reads that build. Then it builds the same share through the compiler on every core and compares the two. Shard 1 then ran the Vite plugin's compiler tests, which no other shard ran. The two halves do not depend on each other, but they ran one after the other.
- **The shader module exports test.** It prepares a module set through the compiler's exports, lists the module names, and renders one module of each kind. D-192 found that the renders take seconds and the build takes the rest. The test runs as native code under cargo-nextest, so its build is the native build that the shader build test already checks. The build job renders the whole module set whenever the shader inputs change. The test's checks need one module of each kind, and four entries make every kind.
- **The whole shader build parts of `rust-tests`.** They ran the same test function as the `shader-compiler` shards, on the same native build, with the same checks, without the compiler. The `shader-compiler` key holds every file of their key, so they never ran without the shards. They added no coverage.
- **Pass keys.** The `shader-compiler` key held all of `tools/lib` until commit e970ab6a1, so a change to the size report rebuilt every shard. It left out the compiler's runner script, `tools/shader-compiler.ts`, which the Rust test starts. It also left out the WGSL that the packing test compiles, in the test pages, fixtures and demos. A change to any of these files reused a pass that no longer held.

## Decision

- The plugin's compiler tests run in a job of their own, `shader-compiler-plugin`, in two parts: the packing test, and the other four test files. They need no Rust toolchain. Each part's key names the files it reads, including the WGSL that it compiles. `package.json` holds the parts as `test:shader-compiler:build`, `test:shader-compiler:plugin` and `test:shader-compiler:pack`, and `test:shader-compiler` still runs them all.
- `shader-compiler` runs in 12 shards instead of 8. A shard's work falls from about one eighth to one twelfth of the build. The estimate is about 9 minutes for each shard.
- The module exports test builds `lit`, `environment`, `pick` and `timer_mark`, the determinism check's list, which make one module of every kind. The compiler's `prepare_modules` export takes `{ "entries": [...] }` in place of the shard that only CI used, and refuses an entry that the manifest lacks. The test fails when a kind of module is missing. It runs among the workspace's tests, so its two parts and its nextest profile go.
- The two tests keep their own copies of the list and of the module kinds' file names. A shared copy in the shader library changes the compiler's stamp, which keys the per-entry shader cache. Every shader then compiles again, on the Mac and in CI's first run, for no change to any shader: on 22 October 2026 that rebuild ran for hours on the loaded Mac and held the lock that every commit's type check waits on.
- The four whole shader build parts go. `rust-tests` keeps the determinism part. The build test now reports the compiler's differences beside the native build's rule failures, so neither hides the other.
- The packing test's compiler pool takes every core.
- The build job builds its three WebAssembly outputs at the same time. It uploaded its artifact at the fastest compression level until 23 October 2026: the artifact then grew from 453 MB to 593 MB, and in run 39813598275 its 25 downloads took 34 s at the median against 9 s, for an upload 30 s shorter. It went back to the default level. An artifact that many jobs download keeps the default level, and one that a few jobs download after a long upload on the critical path, such as `load-pages`, takes the fastest.
- Larger runners: 8 and 16 cores cost about $0.022 and $0.042 a minute on GitHub's Enterprise Server price list. A 16-core runner would shorten the `shader-compiler` shards by about 3 minutes against 12 shards, for about $1.20 a cold run. The run would not end sooner, because `packages` then takes as long. CI uses the free 4-core runners.

## Consequences

- AGENTS.md hard rule 37 states the rule. [Efficient jobs](../pull-requests.md#efficient-jobs) gives its reasons and the ways to reuse work. It also gives the questions to answer before adding a job, and how to review a run.
- `tools/lib/ci-workflow.test.ts` checks four parts of the rule in the workflow file:
  - Every job that runs `cargo` or `rustup` restores a Rust cache.
  - Every job that downloads the build job's files sets `NULL3D_REQUIRE_FRESH_SHADERS`.
  - Only `shader-compiler` runs the test that builds every shader, apart from the determinism part. No job names the module exports test.
  - Each pass key names every script that its part starts, with the files that those scripts import. A part that reads the build job's shader modules names the files they are built from.
- This replaces D-192's rule that the module exports test reads the engine's whole build, and changes D-194's shader test layout.
- The estimated run time when shader inputs change is about 16 minutes, and about 15 with the faster build job. A run without shader changes stays at about 15 minutes, which `packages` sets.
