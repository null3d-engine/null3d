# Performance in sokko3d

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

## 1. Where frame time goes

A frame has three kinds of cost, and each has its own fixes.

| Cost | Where it runs | Grows with | Typical fixes |
| --- | --- | --- | --- |
| Game code | Game worker | Your `onUpdate` loops, allocations, messages | Typed-array loops, no allocation, fewer messages |
| Engine CPU work | Job workers and the game worker | Moving objects, hierarchy depth, animation, culling on WebGL2 | Static objects, instances, fewer levels, LODs |
| GPU work | GPU | Pixels, shader cost, overdraw, shadow maps, draw buckets | Pixel-ratio cap, presets, cheaper materials, fewer shadowed lights |

In pipelined mode the render worker draws frame N while the game worker computes frame N+1, so the slower of the two sets the frame rate. The stats overlay shows both.

Game code is usually the largest CPU cost, so tune it first. In the S1 benchmark (100,000 boxes that `onUpdate` moves every frame, Chrome, MacBook Pro), the game's update took 2.18 ms per frame. The engine's own steps took 0.14 ms on the game worker, the render worker 0.15 ms, and 16 job workers 0.45 ms together. The engine docs page `guides/performance` has the full split.

## 2. Budgets

At 60 frames per second a frame has 16.7 ms. Plan to use at most about 70% of it, because phones slow down when they heat up.

| Target | Frame | Game code | Engine CPU (per thread) | GPU |
| --- | --- | --- | --- | --- |
| 60 fps desktop | 16.7 ms | 4 ms | 6 ms | 12 ms |
| 60 fps phone | 16.7 ms | 3 ms | 5 ms | 11 ms |
| 30 fps phone (battery saver) | 33.3 ms | 6 ms | 10 ms | 22 ms |

These numbers are starting points (proposal). The engine docs page `guides/performance` holds the measured values for each release.

## 3. How to measure

1. Turn on the overlay: `debug.stats(true)`. It shows CPU time per thread and phase (update, transforms, animation, culling, recording, upload, replay), GPU time where the device has timers, frame intervals, draw buckets, uploaded bytes, the GPU tier and the preset.
2. Run the repeatable benchmark: `npx sokko3d bench --scene <name>`. It runs 5 times 30 seconds after warm-up and prints the median and spread per phase. Use it before and after a change.
3. Read numbers in code or tests: `debug.frameStats()` returns the same values.
4. Profile JavaScript in the browser's performance panel. Game code runs in the worker named `sokko3d-game`; look there, not on the main thread.
5. Check the WebGL2 path: add `?gpu=webgl2` to the URL. Phones without WebGPU use this path, and it does more CPU work (culling on job workers).
6. On phones, GPU timers are rare (under 1% of Android and iOS reports have them on WebGL2), so judge the GPU by frame intervals with the CPU phases subtracted.
7. In the engine repository before 0.1, `engine.measure(seconds)` on the page returns these figures; `guides/performance` explains each one and how to measure fairly (warm up, keep the page visible and the screen unlocked, note the display rate).

## 4. Symptoms, causes and fixes

| Symptom in the overlay | Likely cause | Fix |
| --- | --- | --- |
| High "update" time | Heavy game code | Loop over typed arrays; move work to `onFixedUpdate` at a lower rate; spread AI over frames |
| Periodic spikes in "update" | Garbage collection | Remove allocations from per-frame code: no `new`, literals or closures; use scratch arrays |
| High "transforms" | Many dynamic objects or deep hierarchies | Make objects static when they rarely move; flatten hierarchies; use instance batches |
| High "animation" | Many skinned characters | Lower far update rates (preset); share poses between identical characters; use LODs |
| High "culling" on WebGL2 | Many objects checked on the CPU | Instances; larger static groups; layer masks; LODs |
| Objects behind walls or buildings still cost GPU time on WebGL2 | No blocker meshes | Run the asset tool on level geometry so it makes blocker meshes (0.2); call `setOccluder(true)` on large custom walls (`concepts/culling`) |
| High "upload" bytes | Dynamic batches or objects that rarely change | Static batches with `markDirty(start, count)` for the rows that changed |
| High "replay" or draw buckets | Too many mesh and material combinations | Share materials; pack textures into arrays with `sokko3d assets`; merge small static meshes offline |
| GPU time high, CPU low | Pixels or shader cost | Lower `maxPixelRatio`; cheaper materials; fewer shadowed lights; avoid large transparent areas |
| Hitch when something new appears | Pipeline compiled during play | Create materials and objects during loading; `await scene.warmUp()` |
| Hitch while loading during play | Uploads and decoding | Load before play, or stream smaller files; the per-frame upload budget spreads uploads |
| Frame rate drops after a few minutes on a phone | Heat | Aim for 70% of the budget; the governor steps quality down; test 10-minute runs |

