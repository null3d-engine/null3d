# D-116: The stats overlay's memory, triangle and object figures

Status: decided, 2026-10-08. Date: 2026-10-08. Task: M2-EX2.

Summary: The page can now turn the stats overlay on, as the sketch could. The overlay adds GPU time, triangles, objects, memory and the page thread's load. Triangles and objects count every draw of every pass, as three.js's `renderer.info` counts triangles. On WebGPU the GPU-culled draws' counts come back from the GPU on one frame in eleven. The page memory counts the shared WebAssembly memory once. `@null3d/engine/stats` exports the layout, so a three.js page prints its figures the same way.

## Question

The examples and the three.js comparison pages need one overlay that any page can show. It must report memory, triangles and objects drawn, the page thread's load and GPU time. What does each figure count, and how does the engine get it at almost no cost while the overlay is hidden?

## Rule

- With the overlay hidden, a frame pays at most a few operations per draw call, and allocates nothing.
- Each figure means the same in null3D and in a three.js page, so the comparison pages compare like with like.
- A figure that the browser does not give shows `n/a`, never 0.
- The overlay's code stays within the 16 KB budget of a file that loads on first use ([D-14](D-14-js-budget.md)).

## Data

All runs are from 8 October 2026, in Chrome on the owner's Mac (Apple M5 Max), on the stats test page and on S1.

**How Chrome counts the shared memory.** `performance.measureUserAgentSpecificMemory` on the stats test page, threaded build, pipelined:

| GPU path | WebAssembly memory | Browser's figure | Parts that hold the memory | Counted once |
| --- | --- | --- | --- | --- |
| WebGPU, High | 22.1 MiB | 116.1 MiB | 3: the page 28.5, the sketch worker 32.3, the render worker 54.8 MiB | 71.8 MiB |
| WebGL2, Medium | 22.4 MiB | 99.0 MiB | 3: the page 28.8, the sketch worker 32.6, the render worker 37.2 MiB | 54.2 MiB |

The page's own JavaScript heap was 5.5 MiB, so the page's part is the shared memory plus its heap. The 16 job workers gave no part, and each measurement took 58 s, which is Chrome's time limit for workers that do not answer.

**What the engine's start downloads.** After Brotli, against main's build:

| File | Main | First build of this change | Final |
| --- | --- | --- | --- |
| `page.js` | 31,263 B | 31,767 B (+1.6%) | 31,394 B (+0.4%) |
| `page-renderer.js` | 32,091 B | 32,987 B (+2.8%) | 32,426 B (+1.0%) |
| `sketch-worker.js` | 45,641 B | | 45,907 B (+0.6%) |
| `sketch-worker-renderer.js` | 32,439 B | 33,279 B (+2.6%) | 32,732 B (+0.9%) |
| `render-worker.js` | 34,902 B | 35,794 B (+2.6%) | 35,235 B (+1.0%) |
| Pipelined start | 136.1 KB (97.2%) | 137.8 KB (98.4%) | 136.8 KB (97.7%) |

The first build kept the reader of the culled draws' counts in each renderer, and the page thread's windows and the page memory sampler in `page.js`. The final build loads the reader at the first frame that samples, about 1 KB in each thread that draws. The page's meters moved into the overlay's file, which grew from 882 B to 2,245 B.

**Allocation with the overlay shown.** `bun run bench:allocation --stats` on S1, bytes per frame of the render worker in the sample where each place allocated least:

| Place | WebGPU, 100,000 instances | WebGPU, 20,000 instances | Budget |
| --- | --- | --- | --- |
| GPU timer: `copyOut` | 14.2 | 12.1 | 24 more |
| GPU timer: `read` | 10.5 | 12.2 | 16 more |
| GPU timer: `afterSubmit` | 8.9 | 11.7 | 16 more |
| Culled counts: `afterSubmit` | 12.2 | 12.7 | 16 more |
| Culled counts: `read` | 5.9 | 5.2 | 12 more |
| Culled counts: the view of the mapped range | 3.5 | 4.8 | 8 more |

The GPU timer's places are the timer's own, which only showed once the check could run with sampling on. Its first run found an array and an iterator for each pass that the timer read, and an array for each submit. The timer now reads the words one by one and submits through the shared list. What remains are objects that the browser returns: a command buffer, a promise and its reaction, and a view of each mapped range. Each mapped range is new memory, so no pool can keep these objects. They come once in eleven frames, and the culled counts make about half of what the timer makes. The smaller scene allocates no more per readback; it draws more frames a second. WebGL2 with the overlay shown allocated nothing more that the profiler saw, and both paths with the overlay hidden passed their old budgets.

**Browser tests.** The stats test passes on both GPU paths, in every thread mode and from the `?stats` switch: 14 of 14. It ran in Chrome on the Mac's GPU and in the production build. The demo interaction test passes with the overlay on the demos: 2 of 2.

## Decision

