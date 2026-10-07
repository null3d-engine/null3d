# Performance in null3D

Measure first, then change one thing, then measure again. Read `guides/performance` and `guides/phones` in the engine docs for the version you use; this file gives the working method.

## Contents

1. Where frame time goes
2. Budgets
3. How to measure
4. Symptoms, causes and fixes
5. Phones and tablets
6. Memory
7. Quality presets, the governor and your own systems
8. Per-frame code that allocates nothing
9. Objects during play
10. Advice written for other engines

## 1. Where frame time goes

A frame has three kinds of cost, and each has its own fixes.

| Cost | Where it runs | Grows with | Typical fixes |
| --- | --- | --- | --- |
| Sketch code | Sketch worker | Your `onUpdate` loops, allocations, messages | Typed-array loops, no allocation, fewer messages |
| Engine CPU work | Job workers and the sketch worker | Moving objects, hierarchy depth, animation, culling and light lists on WebGL2 | Static objects, instances, fewer levels, LODs, fewer point and spot lights |
| GPU work | GPU | Pixels, shader cost, overdraw, shadow maps, draw buckets, hidden objects | Pixel-ratio cap, presets, cheaper materials, fewer shadowed lights, `gpuOcclusion` where walls hide many objects, `depthPrepass` for heavy overdraw (section 7) |

On WebGPU, compute passes on the GPU cull the objects and list the lights of each cluster. Clusters are the cells of the view that clustered lighting uses. On WebGL2, the job workers do both on the CPU. So many objects and many point or spot lights cost CPU time on WebGL2, and GPU time on WebGPU. Both paths list the same lights for each cluster (`concepts/lighting`).

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

1. Measure the running page with `await engine.measure(5)`. It returns CPU time per thread and phase, GPU time where WebGPU has timestamp queries, the frame rates, draw calls, uploaded bytes, rebuilds and pipelines. The phase `update` is your code, and `commands`, `transforms`, `batches`, `cull`, `record`, `upload` and `replay` are the engine's. The preset is in `engine.mode.preset`. In the sketch, `debug.stats(true)` shows the frame rates and CPU time per thread and phase on the canvas, without GPU time.
2. Run the repeatable benchmark: `bunx @null3d/cli bench --gpu webgpu,webgl2`. It builds the project for production and runs the page 5 times for 30 seconds, each after a warm-up. It prints the median and the spread of CPU time per frame by thread, GPU time and frame rates, and saves each run's phases in `bench.json`. Use it before and after a change, on the same computer.
3. Read numbers in the sketch: `debug.frameStats()` returns the overlay's figures, as means over the last half second. It allocates nothing, so a sketch can read it every frame, for example to log slow frames.
4. Profile JavaScript in the browser's performance panel. Sketch code runs in the worker named `null3d-sketch`; look there, not on the main thread. With `sketchThread: 'main'` it runs on the main thread.
5. Check the WebGL2 path: add `?gpu=webgl2` to the URL. Phones without WebGPU use this path, and it does more CPU work (culling on job workers).
6. The engine never times the GPU on WebGL2, so `gpuMs` is null there, as on WebGPU devices without timestamp queries, such as most phones. Judge the GPU there by the completed rate, `completedFps`, and by `gpuLatencyMs`.
7. Warm up, keep the page visible and the screen unlocked, and compare runs at the same `refreshHz`. The `guides/performance` page explains each figure and how to measure fairly.

Read three frame rates together:

| Figure | What it counts |
| --- | --- |
| `refreshHz` | The display's refresh rate, as the engine measured it |
| `presentedFps` | Frames the renderer presented. It can look healthy while the GPU falls behind |
| `completedFps` | Frames the GPU finished. The engine tracks every frame |
| `perSecond` | Both rates for each whole second, which show when a long run's rate fell |

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
| High "replay" or draw calls | Too many mesh and material combinations | Share materials; keep textures to a few power-of-two sizes, as `bunx @null3d/cli assets optimize` (0.2) does; merge small static meshes offline |
| GPU time high, CPU low | Pixels or shader cost | Lower `maxPixelRatio`; cheaper materials; fewer shadowed lights; avoid large transparent areas |
| High "culling" or "record" with many blended objects | Every frame culls and sorts each view's blended objects on the job workers, and on WebGPU writes each visible one's data | Use `alphaMode: 'mask'` for cut-out shapes, which draw with the opaque objects; keep `'blend'` for what must show through; put blended particles in one instance batch with one material, which draws in few calls when nothing crosses it (`concepts/materials`) |
| Hitch when something new appears, or it appears a moment late | A rebuild (`rebuilds` above zero), or a pipeline build (`pipelines` above zero) | Create materials and objects during loading; create a later stage hidden, `await scene.warmUp()`, then show it |
| Hitch while loading during play | Uploads and decoding | Load before play, or stream smaller files; the per-frame upload budget spreads uploads, and `quality.set({ uploadBytesPerFrame })` lowers it |
| 30 frames per second on a 60 Hz display, with the busiest thread's `cpuMs` a little over one refresh | In pipelined mode, a frame that misses one refresh waits for the next | Cut the CPU work below the refresh interval. Or measure `latency: 'low'`: on a warm Galaxy S24+ it showed 40 frames per second where pipelined mode showed 32. On the iPad keep pipelined mode (`guides/performance`) |
| Frame rate drops after a few minutes on a phone | Heat | Aim for 70% of the budget; test 10-minute runs. The governor lowers the render scale, then the live shadow settings; lighten your own work in `quality.onChange` by `quality.governor.steps` |

