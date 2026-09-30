# Performance in null3D

Measure first, then change one thing, then measure again. Read `guides/performance` and `guides/phones` in the engine docs for the version you use; this file gives the working method.

## Contents

1. Where frame time goes
2. Budgets
3. How to measure
4. Symptoms, causes and fixes
5. Phones and tablets
6. Memory
7. The quality governor and your own systems
8. Per-frame code that allocates nothing
9. Objects during play
10. Advice written for other engines

## 1. Where frame time goes

A frame has three kinds of cost, and each has its own fixes.

| Cost | Where it runs | Grows with | Typical fixes |
| --- | --- | --- | --- |
| Sketch code | Sketch worker | Your `onUpdate` loops, allocations, messages | Typed-array loops, no allocation, fewer messages |
| Engine CPU work | Job workers and the sketch worker | Moving objects, hierarchy depth, animation, culling on WebGL2 | Static objects, instances, fewer levels, LODs |
| GPU work | GPU | Pixels, shader cost, overdraw, shadow maps, draw buckets | Pixel-ratio cap, presets, cheaper materials, fewer shadowed lights |

In pipelined mode the render worker draws frame N while the sketch worker computes frame N+1. The slower of the two sets the frame rate. The figures of `engine.measure()` show both.

Sketch code is usually the largest CPU cost, so tune it first. In the S1 benchmark (100,000 boxes that `onUpdate` moves every frame, Chrome, MacBook Pro), the sketch's update took 2.18 ms per frame. The engine's own steps took 0.14 ms on the sketch worker, the render worker 0.15 ms, and 16 job workers 0.45 ms together. The engine docs page `guides/performance` has the full split.

## 2. Budgets

At 60 frames per second a frame has 16.7 ms. Plan to use at most about 70% of it, because phones slow down when they heat up.

| Target | Frame | Sketch code | Engine CPU (per thread) | GPU |
| --- | --- | --- | --- | --- |
| 60 fps desktop | 16.7 ms | 4 ms | 6 ms | 12 ms |
| 60 fps phone | 16.7 ms | 3 ms | 5 ms | 11 ms |
| 30 fps phone (battery saver) | 33.3 ms | 6 ms | 10 ms | 22 ms |

These numbers are starting points. The engine docs page `guides/performance` holds the measured values for each release.

## 3. How to measure

1. Measure the running page with `await engine.measure(5)`. It returns CPU time per thread and phase, GPU time where the device has timers, the frame rates, draw calls, uploaded bytes, rebuilds and pipelines. The phase `update` is your code, and `commands`, `transforms`, `batches`, `cull`, `record`, `upload` and `replay` are the engine's. The preset is in `engine.mode.preset`. Later in 0.1, the overlay `debug.stats(true)` shows these figures on the canvas.
2. Run the repeatable benchmark: `bunx @null3d/cli bench --gpu webgpu,webgl2`. It builds the project for production and runs the page 5 times for 30 seconds, each after a warm-up. It prints the median and the spread of CPU time per frame by thread, GPU time and frame rates, and saves each run's phases in `bench.json`. Use it before and after a change, on the same computer.
3. Read numbers in the sketch: `debug.frameStats()` returns the same values later in 0.1. Until then, measure on the page and send what the sketch needs as a message.
4. Profile JavaScript in the browser's performance panel. Sketch code runs in the worker named `null3d-sketch`; look there, not on the main thread.
5. Check the WebGL2 path: add `?gpu=webgl2` to the URL. Phones without WebGPU use this path, and it does more CPU work (culling on job workers).
6. On phones, GPU timers are rare: under 1% of Android and iOS reports have them on WebGL2. Judge the GPU there by the completed rate, `completedFps`, and by `gpuLatencyMs`.
7. Warm up, keep the page visible and the screen unlocked, and compare runs at the same `refreshHz`. The `guides/performance` page explains each figure and how to measure fairly.

Read three frame rates together:

| Figure | What it counts |
| --- | --- |
| `refreshHz` | The display's refresh rate, as the engine measured it |
| `presentedFps` | Frames the renderer presented. It can look healthy while the GPU falls behind |
| `completedFps` | Frames the GPU finished. The engine tracks every frame |

The lower of `presentedFps` and `completedFps` is the rate users see. The engine lets at most two frames wait on the GPU. When the GPU is the bottleneck, both rates fall below `refreshHz` together, and `gpuLatencyMs` stays near two frame intervals. When the sketch or the engine's CPU work is the bottleneck, the busiest thread's `cpuMs` is near the frame interval instead.

## 4. Symptoms, causes and fixes

