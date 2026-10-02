# D-11: Preset values, the governor's thresholds, and frames in flight

Status: frames in flight decided by the owner on 2026-09-30. The preset check's thresholds proposed by M1-G3, the governor's thresholds by M1-G5, and the preset values by M1-G6. The device rows of the preset values are pending. Date: 2026-09-30. Tasks: M1-G1 (frames in flight), then M1-G3, M1-G5 and M1-G6.

This record settles three questions. M1-G1 answers the third, frames in flight, with the GPU-bound page. The preset values and the governor's thresholds follow from the S4 traces of M1-G5 and M1-G6, and from the live shadow-map resize test of M1-G3. Those tasks add their sections here. M1-G3 adds the preset check's thresholds at the end.

## Question

When the GPU falls behind, do browsers let frames queue on it? If they do, should the thread that draws hold new frames back while two are unfinished?

## Rule

Cap frames in flight at two if the presented and completed rates part under overload.

## Data

### The GPU-bound page

The page (`tests/pages/overload.html`) draws layers of detailed spheres, about 16,000 triangles each. They never move, so the GPU does nearly all of each frame's work. The page doubles the spheres at each step and measures each step for a second. At the first step where the lower of the presented and completed rates falls below half the display's rate, it measures 5 seconds. The tables give that measurement.

- "Limit 2" is the engine's limit of two frames waiting on the GPU. "None" is `?queue=off`, which leaves the queue to the browser.
- The completion tracker tracks every frame on both GPU paths.
- "Frames in flight" is the median time from submit to completion, in completed frame intervals.
- "Parted" means that the presented rate was more than 10% above the completed rate.

Run 20260930-060650-overload, MacBook Pro M5 Max:

| Browser | Path | Limit | Spheres | Presented fps | Completed fps | Parted | Submit to completion, median / p95 ms | Frames in flight |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Safari 26.6.2 | WebGPU | 2 | 32,768 | 27.8 | 27.8 | no | 35.8 / 36.4 | 1.0 |
| Safari 26.6.2 | WebGPU | none | 32,768 | 24.1 | 24.1 | no | 40.8 / 45.5 | 1.0 |
| Safari 26.6.2 | WebGL2 | 2 | 32,768 | 17.4 | 17.4 | no | 110.2 / 125.5 | 1.9 |
| Safari 26.6.2 | WebGL2 | none | 32,768 | 17.5 | 17.5 | no | 225.5 / 265.0 | 3.9 |
| Firefox 156 | WebGPU | 2 | 4,096 | 55.6 | 55.6 | no | 9.8 / 95.9 | 0.5 |
| Firefox 156 | WebGPU | none | 8,192 | 114.0 | 54.0 | yes | 1474.8 / 2841.1 | 79.7 |
| Firefox 156 | WebGL2 | 2 | 4,096 | 48.5 | 48.6 | no | 40.9 / 53.3 | 2.0 |
| Firefox 156 | WebGL2 | none | 4,096 | 119.9 | 51.5 | yes | 1726.4 / 3054.6 | 89.0 |
| Chrome 154 | WebGPU | 2 | 16,384 | 29.1 | 29.1 | no | 52.4 / 98.8 | 1.5 |
| Chrome 154 | WebGPU | none | 16,384 | 29.9 | 29.9 | no | 217.3 / 320.8 | 6.5 |
| Chrome 154 | WebGL2 | 2 | 8,192 | 45.0 | 45.0 | no | 41.7 / 62.6 | 1.9 |
| Chrome 154 | WebGL2 | none | 8,192 | 54.7 | 54.7 | no | 133.2 / 189.1 | 7.3 |
| Brave (Chromium 153) | WebGPU | 2 | 16,384 | 30.0 | 30.1 | no | 58.1 / 105.9 | 1.7 |
| Brave (Chromium 153) | WebGPU | none | 16,384 | 26.7 | 27.2 | no | 260.7 / 424.4 | 7.1 |
| Brave (Chromium 153) | WebGL2 | 2 | 8,192 | 58.7 | 58.7 | no | 34.5 / 55.1 | 2.0 |
| Brave (Chromium 153) | WebGL2 | none | 16,384 | 36.3 | 36.1 | no | 208.1 / 256.8 | 7.5 |

