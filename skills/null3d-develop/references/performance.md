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
11. Start-up and staged loading
12. Caching across visits
13. Reviewing a scene

## 1. Where frame time goes

A frame has three kinds of cost, and each has its own fixes.

| Cost | Where it runs | Grows with | Typical fixes |
| --- | --- | --- | --- |
| Sketch code | Sketch worker | Your `onUpdate` loops, allocations, messages | Typed-array loops, no allocation, fewer messages |
| Engine CPU work | Job workers and the sketch worker | Moving objects, hierarchy depth, animation, culling and light lists on WebGL2 | Static objects, instances, fewer levels, fewer point and spot lights |
| GPU work | GPU | Pixels, shader cost, overdraw, shadow maps, draw buckets, hidden objects, vertices of far meshes | Pixel-ratio cap, presets, cheaper materials, levels of detail, which meshes made in code plan on their own at their first draw, or `mesh.buildLevels()` and `mesh.setLevels` (0.2), fewer shadowed lights, `gpuOcclusion` where walls hide many objects, `depthPrepass` for heavy overdraw on WebGPU (section 7) |

On WebGPU, compute passes on the GPU cull the objects and list the lights of each cluster. Clusters are the cells of the view that clustered lighting uses. On WebGL2, the job workers do both on the CPU. So many objects and many point or spot lights cost CPU time on WebGL2, and GPU time on WebGPU. On WebGPU at Medium and above, the slices fit the depth that the surfaces in view span, so a cluster lists fewer lights than on WebGL2. A light that a pixel does not reach adds nothing, so both paths light the scene alike (`concepts/lighting`).

In pipelined mode the render worker draws frame N while the sketch worker computes frame N+1. The slower of the two sets the frame rate. The figures of `engine.measure()` show both.

Sketch code is usually the largest CPU cost, so tune it first. In the S1 benchmark (100,000 boxes that `onUpdate` moves every frame, Chrome, MacBook Pro), the sketch's update took 2.18 ms per frame. The engine's own steps took 0.14 ms on the sketch worker, the render worker 0.15 ms, and 16 job workers 0.45 ms together. The engine docs page `guides/performance` has the full split.

Put performance-sensitive work in Rust. The engine's per-frame loops run in Rust, and your TypeScript is an interface to them: it writes arrays and makes calls. For work that grows with the scene, use the engine's bulk calls, which cover every object in one call. For a loop that no engine call covers, build a Rust WebAssembly module and run it on the job workers with `runTask` (`api/tasks`). A task answers between frames, so a loop that must affect the current frame belongs in the engine's own calls. Keep setup, wiring and page logic in TypeScript.

## 2. Budgets

At 60 frames per second a frame has 16.7 ms. Plan to use at most about 70% of it, because phones slow down when they heat up.

| Target | Frame | Sketch code | Engine CPU (per thread) | GPU |
| --- | --- | --- | --- | --- |
| 60 fps desktop | 16.7 ms | 4 ms | 6 ms | 12 ms |
| 60 fps phone | 16.7 ms | 3 ms | 5 ms | 11 ms |
| 30 fps phone (battery saver) | 33.3 ms | 6 ms | 10 ms | 22 ms |

These numbers are starting points. The engine docs page `guides/performance` holds the measured values for each release.

## 3. How to measure

Time a production build, never a development build. Development builds run checks in every frame. Some read every static object, so a large scene times slower than it ships. Find out which build the page runs before you trust a figure:

| The page comes from | Build |
| --- | --- |
| `bunx vite build` with the null3D plugin, served by `bunx vite preview`; `bunx @null3d/cli bench` | Production |
| (0.2) The CDN build's `lib/index.js` | Production |
| `bunx vite`, the dev server; `bunx @null3d/cli shot` and `test` | Development |
| (0.2) The CDN build's `lib-dev/index.js` | Development |
| Engine code built without the null3D plugin, by another bundler or with no bundler at all | Development |

To check a page you did not build, call a setter on an object after its `destroy()`. Only a development build throws E1101 (`concepts/handles`). The engine docs pages `getting-started/cdn` and `guides/performance` give the detail.

