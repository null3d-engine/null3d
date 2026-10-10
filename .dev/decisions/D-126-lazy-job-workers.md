# D-126: Start the job workers as the work grows

Status: decided, owner task, 10 October 2026. Task: memory parity study.

Summary: The engine starts no job workers at first. The sketch thread times the parallel loops that it hands out, and asks for 2 job workers once those loops take 0.2 ms or more per frame over 30 frames, then for twice as many after each such window, up to the most that [D-07](D-07-job-workers.md) sets. Started job workers stay. The sketch thread stops timing its loops for a while after a window with too little work, and for good once it has asked for the most, because each reading of the clock allocates. The render worker no longer runs a copy of the core. On an 18-core Mac, S1 with 1,000 boxes fell from 128 MiB to 77 MiB of real memory, against 40 to 48 MiB for its three.js twin. A scene that needs job workers runs its first quarter second about 0.3 ms per frame slower, and then as fast as before.

## Question

The owner asked whether null3D can use only as much memory as three.js. A page with a small null3D scene took about 80 MiB more memory than its three.js twin. Where does that memory go, and how much of it can go?

## Where the memory went

Measured on 9 and 10 October 2026, MacBook Pro (18 logical cores), Chrome, production builds of the benchmark pages, 1280 x 720, pixel ratio 1. "Real memory" is the page's renderer process footprint from macOS `footprint`: the RAM the tab takes, without the GPU process. A memory figure varies by about 10 MiB from run to run, so each table compares rows of one run.

| Page | Real memory | Engine's WebAssembly memory | JS isolates |
| --- | --- | --- | --- |
| null3D S1, 1,000 boxes, WebGPU, 16 job workers (before) | 128 MiB | 22.1 MiB | 19 |
| null3D S1, 1,000 boxes, WebGPU, `?jobs=1` (before) | 76 MiB | 7.0 MiB | 4 |
| null3D S1, 1,000 boxes, WebGPU, job workers as the work grows | 77 MiB | 5.0 MiB | 3 |
| null3D S1, 1 box, WebGPU, job workers as the work grows | 73 MiB | 4.8 MiB | 3 |
| three.js S1, 1,000 boxes, WebGPURenderer | 48 MiB | | 1 |
| three.js S1, 1,000 boxes, WebGLRenderer | 40 MiB | | 1 |

- Each job worker cost about 3.5 MiB of real memory while it waited: a whole browser thread with its own JS isolate (0.6 MiB of heap), its copy of the core's glue code and instance, and a 1 MiB stack in the shared memory. The 16 job workers of the Mac were 52 MiB of the 80 MiB gap.
- Per object, null3D and three.js are close. From 1,000 to 100,000 boxes, null3D's WebAssembly memory grew by about 230 bytes per box, and three.js's renderer process by about 140 to 200 bytes. The gap is the fixed cost.
- The S1 scene with 1,000 boxes never asked for a job worker. In the prototype's run, S1 with 100,000 boxes and S6 started all 16, and the real memory was the same as before (166 MiB and 171 MiB). In the timing runs below, S1 with 100,000 boxes started 4 to 16 on WebGPU, more when the Mac was busy, and all 16 on WebGL2.

## Options

| Option | Saving, S1 with 1,000 boxes on the Mac | Cost |
| --- | --- | --- |
| Start the job workers as the work grows (chosen) | 51 MiB | A scene that needs job workers runs its first frames with fewer of them (see Cost) |
| Fewer job workers by default, such as 4 | about 42 MiB | Large scenes lose speed: in D-07, 8 workers beat 2 by 6% of the sketch worker's frame on a phone |
| Smaller job worker stacks (256 KiB instead of 1 MiB) | 0 MiB of real memory | None, but it saves nothing: the engine's WebAssembly memory fell by 11 MiB, and the real memory did not move (127 and 129 MiB). A stack page that no call reaches is never backed by RAM. Not done |
| The render worker without a copy of the core (chosen) | about 1 MiB: its stack and its instance | None: the render worker only reads the shared memory, as the page does when it draws |

## Rule

- The page starts the sketch worker and the render worker at once, and no job worker. Each job worker gets its port for the loader's tasks when it starts.
- The core adds up the time that the sketch thread spends in each parallel loop that it hands out, from the hand-out to the last chunk's end. A loop that runs inline, because it has one chunk, does not count. Until a job worker joins, the sketch thread runs every chunk, so the time measures the parallel work there is, whoever runs it.
- After every 30 frames, the sketch thread reads the mean of that time per frame. At 0.2 ms or more, it asks the page for twice the job workers that it asked for before, and at least 2, up to the most: logical cores minus 2, or `?jobs=`.
- The on-demand loader's first task asks for 2 job workers, and runs on the second, so the first stays free for the frames. While every job worker that takes tasks has one, the next task asks for twice as many.
- A model with animation clips asks for 2 job workers before the core queues the clips. The core resamples each clip as a task between frames, which only a job worker runs. Before this rule, a model with clips never finished loading in a scene that had started no job worker.
- Job workers never stop before the engine stops. A scene whose work falls keeps the ones it started.
- `engine.mode.jobWorkers` gives the most job workers. The frame figures and the stats overlay count only the job workers that the engine has started.

