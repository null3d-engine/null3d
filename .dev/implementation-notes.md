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
- Keep numbers that change every frame in typed arrays, not in an object's properties. Playwright's headless Chromium 153, which CI tests with, makes a new object for each fraction stored in a property, while Chrome 154 does not. Six such stores in the camera controls' update made 144 bytes of garbage a frame there. The controls keep those numbers in one `Float64Array`.
- Pass fractions to a per-frame helper in a typed array, not as arguments. A call that the browser does not inline puts each fraction it passes in an object of its own.
- The allocation checks of the math helpers and the camera controls sample a loop in a test page (`tests/lib/allocations.ts`). Give such a loop fractions, as real input has: whole numbers never allocate, so they hide these faults.

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
- The page and the sketch worker start that import while the core downloads, as "Start order" says. It once started after the core, because an earlier start slowed the core's download and delayed the first frame by 22 to 37 ms. Now that the other downloads start early too, the renderer is the last download to arrive unless it starts early.
- The page loads the sketch runner and the scene API (`sketch/runner.ts`) with a dynamic import, only in single-threaded mode, where it runs the sketch itself. Other page modules import only types from them.
- The page starts that import as soon as it knows the mode, while the core downloads, because it needs the runner right after the core. In `bun run bench:startup --switches threads=off`, the first frame came at a median of 4,131 ms over 14 runs. With the runner in the page's file, it came at 4,131 ms too. A start after the core's download gave 4,135 ms.
- In single-threaded mode the page imports the sketch module while the core downloads too. The module's top-level code runs when the module arrives. Hold mode imports it after the sketch runner has seeded the thread's random numbers, so that code draws the same numbers on every run.
- Keep `loadSketch` in `sketch/define-sketch.ts`, where the page imports it. That import keeps `defineSketch` in the page's file, which the sketch worker finds in the browser's cache. In a file of its own, `defineSketch` costs the sketch worker one more request before the sketch runs. On Slow 4G, that request adds a round trip of 562 ms.
- Only the page imports the error fixes (`errors/fixes.ts`). It sets them in `createEngine` and sends them to each worker in its handoff, and `startWorkerCore` sets them in the worker before the core starts. A worker module that imports the fixes adds their text to its file.
- `errors/codes.ts` holds each code's docs text for the docs generator and the tests. Runtime code must not import it: a value import bundles every code's docs text into the engine's files.
- The page hands the key names (`shared/key-codes.ts`) to the sketch worker when it starts it, as it does the error fixes. The sketch worker's file then holds no copy of the list.
- The input ring's record format is plain constants, not enums. The bundler writes a constant into the code as a number, while a TypeScript enum ships as an object that holds each member's name. A `const enum` ships the same object.

## Start order

The page starts every download that the start needs while the core downloads. On Slow 4G each download that waits for the core adds a round trip of at least 562 ms.

- With worker threads the page starts the sketch worker, the render worker and the job workers before it probes the GPU paths. Each worker imports the core's loader as soon as it runs (`startWorker` in `workers/protocol.ts`). It then waits for its start message, which carries the core.
- The page fetches the sketch module into the HTTP cache (`prefetch` in `page/engine.ts`). The sketch worker imports it only after it has started the core, so the module's code runs no earlier than before. When the host serves build files as immutable, as the startup server does, the worker's import makes no request.
- In low-latency mode the page sends the sketch worker `load-renderer` as soon as it starts it, so the worker loads the renderer at once.
- Where the page draws, it imports the renderer while the core downloads. In single-threaded mode it imports the core's loader then too. Each of the two was the last download to arrive once the other started early.
- The page starts the render worker before the probe says whether a worker can draw. When one cannot, the page stops the render worker and draws itself.
- A start that fails before the workers have the core stops them at once, because none waits in the job system yet. After that, a stop waits until each job worker leaves the job system. So the page sends the job workers the core before anything else that can fail, such as the canvas's transfer.
- The core now arrives last on Slow 4G. Its download shares the link with the workers' scripts. In the pipelined mode it is ready about 300 ms later than before, and the engine about 10 ms after it. In low-latency mode the engine is ready about 270 ms after the core. There the sketch worker asks for the renderer only once its own script has arrived.

