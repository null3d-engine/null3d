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
- The packing test's compiler pool takes every core. Since 24 October 2026 its compiles go through the plugin's cache, which CI keeps in the Actions cache. A kept entry names its source and the compiler's version, so a change to a few modules compiles only theirs. In test run 40080601811, after a change to one module, the test took 9.9 s and its job 37 s. With every module to compile, the test took 300 to 406 s. A change to the shader crates empties that cache, so the test then compiles every module. That took 7.5 minutes in run 40085184470, and ended the run. So the test now runs in 4 parts, each with a quarter of the modules from `NULL3D_PACK_SHARE`, and a pass and a cache of its own. In test run 40086717207, with no cache, the parts took 1.3 to 2.4 minutes. In test run 40087379387, after a change to one module, three parts found their passes in 10 to 13 s. The fourth compiled that module alone, and took 23 s.
- The build job builds its three WebAssembly outputs at the same time. It uploaded its artifact at the fastest compression level until 23 October 2026: the artifact then grew from 453 MB to 593 MB, and in run 39813598275 its 25 downloads took 34 s at the median against 9 s, for an upload 30 s shorter. It went back to the default level. Since 23 October 2026 both large artifacts travel through `.github/actions/archive` instead: one tar file, compressed with `zstd` on every core. The zip of the build job's 2.8 GB took 510 MB and 77 s to upload in run 39869813447, and the archive takes about 122 MB, because the shader modules share their text and `zstd` compresses across files, while the zip compresses each file on its own and on one core.
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

## Update, 24 October 2026: the compiler shards read the native build

Each `shader-compiler` shard built its share natively, ran the GLSL and WGSL rules on that build, and then built the same share through the compiler. The `shader-entries` jobs had compiled every entry natively already, and the `build` job keeps them in the Actions cache. So the `build` job now hands on that cache's key and folders as outputs, and each shard restores the cache and reads its native build there, through `NULL3D_SHADER_ENTRIES` (`crates/null3d-shaders/tests/build.rs`). An entry that the cache lacks still compiles. The determinism part never reads the cache, since it must compile each build twice.

The two GLSL rule checks then took most of what was left. They read each stage of each build in turn, on one core: 572 MB of GLSL for shard 7/12, of which only 374 MB was distinct text. Each check now reads every distinct text once, with the texts spread over the machine's cores, and reports the same lines in the same order.

On this Mac, shard 7/12 without the compiler took 272 s, and the checks 98 s of it. With the cache its native build took 6 s, and with the spread checks the whole test took 25 s. In test run 40031098178 every shard compiled no entry and read them all from the cache. The shards' test times came to 3,213 s in all, against 5,059 s in run 40022423739, 36% less, and the longest fell from 539 to 364 s. The jobs took 5.1 to 8.7 minutes, against 6.0 to 10.2.

The Actions keys of the shader caches moved into `bun tools/shaders.ts --cache-keys`, which prints the whole key and its two fallback prefixes, so the shaders action and the `shader-entries` job no longer each build the branch's part of the key.

## Update, 24 October 2026: an unpack that ends in a broken pipe

Three full runs of 23 October 2026 failed on a Safari shard's download of an archive. In two of them, the shard of run 40000245794 with `page-wasm` and the one of run 40016767660 with `load-pages`, the download passed its digest check, and the unpack failed after 11 to 12 s, about the time a whole unpack takes on those machines. tar printed nothing, and zstd printed `/*stdout*\: Broken pipe`, so tar had closed the pipe and zstd failed the step. In the third, run 39990527400, the download of `load-pages` never ended, and the job's limit stopped it after 33 minutes. Both shards passed when run again.

The unpack in `.github/actions/archive` now judges tar's status first. When tar passed and zstd failed on a broken pipe, through its message or the pipe's signal, the step passes with a warning that names the archive. A tar that stops reading at the archive's end marker, before the padding behind it, closes the pipe that way after it has unpacked every file. Any other failure of either still fails the step: an archive cut short makes zstd fail with another message, even where tar, which then sees no file, passes. On this Mac, 303 unpacks of archives of 101 sizes through macOS's tar never broke the pipe, so the warning will show whether that tar is the cause on GitHub's macOS machines. The real-browser job, where the downloads stalled, now gives each of its downloads a limit of 6 minutes and one more try, which a test in `tools/lib/ci-workflow.test.ts` keeps; the slowest download that finished took about 3 minutes, on a slow macOS machine.

## Update, 24 October 2026: a stalled checkout

A checkout's fetch stalled on two runs of 24 October 2026. On a Safari shard of run 40049563192 it waited for curl's own receive timeout, 23 s on the first try and 11 minutes on the next. In run 40056066922 a Firefox shard's checkout waited 35 minutes, until the job's limit cancelled it, and held the run's end at 47 minutes, where its other jobs ended by 24. CI's and the benchmark workflow's environments now set `GIT_HTTP_LOW_SPEED_LIMIT` to 1,000 bytes a second and `GIT_HTTP_LOW_SPEED_TIME` to 30 s, so git gives up on a transfer that stays that slow, and `actions/checkout` fetches again, as it does up to three times. A stall in the checkout's own fetch of the files that a sparse checkout reads fails the step within the same 30 s in place of hanging, since `actions/checkout` does not repeat that step. A test in `tools/lib/ci-workflow.test.ts` keeps both settings.