## Cost

Measured on 10 October 2026 on the same Mac, Chrome 155, production builds of main (2f54175) and of this change.

**Start-up.** A test page ran a busy scene: 64,000 boxes in 16 turning groups, made over the first four frames. The engine test's busy sketch now moves the rows of an instance batch instead, which hands out parallel work in every frame on both GPU paths. It measured the frames in windows of 0.25 s for 6 s from the engine's start. Three runs of each build on WebGPU and one on WebGL2, at a load of 2.7 to 6.1:

| Window from the start | Main, mean CPU ms per frame | This change | Job workers running, this change |
| --- | --- | --- | --- |
| 0 to 0.25 s, WebGPU | 1.57 to 1.64 | 1.90 to 1.99 | 0 to 2 |
| 0.25 to 0.5 s, WebGPU | 0.38 to 0.39 | 0.43 to 0.45 | 2 to 4 |
| 0.5 to 0.75 s, WebGPU | 0.38 to 0.39 | 0.38 | 4 to 8 |
| last 3 s, WebGPU | 0.363 to 0.365 | 0.352 to 0.373 | 16 |
| 0 to 0.25 s, WebGL2 | 1.88 | 2.13 | 0 |
| 0.25 to 0.5 s, WebGL2 | 0.45 | 0.53 | 2 |
| last 3 s, WebGL2 | 0.717 | 0.600 | 16 |

- The first quarter second is about 0.3 ms per frame slower, and the next one about 0.06 ms. From half a second on, the frames take as long as on main. All 16 job workers ran 0.75 to 1 s after the start.
- No frame was dropped for it: both builds drew 26 or 27 frames in the first window, and 29 or 30 in each later one, at 120 Hz. The 95th percentile of the first window was 9.6 to 10.1 ms in both, from the scene's first frames.

**Running scenes.** `bun run bench:run --compare` ran main against this change, 10 s measured per run:

| Scene | Page | Busiest thread, main | This change | Change | Noise | Job workers, this change |
| --- | --- | --- | --- | --- | --- | --- |
| S1, 100,000 boxes | WebGPU | 1.695 ms | 1.905 ms | +10.9% | 1.6% | 4 |
| S1 | WebGL2 | 1.770 ms | 2.080 ms | +6.3% | 7.9% | 16 |
| S2 | WebGPU | 0.205 ms | 0.170 ms | -16.2% | 1.7% | 2 to 4 |
| S2 | WebGL2 | 0.255 ms | 0.210 ms | -17.6% | 2.1% | 2 to 4 |
| S5 | WebGPU | 1.810 ms | 1.800 ms | -0.6% | 0.6% | 16 |
| S5 | WebGL2 | 0.985 ms | 0.960 ms | -2.5% | 1.3% | 16 |

- The comparison flags only a slowdown larger than its rule and its noise. That run, of 3 rounds at a load of 7 to 14, flagged S1 on WebGPU. A second run of S1 alone, of 5 rounds, passed: +16.9% with a noise of 16.0% on WebGPU, and -3.4% on WebGL2. Its load rose from 7 to 33 during the run.
- The S1 difference is all in the sketch's update, the benchmark's own JavaScript loop that writes 100,000 poses. This change does not touch that code, and its time moved with the Mac's load: from 1.5 ms to 3.9 ms per frame in the same build. The engine's own work on the sketch thread was the same within noise: 0.190 and 0.195 ms in the first run.
- S2 runs 16 to 18% faster on its busiest thread, with 2 to 4 job workers to wake each frame in place of 16.
- The GPU time did not change in any scene.

## Open

- After this change, a small scene still takes 15 to 30 MiB more than three.js. Most of it is the two other threads: each has its own isolate, its own copy of the engine's script source, and the render worker its own GPU client. The engine's WebAssembly memory adds about 5 MiB, and the frame figures' shared buffer 1.9 MiB, with room for every job worker that may start. The study's notes list the next steps.
- `?jobs=` now sets the most job workers, so a sweep of counts measures a count only in a scene whose parallel work starts that many. S1 with 100,000 boxes on WebGPU may start fewer than 16. A sweep switch that starts its count at once would make the sweep exact again.