Reading the table:

- Without the limit, every browser but Safari on WebGPU let frames queue on the GPU. Chrome and Brave kept 6 to 8 frames, and Safari's WebGL2 path 4. Firefox kept 80 to 89, with seconds of delay.
- Only Firefox let the two rates part. Chrome and Brave slowed the drawing worker's frame callbacks to the GPU's pace instead. Their rates stayed together while the frames queued.
- Safari's WebGPU path held one frame with and without the limit. Safari copies a worker's frame to the page only after the GPU has finished it, and the worker waits for the copy.
- With the limit, frames in flight stayed at 2 or fewer in every browser.

An earlier run without the limit (20260930-053845-overload) showed the same pattern. Firefox's WebGL2 path then kept 17 frames, and its rates stayed together.

### The limit's cost in Chrome

The runs above measure each browser once, while other work ran on the same Mac, so they cannot show a small cost. Three rounds in Chrome through Playwright compared the limits at fixed loads (`?spheres=`), each measured for 4 seconds. The mean of the three rounds:

| Path | Spheres | Limit 2 | Limit 3 | None |
| --- | --- | --- | --- | --- |
| WebGL2 | 8,192 | 99.2 fps, 19 ms | 93.6 fps, 32 ms | 91.0 fps, 84 ms |
| WebGL2 | 16,384 | 47.5 fps, 44 ms | 48.5 fps, 62 ms | 50.6 fps, 153 ms |
| WebGPU | 8,192 | 92.9 fps, 16 ms | 93.6 fps, 28 ms | 94.7 fps, 71 ms |
| WebGPU | 16,384 | 46.8 fps, 37 ms | 46.1 fps, 62 ms | 46.5 fps, 161 ms |

The figures are the completed rate and the median time from submit to completion. The rounds differed from each other by up to 30%, more than the limits did. In Chrome the limit cut the delay to a third or less, and it cost no clear frame rate.

### Firefox's late completions

Firefox settles WebGPU's `onSubmittedWorkDone` about one display frame after the GPU finishes. On a 120 Hz display that is 8.8 ms, even when the GPU needs under 1 ms. So the limit holds back frames that are already done. The completed rate of Firefox's WebGPU path by the limit, in run 20260930-060007-overload:

| Spheres | Limit 2 | Limit 3 | Limit 4 | None |
| --- | --- | --- | --- | --- |
| 4,096 | 102.0 | 115.1 | 119.9 | 120.0 |
| 8,192 | 21.7 | 66.7 | 84.0 | 104.2, with the delay growing past 75 ms |
| 16,384 | not reached | 29.1, 90 ms delay | 48.4, 74 ms delay | 65.5, with the delay growing past 238 ms |

Firefox's WebGL2 path finished 31 frames per second at 8,192 spheres with each limit from 2 to 4. Its delay grew with the limit: 65, 95 and 128 ms.

### Other findings

- Without the limit, Chrome's slower frame callbacks also slowed the refresh meter of the thread that draws. In one Chrome run on a 144 Hz display it read 36 Hz at 32,768 spheres. With the limit, the meter read the display's rate at every step. The governor's thresholds scale from that rate, so the limit keeps them right under load.
- Apple's GPUs work on two frames at once, so a frame's GPU time from timestamps can exceed the completed frame interval. Before the limit, Chrome's WebGPU path reported 44 ms of GPU time per frame at 69 frames per second.
- The tracker costs one browser object per frame, and two clock readings. In Chrome on WebGPU, the queue's promise and its reaction took about 165 bytes per frame, and the clock readings about 38. On WebGL2 the fence fit within the renderer's earlier budget. `bun run bench:allocation` budgets them.

### The S24+ and the iPad

Run 20260930-074130-overload, Galaxy S24+, 60 Hz display, from the main checkout:

| Browser | Path | Limit | Spheres | Presented fps | Completed fps | Parted | Submit to completion, median / p95 ms | Frames in flight |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Chrome 154 | WebGL2 | 2 | 8,192 | 21.1 | 21.1 | no | 98.7 / 101.1 | 2.1 |
| Chrome 154 | WebGL2 | none | 8,192 | 21.2 | 21.2 | no | 358.7 / 394.8 | 7.6 |
| Brave, Shields on | WebGL2 | 2 | 8,192 | 21.1 | 21.1 | no | 98.9 / 101.1 | 2.1 |
| Brave, Shields on | WebGL2 | none | 8,192 | 20.5 | 21.2 | no | 365.6 / 412.5 | 7.8 |

Without the limit, frames queued on the phone's GPU as they did in Chrome and Brave on the Mac. About 8 frames waited, with 360 ms of delay. The limit cut the delay to about 100 ms at the same frame rate.

The iPad's rows are still to come. The phone and the tablet run the page from the main checkout:

```sh
bun tests/real-browsers.ts --plan overload --allow-no-webgpu --android chrome,brave --lan ipad-safari,ipad-brave --shields on
```

The S24+ has no WebGPU, so its WebGPU pages count as skipped.

How the data was produced: `NULL3D_PORT=63173 bun tests/real-browsers.ts --plan overload Safari Firefox "Google Chrome" "Brave Browser"`. The runs were on 30 September 2026, from the worktree of the branch `feat/frame-completion`. The Mac has a 120 Hz built-in display and a 144 Hz external display, and each browser drew on the display its window was on. Safari runs a worker's frame callbacks from a timer, at about 64 Hz. The Firefox limits came from the same plan with limits 3 and 4 added for one run. The Chrome rounds opened the page in Playwright's Chrome, which starts its window on the built-in display. Other helpers built and tested on the same Mac during every run. The results are in the worktree's `target/runs`.

## Decision

Decided by the owner on 2026-09-30: the thread that draws takes no new frame while two frames are unfinished on the GPU. This holds on both GPU paths and in every thread mode.

The rule's condition holds in Firefox, whose rates parted by more than half on both paths. The condition misses the queues in Chrome, Brave and Safari's WebGL2 path, where the rates stayed together while 4 to 8 frames waited. The limit's purpose is to keep frames from queuing, so the data supports it there too. In Chrome it cut the delay to a third or less, at no clear cost in frame rate.

The cost falls on Firefox's WebGPU path, because Firefox reports completions late. At 4,096 spheres it finished 102 frames per second with the limit and 120 without. At 8,192 spheres it finished 22 with the limit and 84 with a limit of 4. The owner weighed two options and chose the first:

- Keep 2 everywhere (this proposal). Firefox's WebGPU path draws fewer frames when the GPU is busy, with far less delay than without the limit.
- Raise the limit to 3 or 4 on WebGPU. Firefox's WebGPU path recovers most of its rate, and Chrome, Brave and Safari get one or two more frames of delay under load.

`?queue=<n>` sets the limit for a page, and `?queue=off` removes it, so each option can be measured on a device.

## Consequences

- `gpu/completion.ts` tracks every frame, all the time, and reports the frames still unfinished. `Presenter.due` in `render/loop.ts` holds the frame back at the limit.
- `RingSums` in `shared/metrics.ts` sums a ring's new records without allocating. The warm-up benchmark and the governor can read the completed rate and the delay with it, in any window of play.
- `FrameSummary.completedFps` and `gpuLatencyMs` cover every frame. The performance guide explains the presented rate, the completed rate and GPU time. The develop skill tells agents to judge a phone's GPU by the completed rate.
- `bench/allocation.ts` budgets the tracker's objects.
- Revisit the limit on Firefox's WebGPU path when Firefox reports completions sooner.

## The preset check's thresholds (M1-G3)

Status: proposed, for the owner. When the engine chooses the preset itself, it checks the choice after the sketch's setup. It draws the scene that the setup built, and measures the lower of the presented and completed rates. It lowers the preset by one until a preset holds the target. The file `quality/check.ts` holds the thresholds, and `concepts/quality-presets` prints them from there.

### Proposed values