1. Measure the running page with `await engine.measure(5)`. It returns CPU time per thread and phase, GPU time where WebGPU has timestamp queries, the frame rates, draw calls, uploaded bytes, rebuilds and pipelines. The phase `update` is your code, and `commands`, `transforms`, `batches`, `cull`, `record`, `upload` and `replay` are the engine's. The preset is in `engine.mode.preset`. In the sketch, `debug.stats(true)` shows the frame rates and CPU time per thread and phase on the canvas. In 0.2 a click on its frame rate opens a card. It shows each thread's time and the GPU's time against the target frame rate, split into your code and the engine's work. A line names what holds the frame rate back. It also shows memory and the triangles and objects drawn. `?stats` in the page's address shows it too.
2. Run the repeatable benchmark: `bunx @null3d/cli bench --gpu webgpu,webgl2`. It builds the project for production and runs the page 5 times for 30 seconds, each after a warm-up. It prints the median and the spread of CPU time per frame by thread, GPU time and frame rates, and saves each run's phases in `bench.json`. Use it before and after a change, on the same computer.
3. Read numbers in the sketch: `debug.frameStats()` returns the overlay's figures, as means over the last half second. It allocates nothing, so a sketch can read it every frame, for example to log slow frames. A day cycle moves the time with `timeOfDay(hour, {}, day)`, which fills the `day` object of the first call instead of making one.
4. Profile JavaScript in the browser's performance panel. Sketch code runs in the worker named `null3d-sketch`; look there, not on the main thread. With `sketchThread: 'main'` it runs on the main thread.
5. Check the WebGL2 path: add `?gpu=webgl2` to the URL. Phones without WebGPU use this path, and it does more CPU work (culling on job workers).
6. In a production build on WebGPU, `engine.measure()` counts only the triangles of the draws that the CPU issues. The sketch's call of `debug.frameStats()`, or an open stats card, adds the rest. A scene that the GPU culls can then show almost no triangles (`api/debug`).
7. The engine never times the GPU on WebGL2, so `gpuMs` is null there, as on WebGPU devices without timestamp queries, such as most phones. Judge the GPU there by the completed rate, `completedFps`, and by `gpuLatencyMs`.
8. Warm up, keep the page visible and the screen unlocked, and compare runs at the same `refreshHz`. The `guides/performance` page explains each figure and how to measure fairly.

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
| Frame time grows with each skinned character (0.2) | Many skinned characters | Fewer shadow cascades, since each shadow pass skins the characters again (`guides/performance`). Give far characters a longer pose interval with `animator.setUpdateInterval`, and read `quality.governor.farAnimationInterval` for the value the preset and governor ask for (`api/animation#crowds`). Shared poses between identical characters are (0.2, not built yet) |
| High "cull" on WebGL2 | Many objects checked on the CPU | Instances; static batches, which WebGL2 culls 64 rows at a time once they stop changing; static scenery in a world over several grid cells, whose cells out of view are skipped whole (`concepts/culling`); larger static groups; layer masks |
| Objects behind walls or buildings still cost GPU time on WebGL2 | No blocker meshes | Run the asset tool on level geometry so it makes blocker meshes (0.2); call `setOccluder(true)` on large custom walls (0.2, `concepts/culling`) |
| Low `occludedEntries` on WebGL2 though buildings merged into one mesh per material fill the view | A blocker mesh past 4,096 triangles blocks nothing | Merge by area as well as by material. Below that limit a merged mesh blocks part by part: each connected part by its own distance (`concepts/culling`) |
| High "upload" bytes | Dynamic batches or objects that rarely change | Static batches with `markDirty(start, count)` for the rows that changed |
| On WebGL2, `uploadBytes` far above 4 times `visibleEntries` when only the camera moves | Dynamic batches: every frame uploads each active row's 48-byte matrix, visible or not | Make still batches static, and mark only the changed rows (`guides/performance`) |
| The GPU keeps drawing a scene that holds still, so a phone stays warm | Something changes every frame, or the view cannot blend: bloom, outlines, automatic exposure, volumetric fog, particles, custom effects or materials, the physical sky, or a canvas that keeps its alpha | Stop per-frame changes once nothing moves; a still view without those blends into a sharper picture and stops drawing after about a second (`concepts/post-processing`) |
| `rebuilds` above zero during play, with upload and replay spikes in the same frames | Objects, meshes, materials or batches created, destroyed or changed during play: each such frame rebuilds the draw tables and uploads every matrix | Create during setup; hide and show with `setVisible` and pool with `setActiveCount`, which do not rebuild (`guides/performance`) |
| High "replay" or draw calls | Too many mesh and material combinations | Share materials; keep textures to a few power-of-two sizes, as `bunx @null3d/cli assets optimize` (0.2) does; merge small static meshes offline |
| GPU time high, CPU low | Pixels or shader cost | Lower `maxPixelRatio`; cheaper materials; fewer shadowed lights; avoid large transparent areas |
| High "cull" or "record" with many blended objects | Every frame culls and sorts each view's blended objects on the job workers, and on WebGPU writes each visible one's data | Use `alphaMode: 'mask'` for cut-out shapes, which draw with the opaque objects; keep `'blend'` for what must show through; put blended particles in one instance batch with one material, which draws in few calls when nothing crosses it (`concepts/materials`) |
| Hitch when something new appears, or it appears a moment late | A rebuild (`rebuilds` above zero), or a pipeline build (`pipelines` above zero) | Create materials and objects during loading; create a later stage hidden, `await scene.warmUp()`, then show it |
| Hitch while loading during play | Uploads and decoding | Load before play, or stream smaller files; the per-frame upload budget spreads uploads, and `quality.set({ uploadBytesPerFrame })` lowers it |
| 30 frames per second on a 60 Hz display, with the busiest thread's `cpuMs` a little over one refresh | In pipelined mode, a frame that misses one refresh waits for the next | Cut the CPU work below the refresh interval. Or measure `latency: 'low'`: on a warm Galaxy S24+ it showed 40 frames per second where pipelined mode showed 32. On the iPad keep pipelined mode (`guides/performance`) |
| Frame rate drops after a few minutes on a phone | Heat | Aim for 70% of the budget; test 10-minute runs. The governor lowers a sketch's budgets and the render scale in turn, a budget's step first, then the live shadow settings; lighten your own work in `quality.onChange` by `quality.governor.steps` |

## 5. Phones and tablets

