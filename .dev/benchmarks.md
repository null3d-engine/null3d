# Benchmarks

This guide covers how to run the benchmarks and read their numbers. [AGENTS.md](../AGENTS.md) lists the commands, and [Device sessions](devices.md) covers phones and tablets.

The benchmarks compare null3D with three.js in the same browser. These points come from the first checkpoint's measurements.

## What a report measures

- A report gives each engine's whole frame and its own work on the busiest thread. The desktop target uses own work, because both engines run the same scene code.
- null3D's own work comes from its phase timers: each thread's time less its `update` step. three.js's own work is its frame time less the scene code, timed alone on the scene-code page.
- The scene-code page's loop compiles to slower code than an engine's loop, so this estimate of three.js's own work is low.
- Compare results at the same display refresh rate. The engine measures it, and each result records it with the presented and finished frame rates and the GPU delay. Runs at 120 and at 144 frames per second differed by about 10% for both engines.
- The page switch `?fps=<n>` holds null3D's drawing at n frames per second, at most the display's rate. Use it to compare runs on displays of different rates. The three.js pages do not read it.
- On WebGL2, `measure` reports `visibleEntries`, the entries in each frame's list of visible objects, and the bench summary divides the upload by it. When only the camera moves, as in S1-static, the upload is about 4 bytes per entry.

## Hold frames

- A benchmark page with `?hold` draws one frame at the scene's hold time, 2 seconds, and publishes its pixels. `?hold=<seconds>` holds at another time.
- The image test manifest compares null3D's hold frames with their references. `bun run parity` and the device runner's parity plan compare them with three.js's frames. The benchmark page tests check that three.js's frames show the scene.
- The null3D pages start the engine in hold mode with that time. The engine steps the sketch from 0 to the time at 60 steps per second, then draws that one frame and reads it back. The sketches pose their scene at `time.now`, and hold no time of their own.
- The three.js pages pose their scene at the hold time and draw one frame into a render target, which they read back. The scenes are functions of time, so both engines draw the same moment.
- Before it draws, a hold at 2 seconds runs 121 frames of the scene's update and the engine's steps. S1's hold page on the Mac takes about 0.6 seconds with 100,000 instances.

## Runs on phones and tablets

- Phones and tablets run the benchmarks through the device runner. First find the device's scale with the `scale` plan. Then `--plan bench --n <count>` runs the protocol at that count, with five runs of each page. The pages take turns run by run.
- The bench plan runs S1 on its usual pages. `--pages` and `--scenes` pick others. For example, to compare two null3D paths on a phone: `bun tests/real-browsers.ts --plan bench --allow-no-webgpu --android chrome --scenes s1-static,s2 --pages null3d-webgl2,null3d-webgl2-low`.
- `--seconds <n>` sets each bench page's warm-up and measured time, n seconds each. For the protocol's 10-minute sustained run on a phone, use `--seconds 300`: 5 minutes of warm-up, then 5 measured.

## Sweeps for the open defaults

Three sweeps measure the defaults that are still open: the latency mode, the job worker count and the shared memory's maximum. Each runs on the Mac, and on a phone or an iPad through the device runner.

- The page kinds that end in `-low` run null3D in low-latency mode, and the bench plan runs them beside the pipelined pages. On the Mac, run `bun run bench:run --pages null3d-webgpu,null3d-webgpu-low,null3d-webgl2,null3d-webgl2-low`. Compare the presented frame rate, the 95th and 99th percentiles of the frame interval, and the busiest thread. In low-latency mode the sketch worker draws, so its time includes the drawing.
- The page switch `?jobs=<n>` starts n job workers. On the Mac, `bun run bench:run --jobs 1,2,4,8,16` runs null3D's two GPU paths at each count. On a phone, add the counts to the bench plan: `bun tests/real-browsers.ts --plan bench --allow-no-webgpu --android chrome --n 300000 --jobs 2,4,6,8`. The summary gives each count's frame time, busiest thread and the sketch worker's own work. A run whose engine started another count fails.
- The page switch `?memory=<MiB>` sets the shared memory's maximum, up to the 4096 MiB that the engine core declares. The `memory` plan loads the engine test page 20 times at each maximum from 256 to 4096 MiB. It names the largest maximum that loaded every time. A failed allocation counts as a failed load, and `--runs <n>` changes the number of loads.
- Before the loads at each maximum, the memory plan counts how many shared memories with that maximum fit at once. That is how many engines a page can hold. `--runs 0` runs only these counts.

