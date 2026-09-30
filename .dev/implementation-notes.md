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
- Shrink a reused list with `pop`, never by setting its length to 0. In Chrome, a length of 0 frees the list's storage, and the next `push` allocates it again. The sketch's list of touches works this way.

## Allocation in Rust

- Rust tests that count allocations use `null3d_core::testing::CountingAllocator`, from the core crate's `testing` feature. It counts only the threads a test marks, so the test runner's own threads cannot reach the count.
- The frame recorder sizes a frame's upload arena for the most that any frame can copy for the scene as it stands. It keeps its layout tables and scratch space between rebuilds. Only the frames right after the scene grows allocate.
- Pipelined frames keep one arena per frame parity, so the allocation tests change the structure on both parities after warm-up.
- A thread can run any number of a parallel loop's chunks, from none to all of them. The calling thread runs every chunk that no job worker claims, for example while the workers wake. Storage that one thread fills across chunks therefore needs room for the whole loop. Give each thread's list in the parallel draw-list recorder room for a whole recording. Tests reach this case with a job system whose workers never start.
- Take frame scratch from `ArenaPool`. A thread whose arena is full continues in the other arenas, so the pool holds a frame however its chunks fall. Size the pool with `ArenaPool::new`, from the frame's total and its largest allocation, which `FrameArena::bytes_for` counts.

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
- The page hands the key names (`shared/key-codes.ts`) to the sketch worker when it starts it, as it does the error fixes. The sketch worker's file then holds no copy of the list.
- The input ring's record format is plain constants, not enums. The bundler writes a constant into the code as a number, while a TypeScript enum ships as an object that holds each member's name. A `const enum` ships the same object.

## Textures on both GPU paths

- WebGL2 keeps GL's row order in everything a render pass draws: row 0 is the bottom row, and on WebGPU it is the top row. Uploaded and written texels keep their order on both paths.
- Draw lists give viewport and scissor rectangles from the top-left corner. The WebGL2 backend flips them, so each covers the same part of the image on both paths.
- A shader that samples a target that a pass drew flips its v coordinate in its WebGL2 variant. The texture test shader (`test_textures.wgsl`) shows the pattern.
- Writes and uploads land when the GPU queue gets them. On WebGPU that is before the commands recorded since the last submit. A draw list therefore writes a resource before any command in the same submit that uses it. The mock backend rejects a write after such a use.

## The shader compiler

The shader compiler is the shader crate built as a WebAssembly module. Build tools such as the Vite plugin load it in Node or Bun, so pages never download a shader translator. The crate `null3d-shaders-wasm` builds it, and the wrapper in `packages/vite-plugin/src/shader-compiler.ts` loads it and gives its API.

- The module imports nothing. It takes and gives JSON through its memory, so it needs no wasm-bindgen glue, and the wrapper can make a new instance at any time.
- It holds the engine's library modules. Its build script lists the files in `wgsl/lib`, so a new library module needs no other change.
- A panic stops a call with a trap. The panic hook writes a response first. The wrapper then drops the instance, because a trap can leave its memory in any state.
- The build drops the function names and skips wasm-opt. On this module, wasm-opt took longer than the whole build and saved 0.4% after Brotli, with no speed gain.
- The shader composer rewrites each file before naga reads it, and imported names get longer. Its own error reports count columns in that copy, so the build maps each place back to the original file.
- `bun run test:shader-compiler` runs the shader crate's build tests with `NULL3D_SHADER_COMPILER` set. Each build then runs again through the module in Bun, and both results must match. Plain `cargo test` skips that step, so a module built from older code cannot fail it.

## Meshes on both GPU paths

- WebGL2 always reads the largest value of the index type as a primitive restart, because WebGL 2.0 keeps `PRIMITIVE_RESTART_FIXED_INDEX` on. A triangle that uses 16-bit index 65,535 draws nothing. Pages and mesh parts therefore hold at most 65,535 vertices on both paths.
- Each vertex attribute has a fixed shader location, and a pipeline reads only the attributes that its entry point declares. WebGPU needs a pipeline for each vertex format, since the format sets the stride and the offsets. On WebGL2 the vertex array holds that layout, so the pipelines of one template share one program.
- The culling shader counts each visible instance in every draw of its bucket, one draw per part of the bucket's mesh. The parts' draws then read the same slice of instances.

## Depth on WebGL2