- Test on a real phone. Desktop browsers with device emulation do not show phone GPU or heat behavior.
- Many phones run the WebGL2 path (for example Samsung Exynos phones in Chrome 154). Budget for it.
- On the WebGL2 path (0.2), job workers hide objects that sit behind blocker meshes. The asset tool's `assets optimize` gives one to each mesh that encloses space, and checks that it lies inside the mesh. It skips blended, alpha-masked, skinned and flat meshes. To keep a mesh from blocking, put `"occluder": false` in its glTF extras. In the scene, use `instantiate(model, { occluder: false })` or `setOccluder(false)`. Blockers on small props cost job worker time and hide little (`guides/assets-pipeline`).
- The asset tool stores positions in 16,384 steps across each mesh. A mesh that spreads small parts over hundreds of meters, such as a city's buildings merged by material, then moves their corners by centimeters. Put `"quantizePositions": false` in that mesh's glTF extras to keep its positions as floats (`guides/assets-pipeline`).
- Pixel ratio is the largest GPU lever: a ratio of 3 draws 2.25 times the pixels of a ratio of 2. Presets cap it; do not raise the cap on phones.
- Dynamic resolution is on by default. When frames run over budget, the engine draws the scene at a lower render scale, down to 0.5 on Low. It scales the image up to the canvas, in place of FXAA where the preset uses it. Read it in `quality.renderScale`. `quality.set({ minRenderScale: 1 })` turns it off. One value for both `minRenderScale` and `maxRenderScale` fixes the scale (`concepts/quality-presets`). Draw text and interface in HTML over the canvas, which stays sharp.
- The engine starts phones and tablets on lighter presets than desktops. WebGL2 and WebGPU's compatibility mode run at most Medium. The page reads the preset in `engine.mode.preset`, and `?preset=low` fixes one for a test (`concepts/quality-presets`).
- A page that draws different content on a phone or a tablet than on a desktop asks the engine rather than testing screen width again: `readDeviceHints()` reads the page's hints and `deviceKind()` turns them into `'phone'`, `'tablet'` or `'desktop'`, the same answer the preset chooser used at the start.
- Tablets start at Medium, but a warm tablet can run Medium or High below 60 fps. S4 fell to about 45 fps at Medium on an iPad Pro. At Low it held 60 fps after 5 minutes of warm-up. When a steady rate matters more than sharp shadows, pass `preset: 'low'` to `createEngine`.
- After a start that crashed the tab, the engine starts one preset lower, and at Low after two. A phone that ran out of memory shows it in `engine.mode.crashedStarts`.
- The preset check measures the scene that the setup built, then lowers the preset where the GPU misses the frame rate. Build the first view and load its textures in the setup, or the check measures an empty scene. `engine.mode.presetCheck` shows what it measured (`concepts/quality-presets`). A repeat visit in the same browser takes the stored result and skips the check, unless the page has `?check=fresh`.
- A player's preset choice goes through `quality.setPreset`. It waits for the new preset's pipelines behind the last frame, so call it from a menu or a loading screen. The `skippedDraws` figure of `engine.measure()` counts draws that a building pipeline kept from drawing. It stays at 0 when warm-ups come first.
- Shadows: leave `cascades` and `mapSize` out of a light's `shadow` options, so the preset sets them: two cascades of 1,024 texels on Low, for phones. Keep `distance` no longer than the scene needs. Far cascades draw every few frames by preset. On every preset they draw every frame while a dynamic object touches them, so moving shadows never trail. Set `followMovingCasters: false` to keep their turns where moving objects stay far and small; their shadows then trail by up to the interval less one frame. Raise `farCascadeInterval` to draw them less often, and set `shadowFilter: 3` for cheaper edges. A shadowed spot light draws its casters into one tile of the shadow atlas, and a point light into six. Low and Medium turn point light shadows off and give the atlas fewer tiles, so avoid shadowed point lights on phones.
- Transparent and additive effects covering the screen (smoke, glass) cost the most on phone GPUs.
- For a large rock, cliff or ruin drawn as many copies, run the asset tool with `--lod`. It sorts each large level into pieces, and each copy skips the pieces that lie outside the view or face away from the camera (`concepts/lod`). A mesh made in code of 32,768 triangles or more gets the same pieces with its planned levels. A smaller mesh that many copies draw, such as a building kit's walls, gets a piece for each way it faces. It gets them even with levels set by hand, or from a file that holds one copy and the page copies many times. Build such a kit square to its own axes, so its sides face the six ways that the pieces start from. Keep the material single-sided where it can be: a double-sided material keeps the pieces that face away.
- A large model's levels can download apart from it (0.3). The asset tool's `--lod --stages` keeps the coarsest level in the file and writes each finer level beside it. The loader draws the coarse level at once and refines it as the rest arrive.
- `--clusters --stages` streams a cluster tree the same way. The file holds the tree's first band, and each later band appends patches below it. The tree refines as the bands arrive.
- The loader also holds back a level that the camera never draws. A phone then saves the downloads that its preset would not show, and fetches the level once the camera comes close.
- `assets.loadGltf(url, { maxLevels })` stops after that many levels, so a page whose camera never shows the finest level downloads none of it (`concepts/lod`).
- Memory is tight: a 4 GB iPad reports a 256 MB largest buffer and closes tabs that use too much. Share materials, destroy textures you no longer need, and load large textures from KTX2 files, which stay compressed on the GPU. (0.2) Between levels, destroy the old level's copies, then `prefab.destroy()`: the next level reuses the memory (`api/assets`).
- Texture memory budget (0.2): the preset's `textureMemoryMiB` caps the GPU memory of textures. It is 256 MiB on Low, and at most 1,008 MiB on any phone or tablet. Past it, the engine drops up to 3 of the largest mip levels of textures from files (`assets.loadTexture`, glTF). It drops first where no view needs the detail, then from the textures unseen the longest, then from the largest. It loads the levels again from the file once room returns. Textures from `fromImageBitmap` or `fromData` never drop, so keep big ones in files. Do not raise the budget on phones to stop the drops: the cap stays under half the memory at which an iPad's tab died (`concepts/quality-presets`).
- Repeat visits: the engine keeps transcoded KTX2 textures in its cache of derived data, so a repeat visit skips the transcoder. Keep data that the sketch generates at load, such as a terrain, in a namespace of the same cache: `assets.cache(name, version)` (0.3). A miss costs only the work it saves, so make the data on every miss (`api/assets`, `getting-started/hosting` "Caches between visits").
- For comparison runs, fix the refresh rate at 60 Hz and start with a cool, charged device (engine docs `guides/phones`).

