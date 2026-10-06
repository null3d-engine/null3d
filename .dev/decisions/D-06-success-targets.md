# D-06: Success targets

Status: decided for the desktop target's measure; the phone target and the size target wait for the M0.2 phone runs. Date: 2026-09-27.

## Question

Do the 50%, 100% and 600 KB targets stand as written, now that M0 has data? This record settles the first question the data raised: what "CPU frame time" means for the desktop target when both engines run the same scene code on the thread that limits the frame rate.

## Rule

The targets are proposals to confirm in M0. M0's exit gate, item 1: S1 on the MacBook Pro in Chrome with WebGPU, null3D's CPU frame time at most 50% of three.js best practice. If item 1 fails: stop feature work, profile, and write a revised plan before M1.

## Data

S1, 100,000 instances, each moved every frame by the scene's shared code in `onUpdate`. Busiest thread's CPU time per frame, median of runs.

| Measure | null3D | three.js, faster renderer (WebGL) | Device and browser |
| --- | --- | --- | --- |
| Whole frame | 2.77 ms (2.77 to 2.78, 5 runs); 2.50 ms (3 runs) | 3.25 ms (5 runs); 3.17 ms (3 runs) | MacBook Pro, Chrome 153, WebGPU |
| Shared scene code: S1's motion (three sine or cosine calls per instance) and the camera path | 2.4 to 2.6 ms | the same code | same |
| Own work, busiest thread | 0.14 ms (game thread, after the scene code) | about 0.8 ms (matrix composition and uploads 0.68 ms, drawing 0.11 ms) | same |
| Own work, all threads | about 0.75 ms (game thread 0.14, render thread 0.16, 16 job workers 0.45) | about 0.8 ms, all on the main thread | same |
| Whole-frame share in other browsers | Brave 83%, Safari 42%, Firefox 78% | | same Mac |

How the data was produced: `bun run bench:run`, `bun run bench:run -- --sweep`, and the runner's bench plan in Safari and Firefox, all on 2026-09-27. The first ran the full protocol of 5 runs of 5 s warm-up and 30 s measured, and a 3-run batch. The two Chrome batches differ by about 10% for both engines; their frame rates differed (120 and 144 per second). three.js's own work was estimated as its scene update minus null3D's (which is almost all the shared motion code), plus its drawing time. The scene-code page added with this decision measures the shared code directly.

## Decision

The desktop target keeps 50% and measures each engine's own CPU work per frame on its busiest thread, apart from the game's code. Every report keeps the whole frame next to it. The owner chose this on 2026-09-27 over two other options. One was making game code itself run in parallel, which would change the design because job workers run only Rust. The other was keeping the target as written until the phone data.

How each side is measured:

- null3D times the game's update itself, so each thread's own work is its time less the update phase on it, from the same frames. The update holds the scene code and the game's writes into the engine's arrays, which run no engine code. The busiest thread's value counts.
- three.js calls its own code (matrix composition, the instance buffer, drawing) from inside the game's loop, so its own work is its frame time less the scene code's time. A scene-code page measures that time by running the scene's shared per-frame code alone on the main thread.

A first version subtracted the scene-code page's time from null3D's game thread as well. That was not precise enough. The page's bare loop compiled to slower code than the engines' loops. It took 2.44 to 2.57 ms for S1's scene code, against 2.03 ms for null3D's loop with its array writes on the main thread and 2.2 to 2.4 ms in its game worker. The game thread's own work came out below zero. The same effect makes three.js's own work low in this measure, so the comparison leans against null3D.

Result, full protocol in Chrome on 2026-09-27 (5 runs of 5 s warm-up and 30 s measured, 100,000 instances, display at 144 frames per second):

| Measure | null3D | three.js WebGL (faster) | three.js WebGPU |
| --- | --- | --- | --- |
| Whole frame, busiest thread | 2.32 ms (2.31 to 2.51) | 3.09 ms (2.94 to 3.54) | 3.47 ms |
| Own work, busiest thread | 0.14 ms | 0.56 ms | 0.94 ms |
| Scene code alone (scene-code page) | 2.53 ms (2.38 to 2.56) | | |

null3D's own work is 26% of three.js's, so gate item 1 passes. If three.js's loop runs the scene code as fast as null3D's main-thread loop does (about 2.05 ms), three.js's own work is about 1.0 ms and the share about 14%. The whole frame is 75% of three.js's.

The sweep (one 5-second run per point) first showed a weak spot, which is now fixed:

| Instances | null3D own work, before | after | three.js own work | Share after |
| --- | --- | --- | --- | --- |
| 1,000 | 0.14 ms | 0.14 ms | 0.13 ms | 108% |
| 3,000 | 0.19 ms | 0.15 ms | 0.17 ms | 85% |
| 10,000 | 0.34 ms | 0.19 ms | 0.21 ms | 88% |
| 30,000 | 0.77 ms | 0.25 ms | 0.30 ms | 83% |
| 100,000 | 0.15 ms | 0.15 ms | 0.62 ms | 24% |