- Draw lists and shaders keep WebGPU's reversed depth. Each GLSL vertex shader maps its clip depth through one uniform, and the WebGL2 backend sets it once per program for its depth mode (`gpu/webgl2/depth.ts`). One set of GLSL programs then serves every mode.
- The `reversed` mode sets a clip range from 0 to w with `EXT_clip_control`. The `reversed-gl` mode moves depth into GL's range as 2z - w, where the vertex shader rounds far depths away. The `standard` mode writes w - 2z, and the backend turns clear values and viewport depth ranges around to match.
- Depth textures hold WebGPU's depth values in `reversed` and `reversed-gl`, so shaders that read depth work the same on both paths. In `standard`, they hold 1 minus WebGPU's value.
- A context that answers no `EXT_clip_control` draws `reversed` as `reversed-gl`, and never fails to start. A context lost while the backend starts answers no extension, and a failed start would end the engine's recovery from that loss.
- The depth precision page counts the fighting pixels of surfaces 1 cm apart from 1 m to 10 km. On the Mac, Chrome, Safari and Brave give the same counts, because all three draw WebGL2 through ANGLE on Metal.
- Firefox 156 on the Mac has no `EXT_clip_control`, so it draws `reversed-gl`. That fights in fewer pixels than `standard` there, as it does in every Mac browser.

## Threads and shared memory

- A job worker without work blocks its thread in a wait (hard rule 5). When Safari stops a thread inside such a wait, it keeps the thread's shared memory until the tab closes, even across reloads. The engine therefore ends the job workers' loops before it stops them, and `destroy()` resolves once they have stopped.
- The single-threaded build's core runs on the page. The page keeps it for the next engine, and `destroyEngine` empties it when an engine stops.
- Safari reserves each shared memory's whole maximum in one address range, which the page and its workers share. It also counts the memories' pages against a budget. A stopped engine's memory counts until the engine's workers have finished, which Safari does a moment after `destroy()`. On a slow machine the next engine can ask for its memory before that. Safari tries one collection and then refuses with "Out of memory", as the restart checks saw in CI. So `createSharedMemory` in `page/loader.ts` waits and tries again, for about 3 seconds in all, before it fails with E1109.
- A production build can load an engine module twice in one thread. The sketch worker's file holds one copy, and the page's file that a sketch imports holds another. Module state that the thread sets reaches one copy only, and each copy has its own classes. Keep state that every copy needs on `globalThis` under a `Symbol.for` key. For `instanceof`, mark a class's objects under such a key and check the mark in a static `Symbol.hasInstance`, as `errors/engine-error.ts` does.
- Safari runs a module worker's entry file again when another file imports it (WebKit bug 324459). Chrome and Firefox reuse the running module. A production build puts the code that a worker shares with its later files into the worker's own file. Those files then import it from there. In low-latency mode, the sketch worker loads the renderer's file, which imports the sketch worker's file.
- A second run of a worker's file replaced its message handler with one that had no state. The page's messages to the sketch then went nowhere. Each worker therefore starts through `startWorker` in `workers/protocol.ts`, which starts it on the first run only. Apart from that call, a worker's file must have no effect when it runs.

## Browser faults

- Safari 26 drops a whole submit if its commands hold two or more copies from one buffer that was mapped when they were recorded. WebGPU allows that, and Chrome and Firefox accept it. The staging ring therefore records a frame's copies after it unmaps the buffer, just before the frame's next command.
- The uploads test page reports each frame's WebGPU errors, which show such a failure.
- SwiftShader, the software GPU of the CI machines, loses depth precision past 100 m even in reversed depth from 0 to 1. The depth precision scene fights there at 250 m, 4 km and 10 km, on WebGPU too. The image tests therefore expect no fighting in reversed depth only on a real GPU.
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
- So the frame loops set a timer at the start of each callback in a worker, due 4 ms before the next callback. The worker then sleeps too briefly for Safari's timer to fire late. In S1-static at 240,000 boxes on a busy Mac, Safari presented 62.5 frames per second with it and 54.4 without. On a quiet Mac, the timer fired less late, and Safari presented 59.4 to 60 without it.
- Safari's worker timer then calls the worker about 64 times a second, more often than a 60 Hz display shows frames. On the iPad, the worker drew 61 frames per second, and on the Mac 64.7, so some frames were never shown.
- So the page measures the display's refresh period from its own frame callbacks, which follow the display in every browser. It writes the period to the control block. A worker whose callbacks come at a rate that matches no display's holds its frames to that period. Chrome's worker callbacks follow the display, so Chrome draws as before, even when a busy page thread measures a slower rate.
- With the hold, Safari on the Mac's built-in screen presented 60.0 frames per second in 4 of 4 runs. Safari runs the page's frame callbacks at 60 Hz on that 120 Hz screen, and at 72 Hz on a 144 Hz screen. On the 144 Hz screen, the worker's 64.6 frames per second stay below the page's rate, so the hold skips no callback there.
- Safari writes no timestamps, or stale ones, for a pass without work. The GPU timer's start mark therefore dispatches one invocation that does nothing.