## 6. Memory

| Item | Rough cost | How to reduce |
| --- | --- | --- |
| 2048 x 2048 RGBA8 texture with mipmaps | about 22 MB on the GPU | A KTX2 file, 4 to 8 times smaller on the GPU |
| Same texture as ASTC, BC7 or ETC2 | about 3 to 6 MB | Encode with `basisu -mipmap`, or `bunx @null3d/cli assets optimize` (0.2) |
| One static object | a few hundred bytes of engine data | Instances for many copies |
| One instance row | About 210 bytes of engine memory, 300 with per-row colors or values (0.2: plus 32 bytes of GPU memory), plus your own arrays | Only the columns you need; colors and values only where the batch needs them |
| A new mesh, instance batch, or mesh drawn with a new material, during play | A one-time growth of engine memory in the next frame | Create them during setup; size a batch for its most rows and show fewer with `setActiveCount` |
| Directional light shadows: one map per cascade, 2048 x 2048 at 4 bytes per texel by default | about 16 MB per cascade, 48 MB for the default 3 cascades | Fewer cascades and a smaller `mapSize` in the light's `shadow` option on phones |
| Spot and point light shadows: one atlas tile per spot light, six per point light | 1 MB per 512 x 512 tile, 4 MB per 1024 x 1024 tile | The preset sets the tile count and size; fewer shadowed lights |

A scene's engine memory peaks in its first frame, which copies every mesh. E1109 in a first frame means that peak did not fit. Compare `(await engine.measure(5)).memory.wasmBytes` with `engine.mode.memoryMaximumMiB`, once normally and once with `?direct=on` in the address. The direct draw path needs the most. A timing test at start-up can pick it on Apple GPUs in Safari, and in the browsers of iPhone and iPad. Memory does not shrink, so the reading is the peak. The engine keeps the last 8 MiB under the limit for its own small requests. Fix a scene that comes close by sharing meshes and creating fewer, or by lowering a terrain's `maxLevel`, and ask for a larger maximum last.

`engine.measure()` reports the engine's WebAssembly memory and the JavaScript heaps in `memory`. In the sketch, `textures.memoryBytes` gives the GPU memory that textures hold. In 0.2, `quality.textureMemory` gives it with the budget and the dropped levels, and `debug.frameStats()` reports them as `textureBytes`, `textureBudgetBytes` and `droppedLevels`.

The number of objects and instance rows one scene can draw depends on the GPU path and the device. On WebGPU every device draws 2,097,152, and a device with larger GPU buffers draws more, up to 8,388,480. On WebGL2 the number follows the largest texture the device allows. It is 1,048,576 at the 2,048 pixels that every WebGL2 device allows, 2,097,152 at 4,096, and at most 8,388,608. For the device the page runs on, `engine.capabilities.maxInstances` gives the number. Past it, the call fails with E1501. With worker threads, engine memory stops at 1 GiB by default, about 5 million rows; past that, the call fails with E1109. The `memory` option of `createEngine` raises the maximum up to 4096 MiB (`api/engine`). A larger maximum leaves less address space for other engines and WebAssembly modules on the page. Raise it only for a scene that needs it. In development builds the engine warns once when a scene passes the number that every device of its GPU path draws. That is 2,097,152 on WebGPU and 1,048,576 on WebGL2. The engine picks the GPU path for each device. So test a scene of more than 1,048,576 on both paths, on the devices your users have.

## 7. Quality presets, the governor and your own systems

The engine starts each device on one of four presets: Low, Medium, High or Ultra (`concepts/quality-presets`). Phones start at Low, tablets at Medium and desktops at High. WebGL2 and WebGPU's compatibility mode run at most Medium. When the page names no preset, the engine checks its choice after the first frame, before `createEngine` resolves. It lowers the preset until one holds the target frame rate.

The preset sets the pixel ratio, the render scale, textures, shadows, effects, occlusion culling, anti-aliasing and the memory maximum. Read the settings from the docs, never from memory. `api/quality` links the full list. It says what each setting takes, and whether it changes during play or only at the start. `concepts/quality-preset-tables` gives each preset's value.

The preset tables mark some rows as planned, such as the light caps. A light's own `cascades` and `mapSize`, in its `shadow` options, replace the preset's. The `concepts/quality-presets` page gives the GPU memory that each preset's shadow map and shadow atlas take.

- The sketch reads the preset in `quality.preset`, the heaviest that the GPU path allows in `quality.highest`, and the page in `engine.mode.preset`. Only `quality.setPreset` changes it during play, and it waits for the new preset's pipelines. Call it from a menu or a loading screen. A menu shows the presets above `quality.highest` as unavailable, with the reason.
- `quality.set({ ... })` changes any setting that changes during play, for example from a settings menu, such as `quality.set({ maxPixelRatio: 1.5, fogSlices: 32 })`. A setting fixed at the start, or a value out of range, throws E1213. `createEngine` options set the ones fixed at the start, such as `antialias`, `shadowCascades`, `depthPrepass`, `gpuOcclusion` and `keepTextureCopies`.
- Do not raise the preset of a phone. Check each preset that your users can get with `?preset=low` to `?preset=ultra`.

