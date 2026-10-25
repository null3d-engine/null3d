# Test memory

The unit tests run in a few processes, one for each group of them, so what each test holds adds to its group's peak. This guide covers that cost, the rules that keep a test small, and the ceiling the unit script sets. [AGENTS.md](../AGENTS.md) lists the commands, and [Image tests](image-tests.md) covers the browser tests.

## How the unit run works

- `bun run test` builds the shaders, then runs `bun test` over the tools, the packages, the benchmark scenes and pages, `tests/lib` and the demos.
- That is a group for each package, and one each for the tools, the benchmark's scenes and pages, `tests/lib` and the demos, each a `bun test` of its own (`tests/unit.ts`). One invocation holds everything it finds in one process, so a group's peak is what its files hold together, and the run's peak is the largest group's rather than the sum of them all.
- The generated shader set is the largest thing a test can hold: 1,343 modules and 850 MB of JavaScript source on disk. Git does not keep it; the build writes it. A project takes it from the release asset or builds it; `NULL3D_ENGINE_SHADERS` names a folder to use instead, such as a checkout's `packages/engine/src/generated`, which is what CI's package test does. Without the folder it would build 1,353 modules with the single-threaded wasm compiler, which takes longer than any job on a runner.
- A single file that imports the whole set makes the process large on its own. The same file that reads the set's text costs a fraction of that.
- A generated set is not the only thing a test holds for good. The WebAssembly texture transcoder's heap grows when a check feeds it hostile files, and it does not shrink, so a check that does that holds every growth it has made. The malformed-file checks reach 1.7 GB of memory that way, from a handful of changed files, each of them a few kilobytes on disk.
- The script leaves out the checks that hold gigabytes, and caps the run. `bun run test:heavy` runs those checks, each in a process of its own under a ceiling of its own (`tests/heavy-checks.ts`). Both read one list of them, `tests/lib/heavy-checks.ts`: a file the unit run left out and no runner named would run nowhere, and the two halves of the list must not drift apart.
- The files of a group run in the order that the filesystem hands them over. That order is stable on one machine, and it differs between machines. A test that installs a stand-in for a global, such as `Worker`, cannot rely on being the first to touch it. On 17 October 2026 that order hid a fault from the Mac and showed it on CI. The worker starter kept the constructor of the first start, so the capabilities test's stand-in went unused and its probe talked to a real worker. Two things made that a fault in the starter rather than in the test. Its own test comment claimed the starter keeps the first class it wraps, which was the belief the fault rested on and is now gone. And a page that replaces its `Worker`, and not only a test, would have broken the same way, because the cache held a constructor the caller had since put aside.

## Forcing the order the files run in

A failure that only CI shows, in a check that installs a stand-in for a global, is worth forcing the order for. A preload that starts one worker brings the fault out on any machine. Make a file that calls `spawnWorker(() => ({}) as Worker, error)`, and run it before the one test file:

```sh
bun test --preload ./start-one-worker.ts --conditions=null3d-source packages/engine/src/page/capabilities.test.ts
```

A folder whose copy of the file that starts the worker is named to run before a copy of the failing test works as well.

## What the run cost on 16 October 2026

| Work | Peak memory | Time |
| --- | --- | --- |
| The whole unit run | 12.5 GB | about 15 minutes |
| `tests/lib/runs.test.ts`, which plans every page of a run | 6.4 GB | 57 s |
| `packages/engine/src/gpu/webgl2/programs.test.ts` | 4.3 GB | 83 s |
| `tests/lib/jitter.test.ts`, a small file that imports the checks plan | 4.2 GB | 32 s |
| Importing the checks plan alone | 4.1 GB | 37 s |
| One file that imports all 1,343 generated modules | 3.6 GB | 19 seconds |
| The same program count, read from the modules' text | 69 MB | 1 second |

The last row is the shape to copy. A count, a size or a name is almost always readable from the file's text, and it costs about a hundredth of the memory.

The largest single cause was not a file that reads the set but two that build it. The packages group, run in a process of its own, cost 12.3 GB. Most of that was two of its files: `packages/engine/src/math/tree-shaking.test.ts` at 7.8 GB, and `packages/engine/src/debug/release.test.ts` at 5.6 GB. Each builds the engine with the bundler, whose bundle holds the 890 MB of shader code and a copy of it.

That run was one of the causes of an incident the same day: several helper agents on one machine pushed it past 70 GB, and the owner stopped the session. A test that holds a generated set in memory is not only slow; it can take the machine down with it.

## What the same checks cost now

| Work | Peak memory | Time |
| --- | --- | --- |
| The whole unit run | 2.9 GB | 176 s |
| `tests/lib/runs.test.ts` | 422 MB | 4 s |
| `tests/lib/jitter.test.ts` | 291 MB | 9 s |
| Importing the checks plan alone | 267 MB | 5 s |
| Reading the set's text for its counts | 108 MB | 4 s |
| `bun run typecheck`, 21 projects, at most eight at once | 3.9 GB, or 2.1 GB with current incremental records | 150 s, or 44 s with current records, on a Mac at a load of 88 to 109; one project after another took 481 s at a load of about 50 |
| `tests/lib/shader-set.test.ts`, in a process of its own | 5.3 GB | 60 s |
| `packages/engine/src/gpu/webgl2/programs.test.ts`, in a process of its own | 4.2 GB | 48 s |
| `packages/engine/src/math/tree-shaking.test.ts`, in a process of its own | 7.8 GB | 30 s |
| `packages/engine/src/debug/release.test.ts`, in a process of its own | 5.6 GB | 11 s |

