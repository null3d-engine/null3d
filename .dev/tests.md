# Test memory

The unit tests run in a few processes, one for each group of them, so what each test holds adds to its group's peak. This guide covers that cost, the rules that keep a test small, and the ceiling the unit script sets. [AGENTS.md](../AGENTS.md) lists the commands, and [Image tests](image-tests.md) covers the browser tests.

## How the unit run works

- `bun run test` builds the shaders, then runs `bun test` over the tools, the packages, the benchmark scenes and pages, `tests/lib` and the demos.
- That is a group for each package, and one each for the tools, the benchmark's scenes and pages, `tests/lib` and the demos, each a `bun test` of its own (`tests/unit.ts`). One invocation holds everything it finds in one process, so a group's peak is what its files hold together, and the run's peak is the largest group's rather than the sum of them all.
- The generated shader set is the largest thing a test can hold: 1,343 modules and 850 MB of JavaScript source on disk. Git does not keep it; the build writes it. A project takes it from the release asset or builds it; `NULL3D_ENGINE_SHADERS` names a folder to use instead, such as a checkout's `packages/engine/src/generated`, which is what CI's package test does. Without the folder it would build 1,353 modules with the single-threaded wasm compiler, which takes longer than any job on a runner.
- A single file that imports the whole set makes the process large on its own. The same file that reads the set's text costs a fraction of that.
- A generated set is not the only thing a test holds for good. The WebAssembly texture transcoder's heap grows when a check feeds it hostile files, and it does not shrink, so a check that does that holds every growth it has made. The malformed-file checks reach 1.7 GB of memory that way, from a handful of changed files, each of them a few kilobytes on disk.
- The script leaves out the checks that hold gigabytes, and caps the run. `bun run test:heavy` runs those checks, each in a process of its own under a ceiling of its own (`tests/heavy-checks.ts`). Both read one list of them, `tests/lib/heavy-checks.ts`: a file the unit run left out and no runner named would run nowhere, and the two halves of the list must not drift apart.
- The files of a group run in the order that the filesystem hands them over. That order is stable on one machine, and it differs between machines. A test that installs a stand-in for a global, such as `Worker`, cannot rely on being the first to touch it. So the order can hide a fault on one machine and show it on another. A worker starter that keeps the constructor of its first start is such a fault. A test's stand-in installed later goes unused, and its probe talks to a real worker. The fault is in the starter, not in the test. A page that replaces its `Worker` breaks the same way, because the cache holds a constructor that the caller has put aside.

## Forcing the order the files run in

A failure that only CI shows, in a check that installs a stand-in for a global, is worth forcing the order for. A preload that starts one worker brings the fault out on any machine. Make a file that calls `spawnWorker(() => ({}) as Worker, error)`, and run it before the one test file:

```sh
bun test --preload ./start-one-worker.ts --conditions=null3d-source packages/engine/src/page/capabilities.test.ts
```

A folder whose copy of the file that starts the worker is named to run before a copy of the failing test works as well.

## What the run costs when tests hold the set

These figures come from a unit run in which tests imported the generated set, and the bundler builds ran in the shared process.

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

The largest single cause is not a file that reads the set but two that build it. In that run the packages group, in a process of its own, cost 12.3 GB. Most of that was two of its files: `packages/engine/src/math/tree-shaking.test.ts` at 7.8 GB, and `packages/engine/src/debug/release.test.ts` at 5.6 GB. Each builds the engine with the bundler, whose bundle holds the 890 MB of shader code and a copy of it.

Several helper agents that each run such a unit run on one machine push it past 70 GB, and the session has to stop. So a test that holds a generated set in memory is slow, and it can take the machine down with it.

## What the same checks cost under the rules

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

The checks that hold gigabytes run one process at a time, each under a ceiling set from its own
figure. The bundler builds cost the most, because the engine's 890 MB of shader code is in
the bundle they read and in the bundler's copy of it. What a group of the unit run holds is bounded
by the group, and the run's peak is its largest group rather than the sum of every file's memory.

## Rules

