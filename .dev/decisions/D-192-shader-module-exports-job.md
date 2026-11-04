# D-192: A test that builds every shader gets its own CI part

Status: superseded by [D-218](D-218-efficient-ci-jobs.md): the test runs among the workspace's tests and builds two small entries, and the determinism check covers every kind of module. Task: none.

Summary: The shader module exports test needs one module of each kind, but a build of the whole shader set through the WebAssembly compiler made it take 1,291 s or more. Its renders take seconds, and the build takes the rest. That is why [D-218](D-218-efficient-ci-jobs.md) has it build two small entries among the workspace's tests.

## Question

The test `prepare_modules_lists_every_module_and_module_renders_one` prepares a shader build in the WebAssembly module that the build tools use. The M2 feature families multiplied the builds, and a test that prepares the engine's whole build does not fit the part that runs every other test. Where should it run, and what should it build?

## Rule

- A CI part must let each of its tests finish well inside its time limit, also on a slow runner.

## Data

| Measure | Result |
| --- | --- |
| The test in the part with every other test, run 39155531426 | 1,291 s, passed; the part took 1,666 s |
| The test in the part with every other test, run 39191671424 | still running at 1,440 s; the part hit its 35-minute limit |
| The whole shader build's part, run 39191671424 | two builds, still running after 85 minutes |
| The `build` job's shader build, run 39155531426 | 30,761 builds in 454 s; 73 entries and 1,893 modules |
| The `build` job's shader build, run 39168791058 | 68,369 builds in 855 s, before the split commit |
| The `build` job's shader build, run 39191671424 | 68,369 builds in 1,444 s; 5,955 modules written in 135 s |

How the data was produced: the progress lines and other logs of the named CI runs.

The M2 feature families double the build count. The split commit `25155ee76` leaves the build count as it is: run 39168791058, before that commit, already has 68,369 builds. With the split there are 5,955 modules against 1,893, but the test renders one module of each kind, so six modules and twelve renders. The `build` job writes 5,955 modules in 135 s, which is tens of milliseconds for an average module, so the renders are a few seconds at most. The whole shader build sets the test's time.

## Decision

The test builds two small entries and runs among the workspace's tests ([D-218](D-218-efficient-ci-jobs.md)). Its checks need one module of each kind, and the build of the whole set is what costs the time.

## Options rejected

- **A third part of `rust-tests` with its own nextest profile and a 90-minute limit.** It gives each limit room for a slow runner, but it adds a runner and still pays for a whole shader build that the checks do not need.
- **The whole shader build's part.** That part already builds every shader twice, and a third build would take it close to its 135-minute limit.
