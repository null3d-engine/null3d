# D-14: The engine's JavaScript budget

Status: M1's budget decided by the owner on 2026-09-30, and raised to 80 KB and then 100 KB on 2026-10-01. M2's budgets approved by the owner in writing on 2026-10-04, in [M2](#m2-the-start-and-the-files-that-load-later). The same day the owner added a limit for first-use shader files, two recorded exceptions and the gzip columns, in [Additions of 4 October 2026](#additions-of-4-october-2026). Date: 2026-09-30.

Summary: M1: up to 100 KB for the engine's JavaScript that a page downloads, per thread mode and GPU path. M2: up to 140 KB at a page's start, and up to 16 KB for each file that loads on first use or after the first frame. A feature that a page does not use loads its code on first use. Each first-use shader file may take about 24 KB. Draco's decoder (59 KB) and, after 1.0, the area-light tables are recorded exceptions. The size report adds gzip and uncompressed columns: with gzip a WebGL2 page downloads 496 KB at its start.

## Question

M1's exit gate holds the engine's JavaScript that a page downloads to 60 KB after Brotli in each thread mode. Only the owner can revise that budget, in writing. A pipelined page downloaded 36.9 KB early on 30 September and 49.5 KB that afternoon. Most of M1 has not merged yet. How does the rest of M1 fit, and what does each way cost?

## Rule

Take an option when, by the estimate below, it keeps every thread mode on each GPU path within the budget at the gate. The estimate may be 20% low, so leave room for that. An option must add no round trip before the first frame of a page that does not use the feature. It may add one round trip at a feature's first use, if the page waits for that feature anyway, as it does for a texture.

## Data

All sizes are KB (1,024 bytes) after Brotli at quality 11, as `bun run build` prints them. They come from production builds of the engine test page on the MacBook Pro.

### Where the bytes went

Main at 0ec7313 (#90), before the changes below. What a pipelined page downloaded:

| File | KB | Holds |
| --- | --- | --- |
| `page.js` | 14.8 | `createEngine`, the device probe, input capture, the error fix table, frame figures |
| `sketch-worker.js` | 11.2 | the sketch runner and the scene API |
| `render-worker.js` | 21.7 | the renderers and GPU backends of both GPU paths, and all shader text |
| `job-worker.js` | 1.6 | the core loader |
| `probe-worker.js` | 0.3 | the worker probe |
| Total | 49.5 | |

The largest modules in that download, by what each adds to its files after Brotli:

| Module | KB | Note |
| --- | --- | --- |
| `gpu/webgl2/backend.ts` | 4.6 | not run on a WebGPU page |
| `generated/shaders.ts` | 3.6 | 1.3 KB of WGSL and 1.7 KB of GLSL; a page runs one language |
| `page/engine.ts` | 2.8 | |
| `shared/metrics.ts` | 2.3 | in 3 files |
| `shared/core.ts` | 2.2 | in 4 files |
| `gpu/webgpu/backend.ts` | 2.1 | not run on a WebGL2 page |
| `scene/scene.ts` | 1.9 | |
| `sketch/input.ts` | 1.8 | |
| `errors/fixes.ts` | 1.7 | the fix text of every error code |
| `page/capabilities.ts` | 1.6 | |
| `shared/control.ts` | 1.2 | in 4 files |
| `page/frame-stats.ts` | 1.2 | used by `engine.measure()` only |

What a page downloaded but did not run:

- A WebGPU page carried the other path's code, about 5.5 KB of WebGL2 code and 1.7 KB of GLSL. A WebGL2 page carried about 5.1 KB of WebGPU code and 1.3 KB of WGSL.
- Each thread checked that the core had every function the engine calls, and shipped the list of names (0.9 KB in all). Only a development setup can fail that check.
- Each TypeScript enum shipped every member's name, in each thread's file (1.4 KB in all).
- Each worker file is a bundle of its own, so shared helpers sat in up to four files. They are the core loader, the metrics writer, the control block, the error class and the worker protocol. They came to 8.5 KB in all, 5.7 KB of it copies.
- Some code serves rare calls: the error fix table (1.7 KB, read only when an error is thrown) and the frame figures of `engine.measure()` (1.2 KB).

Test shaders did not ship: the bundler already left them out.

### Growth in M1 so far

Each main commit that changed the download, built again with the same tools. Pipelined totals:

| Commit | Change | Pipelined KB | Step |
| --- | --- | --- | --- |
| e54f443 (#39) | the error text once, the sketch runner on demand | 36.9 | |
| 0de1b1a (#41) | hold mode | 38.1 | +1.1 |
| 394bafb (#43) | GPU layer operations | 40.5 | +2.4 |
| b7ff671 (#44) | error codes in production builds | 40.9 | +0.4 |
| 104ea31 (#48) | frame builders on the render graph | 41.1 | +0.2 |
| 84d63e6 (#56) | math helpers | 41.3 | +0.2 |
| 32588f5 (#54) | sketch input | 44.5 | +3.2 |
| 954e59e (#47) | WebGL2 depth | 44.9 | +0.4 |
| 5fefcdb (#52) | vertex formats and `fromArrays` | 46.5 | +1.6 |
| 3bdede0, 751e8e6, 00307d0 | `Material.set`, grid cells, the memory option | 47.0 | +0.5 |
| 5b8e221 (#49) | GPU time per pass | 48.5 | +1.5 |
| 9a25687 to 93e0f6a | pointer input, the early sketch download, the pipeline cache | 48.7 | +0.3 |
| 432cf87 (#80) | geometry generators | 49.1 | +0.4 |
| 85c687e, 5efb459 | render layers, the row warning | 49.5 | +0.5 |

Fourteen feature merges added 12.6 KB, about 0.9 KB each. The other thread modes grew at about the same rate.

The open pull requests add, each against its own base:

- GPU textures (#76): +3.3 KB
- quality presets (#86): +2.2 KB
- the object API (#84): +1.2 KB
- the sketch context (#79): +0.5 KB
- orthographic cameras (#82): +0.4 KB

Together they add 7.6 KB, which would take main to about 57 KB.

### What this record's pull requests changed

| Pull request | Change | Pipelined, WebGPU | Pipelined, WebGL2 |
| --- | --- | --- | --- |
| #91 | the core function check in development builds only | -1.3 KB | -1.3 KB |
| #95 | enums as plain constants, which the bundler writes in as numbers | -1.8 KB | -1.8 KB |
| #103 | a page downloads the renderers of its own GPU path only | -5.9 KB | -6.9 KB |

Each thread mode on each GPU path, on main at 0ec7313 and with all three:

| Thread mode | Before | After, WebGPU | After, WebGL2 |
| --- | --- | --- | --- |
| pipelined | 49.5 | 40.6 | 39.6 |
| low latency | 47.5 | 39.4 | 38.4 |
| drawing on the main thread | 47.3 | 40.0 | 39.7 |
| single-threaded | 43.2 | 37.2 | 37.0 |

The split by GPU path adds no round trip. Three cold loads of each mode on Slow 4G (`bun run bench:startup --modes pipelined,low-latency,single-threaded`) gave these medians of the first frame done:

| Thread mode | main | #103 |
| --- | --- | --- |
| pipelined | 4215 ms | 4223 ms |
| low latency | 4203 ms | 4204 ms |
| single-threaded | 3207 ms | 3181 ms |

A first version of #103 had the low-latency sketch worker load its renderer as two files, one after the other. That mode was 110 ms slower in every run. Inside one worker's build, the bundler puts the code that two on-demand files share into a third file, which each of them imports. In a worker nothing fetches that file early, so it costs a round trip. #103 gives that worker one entry file per GPU path instead. On the page, Vite fetches such a shared file together with the file that imports it.

After the three changes, helpers copied into several files still come to 5.9 KB, 3.8 KB of it copies.

### What the rest of M1 adds

Estimates for one GPU path, from each task's scope and the measured steps above. Code that only one GPU path runs now counts once.

| Task | What adds to the download | Estimate, KB |
| --- | --- | --- |
| #76, #79, #82, #84, #86 | measured; the textures' backend code now counts for one path | 7.0 |
| M1-A4, M1-A5 | HDR targets, `post.set`, the anti-aliasing setting | 1.3 |
| M1-A6 (rest, #99) | pipeline warm-up, `scene.warmUp`, the loader of each path's shaders | 0.7 |
| M1-C4 | `sketchThread: 'main'`, `engine.capture()` | 0.8 |
| M1-D4, M1-D7 | the texture and asset API, the KTX2 format choice and the calls to its transcoder | 2.8 |
| M1-D5, M1-D6 | material options, the WebGL2 material texture, alpha modes and blend states | 1.8 |
| M1-E1 to M1-E4 | light objects and their setters, cluster data, fog | 1.9 |
| M1-F1 to M1-F4 | shadow options and depth texture arrays | 0.8 |
| M1-G1, M1-G3, M1-G4, M1-G5 | the warm-up benchmark, `setPreset`, dynamic resolution, the governor | 2.1 |
| M1-H4 | `materials.shader` and its uniforms | 1.0 |
| M1-I3 | debug drawing: nothing, since release builds drop it | 0.0 |
| M1-I4 | the stats overlay and debug views | 1.2 |
| Shader text (D-13) | the standard material, lights, shadows, fog and tone mapping at 5 permutation bits, in one file per GPU path and per bits fixed at start | 3.7 on WebGPU, 4.3 on WebGL2 |
| Total | | about 25 |

The shader row comes from the measurements for D-13, which sized stand-in shader code like the real features. From about 40 KB after this record's changes, M1 would end near 66 KB on WebGPU and 65 KB on WebGL2. At the 0.9 KB average of the merges so far, the remaining tasks come to about the same. The single-threaded mode stays about 3 KB below the others.

### Options for the rest

| Option | Saves at the gate | Costs |
| --- | --- | --- |
| A. Load texture and asset loading on first use (M1-D4, M1-D7) | 2.8 KB for every page; a page with textures downloads it later | one round trip at the first texture or asset call, at least 562 ms on Slow 4G, unless the call starts the file's download before its code arrives |
| B. Load the governor, dynamic resolution and the warm-up benchmark after the first frame (M1-G3 to M1-G5) | 2.1 KB before the first frame | none before the first frame; every page still downloads it, later |
| C. Load `materials.shader` on first use (M1-H4) | 1.0 KB for pages without custom materials | one round trip in the sketch setup of pages with them |
| D. Load the stats overlay and debug views on first use (M1-I4) | 1.2 KB | one round trip when a developer turns them on |
| E. Load the frame figures of `engine.measure()` on its first call, which is already asynchronous | 1.2 KB | one round trip on the first measurement |
| F. Error fix text in development builds only; release messages keep the code, the message and the docs link | 1.7 KB now, about 2.5 KB at the gate | a release build's message says where to read the fix, not the fix itself, which bends design principle 10 |
| G. One copy of the shared helpers for all worker files, by shipping the engine's workers prebuilt with shared files (with M1-M5's packages) | about 3.8 KB | a build step for the engine package; each worker takes the shared file from the browser's cache, as the page loaded it first |
| H. Revise the budget | | the owner's call, such as 60 KB for what a page needs before its first frame, with files that load later reported but not budgeted |

## Decision

Decided by the owner on 2026-09-30:

- The engine's JavaScript that a page downloads may take up to 70 KB after Brotli, in each thread mode on each GPU path, for now. The standard material's shaders take a pipelined page to about 57 KB, and texture maps, shadows and lights add more before the gate.
- The budget may rise again, but only with the owner's approval in writing. Until then, a pull request that passes 70 KB fails the size check.

On 2026-10-01 the owner raised the budget to 80 KB, in writing. With texture maps, HDR color and dynamic resolution on main, a pipelined page downloaded 67.3 KB. Anti-aliasing, clustered lighting, transparency, custom materials and shadows still had to land. The owner chose to raise the budget rather than wait for the size cuts in the options table. The renderer split by GPU path (#103) stays set aside. A further raise again needs the owner's approval in writing; a pull request that passes 80 KB fails the size check until then.

Later on 2026-10-01 the owner raised the budget to 100 KB, in writing:

> allow for 100kb size budget. we will trim later on.

FXAA, shadows on WebGPU, transparency, KTX2 textures and custom materials had merged since the raise to 80 KB. A pipelined page then downloaded 74.6 KB, 93% of the 80 KB budget, and the other thread modes 68.9 KB to 73.1 KB. Shadows on WebGL2 and clustered lighting still had to land. The owner plans to trim the download back later, and the size cuts in the options table stay the way to do it. A further raise again needs the owner's approval in writing; a pull request that passes 100 KB fails the size check until then.

The options in the table stay open, and each task can still take one to keep the download down. The proposal before the owner's decision was:

1. Keep 60 KB for the code that a page downloads before its first frame, in each thread mode on each GPU path. Report files that load on first use or after the first frame beside it, without a budget, as M1-D7 already asks for the KTX2 transcoder.
2. Take options A to E as their tasks land:
   - M1-D4 and M1-D7 load texture and asset loading on first use.
   - M1-G3 to M1-G5 load after the first frame.
   - M1-H4 and M1-I4 load on first use.
   - `engine.measure()` loads its figures on its first call.

   The estimate at the gate then falls to about 57 KB, or 61 KB if it is 20% low.
3. Take G with M1-M5's packages, which brings the estimate to about 54 KB, or 57 KB if it is 20% low. F saves less and bends principle 10, so keep it in reserve.
4. Put every new check of a developer's mistake behind the development flag, and add no TypeScript enum to engine code.

## Consequences

- The size report prints each thread mode on each GPU path (#103). Files that load on first use or after the first frame need rows of their own, apart from the budgeted total.
- The pull requests of the tasks in point 2 state how their code loads, and the round trip that its first use costs.
- D-13 settles how shader text ships. This record counts each path's shader file in the download before the first frame, since a page needs it to draw.
- Add the record to the table in [README.md](README.md). When the owner decides, update its status and the budget line in AGENTS.md if point 1 changes it.

## M2: the start and the files that load later

Status: accepted. The owner approved the budgets in writing on 2026-10-04. Task: M2-R5.

### Question

A pipelined page downloads 98.8 KB of the 100 KB budget once M2-C3's skinning on WebGPU merges (#264). Most of M2's features have not landed yet. The owner answered for M2 on 3 October 2026: the budget may rise in M2, and nothing is trimmed yet, because loading efficiency comes later. Code that loads on first use is counted and budgeted apart. What budgets hold for the rest of M2?

### Rule

- A budget holds every thread mode on each GPU path until the M2 gate, by the estimate below. It leaves room for the estimate to be 20% low, as M1's did.
- Code that a page does not use adds nothing to its start. It loads on first use, in a file that the size report lists apart from the start. That file has a budget of its own.
- Nothing is trimmed now (the owner, 3 October).

### Data

All sizes are KB (1,024 bytes) after Brotli at quality 11, as `bun run build` prints them. Main is at a70f34e (#261). #264 is M2-C3 at 33a4920, as its CI measured it.

What a pipelined page downloads at its start:

| File | Main | With #264 |
| --- | --- | --- |
| `page.js` | 22.2 | 22.2 |
| `sketch-worker.js` | 26.8 | 26.9 |
| `render-worker.js` | 24.9 | 25.0 |
| `job-worker.js` | 0.9 | 0.9 |
| `probe-worker.js` | 0.4 | 0.4 |
| The largest shader file | 19.5 | 23.5 |
| Total | 94.6 | 98.8 |

#264's SKIN variants make each WebGPU shader file about 4 KB larger after Brotli. Before compression, the files doubled from 0.8 MB to 1.6 MB. Its pull request says that 2.3 to 3.5 KB of the 4 KB go if D-20 keeps the compute pass. With #264, the other thread modes download 92.3 to 97.0 KB. On 2026-10-04, main at 9ef7c7a (#265) measured 99.9 KB for a pipelined page. The other thread modes measured 93.3 to 98.1 KB. The largest file that loads later was `gltf-worker.js`, at 5.8 KB.

What the code of each area adds to the pipelined start with #264. Each figure is a file's size after Brotli, less its size with the area's code taken out. The rest, about 11 KB, is code that the bundler adds and the bytes that the areas share after compression.

| Area | KB | Note |
| --- | --- | --- |
| Shader text, `generated/` | 24.3 | One file for each GPU path and each value of the bits that a device fixes (D-13). Each file holds the shaders of every feature, bloom and color grading among them |
| The scene API, `scene/` | 11.5 | `scene.ts` 5.1, resources 1.9, mesh arrays 1.4, assets 1.0, textures 1.0, queries 0.7 |
| The page, `page/` | 11.4 | `engine.ts` 4.4, the device probe 1.7, the frame figures of `engine.measure()` 1.2, limits 1.2 |
| The WebGL2 backend, `gpu/webgl2/` | 7.8 | The render worker holds both GPU paths, so a WebGPU page downloads this code and does not run it |
| The WebGPU backend, `gpu/webgpu/` | 7.1 | The same, for a WebGL2 page |
| Shared helpers, `shared/` | 5.7 | The metrics writer 2.5 and the core loader 1.0, in several workers' files |
| The sketch runner and input, `sketch/` | 5.0 | |
| Error text, `errors/` | 4.2 | The fix text of every error code is 3.1 of it |
| The renderer, `render/` | 3.4 | |
| Presets and the governor, `quality/` | 3.1 | |
| Workers, math, debug and shared GPU code | 4.0 | |

Growth of a pipelined page's start on main in M2. The sizes come from the records that size checks keep for main's commits. A row that joins several commits had no record for the commits between them.

| Commits | Change | KB | Step |
| --- | --- | --- | --- |
| ce48c00 | M1's last change before M2 | 85.2 | |
| 69b252b to cde351f | cube and 3D textures, clips on the job workers, the BVHs, two GPU fixes | 86.0 | +0.8 |
| 3b79b9d, cf673ad | a shadow fix, the animator | 86.6 | +0.6 |
| 926dde9 | bloom | 88.3 | +1.7 |
| 99eecef, 944689f | typed uniforms, glTF's vertex types | 90.0 | +1.7 |
| f980a75, 2ab66e2 | the glTF loader, whose code loads on first use, and a shadow fix | 92.9 | +2.9 |
| b0c9d55, 21de365 | raycasts and overlap queries, a governor fix | 94.0 | +1.1 |
| a70f34e | color grading and the vignette, whose table readers load on first use | 94.6 | +0.7 |
| #264 | skinning on WebGPU | 98.8 | +4.2 |

Eleven features and their fixes added 13.6 KB, about 1.2 KB for each feature. The glTF loader, the color grading tables and the KTX2 transcoder load on first use. But each feature still adds its API to the scene API, and its shaders to every shader file. The shader file grew from 17.2 KB to 23.5 KB, so 6.3 KB of the 13.6 KB went into it.

What the rest of M2 adds to the start, by estimate. Each estimate comes from the task's scope and the merges above. Code that loads on first use adds nothing here.

| Tasks | What adds to the start | KB |
| --- | --- | --- |
| M2-C4 | Skinning in the WebGL2 renderer. Its GLSL variants stay under the size of the WebGPU shader file, which the start counts | 0.5 |
| M2-C5 | MORPH variants in the shaders, like SKIN's 4 KB, and the morph weights API | 4.0 |
| M2-C7 | Little: skins and clips from glTF files go into the glTF loader's files, and release builds drop `debug.skeleton` | 0.2 |
| M2-A4 | The texture memory budget, which drops and restores mip levels | 0.8 |
| M2-D3 to M2-D5 | `screenToRay`, pointer events on objects, HTML labels and the page's label loop | 2.5 |
| M2-E2, M2-E3 | Environment light in the lit shaders, and sky and environment backgrounds. The built-in room environment loads on first use | 4.0 |
| M2-F2 | Ambient occlusion: its passes and shaders | 2.2 |
| M2-F4 to M2-F6 | Outlines, custom effects, custom passes and render targets | 4.0 |
| M2-G1 to M2-G3 | Sprites, points and wide lines, with their shaders | 4.0 |
| M2-H1 | `largeWorld` and batch origins | 0.8 |
| M2-I1, M2-I2 | Occlusion culling: the depth pyramid and the test shaders on WebGPU, the blocker data on WebGL2. The software culling runs in WebAssembly | 2.5 |
| M2-J3, M2-K1, M2-R1, M2-R2 | Material textures and `destroy`, the index-only test switch, cascade blending, the WebGL2 prepass | 1.7 |
| M2-R6 | M1's engine follow-ups | 0.8 |
| The P0 tasks | | about 28 |
| The P1 tasks | Draco and HDR files load on first use. The rest: crowd rates, GPU picking, the shadow catcher, LOD groups, bump and displacement maps, custom instance attributes and `quality.setBudget` | about 5 |

The rate of M2's merges so far gives about the same figure: about 25 P0 tasks with runtime code remain, at about 1.2 KB each. From 98.8 KB, the P0 tasks take a pipelined page to about 127 KB, or about 132 KB if the estimate is 20% low. The P1 tasks add about 6 KB more with the same margin, which gives about 138 KB.

The files that load later, with #264. No start counts them:

| File | KB | Loads |
| --- | --- | --- |
| `gltf-worker.js` | 5.8 | with the first glTF file |
| `page-gltf.js`, `sketch-worker-gltf.js` | 3.0 | with the first glTF file, in the thread that runs the sketch |
| `page-ktx2.js`, `sketch-worker-ktx2.js` | 1.9 | with the first KTX2 file |
| `page-lut.js`, `sketch-worker-lut.js` | 1.7 | with the first color grading table |
| `page-stats-overlay.js` and the frame figures' files | 0.8 to 0.9 | when the sketch asks for the overlay or its frame figures |
| The WebGL call timing files | 0.9 | only with `?gl-timing`, on benchmark pages |
| The preset check's files | 0.4 to 0.5 | after the first frame, unless a stored result skips the check (D-17) |

M2-A3's meshopt decoder (#263) adds `gltf-meshopt.js`, 6.2 KB, with the first file that holds meshopt data. M2-C7 adds skins, clips and morph targets to the glTF worker, about 3 KB by estimate, which takes the worker to about 9 KB. The KTX2 transcoder's module, 361 KB, keeps its own section with no budget, beside meshopt's module. Since M2-R18 the engine builds the transcoder itself, without code made from strings. Its script goes into the KTX2 task's file: 8.9 KB, within the 16 KB limit. The meshopt decoder became a module of 3.1 KB and a script of 0.4 KB.

What the budgets cost in time. The startup benchmark's Slow 4G profile downloads 157,500 bytes per second. A page's JavaScript shares the link with the core's 206 KB. At that rate, the 41 KB from 98.8 KB to 140 KB add about 0.27 s to a cold start. A cold load on the MacBook Pro took 4.0 s on Slow 4G on 30 September 2026. A file of 16 KB that loads on first use takes about 0.1 s on the same link. Its round trip of at least 562 ms comes on top. Where the loader starts both downloads at once, as the glTF loader does, that round trip overlaps the download of the feature's own data.

### Decision

1. The start: up to 140 KB after Brotli for the engine's JavaScript that a page downloads at its start. The budget holds in each thread mode on each GPU path. That is the estimate for the M2 gate with all the P1 tasks and a 20% margin. The shader file and each path's renderer count as before.
2. The files that load later: up to 16 KB after Brotli for each file of engine code that no thread mode downloads at its start. Each such file loads on a feature's first use, or after the first frame. The largest that M2 expects is the glTF worker at about 9 KB. The size report lists each file apart from the start, with its share of the budget. Third-party builds that the engine ships as they are, such as the KTX2 transcoder, keep a section of their own with no budget.
3. The chunk rule for M2: a feature that a page does not use adds nothing to its start. Its code loads on first use, in a part that `ENGINE_PARTS` in `tools/lib/size-report.ts` names with the part that loads it. The engine test "a page that uses no feature that loads on first use downloads none of their files" checks every such part. It runs in every thread mode on both GPU paths, on the dev server and in a production build.
4. Trim nothing in M2, as the owner asked. When loading efficiency comes, the areas above give the order. Each needs its own work and measurements, and none is part of this decision:
   - Shader text on first use: each feature's shaders in a file of their own, which loads with the feature. The shader files are the largest part of the start, and most of M2's growth goes into them.
   - One GPU path's backend for each page. The render worker holds both, and a page does not run 7.1 to 7.8 KB of it. #103 split them once. The split was set aside.
   - The fix text of the error codes in development builds only, 3.1 KB. It bends design principle 10, as option F says.
   - One copy of the shared helpers for all workers, as option G gives.

The owner approved the budgets of points 1 and 2 in writing on 2026-10-04. Point 4 follows the owner's answer of 3 October. A pull request that passes either budget fails the size check.

### Consequences

- `tools/lib/size-report.ts` holds the budgets (`START_BUDGET` and `LATER_BUDGET`) and the parts that load later (`LATER_PARTS`). Each budget has a size for every column of the report, as [the section below](#m2-gzip-and-uncompressed-budgets) gives them. `budgetProblems` judges both budgets in every column. The size report prints the parts that load later in a section of their own.
- AGENTS.md, the README and [Benchmarks](../benchmarks.md#download-size) give the new figures. A further raise of either budget needs the owner's approval in writing, recorded here.

## Additions of 4 October 2026

Status: decided by the owner on 2026-10-04. Tasks: M2-C5, M2-E2, M2-A6, M2-R11.

### First-use shader files

The morph builds (M2-C5) and the room's generator (M2-E2, [D-19](D-19-environment-maps.md)) put their shaders in files of their own, which load when the feature first runs. A shader file is mostly WGSL or GLSL text, and the start's shader file alone is about 24 KB after Brotli. So the 16 KB limit for first-use JavaScript does not fit it.

The owner's decision: each shader file that loads on first use may take about 24 KB after Brotli, the size of the start's shader file. The size report lists these files apart from the start, with their share of that limit. The first two use little of it: the room's shaders are 4.2 KB of WGSL or 4.4 KB of GLSL.

On 5 October 2026 the owner raised the limit to 32 KB after Brotli. The sun's shadow filter came to compare each shadow map texel with the receiver's plane at that texel. That added 4 to 6% to the WebGL2 morph files, which were about 23.2 to 23.3 KB on main. Two of them then passed 24 KB: `shaders-glsl-tone-map-morph-half.js` at 24,702 B and `shaders-glsl-draw-index-tone-map-morph-half.js` at 24,758 B. A loop in place of the filter's written-out blocks on WebGL2 saved at most 57 B. The growth is the cost of correct shadows, and the exposure and the specular maps would soon pass a tighter limit too. The other limits stay. The start keeps 140 KB after Brotli, 448 KB after gzip and 3,328 KB raw. Each first-use file keeps 320 KB after gzip and 1,536 KB raw.

This is also the way to trim the start. Each feature's shaders move into a file of their own (M2-R11, with its own record D-56, [D-53](D-53-technique-defaults.md) ruling 23).

### Recorded exceptions

| File | After Brotli | Loads | Why it may pass its limit |
| --- | --- | --- | --- |
| Draco's glTF-only decoder: 49 KB of WebAssembly and 10 KB of JavaScript | 59 KB | On first use, only for files that hold Draco data, in the glTF worker, once per page ([D-54](D-54-addon-modules.md)) | The owner decided on 4 October 2026 that the engine reads Draco files. Draco's authors build the decoder, and no smaller build reads glTF's Draco data. The first figure quoted, 66 KB, was the full build's `.wasm` alone |
| The two fitted tables of area lights, as half floats | To be measured when built | On first use, with the first area light, after 1.0 | Every engine with rectangle lights uses fitted tables, and they cannot be made at load at a sensible cost ([D-53](D-53-technique-defaults.md) ruling 20). The tables are data, so they are also an exception to the rule that built-in assets are made at run time |

The Draco decoder is a third-party build. Its module may go in the size report's section of first-use WebAssembly, beside the KTX2 transcoder's and meshopt's, which have no budget. Either way, a page that reads no Draco file never downloads it. Its script must make no code from strings, or a page's Content-Security-Policy without `'unsafe-eval'` stops it, as it stopped the official KTX2 transcoder (M2-R18). The engine then builds it from its release's sources, as it builds the transcoder.

Built (M2-A6, 8 October 2026, [D-112](D-112-draco-decoding.md)): the official script makes no code from strings, so the engine ships the release's files unchanged. After Brotli, the module is 48,764 B, Draco's script 9,480 B and the engine's Draco code 1,775 B: 60,019 B in all. Each script stays within the 16 KB limit, so the exception covers the module alone, which the size report lists among the first-use WebAssembly modules with this record's name.

### Hosts that compress with gzip

The budgets count bytes after Brotli. Many hosts compress with gzip instead: GitHub Pages and nginx's defaults among them. The library code review measured what a page downloads at its start there (R8-02, [Code review, October 2026](../code-review-2026-10.md)):

A pipelined WebGL2 page, in a fresh project's production build:

| Compression | The page's shader file (GLSL) | The rest of the start | The start | Against the 140 KB budget |
| --- | --- | --- | --- | --- |
| Brotli 11, which the budget measures | 23.4 KB | 82.4 KB | 105.8 KB | 76% |
| Brotli 5, a common setting for compression on the fly | 27.6 KB | 87.9 KB | 115.5 KB | 83% |
| gzip 9 | 402.6 KB | 93.5 KB | 496 KB | 354% |
| gzip 6 | 495.2 KB | 94.1 KB | 589 KB | 421% |
| None | 3,368 KB | 264 KB | 3.6 MB | |

A WebGPU page with gzip 9 downloads 378 KB at its start. Each shader file holds every variant of every template as a full text, 87 WGSL modules or 164 GLSL programs. Brotli at quality 11 finds the repeats across its 4 MB window, and gzip's 32 KB window cannot. 35 of the 164 GLSL stage sources are exact copies, 543 KB in all (R6-03).

The owner's decision (ruling 23 of D-53):

- The size report adds a gzip column and an uncompressed column beside Brotli, for the start and for each file that loads later. Later the same day the owner also approved budgets in those columns ([the next section](#m2-gzip-and-uncompressed-budgets)).
- The size is fixed at its cause, not by a budget. The cure is per-feature shader files, and one copy of each unique shader stage per file, with variants as indexes into it.

### Consequences

- M2-C5 adds the shader files' limit, with the WebGL2 morph builds as the first such files ([D-51](D-51-morph-targets.md)). M2-R11 makes the morph builds one of its first-use features, `[first_use.morph]` in the shader manifest ([D-56](D-56-first-use-shader-files.md)). `FIRST_USE_SHADER_BUDGET` in `tools/lib/size-report.ts` holds the limit in each column, and `budgetProblems` judges each first-use shader file against it. The size report prints them in a section of their own, which no start counts. AGENTS.md and [Benchmarks](../benchmarks.md#download-size) give the figure.
- `tools/lib/size-report.ts` gains the exceptions' rows and the two columns.
- M2-A6 builds Draco on the on-demand loader of [D-54](D-54-addon-modules.md), and its pull request gives the decoder's measured size.
- M2-R11 measures the start in each column before and after, and writes the figures here and in [D-13](D-13-shader-variants.md).

## M2: gzip and uncompressed budgets

Status: accepted. The owner approved every budget below in writing on 2026-10-04. Task: M2-R14, from review R8 (R8-02).

### Question

The budgets above count each file after Brotli at quality 11. As [the section above](#hosts-that-compress-with-gzip) shows, a page on a gzip host downloads about four times what the Brotli budget shows. A host that sends files as they are sends about 30 times as much. The [D-13 addendum](D-13-shader-variants.md#addendum-2026-10-04-measured-again-after-the-duplicate-sources-went) gives today's figures. Nothing stopped them from growing. What budgets hold the start and the files that load later on such hosts?

### Rule

- Each budget has a size for each way a host can send a file: as it is, after gzip and after Brotli. A file over its budget in any column fails the build.
- gzip is measured at level 9. A host that compresses its files once, when it deploys them, sends them so. Hosts that compress on the fly at a lower level send more: the start's shader file is about a third larger with gzip 6.
- The start's gzip and uncompressed budgets hold today's largest start with about a tenth to spare. Per-feature shader files (M2-R11) move code out of the start, so these figures are expected to fall. Brotli's budgets stay as the section above decided them.

### Data

On 2026-10-04, main at dc178379 with this task's branch, from `bun run build`. Sizes are KB (1,024 bytes).

What a page downloads at its start, in each thread mode:

| Thread mode | Raw | gzip 9 | Brotli 11 |
| --- | --- | --- | --- |
| pipelined | 3,040.6 | 402.7 | 106.9 |
| low latency | 3,034.5 | 400.5 | 105.1 |
| drawing on the main thread | 3,033.7 | 400.5 | 105.1 |
| single-threaded | 3,018.3 | 395.1 | 100.4 |
| sketch on the main thread | 3,027.0 | 398.1 | 102.9 |

The shader file is 2,654.4 KB raw and 299.0 KB with gzip 9 of the pipelined start. The rest of the start is 386.2 KB raw and 103.7 KB with gzip 9.

The largest JavaScript file that loads later is `gltf-worker.js`: 27.5 KB raw, 10.4 KB with gzip 9 and 9.4 KB with Brotli 11. The next are `gltf-meshopt.js` (25.7, 7.0 and 6.2 KB) and the glTF loader's files (16.4, 6.7 and 6.0 KB).

### Decision

| Budget | Raw | gzip 9 | Brotli 11 | Largest today |
| --- | --- | --- | --- | --- |
| The start, in the thread mode that downloads the most | 3,328 KB | 448 KB | 140 KB | 3,040.6 / 402.7 / 106.9 KB (pipelined) |
| Each JavaScript file that loads later | 64 KB | 24 KB | 16 KB | 27.5 / 10.4 / 9.4 KB (`gltf-worker.js`) |
| Each shader file that loads on a feature's first use (M2-R11) | 1,536 KB | 320 KB (224 KB until 5 October, [below](#addendum-5-october-2026-first-use-shader-files-after-gzip)) | 32 KB (24 KB until 5 October, [above](#first-use-shader-files)) | 1,324.5 / 199.4 / 16.1 KB (skinning's GLSL file for the draw index, the 8-bit output and half precision) |

The start's gzip and uncompressed budgets are about 10% above today's largest start. Per-feature shader files bring both down. The budgets of the files that load later are 1.5 times their Brotli budget with gzip and 4 times it uncompressed. The largest such file uses 43% of each.

Shader text compresses far better than code, so the JavaScript files' proportions do not fit the shader files. An earlier proposal of 80 KB with gzip and 576 KB uncompressed was too small for skinning's file. Record D-56 gives the reasons and M2-R11's figures.

The owner approved the three rows in writing on 2026-10-04. A raise of any budget in any column needs the owner's approval in writing, recorded here.

The same day, the owner made Vite with the null3D plugin the one supported build ([D-54](D-54-addon-modules.md#bundlers)). The budgets hold for that build. Without the plugin, Vite builds each engine worker as one classic script with every shader file in it. Each worker is then about 34 MB, which no budget can hold (review R8, R8-07). The plugin builds workers as ES modules and warns when another setting replaces that.

### Consequences

- `tools/lib/size-report.ts` measures each file in three columns (`COLUMNS`, `measure`). Each budget is a `Budget` with a size for each column. `budgetProblems` gives one problem for each column over its budget. The size report prints every column with its share of the budget.
- The hosting guide tells developers to serve the engine's files with Brotli, and gives the gzip and uncompressed sizes of the start.
- AGENTS.md, the README and [Benchmarks](../benchmarks.md#download-size) give the budgets in all three columns.
- `FIRST_USE_SHADER_BUDGET` in `tools/lib/size-report.ts` holds the limits of each shader file of a feature that loads on first use. The size report lists those files in a section of their own.

### Addendum, 5 October 2026: first-use shader files after gzip

Status: decided by the owner on 2026-10-05.

Environment lighting (M2-E2, #283) adds image-based light to the lit templates, so every SKIN and MORPH build grew. With it merged into M2-R11, eight skinning and morph files passed the 224 KB gzip limit. Every file stayed within the Brotli and uncompressed limits:

| Largest first-use shader files | Uncompressed | gzip 9 | Brotli 11 |
| --- | --- | --- | --- |
| Skinning, WebGPU, 8-bit output and half precision | 1,182.3 KB | 270.0 KB | 18.7 KB |
| Skinning, WebGL2 with the draw index, 8-bit output and half precision | 1,444.4 KB | 255.5 KB | 19.7 KB |
| Morph, WebGL2 with the draw index, 8-bit output and half precision | 1,209.2 KB | 233.7 KB | 17.7 KB |
| The limits until this addendum | 1,536 KB | 224 KB | 24 KB |

The owner's decision: the gzip limit of each first-use shader file rises from 224 KB to 320 KB. The uncompressed limit stays 1,536 KB. The same day the owner raised the Brotli limit from 24 KB to 32 KB for the shadow filter's growth ([above](#first-use-shader-files)). The reason: browsers download over HTTPS with Brotli wherever the host offers it, and the Brotli limit holds. Only a host without Brotli sends gzip, and a file of a feature loads only on that feature's first use. 320 KB leaves about a sixth above the largest file today.

`FIRST_USE_SHADER_BUDGET.gzip` in `tools/lib/size-report.ts` holds the new limit. AGENTS.md, the README, [Benchmarks](../benchmarks.md#download-size), D-51 and D-56 give it.