## 5. Phones and tablets

- Test on a real phone. Desktop browsers with device emulation do not show phone GPU or heat behavior.
- Many phones run the WebGL2 path (for example Samsung Exynos phones in Chrome 154). Budget for it.
- On the WebGL2 path (0.2), job workers hide objects that sit behind blocker meshes, which the asset tool makes from large static meshes. See-through meshes such as glass and fences must not be blockers: call `setOccluder(false)` on them if the tool picked them.
- Pixel ratio is the largest GPU lever: a ratio of 3 draws 2.25 times the pixels of a ratio of 2. Presets cap it; do not raise the cap on phones.
- Shadows: one cascade on Low, two on Medium. Each shadowed point light draws the scene six times; avoid them on phones.
- Transparent and additive effects covering the screen (smoke, glass) cost the most on phone GPUs.
- Memory is tight: a 4 GB iPad reports a 256 MB largest buffer and closes tabs that use too much. Use KTX2 textures, share materials, and free unused prefabs with `destroy()`.
- For comparison runs, fix the refresh rate at 60 Hz and start with a cool, charged device (engine docs `guides/phones`).

## 6. Memory

| Item | Rough cost | How to reduce |
| --- | --- | --- |
| 2048 x 2048 RGBA8 texture with mipmaps | about 22 MB on the GPU | KTX2 compression (4 to 8 times smaller) |
| Same texture as ASTC or ETC2 | about 4 to 6 MB | Use `sokko3d assets optimize` |
| One static object | a few hundred bytes of engine data | Instances for many copies |
| One instance row | 48 bytes of matrix plus your own arrays | Only the columns you need |
| A new mesh, instance batch, or mesh drawn with a new material, during play | A one-time growth of engine memory in the next frame | Create them during setup; size a batch for its most rows and show fewer with `setActiveCount` |
| Shadow map 2048 x 2048, depth 32-bit | about 16 MB | Smaller maps on Low and Medium presets |

Check `debug.frameStats().memory` for WebAssembly memory and GPU memory estimates.

## 7. The quality governor and your own systems

The engine lowers settings in a fixed order when frames run over budget: render scale first, then shadow updates, then effects, then the preset. It raises them again after a stable period, so quality does not flicker. Your systems can join in:

```ts
quality.setBudget({ name: 'ai', ms: 2, onScale: (s) => { aiUpdateEvery = s < 0.5 ? 4 : s < 0.8 ? 2 : 1; } });
quality.onChange((q) => { rain.setActiveCount(q.preset === 'low' ? 2000 : 10000); });
```

`onScale` receives a value from 0 to 1: 1 means full quality. Keep the callbacks cheap; they run when quality changes, not every frame.

## 8. Per-frame code that allocates nothing

These habits come from finding and removing allocations in the engine's own per-frame code. Apply them to `onUpdate` and everything it calls.

- Read vectors by index: `const x = v[0]`. Never destructure an array or typed array in per-frame code; `const [x, y, z] = v` makes an iterator on every read.
- Write elements into arrays you already have. `axis.set([0, 1, 0])` builds a new array on every call.
- Build lookup tables and scratch arrays once, in setup or at module level, never inside a function that runs every frame.
- Use `Math.sqrt(x * x + y * y + z * z)` for a length, not `Math.hypot`.
- Keep scratch lists at a fixed length. `list.length = 0` frees the storage, and the next write allocates it again.
- Make no closures, `async` wrappers or promise chains per frame. Keep closures out of per-frame functions even in a branch that rarely runs: until the browser optimizes the function, the variables a closure captures are allocated on every call. Move such a branch into its own function.
- Animate a light with `setIntensity` and `setDirection`, which allocate nothing. `setColor` converts the color and allocates.
- Judge allocation after about 30 seconds of play. Until the browser optimizes a function that runs once per frame, the decimal numbers it computes are allocated.