| Threshold | Proposed | Why |
| --- | --- | --- |
| Target | The measured refresh rate, at most 60 frames per second, and at most the `?fps=` rate | A 120 Hz iPad or Mac plays smoothly at 60. A higher target would push those devices to lighter presets |
| A preset holds at | 90% of the target | At 60 Hz, a 500 ms window with two dropped frames still holds; three do not |
| Grace before each measurement | 250 ms, plus up to 2 s while textures wait to upload | The first frames after a warm-up, and the frames that carry uploads, can run slower than play. A new pixel ratio reaches the canvas a frame or two after a change |
| Measurement | 500 ms per preset | About 30 frames at 60 Hz |
| Presets checked | Only a preset that the engine chose, and never Low | A preset that the page, `?preset=` or hold mode fixes stays. Low has no lighter preset |

### Data

Headless Chrome 154 through Playwright on the MacBook Pro M5 Max, with the Mac's GPU, 30 September 2026. The canvas was 320 x 180 at a pixel ratio of 1, so each preset drew the same pixels. Other helpers built and tested on the same Mac.

A light scene held the target. The engine test page's empty scene measured 60 presented and 60 completed frames per second on WebGPU and WebGL2, in 3 of 3 runs each. The call to `createEngine` then took 991 to 1,045 ms with the check, and 144 to 279 ms with `?preset=` fixing the preset. The first frame was done at 164 to 303 ms in both cases. So the check adds about 0.8 s before `createEngine` resolves, and nothing before the first frame.

A heavy scene, 32,768 of the GPU-bound page's spheres, missed the target at every preset:

| Path | Chosen | Rounds (presented / completed fps) | Runs |
| --- | --- | --- | --- |
| WebGPU | High | High 31.0 / 29.6, Medium 24.0 / 23.3, Low 18.6 / 18.2 | Low |
| WebGL2 | Medium | Medium 28.1 / 28.2, Low 20.0 / 20.1 | Low |

The same scene with `?preset=` and no check, measured in 0.5 s windows after `createEngine` resolved, fell over its first 2 seconds and then held:

| Path | Lower rate in each 0.5 s window, fps |
| --- | --- |
| WebGPU | 28, 25, 21, 18, 18, 18, 19, 17, 19, 20 |
| WebGL2 | 27, 24, 21, 19, 19, 19, 19, 20, 21, 21 |

So the check's first round saw this GPU-bound scene about 50% faster than steady play. The rounds fell only because the scene slowed; the presets differ only in the pixel ratio cap here. A device near the threshold could keep a preset that play then misses. A longer grace would catch this, at the cost of loading time.

CI's software GPU drew 8 spheres at 1 to 6 frames per second, so the check lowered High or Medium to Low on every path.

### Open for the owner

- The grace and the window. A 1.5 s grace would let the scene above settle before the measurement, and would add about 1.25 s to each start that checks. Shorter windows cut the cost, and measure fewer frames.
- The target on 120 Hz displays. With 60, the iPad keeps a preset that holds 60 but not 120.
- Dynamic resolution (M1-G4) lets a preset hold its target at a lower render scale. The check measures at the full scale, so it may lower a preset that dynamic resolution could have saved. M1-G6 tunes the target and the share with S4 traces on the three devices.

### The live shadow-map resize test

