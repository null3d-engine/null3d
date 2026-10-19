# D-192: A test that builds every shader gets its own CI part

Status: decided. Date: 19 October 2026. Task: none.

Summary: The shader module exports test builds the whole shader set through the WebAssembly compiler, so it now runs in a third part of `rust-tests` with a 90-minute limit. It took 1,291 seconds beside every other test on 18 October 2026, and on 19 October 2026 it still ran at 1,440 seconds when that part's 35-minute limit ended.

## Question

The test `prepare_modules_lists_every_module_and_module_renders_one` prepares the engine's whole shader build in the WebAssembly module that the build tools use. The M2 feature families multiplied the builds, and the test no longer fitted the part that runs every other test. Where should it run?

## Rule

- A CI part must let each of its tests finish well inside its time limit, also on a slow runner.
- A test that costs about a whole shader build may have a longer limit, as the whole shader build's part does.
- The test keeps its check: the engine's real build must list every module, and one module of each kind must render.

## Data

| Measure | Result |
| --- | --- |
| The test in the part with every other test, run 39155531426, 18 October 2026 | 1,291 s, passed; the part took 1,666 s |
| The test in the part with every other test, run 39191671424, 19 October 2026 | still running at 1,440 s; the part hit its 35-minute limit |
| The whole shader build's part, run 39191671424, 19 October 2026 | two builds, still running after 85 minutes |
| The `build` job's shader build, run 39155531426, 18 October 2026 | 30,761 builds in 454 s; 73 entries and 1,893 modules |
| The `build` job's shader build, run 39168791058, 18 October 2026 at 21:39 | 68,369 builds in 855 s, before the split commit |
| The `build` job's shader build, run 39191671424, 19 October 2026 | 68,369 builds in 1,444 s; 5,955 modules written in 135 s |

How the data was produced: the progress lines and other logs of the named CI runs.

The build count doubled when the M2 feature families landed. The split commit `25155ee76` did not change it: a run before that commit already had 68,369 builds. The split changed the module count, from 1,893 to 5,955, but the test renders one module of each kind, so six modules and twelve renders. The `build` job wrote 5,955 modules in 135 s, which is tens of milliseconds for an average module, so the renders are a few seconds at most. The whole shader build sets the test's time.

## Decision

The test runs as a third part of `rust-tests`, with `-p null3d-shaders-wasm --profile shader-module-exports` and a 90-minute limit. The `ci` part excludes the test, so it keeps its 35-minute limit. The whole shader build's part keeps its 135-minute limit.

The test could not join the whole shader build's part: that part already builds every shader twice, and a third build would take it close to its limit. A part of its own adds a runner, but each limit then has room for a slow runner.

## Consequences

- `.config/nextest.toml` gains the `shader-module-exports` profile, and the `ci` profile excludes the test.
- `.github/workflows/ci.yml` and `.github/workflows/nightly-rust.yml` gain the third part.
- [Branches and parallel work](../pull-requests.md#cis-jobs) states the split and the measured times.
- The test and its checks do not change.

## Addendum 2026-10-19: the shader families and the other jobs' limits

The feature families pushed other jobs past their limits in the same run, 39191671424.

| Job | Measure |
| --- | --- |
| Browser shard 12 | 340 shader parts of about 72 s each; 32 of 33 tests passed, and the 25-minute limit cut the last |
| Browser shard 11, which passed | 28 tests, 19 minutes of tests, 19.7 minutes in all |
| `shader-compiler` | cancelled at its 90-minute limit, 88 minutes into the shader test |
| The whole shader build's part | failed at 6,312 s (105 minutes) on a module-kind check, below its 135-minute limit |

The browser's 340 parts come from 50,907 GLSL programs. Main at `865f3e6bb` had 104 parts, so about 15,450 to 15,600 programs. The count grew with the feature families' builds, not with duplicates: 487 builds sit in more than one module, and counting each once would remove 583 programs, 1.1 per cent. The extra programs are distinct compiled shaders, so the page must compile them.

The browser job's limit rose from 25 to 45 minutes. The slowest shard needed about 26 minutes on that run, and the new limit keeps room for a machine that runs the tests twice as slowly. The shard weights still come from main's part count and need retuning ([Image tests](../image-tests.md#ci)).

`shader-compiler`'s limit rose from 90 to 180 minutes. It runs the same 105-minute test and then builds every entry through the shader compiler. On main that extra work took about 15 minutes, and the feature families multiply it with the builds. The whole shader build's part keeps 135 minutes: its test takes 105, which leaves 30 minutes. Read these times again when the shader build gets faster.
