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

## The shader compiler

The shader compiler is the shader crate built as a WebAssembly module. Build tools such as the Vite plugin load it in Node or Bun, so pages never download a shader translator. The crate `null3d-shaders-wasm` builds it, and the wrapper in `packages/vite-plugin/src/shader-compiler.ts` loads it and gives its API.

- The module imports nothing. It takes and gives JSON through its memory, so it needs no wasm-bindgen glue, and the wrapper can make a new instance at any time.
- It holds the engine's library modules. Its build script lists the files in `wgsl/lib`, so a new library module needs no other change.
- A panic stops a call with a trap. The panic hook writes a response first. The wrapper then drops the instance, because a trap can leave its memory in any state.
- The build drops the function names and skips wasm-opt. On this module, wasm-opt took longer than the whole build and saved 0.4% after Brotli, with no speed gain.
- The shader composer rewrites each file before naga reads it, and imported names get longer. Its own error reports count columns in that copy, so the build maps each place back to the original file.
- `bun run test:shader-compiler` runs the shader crate's build tests with `NULL3D_SHADER_COMPILER` set. Each build then runs again through the module in Bun, and both results must match. Plain `cargo test` skips that step, so a module built from older code cannot fail it.

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
- Work around a browser's fault with an order or a call that is valid everywhere, as the staging ring does. Where browsers differ in speed, time the choices on the device, as the upload routes do. When neither works, detect the fault with a feature test, never from the user agent (hard rule 14).