Pending. A live change of the shadow map size needs shadow maps that draw. Their first part (#120) holds the cascade math and the render graph's array targets, and the cascades draw from #134 on. Once #134 merges, the test resizes the shadow maps during rendering on both paths. Until it passes, the shadow map size is fixed while a preset runs. It changes only through `quality.setPreset` or `quality.set`, whose first frame waits for its pipelines and targets.

### Consequences

- `quality.setPreset` in the sketch changes every setting. `quality.set` takes the settings fixed while a preset runs too, and changes them the same way. The control block's pipeline hold (`Slot.PipelineHold`) makes two frames wait for their pipelines. One is the first frame that records with the new settings. The other is the frame whose `quality.onChange` handlers hear of the change. A change in a frame's own update holds that frame. The promise resolves once the frame after the change is taken.
- The check's frames, and the frames of warm-ups in the setup, run none of the sketch's code. The engine numbers them with its own frames, but the sketch's `time.frame` and the pointer's frame count only the frames that run the sketch.
- `FrameSummary.skippedDraws` counts the draws that a building pipeline kept from drawing. The preset change test holds it at 0 on every GPU path and thread mode.
- The check's code (`sketch/preset-check.ts`) loads after the first frame, as D-14's option B proposes. The size report prints its files apart from the downloads before the first frame.

## The governor's thresholds (M1-G5)

Status: proposed by M1-G5 on 2026-10-03. M1-G6 tunes them with the S4 traces of the three devices.

### Proposed values

The governor keeps the thresholds of dynamic resolution (M1-G4) for every step. Each scales from the measured refresh rate, with a target of at most 60 frames per second:

| Rule | Value |
| --- | --- |
| Over budget | The longer of the mean presented and completed intervals is 110% of the budget or more, or the GPU delay is 200% or more |
| Step down | After 1 s over budget |
| Room to spare | Intervals within 102% of the budget, with a GPU delay within 125% |
| Step up | After 5 s with room. A step up that fails within 3 s doubles the next wait, up to 80 s |
| Settle after a step | 1 s |
| Grace | 2 s after the first frame, after a pause, and while textures wait to upload |
| Order | Render scale in steps of 0.05, then the far cascades' interval doubled up to 8, then the shadow filter from 5 to 3. Up in the reverse order |

The rules ask for a step up only after about five seconds under 80% of the budget. A presented interval never falls below the refresh period, so a frame interval under 80% of the budget never happens at the display's rate. The GPU delay is no better. A WebGL2 fence's time rounds up to the next frame callback, and Firefox reports WebGPU completions a display frame late. So "room" means frames at the target rate with a GPU delay within 125% of the budget. The failed-step-up rule then keeps the settings below the point where frames fall behind.

### Data

The stress test (`tests/pages/governor.html`) on the Mac in Chrome, both GPU paths, 60 Hz:

- The walk took every step down, one every 1.9 to 2 s, and every step back up, one every 6 s. No frame stuck: the 99th percentile of presented intervals was 50 ms under the load and 16.7 ms after it. No pipeline built and no draw was skipped. Each capture's largest block difference from the first frame was about 2 to 6 levels. A frame drawn without its shadows differs by about 113.
- The hold grew the plane's loop until the lower rate fell under 45 fps, at about 33,000 to 66,000 steps per pixel. The governor then held 55 to 60 fps in the last 15 seconds, at render scales of 0.5 to 0.8. At the heavier load it reached 0.5, tried 0.55 once, fell behind and stepped back within 2 s.
- The Mac's software GPU draws the scene at about 40 fps on WebGL2 without a load, and passes the walk with `?fps=30`. CI's takes 300 to 400 ms for some frames, so CI skips both stages.

The S24+ and the iPad rows are still to come, from `bun tests/real-browsers.ts --plan governor --allow-no-webgpu --android chrome --lan ipad-safari`.

### Open for the owner

- The shadow steps help only a scene whose shadows cost much. The render scale helps only a GPU-bound scene. A CPU-bound scene walks down every step for nothing. The governor could undo a step that did not shorten the frames.
- A slow sketch on the thread that draws slows the frame callbacks, as in low latency and single-threaded modes. The refresh meter reads them as a slower display. The budget then grows, and the governor misses the overload.
- The S4 benchmark kept its render scale at 1, to match its three.js twin's pixels. Since M1-G6 it keeps the preset's range of render scales, as exit gate item 3 measures it.

## The preset values (M1-G6)

Status: proposed by M1-G6 on 2026-10-03, from the Mac's runs. The S24+ and iPad runs at each candidate preset are still to come, and they decide the values. The governor keeps the thresholds of M1-G5 until those traces show flicker or late steps.

### Rule

Each device's chosen preset holds its target on S4 for a 10-minute run, with dynamic resolution at the preset's default range of render scales. Its completed rate stays at the target in at least 95% of the seconds after warm-up. The chooser picks Low on the S24+ (WebGL2), Medium on the iPad (WebGPU) and High on the Mac. Within that rule, a preset draws the sharpest shadows that its devices hold.

### Proposed values

The engine now applies the shadow cascade count and map size of each preset. A directional light whose `shadow` options name neither takes the preset's values when it is created. `createEngine` takes `shadowCascades` and `shadowMapSize`, like the other settings fixed at the start. Three values move from the plan's starting values:

| Setting | Low | Medium | High | Ultra | Starting values |
| --- | --- | --- | --- | --- | --- |
| Shadow cascades | 2 | 3 | 3 | 4 | 1, 2, 3, 4 |
| Shadow map size in texels | 1,024 | 2,048 | 2,048 | 4,096 | unchanged |
| Shadow filter | 3 x 3 | 5 x 5 | 5 x 5 | 5 x 5 | 3 x 3 on Medium |

The other rows keep their starting values. Why each value moved:

- Low takes 2 cascades, not 1. One cascade spreads its 1,024 texels over the whole 200 m of shadow. A vehicle's shadow in S4 then drew as a smear of a few texels. With two, the near cascade ends at about 24 m, so the shadows near the camera get texels about eight times finer. Before this change, every light drew 3 cascades of 2,048 texels. With them, the S24+ held 60 fps at Low in S4's 10-minute run on 2 October, at a render scale of 1. Two cascades of 1,024 texels draw the casters one time fewer, and fill a sixth of those texels.
- Medium keeps 3 cascades, not 2. With 2, the near cascade ends at about 24 m instead of 14 m, so its texels grow by about two thirds. The owner saw jagged shadow edges on the iPad at Medium with 3 cascades, before this change.
- Medium takes the 5 x 5 filter, for those edges. The iPad draws at a pixel ratio of 2, where the 3 x 3 filter's edges show their steps. The governor lowers the filter to 3 x 3 as its last step when frames run long.

Shadow map memory, 4 bytes per texel in each cascade: Low 8 MiB, Medium and High 48 MiB, Ultra 256 MiB.

### Data

Chrome 154 drew S4 through Playwright on the MacBook Pro M5 Max, on WebGPU and WebGL2. The window was 1,400 x 778 CSS pixels at a pixel ratio of 1, on a 144 Hz display. Each page ran three times for 10 s, with `bun run bench:run --scenes s4 --pages null3d-webgpu,null3d-webgl2 --switches preset=<preset> --runs 3 --seconds 10`. Other helpers built and tested on the same Mac.

| Preset | Shadows | GPU ms per frame, WebGPU | Busiest thread ms, WebGPU | Busiest thread ms, WebGL2 |
| --- | --- | --- | --- | --- |
| Low, starting values | 1 cascade of 1,024 texels, 3 x 3 | 1.29 | 0.09 | 0.24 |
| Low, proposed | 2 cascades of 1,024 texels, 3 x 3 | 1.18 | 0.11 | 0.17 |
| Medium, starting values | 2 cascades of 2,048 texels, 3 x 3 | 1.14 | 0.12 | 0.26 |
| Medium, proposed | 3 cascades of 2,048 texels, 5 x 5 | 1.34 | 0.10 | 0.18 |
| High, unchanged | 3 cascades of 2,048 texels, 5 x 5 | 1.34 and 1.40 | 0.14 and 0.13 | 0.26 and 0.24 |

Every run held its target of 60 fps in every measured second, at a render scale of 1, with no quality step. The figures are medians of the three runs. The starting values ran first, and the proposed values later the same morning.

The Mac holds every preset with room to spare, so its timings cannot choose between them. Its GPU time per frame stays within the noise of the runs. The phone and the tablet decide.

### Runs on the S24+ and the iPad

S4 and S3 run at each candidate, from a checkout of this branch. `?shadowCascades=`, `?shadowMapSize=` and `?shadowFilter=` replace a preset's shadow values on a benchmark page. The device runner's `--switches` gives them to every page of its bench plan. The candidates:

- S24+, Chrome and Brave, WebGL2: Low as proposed, and Low with the 3 cascades of 2,048 texels from before this change. Then Medium, to see the room above Low.
- iPad, Safari, WebGPU: Medium as proposed; Medium with the 3 x 3 filter; and High.

Then the 10-minute gate run of the chosen preset on each device. Their rows go here.