## 5. Phones and tablets

- Test on a real phone. Desktop browsers with device emulation do not show phone GPU or heat behavior.
- Many phones run the WebGL2 path (for example Samsung Exynos phones in Chrome 154). Budget for it.
- On the WebGL2 path (0.2), job workers hide objects that sit behind blocker meshes. The asset tool's `assets optimize` gives one to each mesh that encloses space, and checks that it lies inside the mesh. It skips blended, alpha-masked, skinned and flat meshes. To keep a mesh from blocking, put `"occluder": false` in its glTF extras. In the scene, use `instantiate(model, { occluder: false })` or `setOccluder(false)`. Blockers on small props cost job worker time and hide little (`guides/assets-pipeline`).
- Pixel ratio is the largest GPU lever: a ratio of 3 draws 2.25 times the pixels of a ratio of 2. Presets cap it; do not raise the cap on phones.
- Dynamic resolution is on by default. When frames run over budget, the engine draws the scene at a lower render scale, down to 0.5 on Low. It scales the image up to the canvas, in place of FXAA where the preset uses it. Read it in `quality.renderScale`. `quality.set({ minRenderScale: 1 })` turns it off. One value for both `minRenderScale` and `maxRenderScale` fixes the scale (`concepts/quality-presets`). Draw text and interface in HTML over the canvas, which stays sharp.
- The engine starts phones and tablets on lighter presets than desktops. WebGL2 and WebGPU's compatibility mode run at most Medium. The page reads the preset in `engine.mode.preset`, and `?preset=low` fixes one for a test (`concepts/quality-presets`).
- Tablets start at Medium, but a warm tablet can run Medium or High below 60 fps. S4 fell to about 45 fps at Medium on an iPad Pro. At Low it held 60 fps after 5 minutes of warm-up. When a steady rate matters more than sharp shadows, pass `preset: 'low'` to `createEngine`.
- After a start that crashed the tab, the engine starts one preset lower, and at Low after two. A phone that ran out of memory shows it in `engine.mode.crashedStarts`.
- The preset check measures the scene that the setup built, then lowers the preset where the GPU misses the frame rate. Build the first view and load its textures in the setup, or the check measures an empty scene. `engine.mode.presetCheck` shows what it measured (`concepts/quality-presets`). A repeat visit in the same browser takes the stored result and skips the check, unless the page has `?check=fresh`.
- A player's preset choice goes through `quality.setPreset`. It waits for the new preset's pipelines behind the last frame, so call it from a menu or a loading screen. The `skippedDraws` figure of `engine.measure()` counts draws that a building pipeline kept from drawing. It stays at 0 when warm-ups come first.
- Shadows: leave `cascades` and `mapSize` out of a light's `shadow` options, so the preset sets them: two cascades of 1,024 texels on Low, for phones. Keep `distance` no longer than the scene needs. Far cascades draw every few frames by preset. On every preset they draw every frame while a dynamic object touches them, so moving shadows never trail. Set `followMovingCasters: false` to keep their turns where moving objects stay far and small; their shadows then trail by up to the interval less one frame. Raise `farCascadeInterval` to draw them less often, and set `shadowFilter: 3` for cheaper edges. A shadowed spot light draws its casters into one tile of the shadow atlas, and a point light into six. Low and Medium turn point light shadows off and give the atlas fewer tiles, so avoid shadowed point lights on phones.
- Transparent and additive effects covering the screen (smoke, glass) cost the most on phone GPUs.
- Memory is tight: a 4 GB iPad reports a 256 MB largest buffer and closes tabs that use too much. Share materials, destroy textures you no longer need, and load large textures from KTX2 files, which stay compressed on the GPU. Prefabs to free with `destroy()` come in 0.2.
- For comparison runs, fix the refresh rate at 60 Hz and start with a cool, charged device (engine docs `guides/phones`).

## 6. Memory