`bun run bench:startup --modes all --loads cold,warm --network slow-4g,full` in Chrome 154 on a MacBook Pro, 30 September 2026. The old and new code ran in turns while other work loaded the machine. The table gives the first frame of a cold load on Slow 4G, in ms. Each value is a median of 15 loads of the old code or 10 of the new.

| Thread mode | Start after the core | Start with the core |
| --- | --- | --- |
| Pipelined | 4,183 | 2,674 |
| Low latency | 4,169 | 2,752 |
| Single-threaded, with the sketch module early | 3,166 | 2,607 |
| Drawing on the main thread | 4,298 | 2,661 |

Warm loads and loads at full speed stayed within the spread between runs. The first row of the single-threaded mode already downloaded the sketch module with the core. Before that, the first frame came at 3,580 ms. In single-threaded mode, starting only the renderer early gave 3,194 ms, because the core's loader was then last. Starting both gave 2,624 ms.

## Textures on both GPU paths

- WebGL2 keeps GL's row order in everything a render pass draws: row 0 is the bottom row, and on WebGPU it is the top row. Uploaded and written texels keep their order on both paths.
- Draw lists give viewport and scissor rectangles from the top-left corner. The WebGL2 backend flips them, so each covers the same part of the image on both paths.
- A shader that samples a target that a pass drew flips its v coordinate in its WebGL2 variant. The texture test shader (`test_textures.wgsl`) shows the pattern.
- Writes and uploads land when the GPU queue gets them. On WebGPU that is before the commands recorded since the last submit. A draw list therefore writes a resource before any command in the same submit that uses it. The mock backend rejects a write after such a use.

## Texture uploads

- The texture store (`crates/null3d-render/src/textures.rs`) keeps every texture in a layer of a 2D array of its size, format and mip count. A frame's texture work comes before its passes. Arrays are made or grown first, then a submit follows when an array grew. Releases, uploads and mip levels come after it. A grown array's copies must land before the uploads, and WebGPU would run the uploads first within one submit.
- A capture replays the frame's list a second time. So a list never releases what it uses itself. The next frame's list releases images and outgrown array textures. A release of an image that the backend no longer holds does nothing. The store's tests replay every list twice.
- The engine core gives each image an id in the order the sketch thread sends them. The thread that draws counts the images it received in the control block (`Slot.ImagesArrived`), so every id up to the count arrived. One `MessagePort` carries them, so they arrive in order. Where one thread runs the sketch and draws, the images go straight into its table.
- The image table lives outside the renderer, so a new GPU device uploads the images that the thread still holds. The store learns which were released from the frames that the thread took.
- Hold mode draws one frame, which records as after a GPU loss. The sketch thread waits for every image to arrive first, and that frame uploads them all, whatever the budget.
- Both backends draw each mip level of one layer with the mip shader (`mipmap.wgsl`), which samples the level before. On WebGPU the shader reads that level through a view of every layer, as compatibility mode binds whole arrays only. On WebGL2 the texture's base and highest levels are that level while the shader draws. The draw then reads no level that it writes.
- WebGL2 has two shorter ways to make mip levels, and neither works here. `generateMipmap` on a 2D array texture remakes the levels of every layer. Each upload would then cost the whole array. In Firefox on macOS, a blit from one level to the next averages the stored bytes of sRGB texels, not their linear values. The levels then come out too dark.
- An upload of a band of rows reads the image from a row inside it: `copyExternalImageToTexture` takes an origin, and WebGL2 applies `UNPACK_SKIP_PIXELS` and `UNPACK_SKIP_ROWS` to image bitmaps.
- The sketch thread reads the texture constants from the core's generated module, not the GPU layer's. A value import of the GPU layer's constants would put them in a file of their own, which the size report refuses.