### The governor

The frame-budget governor keeps the frame rate when the scene is too heavy for the device. It aims for the display's refresh rate, up to 60 frames per second. A game on a 120 or 144 Hz display can defend the full rate with `createEngine({ targetFps: 'display' })` (0.2), at the cost of lighter presets (`concepts/quality-presets`). It judges the frames four times a second, by the slower of the presented and the completed rates. So it also sees a GPU that falls behind while the renderer keeps presenting.

The governor steps down when a second of frames averages under 95% of the target rate, such as 57 at 60. It takes one step at a time, from a sketch's budgets and the render scale in turn, a budget's step first, in the order that `concepts/quality-presets#the-frame-budget-governor` lists.

It raises the settings in the reverse order, each after about 5 seconds with time to spare, so quality does not flicker. A step up that falls behind within 30 seconds doubles the wait before the governor tries that setting again, up to 80 seconds. At 57 to 59 frames per second, the settings stay where they are. The governor takes no step in the first 2 seconds, or while textures wait to upload. It takes a shadow step only where a light casts shadows. It never changes the preset or the settings fixed at the start.

Read the current render scale in `quality.renderScale`, and the shadow settings that frames draw with in `quality.governor`. After each shadow step, `quality.onChange` runs, and `quality.governor.steps` counts the steps past the render scale. Lighten your own systems there. To measure the scene's own cost, turn the governor off: `quality.set({ governor: false })`. The scene then draws at `maxRenderScale`, with the shadow settings as set.

### The depth prepass

With the depth prepass, each camera view first draws the depth of its opaque objects. The opaque pass then shades each pixel once, for its nearest surface. The prepass costs a second pass over the objects' vertices. Both GPU paths draw it, with the same image as without it. Blended objects and alpha-cutoff materials stay out of the prepass. Custom materials and sprites join it with their own vertex shader, so their vertex offsets keep their depth. Ambient occlusion and contact shadows read the prepass. So a masked surface, such as foliage, takes them only where the prepass holds a surface at its own depth. A leaf on the ground takes them, and a petal in front of open grass does not (`concepts/post-processing`).

On WebGL2, every preset turns it on. On Apple GPUs, a depth prepass restores early rejection of hidden pixels in WebGL2. In the S4 benchmark on an iPad, the prepass took WebGL2 from 38 to 60 frames per second on Low. On Medium it went from 17 to 37. Android phones kept their frame rates with it. Do not turn it off on WebGL2 unless you measure the scene on an iPhone or iPad.

On WebGPU, every preset leaves it off: the GPU removes hidden surfaces itself, so the prepass only adds work. S2 is a benchmark scene with little overdraw. In Chrome on a MacBook Pro, the prepass raised its GPU time per frame on WebGPU from 0.28 ms to 0.40 ms. Turn it on there with `createEngine({ depthPrepass: true })` only after you compare the scene's GPU time with `?prepass=on` and `?prepass=off`.

Two opaque surfaces at exactly the same depth show the one drawn last with the prepass, and the one drawn first without it. The engine chooses the draw order, so an exact tie has no defined winner, and it may differ between GPU paths. Give overlapping surfaces, such as decals, a depth bias. Engine docs: `concepts/quality-presets`.

### GPU occlusion culling

With `gpuOcclusion` on, each camera draws the depth of the large opaque objects and instance rows that showed in its last frame, and builds a depth pyramid from it. Then it draws only the objects that show. The image matches the image without it, and no object shows a frame late. The GPU picks the objects that hide others, so nothing needs a mark; `setOccluder(false)` keeps one out. High and Ultra turn it on for desktops, and phones and tablets keep it off. It runs only on WebGPU. Engine docs: `concepts/culling`.

A check during play turns its passes off while they hide less than a tenth of the objects in view or make the GPU's frame longer, so open scenes lose almost nothing. It pays where walls, hills and large objects hide many detailed objects, such as the streets of a city. Compare the scene's GPU time with `?occlusion=on` and `?occlusion=off`. Shadow passes and see-through objects do not use it.

### Half precision

The scene shaders can do their color math at half precision: lighting, tone mapping and sRGB encoding. Positions, depth and shadow lookups keep full precision. It stays off on both GPU paths. On a WebGL2 phone it saved no frame time and moved shadow edges. On an iPad's WebGPU path it saved under 2% of the GPU time. `?half=on` turns it on to measure a scene. WebGPU takes it only on devices with the `shader-f16` feature. `engine.capabilities.halfPrecision` says what the engine took. Custom materials always use full precision. There is no `createEngine` option for it.

### Your own systems

Keep your own values per preset in one table. Apply them in the setup, and again in `quality.onChange`, which runs when a setting changes. Your systems get budgets of their own through `setBudget` (0.2):

```ts
const ai = quality.setBudget({ name: 'ai', ms: 2, min: 0.25, onScale: (s) => { thinkers = Math.round(200 * s); } });  // (0.2)
const RAIN = { low: 2000, medium: 5000, high: 10000, ultra: 10000 };  // one table, keyed by preset
rain.setActiveCount(RAIN[quality.preset]);
quality.onChange(() => { rain.setActiveCount(RAIN[quality.preset]); });
```