| Symptom in `engine.measure` | Likely cause | Fix |
| --- | --- | --- |
| High "update" time | Heavy sketch code | Loop over typed arrays; move work to `onFixedUpdate` at a lower rate; spread AI over frames |
| Periodic spikes in "update" | Garbage collection | Remove allocations from per-frame code: no `new`, literals or closures; use scratch arrays |
| High "transforms" | Many dynamic objects or deep hierarchies | Make objects static when they rarely move; flatten hierarchies; use instance batches |
| High "animation" (0.2) | Many skinned characters | Lower far update rates (preset); share poses between identical characters; use LODs |
| High "culling" on WebGL2 | Many objects checked on the CPU | Instances; static batches, which WebGL2 culls 64 rows at a time once they stop changing; static scenery in a world over several grid cells, whose cells out of view are skipped whole (`concepts/culling`); larger static groups; layer masks; LODs |
| Objects behind walls or buildings still cost GPU time on WebGL2 | No blocker meshes | Run the asset tool on level geometry so it makes blocker meshes (0.2); call `setOccluder(true)` on large custom walls (0.2, `concepts/culling`) |
| High "upload" bytes | Dynamic batches or objects that rarely change | Static batches with `markDirty(start, count)` for the rows that changed |
| On WebGL2, `uploadBytes` far above 4 times `visibleEntries` when only the camera moves | Dynamic batches: every frame uploads each active row's 48-byte matrix, visible or not | Make still batches static, and mark only the changed rows (`guides/performance`) |
| `rebuilds` above zero during play, with upload and replay spikes in the same frames | Objects, meshes, materials or batches created, destroyed or changed during play: each such frame rebuilds the draw tables and uploads every matrix | Create during setup; hide and show with `setVisible` and pool with `setActiveCount`, which do not rebuild (`guides/performance`) |
| High "replay" or draw calls | Too many mesh and material combinations | Share materials; pack textures into arrays with `bunx @null3d/cli assets` (0.2); merge small static meshes offline |
| GPU time high, CPU low | Pixels or shader cost | Lower `maxPixelRatio`; cheaper materials; fewer shadowed lights; avoid large transparent areas |
| Hitch when something new appears, or it appears a moment late | A rebuild (`rebuilds` above zero), or a pipeline build (`pipelines` above zero) | Create materials and objects during loading; create a later stage hidden, `await scene.warmUp()`, then show it |
| Hitch while loading during play | Uploads and decoding | Load before play, or stream smaller files; the per-frame upload budget spreads uploads |
| Frame rate drops after a few minutes on a phone | Heat | Aim for 70% of the budget; test 10-minute runs. The governor steps quality down later in 0.1 |

## 5. Phones and tablets

- Test on a real phone. Desktop browsers with device emulation do not show phone GPU or heat behavior.
- Many phones run the WebGL2 path (for example Samsung Exynos phones in Chrome 154). Budget for it.
- On the WebGL2 path (0.2), job workers hide objects that sit behind blocker meshes, which the asset tool makes from large static meshes. See-through meshes such as glass and fences must not be blockers: call `setOccluder(false)` on them if the tool picked them.
- Pixel ratio is the largest GPU lever: a ratio of 3 draws 2.25 times the pixels of a ratio of 2. Presets cap it; do not raise the cap on phones.
- The engine starts phones and tablets on lighter presets than desktops, and WebGL2 runs at most Medium. The page reads the preset in `engine.mode.preset`, and `?preset=low` fixes one for a test (`concepts/quality-presets`).
- After a start that crashed the tab, the engine starts one preset lower, and at Low after two. A phone that ran out of memory shows it in `engine.mode.crashedStarts`.
- Shadows (later in 0.1): one cascade on Low, two on Medium. Each shadowed point light draws the scene six times; avoid them on phones.
- Transparent and additive effects covering the screen (smoke, glass) cost the most on phone GPUs.
- Memory is tight: a 4 GB iPad reports a 256 MB largest buffer and closes tabs that use too much. Share materials and destroy textures you no longer need. KTX2 textures come later in 0.1, and prefabs to free with `destroy()` in 0.2.
- For comparison runs, fix the refresh rate at 60 Hz and start with a cool, charged device (engine docs `guides/phones`).

## 6. Memory

| Item | Rough cost | How to reduce |
| --- | --- | --- |
| 2048 x 2048 RGBA8 texture with mipmaps | about 22 MB on the GPU | KTX2 compression (later in 0.1), 4 to 8 times smaller |
| Same texture as ASTC or ETC2 | about 4 to 6 MB | `bunx @null3d/cli assets optimize` (0.2) |
| One static object | a few hundred bytes of engine data | Instances for many copies |
| One instance row | About 180 bytes of engine memory, 230 with per-row colors, plus your own arrays | Only the columns you need; colors only where the batch needs them |
| A new mesh, instance batch, or mesh drawn with a new material, during play | A one-time growth of engine memory in the next frame | Create them during setup; size a batch for its most rows and show fewer with `setActiveCount` |
| Shadow map 2048 x 2048, depth 32-bit (later in 0.1) | about 16 MB | Smaller maps on Low and Medium presets |