1. **Turning it on.** `createEngine({ stats: true })`, `engine.stats(show)` and the `?stats` switch show the overlay from the page. The sketch's `debug.stats` shows the same overlay, and the last call from either side wins. Each sketch call reaches the page, which may have changed the overlay since. Production builds read the switch only with the Vite plugin's `urlSwitches`, as they read every switch. A held engine shows no overlay, since it presents no frames.
2. **Sampling.** The overlay, a measurement and the sketch's first `debug.frameStats()` each turn on sampling, and the engine samples while any of them wants it. Sampling times one frame in eleven on the GPU, with the measurement's timer code. The overlay and the sketch's figures also want what only they show, and a second count in the header says so. On WebGPU the engine then reads back the counts of the culled draws on the timed frames. The code that reads them back loads at the first frame with such a reader, so a page that only measures never downloads it. The sketch thread also publishes the memory of textures and meshes in the header every eighth frame. Without sampling, none of this runs.
3. **Triangles and objects.** The thread that draws counts every draw of every pass: shadow maps, the depth prepass, the passes that shade and post effects. A draw of triangles adds its vertices or indices over 3, times its instances. A draw of lines adds none. Each draw adds its instances to the objects. three.js's `renderer.info.update` counts triangles the same way, per draw call, shadow maps included, so the figures compare. A three.js page gets the same object count by adding each call's instance count.
4. **Counts on WebGPU's GPU-culled path.** The culling shaders write the instance count of each indirect draw on the GPU, so the CPU never sees it. Two counts were possible:
   - The submitted count: every source in the buckets, before culling. It is known on the CPU, but it measures the scene, not what the GPU drew, and differs from WebGL2's count of the same scene.
   - The drawn count: the instance counts that the culling wrote. Only the GPU knows them.

   The engine reads the drawn count back, because only it matches WebGL2 and three.js. On a sampled frame, the backend notes each indirect draw that it replays. At the frame's end it copies the noted draws' arguments into a mappable buffer, with one copy for each buffer of draws. It sums them once the buffer maps. Each frame adds the newest sums to its own direct counts. Every indirect buffer gains `COPY_SRC` usage for these copies, which WebKit's argument copies already needed. Until the first counts come back, a counter in each frame's record marks its triangles and objects as not known. The window's means leave such frames out. Without that, the first window after the overlay shows counted only the direct draws. In CI's SwiftShader it gave 11.8 triangles per frame for the stats page's box of 12.
5. **Memory.** The overlay shows the WebAssembly memory's size and the GPU bytes of textures and meshes. It also shows the page thread's JavaScript heap from `performance.memory`, and the whole page from `performance.measureUserAgentSpecificMemory`. Chromium adds a shared memory to the figure of each thread that holds it. So the browser's figure counts the engine's memory once per engine thread that answered. The overlay counts it once: it subtracts the memory's size for each holder past the first. A holder is a part of the breakdown at least as large as the shared memory, since no thread's own heap comes near it. The overlay also shows the browser's own figure. The measurement waits for every worker to run it, or about a minute. Job workers never return to their event loop, so in the threaded build each measurement takes about a minute.
6. **The page's own thread.** The overlay shows the last 5 seconds' long tasks and longest input delay. A long task takes 50 ms or more. `MainThreadWindow` observes them in windows, and `@null3d/engine/stats` exports it for other engines' pages.
7. **Figures only the page has.** The JavaScript heap, the page memory and the main thread's figures stay on the overlay and out of `debug.frameStats()`. A worker cannot measure them.
8. **The shared layout.** `@null3d/engine/stats` exports `statsText`, the figure types, `MainThreadWindow`, `PageMemorySampler` and `pageHeapBytes`, with the percentile helpers. The package now builds the module, so a page outside the repository can import it.

9. **The start's cost.** The start holds only what runs each frame: the per-draw counts and the memory figures' writes. The overlay's own file holds the page's meters. The reader of the culled draws' counts loads on first use. A measurement with `engine.measure` keeps its own small meters of the page thread and the page memory in the start. They repeat about 20 lines of the overlay's meters. That costs less than moving the meters into the start. The overlay's file loads none of the page's modules that the start holds. When it did, Vite's build split shared modules out of `page.js` into files of their own.

## Consequences

- `FrameStats` gains `gpuMs`, `triangles`, `objects`, `wasmBytes` and `meshBytes`. The overlay on the page now shows the real texture bytes, where it read 0 before.
- Each frame record has three more counters, `Triangles`, `DrawnObjects` and `UncountedFigures`. The metrics header has four memory figures and a count of the readers of the frame figures.
- The stats test page turns the overlay on from the page, through the option and the switch. Its checks need non-zero triangles, objects and memory on both GPU paths, and GPU time where the path has a timer.
- The examples' `startDemo` shows the overlay by default, and takes `stats: false` to leave it off.
- `bun run bench:allocation --stats` checks the allocation with the overlay shown.
- `docs/api/debug.md`, `docs/api/engine.md`, the performance and debugging guides, the three.js mapping and the skills describe the figures.