`onScale` receives the budget's scale when you register it, and after each change. 1 means full quality. All budgets share one scale that moves in steps of 0.25, down to each budget's `min`. When frames run long, the governor lowers the budgets one step before each render-scale step. So your systems scale down before the render scale reaches `minRenderScale`. It raises them in the reverse order. `ai.ms` is `ms` times the scale. Use it as the time limit for work that you spread over frames, such as path searches. The engine does not time your system. Keep the callbacks cheap; they run when the scale changes, not every frame. Engine docs: `api/quality`.

### Know what a value costs

- Write the number itself in the table, such as `rocks: 3000`, never a level name that each builder reads its own way. Write `null` for a feature that a preset leaves out, and do not create it. A custom effect costs its full-screen pass whatever its uniforms say (`guides/performance`).
- In `quality.onChange` and a budget's `onScale`, change only values: active counts, uniforms and update rates. Creating objects or materials there rebuilds the draw tables, and can build pipelines, on a device that is already behind.
- Know what a value multiplies before you change it. A count costs in a straight line. A grid's columns and rows, and a texture's edge, cost with their square. A spacing between scattered objects changes their count with its inverse square: twice the spacing leaves a quarter of them.
- Count before you choose. Keep generation in plain modules that import nothing from the engine (`references/testing-and-debugging.md`, section 3), and print the count for each candidate value under `bun test`. That takes seconds, where a look in the browser takes minutes.
- Find each value's floor: the point where a lower value shows as a fault, such as a jagged silhouette. Cut elsewhere once a value reaches it.
- Choose Low's values by what a phone still shows. At Low's pixel ratio, distant props and fine scatter often cover less than a pixel, so leave them out. Scaling every value by one factor keeps paying for what nobody sees.
- Spend detail on the objects that make the silhouette, and keep the rest plain. Choosing by importance often saves more than choosing by distance.
- Test the table with `bun test`: each value moves one way from Ultra to Low, and each stays in the range that its builder accepts. The first catches an edit that makes a lighter preset heavier. The second catches a value that a builder refuses and silently skips.

## 8. Per-frame code that allocates nothing

Apply these habits to `onUpdate` and everything it calls.

- Read vectors by index: `const x = v[0]`. Never destructure an array or typed array in per-frame code; `const [x, y, z] = v` makes an iterator on every read.
- Write elements into arrays you already have. `axis.set([0, 1, 0])` builds a new array on every call.
- Build lookup tables and scratch arrays once, in setup or at module level, never inside a function that runs every frame.
- Use `Math.sqrt(x * x + y * y + z * z)` for a length, not `Math.hypot`.
- Keep scratch lists at a fixed length. `list.length = 0` frees the storage, and the next write allocates it again.
- Make no closures, `async` wrappers or promise chains per frame. Keep closures out of per-frame functions, even in a branch that rarely runs. Until the browser optimizes the function, the variables a closure captures are allocated on every call. Move such a branch into its own function.
- A light's, the camera's, a line's and the background's setters allocate nothing, a color included: call them from a small function of their own, as a game's update does. The controls write a camera's pose with `camera.setPose(position, rotation)` from the arrays that hold it, so no number crosses the call.
- A material's `set` is for setup. It reads its numbers from an options object, and the browser boxes a read where it cannot keep the fields unboxed. Change a value that a frame changes with `material.setUniform(name, value)`, which takes the number or the color itself, a custom material's WGSL uniforms included. A line material's `set` allocates nothing: keep one options object and change its values in place.
- Judge allocation after about 30 seconds of play. Until the browser optimizes a function that runs once per frame, the decimal numbers it computes are allocated.

## 9. Objects during play

Some calls rebuild the scene's draw tables in the frame they take effect: the bundle is recorded again and every matrix uploads. Others upload only what they changed. The engine docs page `guides/performance` has the full table.

- Cheap: moving objects, writing batch arrays, `setVisible`, and `setActiveCount`.
- Rebuilds: creating or destroying objects and batches, `setMaterial`, `setParent` and `setDynamic`.
- Create everything a level needs during setup. Hide with `setVisible` instead of destroying.
- Hide spare objects under a hidden parent. Objects under a hidden object stop updating, dynamic ones too, so a pool of hidden moving parts costs almost nothing per frame (`api/objects`).
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
| Download every shader before play | Many features download their shaders on first use, such as skinning, bloom and the sky. `guides/first-use-shaders` lists every such feature by the name that `preload` takes, and when its shaders download; read it rather than guess the names. A masked object casts no shadow until `'cutout'` loads. For a game that must fetch nothing during play, list them: `createEngine({ preload: ['skinning', 'bloom'] })`. They then load, and compile where the files allow, before the first frame. Create the scene's own objects in the setup and `await scene.warmUp()` for the pipelines that depend on materials, which also downloads each file of a custom material's builds that those pipelines need, such as its builds that skin. Leave the list out otherwise: each listed file grows the start |
| Turn off matrix updates for still objects | Objects are static by default and cost nothing until a setter changes them |
| Set a needs-update flag after a change | Setters mark changes themselves |
| Track GPU completion yourself | `engine.measure` reports `completedFps` and `gpuLatencyMs` |
| Limit the frames in flight | The engine holds them to two |
| Count `requestAnimationFrame` callbacks for the frame rate | A callback keeps firing while the GPU falls behind. Take the lower of `presentedFps` and `completedFps` from `engine.measure` |
| Write an adaptive-quality loop of your own | The governor already lowers the render scale, then detail, shadows and effects, and a second loop fights it. Lighten your own systems in `quality.onChange` and through `quality.setBudget` (0.2) |
| Pick a device class from `deviceMemory`, `hardwareConcurrency`, GPU limits or the user agent | The engine picks the preset from the main pointer and the screen's smaller edge, and lowers it after a crash. Read `quality.preset` |
| Resize the shadow map or change sample counts when frames run long | A setting fixed at the start throws E1213 during play. The live settings are uniforms and target sizes, so changing them builds no pipeline |
| Move the renderer into a worker with `transferControlToOffscreen` | The engine draws from a worker already. Give `createEngine` a canvas that no code has drawn on: a canvas with a context cannot move to a worker |
| Yield with `setTimeout(0)` or a `MessageChannel` while the scene builds | The setup runs in the sketch worker, so the page stays responsive. After the first frame, build in a task on the job workers, or in slices per frame (section 11) |
| Cache compiled shaders between visits | No page can store or read the browser's compiled shaders. Time a first visit with `?shaders=fresh` (section 11) |

