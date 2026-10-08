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

The browser runs that give the figures for this record have not run yet.

## Decision

1. **Turning it on.** `createEngine({ stats: true })`, `engine.stats(show)` and the `?stats` switch show the overlay from the page. The sketch's `debug.stats` shows the same overlay, and the last call wins. Production builds read the switch only with the Vite plugin's `urlSwitches`, as they read every switch. A held engine shows no overlay, since it presents no frames.
2. **Sampling.** The overlay, a measurement and the sketch's first `debug.frameStats()` each turn on sampling, and the engine samples while any of them wants it. Sampling times one frame in eleven on the GPU, with the measurement's timer code. On WebGPU it also reads back the counts of the culled draws on those frames. The sketch thread then publishes the memory of textures and meshes in the metrics buffer's header every eighth frame. Without sampling, none of this runs.
3. **Triangles and objects.** The thread that draws counts every draw of every pass: shadow maps, the depth prepass, the passes that shade and post effects. A draw of triangles adds its vertices or indices over 3, times its instances. A draw of lines adds none. Each draw adds its instances to the objects. three.js's `renderer.info.update` counts triangles the same way, per draw call, shadow maps included, so the figures compare. A three.js page gets the same object count by adding each call's instance count.
4. **Counts on WebGPU's GPU-culled path.** The culling shaders write the instance count of each indirect draw on the GPU, so the CPU never sees it. Two counts were possible:
   - The submitted count: every source in the buckets, before culling. It is known on the CPU, but it measures the scene, not what the GPU drew, and differs from WebGL2's count of the same scene.
   - The drawn count: the instance counts that the culling wrote. Only the GPU knows them.

   The engine reads the drawn count back, because only it matches WebGL2 and three.js. On a sampled frame, the backend notes each indirect draw that it replays. At the frame's end it copies the noted draws' arguments into a mappable buffer, with one copy for each buffer of draws. It sums them once the buffer maps. Each frame adds the newest sums to its own direct counts. Every indirect buffer gains `COPY_SRC` usage for these copies, which WebKit's argument copies already needed.
5. **Memory.** The overlay shows the WebAssembly memory's size and the GPU bytes of textures and meshes. It also shows the page thread's JavaScript heap from `performance.memory`, and the whole page from `performance.measureUserAgentSpecificMemory`. Chromium adds a shared memory to the figure of each thread that holds it. So the browser's figure counts the engine's memory once per engine thread that answered. The overlay counts it once: it subtracts the memory's size for each holder past the first. A holder is a part of the breakdown at least as large as the shared memory, since no thread's own heap comes near it. The overlay also shows the browser's own figure. The measurement waits for every worker to run it, or about a minute. Job workers never return to their event loop, so in the threaded build each measurement takes about a minute.
6. **The page's own thread.** The overlay shows the last 5 seconds' long tasks and longest input delay. A long task takes 50 ms or more. `MainThreadWatch` observes them, as it did for `engine.measure`. `@null3d/engine/stats` exports it for other engines' pages.
7. **Figures only the page has.** The JavaScript heap, the page memory and the main thread's figures stay on the overlay and out of `debug.frameStats()`. A worker cannot measure them.
8. **The shared layout.** `@null3d/engine/stats` exports `statsText`, the figure types, `MainThreadWatch`, `PageMemorySampler` and `pageHeapBytes`, with the percentile helpers. The package now builds the module, so a page outside the repository can import it.

## Consequences

- `FrameStats` gains `gpuMs`, `triangles`, `objects`, `wasmBytes` and `meshBytes`. The overlay on the page now shows the real texture bytes, where it read 0 before.
- Each frame record has two more counters, `Triangles` and `DrawnObjects`, and the metrics header four memory figures.
- The stats test page turns the overlay on from the page, through the option and the switch. Its checks need non-zero triangles, objects and memory on both GPU paths, and GPU time where the path has a timer.
- `docs/api/debug.md`, `docs/api/engine.md`, the performance and debugging guides, the three.js mapping and the skills describe the figures.