`engine.measure()` reports the engine's WebAssembly memory and the JavaScript heaps in `memory`. In the sketch, `textures.memoryBytes` gives the GPU memory that textures hold.

The number of objects and instance rows one scene can draw depends on the GPU path and the device. On WebGPU every device draws 2,097,152, and a device with larger GPU buffers draws more, up to 8,388,480. On WebGL2 the number follows the largest texture the device allows. It is 1,048,576 at the 2,048 pixels that every WebGL2 device allows, 2,097,152 at 4,096, and at most 8,388,608. For the device the page runs on, `engine.capabilities.maxInstances` gives the number. Past it, the call fails with E1501. With worker threads, engine memory stops at 1 GiB by default, about 5 million rows; past that, the call fails with E1109. The `memory` option of `createEngine` raises the maximum up to 4096 MiB (`api/engine`). A larger maximum leaves less address space for other engines and WebAssembly modules on the page. Raise it only for a scene that needs it. In development builds the engine warns once when a scene passes the number that every device of its GPU path draws. That is 2,097,152 on WebGPU and 1,048,576 on WebGL2. The engine picks the GPU path for each device. So test a scene of more than 1,048,576 on both paths, on the devices your users have.

## 7. The quality governor and your own systems

Keep your own values per preset in one table, and apply them in `quality.onChange`. Later in 0.1, a governor lowers settings in a fixed order when frames run over budget: render scale first, then shadow updates, then effects. It never changes the preset during play. It raises the settings again after a stable period, so quality does not flicker. Your systems can join in through `setBudget` (0.2):

```ts
quality.setBudget({ name: 'ai', ms: 2, onScale: (s) => { aiUpdateEvery = s < 0.5 ? 4 : s < 0.8 ? 2 : 1; } });  // (0.2)
const RAIN = { low: 2000, medium: 5000, high: 10000, ultra: 10000 };  // one table, keyed by preset
quality.onChange(() => { rain.setActiveCount(RAIN[quality.preset]); });
```

`onScale` receives a value from 0 to 1: 1 means full quality. Keep the callbacks cheap; they run when quality changes, not every frame.

## 8. Per-frame code that allocates nothing

Apply these habits to `onUpdate` and everything it calls.

- Read vectors by index: `const x = v[0]`. Never destructure an array or typed array in per-frame code; `const [x, y, z] = v` makes an iterator on every read.
- Write elements into arrays you already have. `axis.set([0, 1, 0])` builds a new array on every call.
- Build lookup tables and scratch arrays once, in setup or at module level, never inside a function that runs every frame.
- Use `Math.sqrt(x * x + y * y + z * z)` for a length, not `Math.hypot`.
- Keep scratch lists at a fixed length. `list.length = 0` frees the storage, and the next write allocates it again.
- Make no closures, `async` wrappers or promise chains per frame. Keep closures out of per-frame functions, even in a branch that rarely runs. Until the browser optimizes the function, the variables a closure captures are allocated on every call. Move such a branch into its own function.
- Animate a light with `setIntensity` and `setDirection`, which allocate nothing. `setColor` converts the color and allocates.
- Judge allocation after about 30 seconds of play. Until the browser optimizes a function that runs once per frame, the decimal numbers it computes are allocated.

## 9. Objects during play

Some calls rebuild the scene's draw tables in the frame they take effect: the bundle is recorded again and every matrix uploads. Others upload only what they changed. The engine docs page `guides/performance` has the full table.

- Cheap: moving objects, writing batch arrays, `setVisible`, and `setActiveCount`.
- Rebuilds: creating or destroying objects and batches, `setMaterial`, `setParent` and `setDynamic`.
- Create everything a level needs during setup. Hide with `setVisible` instead of destroying.
- Pool bullets, particles and pickups in a batch sized for its most rows. Show the live ones with `setActiveCount`, and keep them at the front of the arrays.
- For a look that changes often, such as a highlight, keep two objects and swap their visibility.
- Check `engine.measure()`: `rebuilds` above zero during play means one of the rebuilding calls ran.

## 10. Advice written for other engines

Performance advice for three.js and other engines assumes things that do not hold in null3D. The engine docs page `guides/performance` answers the questions behind it.

| Advice | In null3D |
| --- | --- |
| Merge meshes to cut draw calls | Objects that share a mesh and material already share one draw. Merge only different small static meshes, to cut buckets |
| Share materials so objects share a shader | Every material already shares its pipeline. Share materials anyway: each mesh and material pair is its own draw |
| Compile shaders before the first frame | The first frame waits for its pipelines. Wait for `engine.firstFrame`; warm up later stages with `scene.warmUp()` |
| Turn off matrix updates for still objects | Objects are static by default and cost nothing until a setter changes them |
| Set a needs-update flag after a change | Setters mark changes themselves |
| Track GPU completion yourself | `engine.measure` reports `completedFps` and `gpuLatencyMs` |
| Limit the frames in flight | The engine holds them to two |