## 11. Start-up and staged loading

The visitor waits for the setup. `createEngine` resolves after it and after the preset check, and the first frame waits for its pipelines (`guides/loading-screens`). So what the setup builds decides when anything shows.

- Build the first view in the setup, with its textures, and leave the rest for later. The preset check measures what the setup built, so include everything that the first view shows, far scenery in view too.
- Add each later stage whole, in the order the visitor reaches them: create its objects hidden, `await scene.warmUp()`, then show them. A stage that appears piece by piece looks broken, and an object whose pipeline is still building draws nothing.
- Size each batch for the rows of the finished scene, and reveal rows with `setActiveCount`. Destroying an earlier stage's batch to make a larger one rebuilds the draw tables and uploads every matrix again.
- Swap in one run of code. Put no `await` between hiding the old objects and showing the new ones, or a frame can show neither.
- Create every light during setup. A light that appears later starts at intensity 0 and rises with its stage. Creating a light during play rebuilds the draw tables, and the scene's first rectangle or tube light changes its shaders (`guides/performance`).

A large model can stage itself (0.3). A file that the asset tool wrote with `--stages` draws its coarsest level at once, and refines as the rest arrive (section 5).

Generation after the first frame shares the sketch worker with every frame, so one long loop delays the next frame. Heavy generation belongs in a Rust module on the job workers, through `runTask` (0.3), whose answer arrives between frames (SKILL.md section 4, rule 13). Work that stays in the sketch splits into a fixed count of items per frame. A time limit would make hold mode's frame depend on the computer's speed (`references/testing-and-debugging.md`, section 2). A budget (0.2) lowers the count when frames run long:

```ts
// sketch.ts, in the setup. Keep placeRocks in a plain module, so a test runs it over the whole range.
const ROCKS = 40_000;
const rocks = scene.createInstances(rockMesh, ROCKS, { material: rockMaterial });
rocks.setActiveCount(0);                     // the rocks show whole, once all are placed
let placed = 0;
let perFrame = 2_000;
const building = quality.setBudget({ name: 'rocks', ms: 2, min: 0.25, onScale: (s) => { perFrame = Math.round(2_000 * s); } });  // (0.2)
return {
  onUpdate() {
    if (placed === ROCKS) return;
    const to = Math.min(ROCKS, placed + perFrame);
    placeRocks(rocks.positions, placed, to);  // writes rows placed to to-1 of the static batch
    placed = to;
    if (placed < ROCKS) return;
    rocks.markDirty(0, ROCKS);
    rocks.setActiveCount(ROCKS);
    building.remove();
  },
};
```

A plain function over a range of indexes serves tests and frames alike. A generator would do the same, but it makes a result object at every step, which SKILL.md section 4, rule 1, forbids in `onUpdate`.

Measure the start:

- A first visit and a repeat visit take different paths. A repeat visit takes the stored preset check, the transcoded textures, the browser's compiled shaders and your own cache (section 12). Time both from navigation, with the production build on Chrome's Slow 4G profile.
- Reproduce a first visit in a new browser profile, or with `?check=fresh&shaders=fresh&derived-cache=off` (`references/testing-and-debugging.md`, section 4). Never plan a start that holds only when the browser's caches hit.
- `engine.measure()` gives the start's times in `load`, and the page thread's long tasks in `mainThread`. Also click a page control while the engine starts, and time its answer: a page with no long tasks can still answer slowly.

Keep the network clear for the engine. Profile the whole page first, because the page's own downloads share the connection with the engine's:

- Ship only the data and translations that the page shows. A page bundle that carries more delays the engine's own downloads.
- Turn off route prefetching on the page with the scene, and on connections that report `saveData`. Prefetches compete with the engine for the connection.
- Add a `<link rel="preconnect">` for each other origin that the start contacts, such as a CDN for models.
- Start no engine on pages without a scene. In a framework app, check in the network panel when the core's `.wasm` download starts: code that waits for hydration starts it late.

## 12. Caching across visits

Each layer keeps something different, and most are in place already:

| Layer | Keeps | Set up by |
| --- | --- | --- |
| The HTTP cache | The build's files, models and textures | The host: a long lifetime for hashed files (`getting-started/hosting`) |
| The stored preset check | The preset that the check chose, for a week | The engine, in the page's `localStorage` (`concepts/quality-presets`) |
| The cache of derived data | Data that the engine and add-ons make from files, such as each KTX2 file's transcoded texels, and the arrays that your sketch makes | The engine, with no setup. `assets.cache(name, version)` (0.3) gives your sketch a namespace of its own (`api/assets`, "The cache of derived data") |
| Compiled shaders | Shaders that the browser compiled before | The browser alone: no page can store or read them |
| Offline files | The build and your own files | Your service worker (`getting-started/hosting`) |
| A view of a single-page app | The running engine | `engine.detach()` and `engine.attach()` (`references/content-pages.md`) |
| Back and forward | The whole page | The browser (`references/content-pages.md`) |

Keep the data that your sketch generates at load in a namespace of the engine's cache. `guides/content-pages` shows the read path. Cache only what comes back exactly as it went in:

| Data | Cache it? |
| --- | --- |
| Arrays your code computes: positions, indices, heights, scatter rows, noise fields | Yes, as the bytes of typed arrays |
| Pixels read back from a 2D canvas, such as an `OffscreenCanvas` texture | No. The canvas stores partly transparent pixels premultiplied, so they come back changed, and browsers differ. A nearly equal texture hides the fault until it shows |
| Engine objects: meshes, materials, textures, batches | No. Store the arrays that made them, and make them again, such as with `geometry.fromArrays` |
| What the GPU made: environments, pass textures | No. Make them again |

Rules for a namespace of your own:

1. A hit and a miss run the same code after the lookup, so the two cannot build different scenes.
2. Name the namespace for what makes the data, and give it the version of the bytes it makes. Change the version whenever the same key would give other bytes. In a production build, `import.meta.url` names the sketch's file with a hash of its content, so it serves as the version. The first call with a new version deletes the name's older entries.
3. Key each entry by every input that changes the output and that the version does not cover: a data file that the sketch fetches, the quality preset, a seed or a size. Use the file's version or a hash of its bytes.
4. `get` never rejects. It answers `undefined` on a miss, a failed read, an entry that fails its check, and when the cache is off. Make the data on every such answer. The bytes may be a view of a larger buffer, so copy them before you read them as another typed array.
5. `put` returns at once, and the write starts after the call, off the sketch's frames. So it needs no timer and no message from the page. Leave the bytes unchanged until its promise resolves. A write that fails is dropped, and the next visit generates the data again.
6. Skip the cache in development, where `import.meta.url` holds no hash.
7. Code that resolves after the engine stops must not call it, because calls after `engine.destroy()` throw E1420. Set a flag in `onDestroy`, and check it in the cache's callbacks.
8. Test the cache: build the scene's arrays with the cache and without it, and compare them. The `?derived-cache=off` switch turns the whole cache off.

```ts
// sketch.ts: the heights of one terrain tile, from the cache or made again.
const tiles = assets.cache('my-game/terrain', import.meta.url);

async function tile(x: number, z: number): Promise<Float32Array> {
  const key = `${WORLD_SEED}:${x}:${z}`;
  const stored = import.meta.env.DEV ? undefined : await tiles.get(key);
  if (stored) return new Float32Array(stored.slice().buffer);
  const heights = makeHeights(WORLD_SEED, x, z);
  if (!import.meta.env.DEV) void tiles.put(key, new Uint8Array(heights.buffer));
  return heights;
}
```

What browsers keep, and for how long (MDN, "Storage quotas and eviction criteria"):

- The engine's cache keeps every namespace within one budget: a tenth of the storage that the browser allows the origin. Past it, the cache deletes the entries used longest ago.
- An origin may use up to about 60% of the disk in Chromium browsers and in Safari. Firefox gives the smaller of 10% of the disk and 10 GiB per site, or 50% once the site's storage is persistent.
- `localStorage` holds about 5 MiB of text per origin, and no worker can reach it. The engine keeps its crash note and the stored preset check there.
- Safari deletes the storage that scripts wrote for a site that the visitor has not tapped or clicked in seven days of browser use. A web app on the Home Screen counts its own days of use. So a returning Safari visitor may find every cache empty.
- When the disk runs short, browsers delete whole origins, the least recently used first, unless the origin's storage is persistent. Your entries, the engine's texels and the stored preset check go together.
- Do not call `navigator.storage.persist()` for a cache. Firefox asks the visitor, and losing a cache costs only one slower visit.

## 13. Reviewing a scene

Ask these in order, because each answer changes what the next one means.

1. How was the frame rate measured? Trust `engine.measure` or `bunx @null3d/cli bench`, which take the lower of the presented and completed rates. A count of frame callbacks can show 60 while the GPU finishes far fewer.
2. Which preset ran, and what did the governor lower? Read `engine.mode.preset`, `quality.renderScale` and `quality.governor.steps`. Measure with `quality.set({ governor: false })` to see the scene's own cost.
3. How many passes walk the scene in a frame? Count the shadow cascades and tiles that draw, scene passes, the depth prepass, outlines and custom effects before you count triangles (`guides/performance`).
4. What builds or rebuilds during play? `rebuilds`, `pipelines` or `skippedDraws` above zero points to section 9.
5. What does the page show with JavaScript off, after a failed start and after a crash (`references/content-pages.md`)?
6. What happens on a repeat visit and on back navigation? Time both visits (section 11), and check each layer of section 12.
7. Where does the page's thread block during the start? Read `mainThread` from `engine.measure`, and click a control while the engine starts.
8. What does Low leave out? Read the scene's own table per preset. A Low that only scales numbers down is a smaller desktop scene, and it will not hold a phone's frame rate.