## The shader compiler

The shader compiler is the shader crate built as a WebAssembly module. Build tools such as the Vite plugin load it in Node or Bun, so pages never download a shader translator. The crate `null3d-shaders-wasm` builds it, and the wrapper in `packages/vite-plugin/src/shader-compiler.ts` loads it and gives its API.

- The module imports nothing. It takes and gives JSON through its memory, so it needs no wasm-bindgen glue, and the wrapper can make a new instance at any time.
- It holds the engine's library modules. Its build script lists the files in `wgsl/lib`, so a new library module needs no other change.
- A panic stops a call with a trap. The panic hook writes a response first. The wrapper then drops the instance, because a trap can leave its memory in any state.
- The build drops the function names and skips wasm-opt. On this module, wasm-opt took longer than the whole build and saved 0.4% after Brotli, with no speed gain.
- The shader composer rewrites each file before naga reads it, and imported names get longer. Its own error reports count columns in that copy, so the build maps each place back to the original file.
- `bun run test:shader-compiler` runs the shader crate's build tests with `NULL3D_SHADER_COMPILER` set. Each build then runs again through the module in Bun, and both results must match. Plain `cargo test` skips that step, so a module built from older code cannot fail it. The same command runs the Vite plugin's WGSL tests, which build small projects with Vite.
- The Vite plugin compiles WGSL from projects (`packages/vite-plugin/src/wgsl.ts`). It reads a module's comments with Vite's parser, so the `/* wgsl */` tag counts only as a real comment before a real template literal. It runs before TypeScript becomes JavaScript, so the literal's place in the code is its place in the file.
- Each project shader builds for WebGPU and, with the shader def `WEBGL2`, for WebGL2. It has one render pipeline for each `@fragment` entry point, with its one `@vertex` entry point. The plugin finds the entry points in the WGSL text, because the compiler takes the pipelines with the source.
- Plugin errors count columns from 1, as editors do. Rollup counts its own from 0, but Vite and Rolldown only print the place, and Vite's overlay opens the editor at it.
- naga turns off its checks of uniform control flow for derivatives and `textureSample`, because they reject valid shaders. The build therefore cannot catch `textureSample` in a branch that differs between pixels, which Chrome rejects when it creates the shader module.

## Meshes on both GPU paths

- WebGL2 always reads the largest value of the index type as a primitive restart, because WebGL 2.0 keeps `PRIMITIVE_RESTART_FIXED_INDEX` on. A triangle that uses 16-bit index 65,535 draws nothing. Pages and mesh parts therefore hold at most 65,535 vertices on both paths.
- Each vertex attribute has a fixed shader location, and a pipeline reads only the attributes that its entry point declares. WebGPU needs a pipeline for each vertex format, since the format sets the stride and the offsets. On WebGL2 the vertex array holds that layout, so the pipelines of one template share one program.
- The culling shader counts each visible instance in every draw of its bucket, one draw per part of the bucket's mesh. The parts' draws then read the same slice of instances.

## Pipelines and warm-up