| Item | Rough cost | How to reduce |
| --- | --- | --- |
| 2048 x 2048 RGBA8 texture with mipmaps | about 22 MB on the GPU | A KTX2 file, 4 to 8 times smaller on the GPU |
| Same texture as ASTC, BC7 or ETC2 | about 3 to 6 MB | Encode with `basisu -mipmap`, or `bunx @null3d/cli assets optimize` (0.2) |
| One static object | a few hundred bytes of engine data | Instances for many copies |
| One instance row | About 210 bytes of engine memory, 260 with per-row colors, plus your own arrays | Only the columns you need; colors only where the batch needs them |
| A new mesh, instance batch, or mesh drawn with a new material, during play | A one-time growth of engine memory in the next frame | Create them during setup; size a batch for its most rows and show fewer with `setActiveCount` |
| Directional light shadows: one map per cascade, 2048 x 2048 at 4 bytes per texel by default | about 16 MB per cascade, 48 MB for the default 3 cascades | Fewer cascades and a smaller `mapSize` in the light's `shadow` option on phones |
| Spot and point light shadows: one atlas tile per spot light, six per point light | 1 MB per 512 x 512 tile, 4 MB per 1024 x 1024 tile | The preset sets the tile count and size; fewer shadowed lights |

`engine.measure()` reports the engine's WebAssembly memory and the JavaScript heaps in `memory`. In the sketch, `textures.memoryBytes` gives the GPU memory that textures hold.

The number of objects and instance rows one scene can draw depends on the GPU path and the device. On WebGPU every device draws 2,097,152, and a device with larger GPU buffers draws more, up to 8,388,480. On WebGL2 the number follows the largest texture the device allows. It is 1,048,576 at the 2,048 pixels that every WebGL2 device allows, 2,097,152 at 4,096, and at most 8,388,608. For the device the page runs on, `engine.capabilities.maxInstances` gives the number. Past it, the call fails with E1501. With worker threads, engine memory stops at 1 GiB by default, about 5 million rows; past that, the call fails with E1109. The `memory` option of `createEngine` raises the maximum up to 4096 MiB (`api/engine`). A larger maximum leaves less address space for other engines and WebAssembly modules on the page. Raise it only for a scene that needs it. In development builds the engine warns once when a scene passes the number that every device of its GPU path draws. That is 2,097,152 on WebGPU and 1,048,576 on WebGL2. The engine picks the GPU path for each device. So test a scene of more than 1,048,576 on both paths, on the devices your users have.

## 7. Quality presets, the governor and your own systems

The engine starts each device on one of four presets: Low, Medium, High or Ultra (`concepts/quality-presets`). Phones start at Low, tablets at Medium and desktops at High. WebGL2 and WebGPU's compatibility mode run at most Medium. When the page names no preset, the engine checks its choice after the first frame, before `createEngine` resolves. It lowers the preset until one holds the target frame rate.

The preset sets these groups of settings. The `concepts/quality-presets` page has each value:

| Group | Settings | Changes |
| --- | --- | --- |
| Pixels | `maxPixelRatio`, `minRenderScale`, `maxRenderScale` | During play |
| Textures | `maxAnisotropy`, `uploadBytesPerFrame` | During play |
| Directional light shadows | `shadowFilter`, `farCascadeInterval`, `followMovingCasters`, `shadowCascadeBlend` | During play |
| Directional light shadow maps | `shadowCascades`, `shadowMapSize` | At the start |
| Frame budget | `governor` | During play |
| Anti-aliasing | `antialias`: FXAA on Low, MSAA above | At the start |
| Spot and point light shadows | `shadowTiles`, `shadowTileSize`, `pointLightShadows` (High and Ultra only) | At the start |
| Depth prepass | `depthPrepass`, off on every preset | At the start |
| GPU occlusion culling | `gpuOcclusion`, off on every preset (WebGPU only) | At the start |
| Engine memory | `memoryMaximumMiB` | Before the engine loads |

The table marks its other rows as planned, such as the light caps and the texture memory budget. A light's own `cascades` and `mapSize`, in its `shadow` options, replace the preset's. The `concepts/quality-presets` page gives the GPU memory that each preset's shadow map and shadow atlas take.

- The sketch reads the preset in `quality.preset`, and the page in `engine.mode.preset`. Only `quality.setPreset` changes it during play, and it waits for the new preset's pipelines. Call it from a menu or a loading screen.
- `quality.set({ maxPixelRatio, minRenderScale, maxRenderScale, maxAnisotropy, uploadBytesPerFrame, shadowFilter, farCascadeInterval, followMovingCasters, shadowCascadeBlend, governor })` changes the live settings during play, for example from a settings menu. Other settings throw E1213. `createEngine` options set the ones fixed at the start, such as `antialias`, `shadowCascades`, `depthPrepass` and `gpuOcclusion`.
- Do not raise the preset of a phone. Check each preset that your users can get with `?preset=low` to `?preset=ultra`.

### The governor