1. Read a count, a size or a name from the generated file's text. Import generated modules only when a test needs their values, and then only the modules it needs.
2. Load one part at a time and drop it before the next. Never hold every part of a set at once, and never merge the parts into one map to learn something a count gives.
3. A check that must compare against the whole set, or that builds the engine with its shaders in it, runs in its own process, through its own script. The unit run is shared, so such a check makes every other test pay for it.
4. Measure a test that touches generated data. Run it alone under `/usr/bin/time -l` and read the `maximum resident set size` line. Put the figure in the branch notes when the test changes.
5. Keep fixtures small, and read them one file at a time. Tests that need the large sample content use the shared cache that [Sample content](sample-content.md) describes.
6. When a check grows past the ceiling, split it rather than raising the ceiling. The ceiling exists to make a fault visible as a failed test, not to end a run with a dead machine.
7. A check gets the budget the run states (`checkTimeoutMs` in `tests/lib/run-budget.ts`). Bun's default of five seconds is a budget, not a measurement. The checks that map a glow at every canvas take 0.64 and 0.90 seconds idle and 7.0 and 8.7 seconds loaded, about tenfold, so a check that computes is at risk long before it looks slow. So the budget is 30 seconds times the machine's 1-minute load per core when a group starts, rounded up, from 1 to 4. An idle machine, or one loaded at most to its core count, gets 30 seconds, and a load of 71 on 18 cores gets 120. The run's line for a group names a budget above 30 seconds. A check that hangs waits for the budget. A check that waits on the clock rather than the load, such as a runner page or a lock, needs nothing of its own.
8. A check, a setup or teardown hook (`beforeAll`, `beforeEach`, `afterAll`, `afterEach` or `onTestFinished`), or a file that states its own budget writes it as `scaledBudget(ms)`, or as a constant of the same file that holds such a call. The helper multiplies the budget by the run's factor. The run hands that factor to each group's process in the environment, so both budgets grow from one reading. A file that `bun test` runs alone reads the load itself. A stated budget wins over the run's, so a fixed one can be the smaller of the two on a loaded machine. A file that sets 60 seconds can then time out at 60 seconds while the run gives 120. A child process that a check starts takes its time limit from `scaledBudget` too, or it dies before the check's budget ends. The check in `tests/lib/bare-budgets.test.ts` fails on any other form of stated budget, such as a number or a constant that holds one.
9. A page or a run that proves something by a picture must prove it read the change first. It can miss the change in two ways. Settings that a page puts on a sketch's address are lost if the sketch never sees the query. The sketch then draws its own defaults, and every variant is one picture. Have the sketch post back the values it built, and report them beside the frame. And a dev server answers a sketch address whose query carries a `v=` value with `Cache-Control: max-age=31536000, immutable`. Any other address, with or without a query, answers `no-cache`. A browser may then keep the first module it fetched. The test that settles freshness is a marker: open the page twice with two markers and have the sketch report the one it read. Run it before drawing the frame that decides something, not after.
10. Hand `bun test` each path with `./` in front (`exactTestPath` in `tests/lib/test-paths.ts`). Without it, `bun test` reads the path as a filter. It searches every folder of the checkout for test files, and runs every file whose path contains the text. In a checkout whose `target` folder holds 86 GB, the search takes 2.8 s for one file. Under a load near 88, the build log test then timed out in 10 of 20 runs. With `./` it timed out in 0 of 20, at a load of 72 to 86. The filter also makes the `tools` group run `packages/cli/src/devtools.test.ts` a second time, because its path contains the text. The `./` cures only a single file's run. In the whole `tools` group, the build log test can still stop at 90 s with `./` paths, for a cause not yet found.

## The ceiling

- The unit script caps the run with `NULL3D_TEST_MEMORY_MIB` and runs `tests/lib/memory-ceiling.ts` as a preload. That watch reads the run's own memory ten times a second. A run that holds more than the ceiling stops with a message that names it, rather than growing until another agent suffers. `bun run test:heavy` sets the same variable for each check's process.
- A run that does not set the variable is not capped, so a developer who runs `bun test` directly keeps their own limits.
- The watch reads memory between turns of the event loop. A burst that one synchronous step holds is caught at that step's next turn.
- Bun's own knobs are not ceilings. `BUN_JSC_forceRAMSize` and `--max-old-space-size` set the size that the JavaScript heap grows towards. A run that allocates fast passes them without failing: a process held 2 GB with `BUN_JSC_forceRAMSize` at 512 MB, and exited 0.
- With the shader set as M2 splits it, one bundler build of the engine holds 5.2 to 9.6 GB, depending on the run. So the checks that build the engine run one build each, in a process of its own: two tree-shaking checks, two release renderer checks and the release runner check. The two release renderer checks' ceilings are 12,288 MiB each, and the release runner's is 4,096. A CI runner holds 16 GB, so the ceiling guards a runaway and not a machine's worth of memory.
- A tree-shaking check builds without the shader text. `tests/lib/tree-shaking-build.ts` points every shader module at an empty module, in the page's build and the workers' builds alike. With the text, the quaternion check held 12,390 MiB and 12,474 MiB in two CI runs, past a ceiling of 12,288 MiB. One build cannot be split. The checks read only the math helpers' code, so they test the same thing without it. Each holds about 1.5 GB, against 15.5 GB with the text on the Mac, and its ceiling is 3,072 MiB.
- The release renderer check builds the production and the development bundle as two checks, one for each build. In one process the two builds reach 12,484 MiB, past the ceiling. The release check proves the markers are absent, and the development check proves they are present, so neither proof depends on the other build having finished.
- A page build of the add-on check that reads the engine's 2.8 GB shader set reached 13,120 MiB on CI. It writes a copy of the set for the page and for each worker. The check's ceiling of 14,336 MiB holds that build. The build that links the files the shader build wrote, beside the scripts that name them, passes no shader bytes through the bundler. It peaks at 790 MiB on the Mac and takes 8 s. The ceiling falls to 1,536 MiB when the page gates pass with it. [D-225](decisions/D-225-addon-listing-check.md) gives the figures and the reason.
- The ceiling is the smallest figure the measured run fits under, with room for a busy machine. [Branches and parallel work](pull-requests.md) covers why the machine matters: several copies of the repository run at once during parallel work.
- Raise the ceiling only for a measured need, and say in the commit message what needed it. A test that needs more than the ceiling usually needs splitting.
- A check that reaches its ceiling stops with exit status 1. Its message names the ceiling and the variable that set it, and points here. Split the check, or give it a process of its own with a ceiling of its own, as `tests/heavy-checks.ts` does.

## Finding a heavy test

- Run each group on its own and keep the peak figures: `bun test tools`, then `bun test packages`, then `bun test tests/lib`. The heaviest file shows itself.
- `/usr/bin/time -l bun test <file>` prints the peak memory of that one file in bytes.
- Measure a group as well as its files: one invocation holds everything it finds, so its peak shows a cause that no single file shows. `bun test packages` peaked at 12.3 GB, which was two of its files at 7.8 GB and 5.6 GB that each build the engine, and no one file looked like the cause of the run.
- A file whose peak is far above its work is usually importing a generated set, merging parts, or holding a decoded asset. All three have a cheaper shape.