The checks that hold gigabytes still do, one process at a time, each under a ceiling set from its
own figure: the two bundler builds cost the most, because the engine's 890 MB of shader code is in
the bundle they read and in the bundler's copy of it. What a group of the unit run holds is bounded
by the group, and the run's peak is its largest group rather than the sum of every file's memory.

## Rules

1. Read a count, a size or a name from the generated file's text. Import generated modules only when a test needs their values, and then only the modules it needs.
2. Load one part at a time and drop it before the next. Never hold every part of a set at once, and never merge the parts into one map to learn something a count gives.
3. A check that must compare against the whole set, or that builds the engine with its shaders in it, runs in its own process, through its own script. The unit run is shared, so such a check makes every other test pay for it.
4. Measure a test that touches generated data. Run it alone under `/usr/bin/time -l` and read the `maximum resident set size` line. Put the figure in the branch notes when the test changes.
5. Keep fixtures small, and read them one file at a time. Tests that need the large sample content use the shared cache that [Sample content](sample-content.md) describes.
6. When a check grows past the ceiling, split it rather than raising the ceiling. The ceiling exists to make a fault visible as a failed test, not to end a run with a dead machine.
7. A check gets the budget the run states, thirty seconds (`tests/lib/run-budget.ts`), and a check that needs more states its own, which wins over that. Bun's default of five seconds is a budget, not a measurement. The checks that map a glow at every canvas take 0.64 and 0.90 seconds idle and 7.0 and 8.7 seconds loaded, about tenfold, so a check that computes is at risk long before it looks slow. A check that hangs now waits thirty seconds rather than five. A check that waits on the clock rather than the load, such as a runner page or a lock, needs nothing of its own.

## The ceiling

- The unit script caps the run with `NULL3D_TEST_MEMORY_MIB` and runs `tests/lib/memory-ceiling.ts` as a preload. That watch reads the run's own memory ten times a second. A run that holds more than the ceiling stops with a message that names it, rather than growing until another agent suffers. `bun run test:heavy` sets the same variable for each check's process.
- A run that does not set the variable is not capped, so a developer who runs `bun test` directly keeps their own limits.
- The watch reads memory between turns of the event loop. A burst that one synchronous step holds is caught at that step's next turn.
- Bun's own knobs are not ceilings. `BUN_JSC_forceRAMSize` and `--max-old-space-size` set the size that the JavaScript heap grows towards. A run that allocates fast passes them without failing: on 16 October 2026 a process held 2 GB with `BUN_JSC_forceRAMSize` at 512 MB, and exited 0.
- On 19 October 2026 the M2 shader split made one bundler build of the engine hold 5.2 to 9.6 GB, depending on the run. The checks that build the engine now run one build each, in a process of its own: two tree-shaking checks, two release renderer checks and the release runner check. Each of those ceilings is 12,288 MiB, and the release runner's is 4,096. A CI runner holds 16 GB, so the ceiling guards a runaway and not a machine's worth of memory.
- On 21 October 2026 the quaternion tree-shaking check held 12,390 MiB and 12,474 MiB in two CI runs, past its 12,288 MiB ceiling, after the night's shader changes grew the shader text a little. One build cannot be split, so the check now builds without the text: `tests/lib/tree-shaking-build.ts` points every shader module at an empty module, in the page's build and the workers' builds alike. The checks read only the math helpers' code, so they test what they did. Each now holds about 1.5 GB, against 15.5 GB before on the Mac, and their ceilings fall from 12,288 MiB to 3,072 MiB.
- Later that day the release renderer check built the production and the development bundle in one process and reached 12,484 MiB, past its ceiling. The two builds now run as two checks, one for each build: the release check proves the markers are absent, and the development check proves they are present, so neither proof depends on the other build having finished.
- On 25 October 2026 the add-on check's page build reached 13,120 MiB on CI, and its ceiling had risen to 14,336 MiB. The peak was the engine's 2.8 GB shader set, which the build read and wrote as a copy for the page and for each worker. The build now links the files that the shader build wrote beside the scripts that name them, so no shader bytes pass through the bundler. The same build peaked at 790 MiB here and took 8 s. Its ceiling falls to 1,536 MiB when the page gates pass with the new build. [D-225](decisions/D-225-addon-listing-check.md) gives the figures and the reason.
- On 26 October 2026 the masked transmission's permutations grew the generated set. The WebGL2 programs check and the WebGPU pipelines check, which read the whole set, rose past the 7,168 MiB ceiling to 7,343 and 7,283 MiB. Both ceilings rise to 7,680 MiB, about 340 MiB over the peaks. The whole set is their proof, so a shard split is the fix to choose if a later change passes that figure.
- The ceiling is the smallest figure the measured run fits under, with room for a busy machine. [Branches and parallel work](pull-requests.md) covers why the machine matters: several copies of the repository run at once during parallel work.
- Raise the ceiling only for a measured need, and say in the commit message what needed it. A test that needs more than the ceiling usually needs splitting.
- A check that reaches its ceiling stops with exit status 1. Its message names the ceiling and the variable that set it, and points here. Split the check, or give it a process of its own with a ceiling of its own, as `tests/heavy-checks.ts` does.

## Finding a heavy test

- Run each group on its own and keep the peak figures: `bun test tools`, then `bun test packages`, then `bun test tests/lib`. The heaviest file shows itself.
- `/usr/bin/time -l bun test <file>` prints the peak memory of that one file in bytes.
- Measure a group as well as its files: one invocation holds everything it finds, so its peak shows a cause that no single file shows. `bun test packages` peaked at 12.3 GB, which was two of its files at 7.8 GB and 5.6 GB that each build the engine, and no one file looked like the cause of the run.
- A file whose peak is far above its work is usually importing a generated set, merging parts, or holding a decoded asset. All three have a cheaper shape.
