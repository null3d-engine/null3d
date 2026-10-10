# D-125: The per-frame allocation check runs in CI on SwiftShader

Status: decided by the owner on 2026-10-09: "yes add it". The settings below come from six trial runs on CI's machines on 9 and 10 October 2026. The warm-up of 1,200 frames is set from the sixth; the pull request's own run gives the final time. Date: 2026-10-10. Task: CI.

Summary: CI's `allocation` job runs `bun run bench:allocation` on S1, once on WebGPU and once on WebGL2. It runs on each push to main, and on each ready pull request that changes what the check covers. On SwiftShader it draws 1,000 boxes and counts the frames that S1 steps. It keeps its own budgets for three places that the browser fills between frames. The browser optimizes after fewer calls there, so 1,200 frames of warm-up do the work of 3,600. A job takes about 7 minutes, against 17 to 18 with the full warm-up.

## Question

Before, the check ran only by hand and in the Mac's gate. On 9 October 2026, #457 moved each GPU path's drawing step to a file of its own. The check then failed on main, and nobody saw it. Should CI run the check, and how, when CI has no real GPU?

## Rule

The job must catch a place of the engine's frame code that starts to allocate each frame, on each GPU path. It must pass when the engine's frame code allocates nothing, so a red job means a real fault. It must take no longer than the browser test shards, 8 to 12 minutes, so it does not hold back CI on engine pull requests. It must not run on pull requests that cannot change the figures.

## Data

| Run | Setting | WebGPU | WebGL2 |
| --- | --- | --- | --- |
| Mac, SwiftShader | S1 with 100,000 boxes | 0.2 drawn frames a second, 2.7 page frames | not run |
| Mac, SwiftShader | S1 with 1,000 boxes | 6.0 drawn frames a second, 20.6 page frames | not run |
| CI 37947471151 | 1,200 frames, the page's timed run | hung: the page stopped the engine before the warm-up ended | the same |
| CI 37950911631 | 3,600 frames, Mac budgets | 1,000 boxes passed; 100 boxes failed on the completion tracker's clock reading, 19.4 of 4 bytes | failed on the browser's own objects: `(IDLE)` 195 to 220 of 48 bytes, `(JS)` 86 to 121 of 24 |
| CI 37953912207 | 1,200 frames, 1,000 boxes | failed on unoptimized code: the canvas view's helper, 11 to 39 of 4 bytes | failed on unoptimized code: the sketch's phase timer, 45 to 62 of 4 bytes |
| CI 37956553296 | 3,600 frames, 1,000 boxes, CI budgets | 2 of 2 passed, warm-up 897 and 1,055 s | 1 of 2 passed, warm-up 998 s. The other warmed up in 519 s, then hung in its samples until the job's 50 minutes ran out |
| CI 37979009491 | The same, with a one-minute limit on each call to the browser | 2 of 4 passed, in 11 and 18 minutes. 2 failed after their samples: a mouse or key press never returned | 4 of 4 passed, in 17 to 18 minutes |
| CI 38010789676 | The browser's compilers take a function after 100 and 500 calls, not 400 and 3,000. 600 and 900 frames, 2 jobs each | 600: 0 of 2 passed, in 4.3 minutes. 900: 0 of 2 passed, in 5.3 to 5.5 minutes, only on the canvas view's helper, `targetView`, 6.7 and 23.5 of 4 bytes | 600: 0 of 2 passed, in 2.5 minutes. 900: 2 of 2 passed, in 5.4 to 5.6 minutes |

How the data was produced: `.github/workflows/alloc-experiment.yml` on a branch that was not merged, on GitHub's Linux machines with 4 processors. Each job ran the check alone.

SwiftShader draws far fewer frames than the browser asks for. The page's own frame count was 3 to 10 times the engine's, so the check counts the frames that S1's sketch steps on SwiftShader. In the passing runs, every place of the engine's frame code stayed within the Mac's budget. Only the browser's objects between tasks and the completion tracker's clock reading went over. The browser calls the render worker at the display's rate, several times per drawn frame.

The browser's optimizing compiler takes a function after 3,000 calls by default, and frame code gets one call per frame. So the full warm-up needs 3,600 frames. With lower counts, 600 frames left a callback of the sketch worker unoptimized, at 14.3 of 4 bytes. At 900 frames the only place over budget was `targetView`. It makes the view of the canvas's texture, a browser object that each frame needs, and the Mac's budget of `colorView` covers it. With the lower counts the browser does not inline it into `colorView`, so it counts the view under its own name.

## Decision

- The job runs on SwiftShader with 1,000 boxes. Each frame runs the same engine code whatever the count.
- On SwiftShader the browser's compilers take a function after 100 and 500 calls, and the warm-up is 1,200 frames. That is a third more than the 900 that passed, against the 600 that failed. With the full counts, 1,200 frames were too few.
- `targetView` gets the budget of `colorView`, 48 bytes, on every machine, since the same view counts in one or the other.
- Three budgets change on SwiftShader only: the render worker's `(IDLE)` to 512 bytes, its `(JS)` to 256, and the completion tracker's `giveUpStalled` to 256. All other budgets are the Mac's.
- The page runs as a demo, which runs until the page closes, so no timer of the page stops the engine.
- Each call to the browser after the warm-up has a time limit of one minute, and names its step when it runs out. A stalled run fails fast and says where.
- A mouse or key press that never returns gives a warning, not a failure. It stopped 3 of 12 trial jobs after their samples, while S1 went on stepping. The summary line counts the input steps in the samples.
- The job runs on pushes to main and on ready pull requests that change `packages/engine/src/render/`, `gpu/` or `sketch/`, the check and its files, or the CI workflow.

## Consequences

- `.github/workflows/ci.yml` has the `allocation-paths` and `allocation` jobs, and `ci-passed` lets `allocation` skip when the paths job says so.
- `bench/allocation.ts` holds `SWIFTSHADER_COUNT`, `SWIFTSHADER_JS_FLAGS`, `SWIFTSHADER_WARMUP_FRAMES` and `SWIFTSHADER_BUDGETS`. The job's time limit is 15 minutes. The benchmark page's `frames` switch publishes the count of frames that S1 steps.
- [Benchmarks](../benchmarks.md#allocation-and-profiling) and [Pull requests](../pull-requests.md#cis-jobs) describe the job.
