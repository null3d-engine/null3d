# Implementation notes

This guide holds lessons from building the engine: habits that keep the hot paths fast, and the browser faults that shaped the code. [AGENTS.md](../AGENTS.md) holds the hard rules that these notes serve.

## Hot paths without allocation

The engine's hot paths stay allocation-free with these habits (hard rule 1):

- Read typed arrays by index rather than by destructuring.
- Reuse WebGPU descriptors (`RenderPassSetup` and `submitOne` in `packages/engine/src/gpu/webgpu/reusable.ts`).
- Pass typed arrays straight to WebGPU, as `setBindGroup` reads dynamic offsets from the draw list.
- Keep reused lists at a fixed length.
- Do not wrap browser promises in `async` functions, and use `Math.sqrt` rather than `Math.hypot`.
- Keep closures out of functions that run every frame, even in a branch that rarely runs. Until the browser optimizes such a function, it allocates the variables a closure captures on every call.

## Allocation in Rust

- Rust tests that count allocations use `null3d_core::testing::CountingAllocator`, from the core crate's `testing` feature. It counts only the threads a test marks, so the test runner's own threads cannot reach the count.
- The frame recorder sizes a frame's upload arena for the most that any frame can copy for the scene as it stands. It keeps its layout tables and scratch space between rebuilds. Only the frames right after the scene grows allocate.
- Pipelined frames keep one arena per frame parity, so the allocation tests change the structure on both parities after warm-up.

## Uploads

- Uploads from 64 KiB to 4 MiB take the route that the render worker measures as faster on the device: `queue.writeBuffer` or the staging ring.
- In Chrome on a Mac the ring is 3 to 6 times faster in that range, as `writeBuffer` takes up to 0.8 ms per MB. In Safari `writeBuffer` wins at every size, because unmapping a staging buffer costs time in proportion to its size. Outside that range `writeBuffer` wins in every browser measured.

## Download size

- The page and the sketch worker load the renderer and the GPU layer (`render/draw.ts`) with a dynamic import, only in the modes where they draw. A pipelined page then downloads the GPU layer once, in the render worker.
- In their other modules, import only types from the renderer and the GPU layer: a value import bundles the GPU layer into their files again.
- The sketch worker starts the import with its other startup work. The page starts it once the core has downloaded. An earlier start slowed the core's download on Slow 4G and delayed the first frame by 22 to 37 ms.
- The page loads the sketch runner and the scene API (`sketch/runner.ts`) with a dynamic import, only in single-threaded mode, where it runs the sketch itself. Other page modules import only types from them.
- The page starts that import as soon as it knows the mode, while the core downloads, because it needs the runner right after the core. In `bun run bench:startup --switches threads=off`, the first frame came at a median of 4,131 ms over 14 runs. With the runner in the page's file, it came at 4,131 ms too. A start after the core's download gave 4,135 ms.
- Keep `loadSketch` in `sketch/define-sketch.ts`, where the page imports it. That import keeps `defineSketch` in the page's file, which the sketch worker finds in the browser's cache. In a file of its own, `defineSketch` costs the sketch worker one more request before the sketch runs. On Slow 4G, that request adds a round trip of 562 ms.
- Only the page imports the error fixes (`errors/fixes.ts`). It sets them in `createEngine` and sends them to each worker in its handoff, and `startWorkerCore` sets them in the worker before the core starts. A worker module that imports the fixes adds their text to its file.
- `errors/codes.ts` holds each code's docs text for the docs generator and the tests. Runtime code must not import it: a value import bundles every code's docs text into the engine's files.

## Textures on both GPU paths

- WebGL2 keeps GL's row order in everything a render pass draws: row 0 is the bottom row, and on WebGPU it is the top row. Uploaded and written texels keep their order on both paths.
- Draw lists give viewport and scissor rectangles from the top-left corner. The WebGL2 backend flips them, so each covers the same part of the image on both paths.
- A shader that samples a target that a pass drew flips its v coordinate in its WebGL2 variant. The texture test shader (`test_textures.wgsl`) shows the pattern.
- Writes and uploads land when the GPU queue gets them. On WebGPU that is before the commands recorded since the last submit. A draw list therefore writes a resource before any command in the same submit that uses it. The mock backend rejects a write after such a use.

## Threads and shared memory

- A job worker without work blocks its thread in a wait (hard rule 5). When Safari stops a thread inside such a wait, it keeps the thread's shared memory until the tab closes, even across reloads. The engine therefore ends the job workers' loops before it stops them, and `destroy()` resolves once they have stopped.
- The single-threaded build's core runs on the page. The page keeps it for the next engine, and `destroyEngine` empties it when an engine stops.

## Browser faults

- Safari 26 drops a whole submit if its commands hold two or more copies from one buffer that was mapped when they were recorded. WebGPU allows that, and Chrome and Firefox accept it. The staging ring therefore records a frame's copies after it unmaps the buffer, just before the frame's next command.
- The uploads test page reports each frame's WebGPU errors, which show such a failure.
- Work around a browser's fault with an order or a call that is valid everywhere, as the staging ring does. Where browsers differ in speed, time the choices on the device, as the upload routes do. When neither works, detect the fault with a feature test, never from the user agent (hard rule 14).

## Safari's frame path

Safari 26 does work for each WebGPU frame that no GPU timestamp covers. It shows only in `gpuLatencyMs` and in the frame rate. [Benchmarks](benchmarks.md#safaris-own-work) says how to see it.

- Safari 26 encodes a render bundle that holds an indirect draw again at every `executeBundles`. Each time, it also builds a Metal indirect command buffer of 16,384 commands, because a command count wraps below zero.
- On an M5 Max, that took Safari's GPU process 9.6 ms of CPU per frame, in S1-static and in S2 alike. WebKit fixed it in August 2026, and Safari 27.2's beta notes list the fix.
- So the WebGPU backend makes no native render bundles. It keeps each bundle's recorded commands and replays them into the render pass. In Chrome, S2's 100 draws added about 15 microseconds to the render worker's frame.
- A worker's WebGPU canvas reaches the page through two synchronous calls after each frame callback. The second copies the frame into the page's canvas, and it first waits for the GPU to finish the frame.
- So the worker stays blocked until Safari's GPU process has run all the frame's commands and the GPU has drawn the frame. Safari's own work, the GPU time and the copy add up to the worker's frame.
- `gpuLatencyMs` counts from the submit until the drawing thread sees the frame finish, so in Safari it includes that blocked time. With native bundles on the Mac, most of its 11 ms was Safari's command buffer build.
- Safari runs a worker's `requestAnimationFrame` from a 15 ms timer, not from the display. After the worker sleeps through most of a frame, the timer fires about 3 ms late.
- Safari writes no timestamps, or stale ones, for a pass without work. The GPU timer's start mark therefore dispatches one invocation that does nothing.
