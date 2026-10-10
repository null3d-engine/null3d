# D-126: Start the job workers as the work grows

Status: decided, owner task, 10 October 2026. Task: memory parity study.

Summary: The engine starts no job workers at first. The sketch thread times the parallel loops that it hands out, and asks for 2 job workers once those loops take 0.2 ms or more per frame over 30 frames, then for twice as many after each such window, up to the most that [D-07](D-07-job-workers.md) sets. Started job workers stay. The render worker no longer runs a copy of the core. On an 18-core Mac, S1 with 1,000 boxes fell from 128 MiB to 77 MiB of real memory, against 40 to 48 MiB for its three.js twin. Scenes with enough parallel work start every job worker, as before.

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
- The S1 scene with 1,000 boxes never asked for a job worker. With 100,000 boxes, and in S6, the engine started all 16, and the real memory was the same as before (166 MiB and 171 MiB in one run).

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
- Job workers never stop before the engine stops. A scene whose work falls keeps the ones it started.
- `engine.mode.jobWorkers` gives the most job workers. The frame figures and the stats overlay count only the job workers that the engine has started.

## Cost

To be measured: how many frames a scene that needs job workers runs before they start, and whether any frame is slower than before.

## Open

- After this change, a small scene still takes 15 to 30 MiB more than three.js. Most of it is the two other threads: each has its own isolate, its own copy of the engine's script source, and the render worker its own GPU client. The engine's WebAssembly memory adds about 5 MiB, and the frame figures' shared buffer 1.9 MiB, with room for every job worker that may start. The study's notes list the next steps.