- A frame's draw list creates its pipelines before any other command. The renderer starts their builds the first time it prepares the frame, and replays the rest of the list later. The render crate's test world checks this order in every list it records.
- A list that creates a pipeline after other commands builds it at once. So a hand-written list, as on the replay test pages, draws everything in one replay.
- The first frame on a GPU device waits for its pipelines. Later frames draw at once, and a draw whose pipeline is still building draws nothing. So each frame loop asks the presenter whether a frame is ready before it takes the frame. The sketch thread computes no frame past it.
- Without `KHR_parallel_shader_compile`, a WebGL2 program never counts as building, and its first draw waits for its compile. The switch `?compile=wait` gives that path in a browser that has the extension.
- A warm-up in the setup records a frame itself, since no frame loop runs yet. So the renderer must exist before the setup: low-latency and single-threaded modes start it first.
- Sketch code that runs between frames, such as a message handler or the code after a warm-up, gets fresh views of engine memory first. The single-threaded build's memory detaches every view when it grows, which a frame may have done.

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
- Safari gives a shared memory back only after a full collection finds each object that refers to it unused. Its sweeper must then reach those objects. A refused memory runs a full collection but no sweep, so Safari's second try fails too. The sweeper then works in short slices, and each new collection starts it again.
- With `?render=main`, the page holds views of the engine's memory, so the memory also waits for the page's sweep. On CI's Mac that took seconds. Safari refused a start for more than 3 seconds, and 6 seconds after the last stop the room was still missing. The page reached none of the stopped engines' memories, and the room came back later. The engine kept nothing alive: Safari freed the memory late.
- The restart checks therefore wait before they judge. A start that Safari refuses waits and tries again, for 30 s in all on one page. After the last stop, the page counts the room again after longer and longer pauses until it comes back, for 31 s in all.
- Each count of the room ends with one more memory, which Safari refuses because the count filled the room. The collection that the refusal runs finds the counted memories unused, and Safari frees them before the next count. Without it, one count's memories took the room of the next count. That failed the single-threaded check, although that mode gives no worker a shared memory.
- A production build can load an engine module twice in one thread. The sketch worker's file holds one copy, and the page's file that a sketch imports holds another. Module state that the thread sets reaches one copy only, and each copy has its own classes. Keep state that every copy needs on `globalThis` under a `Symbol.for` key. For `instanceof`, mark a class's objects under such a key and check the mark in a static `Symbol.hasInstance`, as `errors/engine-error.ts` does.
- Safari runs a module worker's entry file again when another file imports it (WebKit bug 324459). Chrome and Firefox reuse the running module. A production build puts the code that a worker shares with its later files into the worker's own file. Those files then import it from there. In low-latency mode, the sketch worker loads the renderer's file, which imports the sketch worker's file.
- A second run of a worker's file replaced its message handler with one that had no state. The page's messages to the sketch then went nowhere. Each worker therefore starts through `startWorker` in `workers/protocol.ts`, which starts it on the first run only. Apart from that call, a worker's file must have no effect when it runs.

## Frames in flight

- When the GPU falls behind, every browser but Safari on WebGPU lets frames queue on it. On the GPU-bound page, Chrome and Brave slowed the drawing worker's frame callbacks to the GPU's pace, yet kept 5 to 8 frames queued. Safari's WebGL2 path kept about 4. Firefox kept presenting at the display's rate and queued up to 89 frames, seconds of input lag. [D-11](decisions/D-11-frames-in-flight.md) has the figures.
- So the completion tracker (`gpu/completion.ts`) tracks every frame, and the thread that draws takes no new frame while two are unfinished (`Presenter.due` in `render/loop.ts`). In the render worker, the sketch worker then waits on the frame-taken counter, so the hold needs no message.
- Each tracked frame costs one browser object, the queue's promise or the fence, and two clock readings. `bun run bench:allocation` budgets them.
- The tracker learns of a WebGL2 fence only when it checks, at a frame callback. Frames that it finds finished together share the time since the last completion. Firefox can settle several WebGPU promises in one task, at one clock reading, which gives a frame an interval of 0. Such an interval still counts toward the completed rate.
- A frame whose completion never arrives stops counting as in flight after a second, so a lost signal slows the drawing without stopping it.
- Firefox settles WebGPU's `onSubmittedWorkDone` about a frame after the GPU finishes, so the limit holds back frames that are already done. That costs Firefox's WebGPU path frame rate when the GPU is busy. Its WebGL2 path loses none.
- Without the limit, Chrome's slower frame callbacks also slowed the refresh meter of the thread that draws. It read 36 Hz on a 144 Hz display. With the limit, the callbacks keep the display's rate, and so does the meter.
- Apple's GPUs work on two frames at once. A frame's GPU time from timestamps can then exceed the time between completed frames.

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