From 10,000 to 30,000 instances null3D's busiest thread was the render thread. Its time was Chrome's `writeBuffer` for uploads of 0.5 to 3 MB (up to 0.8 ms per MB, against 0.05 ms per MB from 4 MiB up). On the owner's go-ahead of 2026-09-28, uploads from 64 KiB to 4 MiB now go through a ring of mapped staging buffers (about 0.13 ms per MB in Chrome), and the rest stay on `writeBuffer`. At 1,000 instances the render thread's fixed cost per frame (about 0.13 ms: the replay's WebGPU calls and, while measuring, the GPU timer) is about three.js's whole own work.

Why the measure changed: S1 is defined with its motion as CPU code in `onUpdate`. That code alone takes 2.2 to 2.6 ms in Chrome, more than the whole 50% budget of about 1.6 ms. No engine meets the whole-frame target while that code runs on one thread, so the whole-frame measure tests the scene code rather than the engine.

Caveat to keep in view: in total processor time the two engines do about the same work in S1. null3D's gain is where its work runs, spread over job workers and off the game thread. Its gain also comes from GPU culling, which keeps its game-thread work nearly flat as the instance count grows (0.03 ms at 1,000 instances, 0.14 ms at 100,000).

## Consequences

- The benchmark gains a scene-code page per scene. Reports, the device runner's tables and the sweep chart show each engine's own work next to the whole frame.
- The desktop target and gate item 1 name the own-work measure.
- The README's target table names the measure.
- The phone target (100%) and the size target (600 KB) stay open until the M0.2 phone runs; that decision also says whether the phone target uses the own-work measure.
- Mid-size uploads: fixed on 2026-09-28 with the staging ring above. Measured in Safari and Firefox the same day (runner bench plan, S1 at 30,000 instances, 3 runs each, before the route choice below):
  - Firefox: the ring costs the render worker 0.18 ms for 1.44 MB; own work 0.24 ms against three.js's 1.10 ms (22%), whole frame 2.90 ms against 3.78 ms (77%).
  - Safari: own work 1.48 ms against three.js's 1.40 ms (106%), whole frame 1.48 ms against 2.74 ms (54%). The render worker was the busiest thread. Safari's unmapping of a staging buffer costs time in proportion to the buffer's size, so the ring took about 1.5 ms where `writeBuffer` takes about 0.4 ms (micro-benchmark: 0.44 ms for 1.44 MB).
  - Safari 26 also dropped whole submits holding two or more copies from one buffer that was mapped when they were recorded. The ring now records its copies after unmapping.
  - Consequence: the render worker times both routes for each size class from 64 KiB to 4 MiB and takes the faster one, never deciding from the browser's name.
  - Final numbers with the route choice and allocation-free recording (runner bench plan, 3 runs each, 2026-09-28; own work against three.js's faster renderer, then the whole frame):

    | Instances | Browser | Own work | Whole frame |
    | --- | --- | --- | --- |
    | 30,000 | Safari | 0.12 ms against 1.54 ms (8%) | 0.56 ms against 2.64 ms (21%) |
    | 30,000 | Firefox | 0.26 ms against 0.66 ms (39%) | 2.84 ms against 3.82 ms (74%) |
    | 100,000 | Safari | 0.46 ms against 1.18 ms (39%) | 1.74 ms against 4.74 ms (37%) |
    | 100,000 | Firefox | 0.42 ms against 1.56 ms (27%) | 4.42 ms against 5.68 ms (78%) |

    Both browsers meet the desktop own-work target (50%) at both counts. Firefox's three.js estimates move with the scene-code page's timing, which varied from 2.68 to 3.16 ms at 30,000 instances between runs.
- Frame recording without the general-purpose allocator, 2026-09-28: a trace build that reported each WebAssembly memory growth with its call stack found the frame recorder's upload arena and layout rebuild calling the allocator. The recorder now sizes both for the scene as it stands; see the render crate's allocation tests.

## Addendum, 2026-09-29: faster than three.js in every kind of scene

The owner asked for null3D to be faster than three.js on the benchmarks, on both GPU paths, with fixes that hold for every kind of scene rather than for the three scenes alone.

Finding. A page that runs no engine code timed the least possible frame on the MacBook Pro: get the canvas texture, run one empty render pass, submit. It costs 0.075 ms of CPU time per frame in Chrome and 0.06 to 0.1 ms in Safari and Firefox, in a worker or on the main thread, with or without MSAA and depth. The least WebGL2 frame costs 0.015 to 0.04 ms. three.js's whole WebGL frame takes about 0.05 ms with one box, and about 0.07 ms with S1-static's 100,000 still boxes, which it draws without culling them one by one. So no WebGPU renderer can beat three.js's WebGL renderer on very small scenes or on large scenes of still objects. three.js's own WebGPU renderer takes 0.2 to 0.3 ms there.

Options put to the owner:

1. Keep WebGPU as the first choice, and accept ties or small losses against three.js's WebGL renderer on those scenes. Reports show both comparisons: against three.js's faster renderer and against three.js on the same API.
2. Make WebGL2 the first choice, and WebGPU opt-in.
3. Keep WebGPU first, and compare each path only with three.js on the same API.

Decision: option 1, chosen by the owner on 2026-09-29.

General fixes made on the WebGL2 path branch (PR #20):

- Static instance batches at rest are culled in clusters of 64 nearby rows (Morton order), one sphere test and one index list entry per cluster; the vertex shader expands clusters through a cluster texture.
- Culling runs on the calling thread below 16,384 spheres, and covers the scene slots in use, not the scene's capacity.
- The frame uniform, the streamed texture and the index list move to a new ring slot only when a frame writes new data. A scene object that draws nothing (a camera) uploads nothing when it moves, on both paths.
- GPU time and frame completion are measured on one frame in eight.
- The benchmark sweep runs every scene from one object up on both paths and both three.js renderers.

Sweep, 2026-09-29, before the upload changes (busiest thread's CPU time per frame in ms, Chrome, one run of 5 s per point):

| Scene, objects | null3D WebGPU | null3D WebGL2 | three.js WebGPU | three.js WebGL |
| --- | --- | --- | --- | --- |
| S1, 1 | 0.11 | 0.08 | 0.31 | 0.09 |
| S1, 1,000 | 0.12 | 0.14 | 0.40 | 0.20 |
| S1, 100,000 | 2.57 | 2.65 | 3.49 | 3.09 |
| S1-static, 1 | 0.09 | 0.04 | 0.20 | 0.04 |
| S1-static, 100,000 | 0.09 | 0.07 | 0.27 | 0.07 |
| S2, 5,096 | 0.16 | 0.31 | 8.73 | 3.08 |
| S2, 15,288 | 0.38 | 0.50 | 33.73 | 9.86 |

After the upload changes, one still box takes 0.035 ms on WebGL2 against three.js's 0.040 ms (3 alternating runs each), where they tied, and 0.085 to 0.09 ms on WebGPU.

Final sweep on PR #20 after its last commit, 2026-09-29 (busiest thread's CPU time per frame in ms, Chrome, one run of 5 s per point; `target/bench/20260929-055234-sweep`):

| Scene, objects | null3D WebGPU | null3D WebGL2 | three.js WebGPU | three.js WebGL |
| --- | --- | --- | --- | --- |
| S1, 1 | 0.08 | 0.06 | 0.25 | 0.08 |
| S1, 1,000 | 0.13 | 0.11 | 0.35 | 0.15 |
| S1, 10,000 | 0.52 | 0.63 | 1.29 | 0.76 |
| S1, 100,000 | 2.52 | 2.60 | 3.45 | 3.03 |
| S1-static, 1 | 0.08 | 0.04 | 0.17 | 0.04 |
| S1-static, 100,000 | 0.10 | 0.07 | 0.30 | 0.08 |
| S2, 5,096 | 0.21 | 0.27 | 8.97 | 3.08 |
| S2, 15,288 | 0.33 | 0.40 | 34.48 | 9.87 |

Verdicts: WebGL2 is faster than three.js's faster renderer at every count of every scene, on the whole frame and on own work. WebGPU is faster than three.js's WebGPU renderer at every count. Against three.js's WebGL renderer it is slower in S1 below 1,000 boxes (113% to 120%) and in S1-static at every count (127% to 200%), the limit that option 1 accepts.

Later fixes on the branch:

- Upload trims for objects that draw nothing
- Ring slots that move only on new data
- The job workers' wake after the sketch's update
- Mid-sized culls on awake workers
- A 16-word index list comparison
- One-draw multi-draw calls as plain draws
- An allocation-free refresh meter

## Addendum, 2026-09-29: the size target, in writing

Gate item 5 asks for both core builds to be measured and the 600 KB target confirmed or revised in writing.

| File | Raw | Brotli | Share of the 600 KB budget |
| --- | --- | --- | --- |
| Threaded core (`null3d_bg.wasm`) | 156,061 B | 53,412 B | 8.7% |
| Single core (`null3d_bg.wasm`) | 150,966 B | 52,634 B | 8.6% |
| Threaded glue (`null3d.js`) | 18,335 B | 4,074 B | |
| Engine JavaScript (page, sketch, render, job and probe workers) | 354,975 B | 77,507 B | against the 60 KB API budget, see below |

Sizes from `tools/size-baseline.json` (main's size record then, at 9b792d0) and from the production build measured for [D-01](D-01-gpu-layer.md), whose full tables stay with its size probe outside the repository.

Decision: the 600 KB budget for each core build stands. Both builds use under a tenth of it, which leaves room for the renderer features still to come (shadows, PBR, glTF, animation) without a revision now. CI keeps checking every build against it and against 2% growth.

There is also a 60 KB budget for the TypeScript API and page shim. The engine's JavaScript is 77.5 KB after Brotli across its five chunks, but a page downloads only the chunks its mode needs. Of the total, 37.5 KB is the GPU layer shipped three times (in the page, the sketch worker and the render worker; finding in [D-01](D-01-gpu-layer.md)). The page chunk alone is 31 KB. This budget has no check in CI yet (audit item I5). On 2026-09-30 the owner raised it to 70 KB, and on 2026-10-01 to 80 KB and then 100 KB ([D-14](D-14-js-budget.md)). On 2026-10-04 the owner set M2's budgets: 140 KB at a page's start, and 16 KB for each file that loads on first use. A revision waits for that check and for the owner's call on sharing the GPU layer's code between chunks.

## Addendum, 2026-09-29: the phone target on the Galaxy S24+

S1 at phone scale (300,000 boxes), runner bench plan, five runs each, Chrome and Brave, WebGL2 (the S24+ has no WebGPU), busiest thread's CPU time per frame:

| Browser | null3D | three.js (faster renderer) | Share |
| --- | --- | --- | --- |
| Chrome | 24.9 ms | 39.5 ms | 63% |
| Brave | 26.2 ms | 38.2 ms | 69% |

Runs: `target/runs/20260929-090632-bench` (Chrome) and `target/runs/20260929-094743-bench` (Brave), after the fix that made WebGL2 frames reach the canvas (PR #21). Both meet the phone target (at most 100%). The iPad part of the phone target (Safari WebGPU and forced WebGL2) waits for the tablet session; the status of this record stays "decided for the desktop target" until then.


## Addendum, 2026-09-30: the phone target on the iPad Pro

S1 at the iPad's scale: 240,000 boxes, where three.js's faster renderer by frame rate, WebGPU, holds 30 frames per second. Runner bench plan, five runs of each page taking turns, Safari 26.6 with Limit Frame Rate on (60 Hz). Busiest thread's CPU time per frame, median of runs:

| Page | CPU per frame | Own work, busiest thread | Presented fps | GPU ms |
| --- | --- | --- | --- | --- |
| null3D, WebGPU | 15.52 ms | 2.36 ms | 26.8 | 27.78 |
| null3D, WebGL2 forced | 15.60 ms (4 runs, see below) | 1.86 ms | 28.9 | n/a |
| null3D, WebGPU, low latency | 18.58 ms | 3.47 ms | 18.3 | 27.88 |
| null3D, WebGL2, low latency | 17.40 ms | 2.98 ms | 29.0 | n/a |
| three.js, WebGPU | 26.54 ms | 13.42 ms | 31.5 | n/a |
| three.js, WebGL | 22.56 ms | 9.44 ms | 18.3 | n/a |
| Scene code alone | 13.12 ms | | 60.0 | |

Run `target/runs/20260929-155111-bench` (the 31 results before a dev server restart are also copied to the session scratchpad). One WebGL2 run measured 0 frames: the dev server reloaded the page mid-run when a file move added an HTML file to its tree. The other four WebGL2 runs agree within 1%.

Both parts of the iPad's phone target pass: null3D on WebGPU takes 58% of three.js WebGPU's CPU time and 69% of three.js WebGL's; forced WebGL2 takes 69% of three.js WebGL's. Own work is 18% to 25% of three.js's.

With the S24+ addendum above, gate item 2 passes on every device and browser the team has. Brave on the iPad followed on 2026-09-30 (addendum "the phone target in Brave on the iPad").

A finding to follow up: on the iPad, null3D's frame rate is lower than three.js WebGPU's (26.8 against 31.5 frames per second) although its CPU time is lower. null3D's GPU time is 27.8 ms per frame, so the GPU limits it there. The phone target measures CPU time and passes, but the frame rate gap on Apple's GPU needs a profile in M1 (GPU timestamps per pass: culling, drawing, MSAA resolve).

## Addendum, 2026-09-30: a thinner margin on the S24+

A rerun of S1 at 240,000 boxes on the S24+ (Chrome 154, WebGL2, run `target/runs/20260929-164448-bench`) measured null3D at 95% of three.js's CPU time per frame (21.08 ms against 22.20 ms). null3D's own work was 101% of three.js's (7.14 ms against 7.06 ms). The phone reached Samsung's throttle level 2 during the run, with its fastest cores capped at 51% of top speed, and null3D's runs spread from 13.2 to 22.3 ms.

The earlier run at 300,000 boxes measured 63%, with three.js at 39.5 ms. Scaled to 240,000 boxes, three.js would take about 31.6 ms, not the 22.2 ms measured now, so heat or run order moved one engine's runs more than the other's. The target still holds, but the margin needs a controlled rerun: start cool, alternate the two engines page by page, and add `--seconds 300` sustained runs, before the phone figure is published.

## Addendum, 2026-09-30: S2 on the iPad Pro

S2 (5,000 objects in a 6-level hierarchy, 20 meshes by 5 materials), runner bench plan, five runs of each page taking turns, Safari 26.6 at 60 Hz. Run `target/runs/20260929-165718-bench`.

| Page | CPU per frame | Presented fps | GPU ms |
| --- | --- | --- | --- |
| null3D, WebGPU | 0.32 ms | 60.7 | 2.19 |
| null3D, WebGL2 forced | 0.38 ms | 57.7 | n/a |
| three.js, WebGL | 10.62 ms | 55.8 | n/a |
| three.js, WebGPU | no result: all five runs hung for 95 s | | |

null3D takes 3% of three.js WebGL's CPU time on WebGPU and 4% with WebGL2 forced, and holds the display's rate. three.js's WebGPU renderer never published a result in S2 on the iPad; its page loaded and then gave no frames within the page's timeout. That is a three.js or Safari fault, which the three.js page's own start times would show; the S2 comparison on the iPad uses three.js WebGL.

The scene-code page drew every frame, but its code takes less than one step of Safari's timer, so the runner failed it for "no CPU time" in this run; #38 accepts that.

## Addendum, 2026-09-30: the controlled rerun on the S24+

The controlled rerun started cool (throttle level 0, skin 37.9 °C) and alternated the pages run by run: S1 at 240,000 boxes, Chrome 154, WebGL2, five runs, run `target/runs/20260929-171803-bench`.

| Page | CPU per frame | Own work, busiest thread | Presented fps |
| --- | --- | --- | --- |
| null3D, WebGL2 | 22.15 ms (12.52 to 22.33) | 7.57 ms | 30.0 |
| three.js, WebGL | 22.11 ms (16.75 to 24.48) | 8.97 ms | 44.2 |
| Scene code alone | 13.14 ms | | 59.9 |

null3D takes 100% of three.js's CPU time: the phone target holds only at its limit, against 63% and 95% in the two earlier runs. Own work is 84% of three.js's. The phone throttled to level 2 in this run too, with its fastest cores at 57% at the lowest.

Where null3D's time goes on the sketch worker, per frame: the sketch's update 14.58 ms, instance batches 5.07 ms, culling 1.59 ms, and under 0.2 ms for the rest. The sketch's update is S1's motion code and its writes into engine memory. The eight job workers are each busy 1.4 to 3.3 ms per frame. The batch pass packs every moved box for upload (12.47 MB per frame, 52.6 bytes per visible entry), split across the job workers, and the sketch worker waits for the last chunk. With 2 job workers the sketch worker's own work was 4.95 ms against 7.42 ms with 8 ([D-07](D-07-job-workers.md)), which points at chunks that land on the phone's slower cores.

The presented rate (30 against 44) comes from the pipelined pacing: a sketch frame over 16.7 ms runs at half the 60 Hz refresh. The owner chose on 2026-09-29 to keep that pacing; it does not affect the CPU measure.

Next: profile the batch pass on the phone (the profiler needs an option to sample the sketch worker), and decide [D-07](D-07-job-workers.md) with this in view, before M1 adds work to the sketch worker.

## Addendum, 2026-09-30: sustained S1 on the S24+

The protocol's 10-minute sustained run (`--seconds 300`: 5 minutes of warm-up, then 5 measured), S1 at 240,000 boxes, Chrome 154, WebGL2, run `target/runs/20260929-172838-bench`. The phone reached throttle level 4 and Android thermal status 3, with its fastest cores down to 42% of top speed.

| Page | CPU per frame | Presented fps |
| --- | --- | --- |
| null3D, WebGL2 | 16.84 ms | 40.0 |
| three.js, WebGL | 28.11 ms | 34.8 |

null3D took 60% of three.js's CPU time. The two runs were back to back, null3D first, so three.js ran on a hotter phone; the comparison leans toward null3D. Both kept drawing for the full 10 minutes.

## Addendum, 2026-09-30: sustained S1-static, and a WebGPU cost on the iPad

The 10-minute sustained S1-static runs at 240,000 boxes (5 minutes of warm-up, 5 measured), run `target/runs/20260929-174908-bench`:

| Device and page | CPU per frame | GPU ms (timed passes) | GPU delay ms | Presented fps |
| --- | --- | --- | --- | --- |
| S24+, Chrome, null3D WebGL2 | 0.85 ms | n/a | 16.7 | 59.9 |
| iPad, Safari, null3D WebGL2 | 0.12 ms | n/a | 17.5 | 58.2 |
| iPad, Safari, null3D WebGPU | 0.12 ms | 2.48 | 39.6 | 23.2 |

On the iPad, null3D's WebGPU path presents 23 frames per second in S1-static and 27 in S1 at 240,000 boxes. Yet its CPU time is under 1 ms in S1-static, and its timed GPU passes take 2.5 ms. Each frame takes about 40 ms from submit to done, so GPU work outside the timed passes, or Safari's presentation from the render worker's OffscreenCanvas, holds it back. S2 (5,000 objects) presents 60 frames per second on the same path, so the cost grows with the object count. Suspects: the GPU culling pass over every instance each frame, the indirect draws, or render bundle replay. three.js's WebGPU renderer presents 31.5 frames per second in S1 on the same iPad.

This does not affect the CPU targets, but it is the largest performance gap found on the iPad. It needs a profile before M1 adds GPU work: reproduce it in Safari on the Mac with the runner (`--scenes s1-static --n 240000 --pages null3d-webgpu,null3d-webgl2 Safari`), time each pass, and turn the culling pass off to see its share.

The same scene ran in Safari on the MacBook Pro, opened directly (not through the runner), for 10 measured seconds. WebGPU presented 59.8 frames per second, with 0.06 ms of CPU time, 0.72 ms in the timed GPU passes and 10.9 ms from submit to done. WebGL2 presented 53.2. The Mac's GPU hides the cost, but the gap between the timed passes and the delay (about 10 ms) is there too, so the untimed work can be studied on the Mac.

## Addendum, 2026-09-30: sustained S2

The 10-minute sustained S2 runs (5,096 objects; 5 minutes of warm-up, 5 measured), run `target/runs/20260929-180916-bench`:

| Device and page | CPU per frame, median / p95 | GPU ms (timed passes) | GPU delay ms | Frame interval p95 / p99 ms | Presented fps |
| --- | --- | --- | --- | --- | --- |
| S24+, Chrome, null3D WebGL2 | 1.65 / 7.06 ms | n/a | 16.3 | 16.84 / 16.95 | 59.9 |
| iPad, Safari, null3D WebGL2 | 0.36 / 1.08 ms | n/a | 17.7 | 18.14 / 18.20 | 57.7 (refresh measured at 58 Hz) |
| iPad, Safari, null3D WebGPU | 0.30 / 0.48 ms | 2.19 | 8.6 | 16.82 / 16.88 | 60.7 |

S2 holds the display's full rate for the whole 10 minutes on both devices. The S24+ has no WebGPU in Chrome 154, so its WebGPU run was skipped. On the iPad, the WebGPU path's delay is 8.6 ms at 5,096 objects, against about 40 ms at 240,000 boxes, which fits a cost that grows with the object count.

## Addendum, 2026-09-30: where the S24+ sketch worker's time goes in S1

`bun run bench:profile --android --thread sketch --scene s1 --n 240000`, with the core built with its function names (`bun tools/build-wasm.ts --names`), Chrome 154, WebGL2, the default 8 job workers. The phone started cool (thermal status 0, battery at 31 °C).

- The page presented 59.7 frames per second: the first S1 run at 240,000 boxes on the S24+ at the display's full rate. The sketch worker was busy 13.4 ms per frame: the scene's own update 10.47 ms, the batch pass 2.32 ms, culling 0.54 ms, the rest under 0.05 ms.
- The profile of the sketch worker's frame step (10 s): the scene's own code 78.9%, the engine core 20.6%, the engine's JavaScript 0.4%, browser calls 0.1%. In the core: the instance row kernel 16.7% (2.3 ms per frame, the whole batch pass) and the job system's own work 2.6% (0.36 ms: splitting the loop and preparing the jobs). Culling took 0.6%, transforms 0.4%.

So the batch pass on the sketch worker is the row kernel running the sketch worker's share of rows, not job overhead. The engine's own work on the sketch worker is about 2.9 ms of the 13.4 ms; the other 10.5 ms is S1's scene code, which the three.js page runs too. The earlier 5.07 ms batch pass was on a phone throttled to about 42% of its top speed, which matches 2.3 ms on a cool phone. The thin margin on the phone is therefore heat, not a slow engine path; [D-07](D-07-job-workers.md) covers whether fewer job workers make less heat.

## Addendum, 2026-09-30: the 120 Hz pass on the S24+ did not reach 120 Hz

With Motion smoothness set to Adaptive (`refresh_rate_mode 1`), Chrome's benchmark pages still ran at 60 Hz, in S1 at 240,000 boxes and in S2. The engine's refresh meter read 60 Hz, and frame intervals were 16.67 ms. Adaptive mode seems to keep Chrome at 60 Hz without touch input. The 120 Hz pass needs another way to hold the display at 120 Hz; the owner decides how, or whether to skip it on this phone.

The S1 runs from that attempt (60 Hz in effect, pages taking turns, no rest between runs; run `target/runs/20260929-190716-bench`) show how heat changes the comparison:

| Order | Page | Skin temperature, start to end | CPU per frame | Presented fps |
| --- | --- | --- | --- | --- |
| 1 | null3D WebGL2 | 32.4 to 34.7 °C | 13.27 ms | 57.1 |
| 2 | three.js WebGL | 34.7 to 38.5 °C | 17.78 ms | 53.1 |
| 3 | null3D WebGL2 | 38.5 to 38.6 °C | 22.76 ms | 29.8 |
| 4 | three.js WebGL | 38.6 to 39.3 °C | 21.62 ms | 46.0 |
| 5 | null3D WebGL2 | 39.3 to 39.5 °C | 22.13 ms | 30.1 |
| 6 | three.js WebGL | 39.5 to 40.4 °C | 23.98 ms | 43.3 |

Cool, null3D took 75% of three.js's CPU time (runs 1 and 2). Once the phone was warm (Samsung throttle level 1 to 2), null3D's sketch worker took about as long per frame as three.js's main thread. Its time grew by 70%, and three.js's by 20 to 35%. At those times null3D's frames take longer than 16.7 ms, so in pipelined mode they present at 30 per second, while three.js presents 43 to 46. So on a warm S24+ the CPU margin is gone, which fits the thin margins of the controlled rerun (63%, 95% and 100%). The engine runs ten threads (the sketch worker, the render worker and eight job workers) against three.js's one. That may heat the phone faster, or place the sketch worker on a slower core once the phone throttles; the data here cannot tell which.

## Addendum, 2026-09-30: the phone target in Brave on the iPad

S1 at 240,000 boxes, with the runner's bench plan: five runs of each page, taking turns. Brave had Shields on, and Limit Frame Rate held the iPad at 60 Hz. Main was at 104ea31, with the frame builders on the render graph. With Shields on, Brave reports 3 cores, so the engine ran 1 job worker. Run `target/runs/20260930-010518-bench`.

| Page | CPU per frame | Own work, busiest thread | Presented fps | GPU ms |
| --- | --- | --- | --- | --- |
| null3D, WebGPU | 15.80 ms | 2.42 ms | 26.8 | 27.74 |
| null3D, WebGL2 forced | 16.02 ms | 1.86 ms | 29.0 | n/a |
| three.js, WebGPU | 28.92 ms | 15.80 ms | 30.4 | n/a |
| three.js, WebGL | 29.17 ms | 16.05 ms | 16.4 | n/a |
| Scene code alone | 13.12 ms | | 60.0 | |

null3D takes 55% of three.js's CPU time on both GPU paths. On WebGPU it takes 15.80 ms against three.js WebGPU's 28.92 ms. On WebGL2 it takes 16.02 ms against three.js WebGL's 29.17 ms. Its own work is 12% to 15% of three.js's. With this row, the phone target passes on every device and browser the team has.

## Addendum, 2026-09-30: the iPad's WebGPU cost in S1-static is gone

The sustained S1-static run on the iPad presented 23 frames per second on WebGPU (addendum "sustained S1-static, and a WebGPU cost on the iPad"). On main at 21bcf46, that cost did not come back. Safari presented 58.4 frames per second in three short runs, and in the same 10-minute sustained run. The timed GPU work was 3.37 ms, and the time from submit to done was 10.1 ms (run `target/runs/20260929-203959-bench`).

The slow run was on main at e54f443. That was before hold mode (#41), the render graph (#42) and the new GPU layer operations (#43). It is not known which change removed the cost, or whether Safari's state that night caused it.

A Safari fault on the Mac explained part of the gap. Safari rebuilds a render bundle that holds an indirect draw on every replay; WebKit has fixed this, and Safari 27.2 lists the fix. Pull request #49 replays each bundle's commands into the render pass instead. On the iPad, it raised S1 at 240,000 boxes on WebGPU from 26.8 to 28.1 frames per second, in Safari and in Brave alike. The GPU time stayed at 27.8 ms, and the time from submit to done fell by 1.7 ms. The runs are `target/runs/20260930-013339-bench` to `20260930-015149-bench`. S1-static stayed at about 59, the display's rate.

## Addendum, 2026-09-30: time to first frame (T-28)

The startup tools of #50 measure the time from navigation start until the GPU has finished the first frame. They load a production build of the engine test page, five cold and five warm loads in each thread mode. A cold load gets a new address for every file, so every file downloads and the browser compiles the core and the scripts from scratch. A warm load repeats an earlier load. Medians in ms; each device loaded from this Mac, over USB (the S24+) or the local network (the iPad).

| Device and browser | Network | Pipelined, cold / warm | Low latency, cold / warm | Single-threaded, cold / warm | Main thread, cold / warm |
| --- | --- | --- | --- | --- | --- |
| S24+, Chrome 154, WebGL2 | Slow 4G | 4,431 / 923 | 4,460 / 940 | 3,922 / 906 | 4,490 / 912 |
| S24+, Chrome 154, WebGL2 | full speed | 306 / 300 | 325 / 307 | 297 / 273 | 331 / 304 |
| S24+, Brave, Shields on, WebGL2 | full speed | 305 / 254 | 340 / 317 | 254 / 322 | 389 / 284 |
| iPad, Safari 26.6, WebGPU | full speed | 173 / 117 | 154 / 104 | 126 / 75 | 164 / 102 |
| iPad, Brave, Shields on, WebGPU | full speed | 155 / 123 | 156 / 109 | 125 / 90 | 158 / 115 |

Runs: S24+ Chrome from `bun run bench:startup --android`; the rest from the runner's `startup` plan, `target/runs/20260930-001309-startup` (iPad Safari) and the plans of 30 September 09:35 to 10:02 (+08). Before #58, low latency stalled in Safari on production builds; these rows are after the fix.

Reading the data:

- A cold load downloads 10 files, about 110 to 117 KB after Brotli (9 files in single-threaded mode). A warm load makes one request, the page's check, and downloads nothing.
- On Slow 4G, a cold start on the S24+ takes 3.9 to 4.5 s, and a warm one about 0.9 s. The page script itself runs at 1.4 s. In the threaded modes, the engine becomes ready about 1.9 s after the core. It starts its workers only once the core has compiled, which adds two round trips. In single-threaded mode, that wait is about 1.3 s.
- At full speed, the GPU probe takes about 60 to 80 ms on the S24+. Chrome there has no WebGPU, and the probe tries it first.

Target, confirmed by the owner on 2026-09-30: on the S24+ in Chrome on Slow 4G, the first frame within 4.5 s on a cold load, and within 1 s on a warm load, at the engine test page's size. Two changes can bring the cold load down. The first starts the workers' downloads with the core's, which saves about two round trips (1.1 s on Slow 4G). The second is the earlier sketch download in single-threaded mode (M1-K7, about 0.56 s).

On 2026-10-06 the owner raised the cold-load target to 5.5 s and kept the warm target at 1 s ([D-83](D-83-gate-rulings-2026-10-06.md)).

## Addendum, 2026-09-30: figures from production builds

From pull request #98 on, the benchmarks measure a production build of the benchmark pages, as developers ship the engine. The build leaves out the engine's development checks, such as the handle and argument checks. The figures above this addendum came from the dev server's pages, with the checks of their day on. The benchmark run, the CI benchmark job, the device runner's bench plan, the profile, the allocation check and the soak all use the build now. With `--dev`, the tools run the dev server's pages instead.

To see what the checks cost, each scene ran on both GPU paths, on the dev server's pages and on the production build. There were 10 rounds. Each round ran each page once per build, back to back, and the order alternated by round. Each run had 5 s of warm-up and 5 s measured, in Chrome 154 on the MacBook Pro. Other work kept the Mac busy, and the display ran at 120 or 144 Hz. The table gives the medians of the runs. The change is the median over rounds of the production run against the development run, as the CI job computes it.

Main at 38d5c1c, CPU time per frame:

| Scene | GPU path | Busiest thread, development / production | Change | Own work, development / production |
| --- | --- | --- | --- | --- |
| S1 | WebGPU | 2.16 / 1.90 ms | -9% | 0.171 / 0.155 ms |
| S1 | WebGL2 | 2.09 / 2.03 ms | -3% | 0.215 / 0.231 ms |
| S1-static | WebGPU | 0.075 / 0.067 ms | -11% | 0.075 / 0.067 ms |
| S1-static | WebGL2 | 0.040 / 0.050 ms | +8% | 0.040 / 0.045 ms |
| S2 | WebGPU | 0.145 / 0.153 ms | -5% | 0.133 / 0.143 ms |
| S2 | WebGL2 | 0.188 / 0.178 ms | +9% | 0.175 / 0.170 ms |

On main the checks cost less than this Mac's noise. S1's runs spread from 1.8 to 4.6 ms, and S1's two paths run the same sketch code. The other changes are 0.01 ms or less, one or two steps of the browser's 5-microsecond timer, and they go both ways. Own work moved by 0.02 ms or less on every page. The figures above this addendum therefore stand.

The per-frame check of static objects in pull request #93 costs more. The same measurement on that branch, at 353bbe9:

| Scene | GPU path | Busiest thread, development / production | Change | Own work, development / production |
| --- | --- | --- | --- | --- |
| S1-static | WebGPU | 0.070 / 0.067 ms | -7% | 0.070 / 0.067 ms |
| S1-static | WebGL2 | 0.045 / 0.047 ms | 0% | 0.040 / 0.045 ms |
| S2 | WebGPU | 0.218 / 0.135 ms | -25% | 0.208 / 0.127 ms |
| S2 | WebGL2 | 0.223 / 0.185 ms | -12% | 0.210 / 0.175 ms |

In S2 that check costs the sketch worker about 0.06 ms per frame on WebGPU and 0.03 ms on WebGL2. On the dev server's pages, the benchmarks and the CI job would have charged that to null3D, though no shipped page pays it.

## Addendum, 2026-10-02: S3, S4 and S1 at phone scale on each device

On 2 October 2026, the runner's bench plan ran S3 and S4 on the S24+ and the iPad. It also ran S1 at phone scale on the S24+ again. Five runs of each page took turns, at 60 Hz. The table gives the busiest thread's CPU time per frame, medians of runs. The S24+ rows compare with three.js's WebGL renderer, the only one it has, and the iPad rows with three.js's WebGPU renderer.

| Device, browser, path | Scene | null3D | Low latency | three.js | Share |
| --- | --- | --- | --- | --- | --- |
| S24+, Chrome 154, WebGL2 | S1, 300,000 boxes | 19.00 ms, 35.5 fps | 20.54 ms | 37.47 ms, 25.6 fps | 51% |
| S24+, Brave, Shields on, WebGL2 | S1, 300,000 boxes | 20.62 ms | | 38.81 ms | 53% |
| S24+, Chrome 154, WebGL2 | S4 | 4.35 ms | 1.51 ms | 6.42 ms | 68% |
| S24+, Brave, Shields on, WebGL2 | S4 | 4.30 ms | 1.64 ms | 6.35 ms | 68% |
| S24+, Chrome 154, WebGL2 | S3 | 1.81 ms | 0.95 ms | cannot draw | |
| S24+, Brave, Shields on, WebGL2 | S3 | 3.81 ms | 1.48 ms | cannot draw | |
| iPad Pro, Safari 26.6, WebGPU | S4 | 0.18 ms | | 11.30 ms | 1.6% |
| iPad Pro, Safari 26.6, WebGPU | S3 | 0.34 ms | | 2.00 ms | 17% |

- In S1 at phone scale, null3D's own work in Chrome was 3.47 ms against three.js's 23.39 ms, 15%. In Brave it was 21%. S1 at that scale always heats the phone: Samsung's throttle level reached 4, and the skin 45.2 °C. Both engines ran under it.
- On the S24+, S4 held 60 frames per second in every measured second in both browsers. The render scale stayed at 1, with no quality step. A run of 5 minutes of warm-up and 5 measured held 60 in 300 of 300 seconds, at 4.32 ms per frame. The phone stayed at throttle level 0.
- WebGLRenderer cannot draw S3 on the S24+ or the iPad. Its shader for 256 point lights needs more than the 1,024 uniform vectors that the GPU gives a fragment shader.
- On the iPad, S4 on WebGPU held 60 frames per second in 146 of 146 seconds. A run of 5 minutes of warm-up and 5 measured held its target in 300 of 300 seconds, at 0.20 ms per frame. That run measured the display at 50 Hz, against 65 Hz in earlier runs, so its target was 50. Check Low Power Mode and Limit Frame Rate before an iPad run.
- On the iPad, WebGL2 was slow. S3 took 25.9 ms per frame on the render worker, at 35 frames per second. S4 took 15.2 ms, with runs from 0.94 to 26.8 ms, and held 60 in 40% of its seconds. three.js's WebGL renderer took 7.74 ms in S4, at 15 frames per second. A profile found the render worker waiting for the GPU inside WebGL calls. WebGL2 is the fallback for iPads without WebGPU.

Runs: S24+ in Chrome `target/runs/20261002-053620-bench` (S4), `20261002-054912-bench` (S3) and `20261002-062931-bench` (the long S4 run); in Brave `20261002-130920-bench`; the iPad `20261002-151739-bench` and `20261002-160138-bench`.

On the MacBook Pro in Chrome at 144 Hz, 3 October 2026, five runs: S4 on WebGPU took 0.08 ms per frame. three.js took 2.38 ms with its WebGL renderer and 4.87 ms with its WebGPU renderer. It held its target in 146 of 146 seconds. S3 on WebGPU took 0.09 ms, against 0.44 ms for three.js's WebGPU renderer.

## Addendum, 2026-10-04: equal work, not identical pixels

The owner's decision of 4 October 2026 ([D-52](D-52-intent-parity.md)) sets how the targets compare the two engines. A comparison measures equal work: the same scene content and comparable quality settings. Where null3D's default technique differs from three.js's, its report gives a quality note beside the timings. The two engines' images need not be identical. The figures above stand: each scene drew the same content in both engines.
