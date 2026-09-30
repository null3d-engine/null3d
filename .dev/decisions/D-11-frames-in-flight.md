# D-11: Preset values, the governor's thresholds, and frames in flight

Status: proposed. Date: 2026-09-30. Tasks: M1-G1 (frames in flight), then M1-G3, M1-G5 and M1-G6.

This record settles three questions. M1-G1 answers the third, frames in flight, with the GPU-bound page. The preset values and the governor's thresholds follow from the S4 traces of M1-G5 and M1-G6, and from the live shadow-map resize test of M1-G3. Those tasks add their sections here.

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

### Pending rows: the iPad and the S24+

The phone and the tablet run the page from the main checkout, once this record's pull request has merged:

```sh
bun tests/real-browsers.ts --plan overload --allow-no-webgpu --android chrome,brave --lan ipad-safari,ipad-brave --shields on
```

The S24+ has no WebGPU, so its WebGPU pages count as skipped.

How the data was produced: `NULL3D_PORT=63173 bun tests/real-browsers.ts --plan overload Safari Firefox "Google Chrome" "Brave Browser"`. The runs were on 30 September 2026, from the worktree of the branch `feat/frame-completion`. The Mac has a 120 Hz built-in display and a 144 Hz external display, and each browser drew on the display its window was on. Safari runs a worker's frame callbacks from a timer, at about 64 Hz. The Firefox limits came from the same plan with limits 3 and 4 added for one run. The Chrome rounds opened the page in Playwright's Chrome, which starts its window on the built-in display. Other helpers built and tested on the same Mac during every run. The results are in the worktree's `target/runs`.

## Decision

Proposed, for the owner to confirm: the thread that draws takes no new frame while two frames are unfinished on the GPU. This holds on both GPU paths and in every thread mode.

The rule's condition holds in Firefox, whose rates parted by more than half on both paths. The condition misses the queues in Chrome, Brave and Safari's WebGL2 path, where the rates stayed together while 4 to 8 frames waited. The limit's purpose is to keep frames from queuing, so the data supports it there too. In Chrome it cut the delay to a third or less, at no clear cost in frame rate.

The cost falls on Firefox's WebGPU path, because Firefox reports completions late. At 4,096 spheres it finished 102 frames per second with the limit and 120 without. At 8,192 spheres it finished 22 with the limit and 84 with a limit of 4. Options for the owner:

- Keep 2 everywhere (this proposal). Firefox's WebGPU path draws fewer frames when the GPU is busy, with far less delay than without the limit.
- Raise the limit to 3 or 4 on WebGPU. Firefox's WebGPU path recovers most of its rate, and Chrome, Brave and Safari get one or two more frames of delay under load.

`?queue=<n>` sets the limit for a page, and `?queue=off` removes it, so each option can be measured on a device.

## Consequences

- `gpu/completion.ts` tracks every frame, all the time, and reports the frames still unfinished. `Presenter.due` in `render/loop.ts` holds the frame back at the limit.
- `RingSums` in `shared/metrics.ts` sums a ring's new records without allocating. The warm-up benchmark and the governor can read the completed rate and the delay with it, in any window of play.
- `FrameSummary.completedFps` and `gpuLatencyMs` cover every frame. The performance guide explains the presented rate, the completed rate and GPU time. The develop skill tells agents to judge a phone's GPU by the completed rate.
- `bench/allocation.ts` budgets the tracker's objects.
- Revisit the limit on Firefox's WebGPU path when Firefox reports completions sooner.