The frame-budget governor keeps the frame rate when the scene is too heavy for the device. It aims for the display's refresh rate, up to 60 frames per second. It judges the frames four times a second, by the slower of the presented and the completed rates. So it also sees a GPU that falls behind while the renderer keeps presenting.

The governor steps down when a second of frames averages under 95% of the target rate, such as 57 at 60. It takes one step at a time, in this order:

1. The render scale falls in steps of 0.05, down to `minRenderScale`. The scene draws at fewer pixels, and the engine scales the image up to the canvas.
2. The far shadow cascades draw half as often, up to every 8th frame.
3. The shadow filter drops to 3 x 3 texels, for cheaper shadow edges.

It raises the settings in the reverse order, each after about 5 seconds with time to spare, so quality does not flicker. A step up that falls behind within 30 seconds doubles the wait before the governor tries that setting again, up to 80 seconds. At 57 to 59 frames per second, the settings stay where they are. The governor takes no step in the first 2 seconds, or while textures wait to upload. It takes a shadow step only where a light casts shadows. It never changes the preset or the settings fixed at the start.

Read the current render scale in `quality.renderScale`, and the shadow settings that frames draw with in `quality.governor`. After each shadow step, `quality.onChange` runs, and `quality.governor.steps` counts the steps past the render scale. Lighten your own systems there. To measure the scene's own cost, turn the governor off: `quality.set({ governor: false })`. The scene then draws at `maxRenderScale`, with the shadow settings as set.

### The depth prepass

With `createEngine({ depthPrepass: true })`, each camera view first draws the depth of its opaque objects. The opaque pass then shades each pixel once, for its nearest surface. The prepass costs a second pass over the objects' vertices. It saves GPU time only where objects hide many others and their shading costs much, such as a street of lit buildings.

Every preset leaves it off. S2 is a benchmark scene with little overdraw. In Chrome on a MacBook Pro, the prepass raised its GPU time per frame on WebGPU from 0.28 ms to 0.40 ms. On WebGL2 it doubled the draw calls. Both GPU paths draw the prepass, with the same image as without it. Blended objects and alpha-cutoff materials stay out of the prepass. Custom materials and sprites join it with their own vertex shader, so their vertex offsets keep their depth. Turn it on only after you compare the scene's GPU time with `?prepass=on` and `?prepass=off`.

### GPU occlusion culling

With `gpuOcclusion` on, each camera draws the depth of the opaque objects that showed in its last frame and builds a depth pyramid from it. Then it draws only the objects that show. The image matches the image without it, and no object shows a frame late. Only objects that `setOccluder(true)` marks hide others. Every preset leaves it off, because on a fast desktop GPU its passes cost more than they saved. It runs only on WebGPU, and not with the depth prepass. Engine docs: `concepts/culling`.

It pays where walls and large objects hide many detailed objects, such as the streets of a city. In open scenes it costs a little. Compare the scene's GPU time with `?occlusion=on` and `?occlusion=off` before you change the preset's choice. Shadow passes and see-through objects do not use it.

### Half precision

The scene shaders can do their color math at half precision: lighting, tone mapping and sRGB encoding. Positions, depth and shadow lookups keep full precision. It stays off on both GPU paths. On a WebGL2 phone it saved no frame time and moved shadow edges. On an iPad's WebGPU path it saved under 2% of the GPU time. `?half=on` turns it on to measure a scene. WebGPU takes it only on devices with the `shader-f16` feature. `engine.capabilities.halfPrecision` says what the engine took. Custom materials always use full precision. There is no `createEngine` option for it.

### Your own systems

Keep your own values per preset in one table. Apply them in the setup, and again in `quality.onChange`, which runs when a setting changes. Your systems get budgets of their own through `setBudget` (0.2):

```ts
quality.setBudget({ name: 'ai', ms: 2, onScale: (s) => { aiUpdateEvery = s < 0.5 ? 4 : s < 0.8 ? 2 : 1; } });  // (0.2)
const RAIN = { low: 2000, medium: 5000, high: 10000, ultra: 10000 };  // one table, keyed by preset
rain.setActiveCount(RAIN[quality.preset]);
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
| Download every shader before play | Skinning, morph targets, bloom, ambient occlusion, sprites, lines, texture backgrounds and GPU occlusion culling (`'occlusion'`) download their shaders on first use. For a game that must fetch nothing during play, list them: `createEngine({ preload: ['skinning', 'bloom'] })`. They then load, and compile where the files allow, before the first frame. Create the scene's own objects in the setup and `await scene.warmUp()` for the pipelines that depend on materials. Leave the list out otherwise: each listed file grows the start |
| Turn off matrix updates for still objects | Objects are static by default and cost nothing until a setter changes them |
| Set a needs-update flag after a change | Setters mark changes themselves |
| Track GPU completion yourself | `engine.measure` reports `completedFps` and `gpuLatencyMs` |
| Limit the frames in flight | The engine holds them to two |