## Download size

- The size report builds the engine test page for production with hidden source maps, which leave the built files unchanged. Vite names each file after a module and adds a hash. The report therefore names each file of the engine's JavaScript by the engine module that it holds. The list of parts is `ENGINE_PARTS` in `tools/lib/size-report.ts`. A new file of engine code fails the report until the list names it.

## Startup

- `bun run bench:startup` times the start of the engine test page in Chrome, from navigation to the first frame. It builds the page for production, serves it with `vite preview`, and drives Chrome through its debugging protocol.
- Without options it times what it always has: three cold loads in the pipelined mode, on WebGPU and Slow 4G. Each cold load gets a fresh Chrome profile, so even the GPU shaders compile from scratch.
- `--loads cold,warm` adds warm loads, `--network slow-4g,full` adds loads at full speed, and `--modes all` runs every thread mode. `--runs`, `--gpu` and `--switches` work as before.
- `--android` drives Chrome on the phone instead. It makes five loads of each kind, in every thread mode, cold and warm, on both networks. [Device sessions](devices.md#startup-times) says how cold loads avoid the phone's caches without clearing them.
- Chrome refuses network limits on a worker. It applies the page's limit to a worker's own requests only once the debugging protocol's Network domain is on in that worker. So on Slow 4G the tool attaches to each worker, which waits at its start until the domain is on.
- Without that step, the workers would load the core's loader and the sketch at full speed. The first frame would then come about a second early.
- On Slow 4G the start is a chain of round trips of at least 562 ms each. After the page and its script come the core and the probe worker, then the other workers. Then the workers load the core's loader, and then the sketch.
- The engine starts its workers only once the core has compiled. On Slow 4G their scripts and imports therefore add two round trips after the core.
- The MacBook Pro was measured in Chrome 154 on 30 September 2026. A cold load in the pipelined mode finished its first frame after 4.0 s on Slow 4G. A warm load took 0.7 s, and both took about 0.1 s at full speed.

## Soak

- `bun run bench:soak` samples every 30 seconds. Before each sample, the page, the sketch worker and the render worker collect their garbage, so a sample counts only what they keep.
- While the engine runs, a job worker blocks inside the job system's loop, so it never runs a collection that the debugger asks for. The soak reads its heap as it is, garbage included.
- The WebAssembly memory's size comes from `Runtime.queryObjects` on the page, because the engine keeps the memory out of the page's global scope.
- The soak judges the run after a 2-minute warm-up. The sketch worker's and the render worker's heaps may each grow by 256 KB. The growth is the median of the last three samples less the median of the first three.
- The WebAssembly memory may not grow at all, and the engine must still draw at the end.

## Allocation and profiling

- `bun run bench:allocation` samples allocations after a warm-up of at least 30 seconds and 3,600 frames. The browser optimizes code that runs once per frame only after thousands of frames, so a display at 60 Hz takes a minute.
- While it warms up and samples, the check moves the mouse over the canvas and presses a key and the mouse button. So the sample covers the sketch's reading of input, and that code is warm when the sample starts.
- Places that allocate because the browser does have budgets with their reasons in `bench/allocation.ts`. Every other place must stay under 4 bytes per frame. Add `--n 30000` to include the staging ring.
- `bun run bench:profile` shows where the render worker's replay spends its time. A browser call costs the same from any language. The engine's own share of the replay is therefore the most that a replay loop in another language could save.
- The profiler samples every 50 microseconds after a 20-second warm-up. Code the browser has not optimized yet counts as the engine's, so a shorter warm-up overstates the engine's share.
- `--thread sketch` samples the sketch worker's frame step instead, and splits it between the engine's code, the engine core and the browser. It also lists the engine's per-frame phase times on that thread, such as the update and the batch pass.
- The shipped core has no function names. Build it with `bun tools/build-wasm.ts --names` before a profile, so the profile names the core's functions. The names add size, so that build skips the size checks: build again without it before you check sizes.
- Chrome's page-wide memory measurement waits up to a minute for the job workers, and it counts shared memory once per worker. Chrome's debugger gives exact heaps per worker through `Runtime.getHeapUsage`.
