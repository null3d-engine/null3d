# D-14: The engine's JavaScript budget

Status: M1's budget decided by the owner on 2026-09-30, and raised to 80 KB and then 100 KB on 2026-10-01. M2's budgets approved by the owner in writing on 2026-10-04, in [M2](#m2-the-start-and-the-files-that-load-later). The same day the owner added a limit for first-use shader files, two recorded exceptions and the gzip columns, in [Additions of 4 October 2026](#additions-of-4-october-2026). On 14 October 2026 the owner raised the start to 145 KB and then to 160 KB after Brotli, and each first-use shader file to 48 KB after Brotli. On 15 October 2026 the owner returned the gzip and uncompressed figures to 448 KB and 3,328 KB, and raised the start's Brotli figure to 165 KB and each first-use shader file to 49 KB, in [The figures raised on 14 and 15 October 2026](#the-figures-raised-on-14-and-15-october-2026), raised the start's Brotli figure to 166 KB on 18 October 2026, in [The fourth raise](#the-fourth-raise-18-october-2026-the-start-to-166-kb), and to 176 KB the same day with a reclaim, in [The fifth raise](#the-fifth-raise-18-october-2026-the-start-to-176-kb-with-a-reclaim). On 19 October 2026 the owner accepted about 45 ms of extra cold start and permitted a raise when a feature needs one, in [The owner's standing ruling](#the-owners-standing-ruling-19-october-2026). Date: 2026-09-30.

Summary: The engine's JavaScript that a page downloads at its start may take 176 KB after Brotli, 448 KB after gzip and 3,328 KB uncompressed, in each thread mode on each GPU path. Each file that loads on first use or after the first frame may take 16 KB after Brotli. Each first-use shader file may take 49 KB after Brotli, 320 KB after gzip and 1,536 KB uncompressed. A feature that a page does not use loads its code on first use. Draco's decoder (59 KB) and, after 1.0, the area-light tables are recorded exceptions. The WebGL2 shader text drives the growth: every raise went to it, and the start sat at 99.8% of its budget within hours of the second one ([The trend](#the-trend-and-the-task-that-tracks-it)).

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
| The two fitted tables of area lights, as half floats | 19.3 KB, a gzip file that Brotli cannot shrink further ([D-145](D-145-area-lights.md)) | On first use, with the first area light. Built in M2-EX28 ([D-142](D-142-more-techniques-before-1-0.md)) | Every engine with rectangle lights uses fitted tables, and they cannot be made at load at a sensible cost ([D-53](D-53-technique-defaults.md) ruling 20). The tables are data, so they are also an exception to the rule that built-in assets are made at run time |

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

## One GPU path's renderers for each page, 9 October 2026

Status: done in the pull request of `perf/smaller-start`. Task: the start's size before 1.0 (D-117).

### Question

On main at ea5cb60eb, a pipelined page on WebGPU downloaded 137.9 KB of its 140 KB at its start. Depth of field (#453) adds 0.4 KB more. Transmission, per-row batch values and a prototype of temporal anti-aliasing must still land before 1.0 ([D-117](D-117-showcase-features-before-1-0.md)). Only the owner raises the budget. Which code that a page does not need at its start can leave it, in every thread mode? The engine must do the same work, draw as fast, and keep its API.

### Data

Each start file of the engine test page's production build, split by module with its source map. "Saves" is the file's size after Brotli less its size with the module's code taken out. The largest modules:

| File | Brotli | Largest modules, and what each saves |
| --- | --- | --- |
| `render-worker.js` | 35.0 KB | the WebGL2 backend 8.2 KB, the WebGPU backend 3.7 KB, WebGPU's pipelines 3.0 KB, the shader loaders 1.8 KB, the scene renderers 1.2 KB, the frame loop 1.2 KB |
| `sketch-worker.js` | 45.2 KB | the scene API 7.8 KB, the sketch runner 3.4 KB, resources 2.5 KB, assets 2.1 KB, mesh arrays 2.1 KB, sketch input 2.0 KB |
| `page.js` | 30.8 KB | `createEngine` 5.7 KB, the error fix text 4.6 KB, the device probe 1.8 KB, the metrics writer 1.4 KB, `engine.measure`'s figures 1.2 KB |

The file of the thread that draws held the renderers and backends of both GPU paths, and a page runs one. A WebGPU page downloaded about 9 KB of WebGL2 code that it never ran, and a WebGL2 page about 9 KB of WebGPU code. In M1, pull request 103 split them once, and the owner set that aside on 3 October 2026. The other candidates were near 1 KB each, and each would change when something happens. They were the frame figures of `engine.measure` on its first call, and the quality governor after the first frame. Others were pointer events on objects at the first handler, and GPU timing at the first measurement. The error fix text bends design principle 10, as option F says.

### What changed

- Each GPU path's renderers moved into a module of their own: `render/webgpu-renderers.ts` and `render/webgl2-renderers.ts`. `createRenderer` imports the one of its path. The rest of the drawing code stays where it was: the frame loops, the GPU loss recovery, the shader loaders and the renderer interface.
- Right after the probe, the page tells the thread that draws its GPU path. The message (`load-shaders`) already started the download of the device's shader file. Now it also starts the path's renderers (`preloadDeviceFiles`). So they download beside the shader file while the core downloads.
- The bundler puts the code that both paths' renderers use into a third file, which each path's file imports. It holds the frame replay, the completion trackers, the readback, the GPU memory count, joined effects and the vertex format helpers: 3.3 KB. On the page, Vite loads a file's imports together with the file. In a worker it does not. A worker would then ask for the third file only once its path's file had arrived, one round trip later. That round trip falls while the core downloads. There each round trip that the start waits for costs at least 562 ms on Slow 4G ([Start order](../implementation-notes.md#start-order)). So the null3D Vite plugin now does in each worker build what Vite does on the page (`worker-preload.ts`). An import on demand also starts the downloads of the files that its file imports and the worker lacks.
- The WebGPU pipelines and the WebGL2 programs read the development constant themselves, as the KTX2 loader does. Their development builds add the debug views' templates. With the shared constant, the bundler kept the debug views' shaders in the start file of a production build. The check that drops them folds only inside the file that holds it. That cost about 13 KB after Brotli in the render worker's file.
- The size report gives each thread mode on each GPU path. A path's start counts its own renderers, the shared file and its own largest shader file.

Rejected:

- An entry file of the render worker for each path, as #103 had. The page starts its workers before it probes the GPU, so their scripts and the core's loader download while the core does. A worker for one path could start only after the probe, about a round trip later.
- Steering the bundler to keep the shared code in the start file. A bare import keeps a module only when the bundler finds side effects in it, and that held for one of the eight modules. Re-exports through one module change nothing, since the bundler follows them to each name's own module. A module of re-exports that loads beside the path's file split the page's start file into four.

### Results

`bun run build:check-size` against main at ea4df4b37, with depth of field. KB after Brotli at quality 11, and after gzip at level 9:

| Thread mode and GPU path | Main, Brotli | This change, Brotli | Saved | Main, gzip | This change, gzip |
| --- | --- | --- | --- | --- | --- |
| pipelined, WebGPU | 138.3 KB | 129.9 KB | 8.5 KB | 176.2 KB | 165.0 KB |
| pipelined, WebGL2 | 136.1 KB | 127.1 KB | 9.0 KB | 178.0 KB | 166.4 KB |
| low latency, WebGPU | 136.0 KB | 127.3 KB | 8.7 KB | 173.4 KB | 162.1 KB |
| low latency, WebGL2 | 133.7 KB | 124.6 KB | 9.2 KB | 175.2 KB | 163.6 KB |
| drawing on the main thread, WebGPU | 135.6 KB | 127.0 KB | 8.6 KB | 173.1 KB | 161.7 KB |
| drawing on the main thread, WebGL2 | 133.4 KB | 124.2 KB | 9.2 KB | 174.9 KB | 163.1 KB |
| single-threaded, WebGPU | 128.8 KB | 120.2 KB | 8.6 KB | 165.2 KB | 153.9 KB |
| single-threaded, WebGL2 | 126.6 KB | 117.4 KB | 9.2 KB | 167.0 KB | 155.2 KB |
| sketch on the main thread, WebGPU | 132.8 KB | 124.3 KB | 8.5 KB | 169.8 KB | 158.5 KB |
| sketch on the main thread, WebGL2 | 130.6 KB | 121.5 KB | 9.0 KB | 171.6 KB | 160.0 KB |

On main, the size report counted each mode with the largest shader file of either path, a WebGPU file. The rows for WebGL2 above count the largest GLSL file instead. The largest start is now 129.9 KB, 93% of the budget. That leaves 10.1 KB for the features before 1.0.

After Brotli, the render worker's own file is 10.5 KB. Its WebGPU renderers take 12.7 KB, its WebGL2 renderers 12.3 KB and the shared file 3.2 KB. In three files, a path's code takes about 1 KB more than in one file, because each file compresses alone.

The start makes two more requests: the path's renderers and the shared file. It is not slower. `bun run bench:startup --modes all` made three cold loads of each mode on Slow 4G, against main at ea5cb60eb. It ran on a MacBook Pro in Chrome 155 on 9 October 2026, while the machine's load was below 8. The medians of the first frame done, in ms:

| Thread mode | WebGPU, main | WebGPU, this change | WebGL2, main | WebGL2, this change |
| --- | --- | --- | --- | --- |
| pipelined | 4,834 | 4,797 | 4,833 | 4,781 |
| low latency | 4,790 | 4,760 | 4,802 | 4,751 |
| single-threaded | 4,731 | 4,693 | 4,719 | 4,682 |
| drawing on the main thread | 5,080 | 5,052 | 5,066 | 5,019 |
| sketch on the main thread | 4,783 | 4,749 | 4,784 | 4,723 |

Every mode on both paths drew its first frame 28 to 61 ms sooner, with 8.3 to 9.4 KB less to download after compression.

The renderers draw the same commands with the same shaders. `bun run bench:gpu-check` found no page slower than its rule allows. At Medium, S4's GPU time stayed at 3.91 ms and S6's went from 4.95 to 4.84 ms. At High the runs spread by 9 to 19%, and the check judged both scenes the same. The lowest S4 run was 2.76 ms on main and 2.77 ms with this change.

### Consequences

- `DOWNLOADS` in `tools/lib/size-report.ts` holds each thread mode on each GPU path, and `drawingParts` names the files that each thread that draws loads on demand.
- A file that loads on demand must not keep code of the start's files alive through a development check. It reads the development constant itself.
- The offline file list (`null3d-files.json`, D-102) puts both paths' renderers and the shared file in `start`. So a cached game also starts offline on the path that its first visit did not draw with. A unit test of `offline.ts` checks the list, and `bun run test:packages` starts the fresh project offline on both paths. A page that switches paths, such as a benchmark page, runs each path in a load of its own. It downloads each path's renderers the first time it draws with that path.
- An engine test checks that a page downloads its own GPU path's renderers and not the other path's. It is the test "a page that uses no feature that loads on first use downloads none of their files".

## The figures raised on 14 and 15 October 2026

Status: decided by the owner on 14 October 2026 in two raises on the same day, and raised a third time on 15 October 2026. Date: 2026-10-15.

### The first raise: the start to 145 KB

The owner raised the start's Brotli budget from 140 KB to 145 KB on 14 October 2026, in answer to the coordinator's question. That question asked for about 145 KB after Brotli. It named no gzip or uncompressed figure.

The M2 features had reached the old 140 KB limit. By 14 October main itself was a few bytes over. Four finished features could not land: SSR (899 B over with its first-use reflections bit), reflection probes (1,211 B), auto exposure (701 B) and lit fog (515 B). Each helper had trimmed its own start code in turn (R6, R31, EX29, R10). That turned the limit into a lottery, where each engine landing risked a red build. The 5 KB raise gave room for those features and for the features that follow, without a redesign of each one.

The same change (`b521bc7b1`) also raised the start's other two budgets, to keep the old proportions: gzip from 448 KB to 464 KB, and uncompressed from 3,328 KB to 3,448 KB. The owner gave those two figures without written words. On 15 October 2026 the owner ruled that the raise was "approved in chat, words not kept", and returned both to 448 KB and 3,328 KB. The Brotli figures stand; the ruling raised the start's Brotli figure a third time, below.

### The second raise: the start to 160 KB and first-use shader files to 48 KB

Later the same day the raised start budget was over again, and the first-use shader files were over their budget too. The owner raised two Brotli figures: the start from 145 KB to 160 KB, and each first-use shader file from 32 KB to 48 KB. The owner gave these figures in the chat, and on 15 October 2026 ruled that the record should say the words were not kept. Both figures stand. The gzip and uncompressed figures stayed at first, because both still passed with headroom.

#### What the build measured

A fresh worktree at main `cfd44ef44`, after `bun install`, and plain `bun run build`, which exited 1. The budget checks are absolute, so the base commit does not matter.

Five start modes were over, all WebGL2. Every WebGPU mode passed.

| Mode | Brotli | Share of 145 KB |
| --- | ---: | ---: |
| pipelined, WebGL2 | 162,305 B | 109.3% |
| low latency, WebGL2 | 159,271 B | 107.3% |
| drawing on the main thread, WebGL2 | 158,870 B | 107.0% |
| sketch on the main thread, WebGL2 | 155,837 B | 105.0% |
| single-threaded, WebGL2 | 150,701 B | 101.5% |

392 of the 657 first-use shader files were over 32 KB, from 33,748 to 43,029 bytes. All 392 were GLSL. No WGSL first-use file was over, and the largest was about 21 KB. The largest files were the sets of several features, such as `js/shaders-area-lights-and-morph-and-skinning-and-transmission-glsl-draw-index-tone-map-half.js` at 43,029 bytes. The gzip and uncompressed columns passed everywhere: the largest first-use file was 171.9 KB of 320 KB after gzip, and 1,005.1 KB of 1,536 KB uncompressed.

#### The cause

The two overruns share one cause: the GLSL shader text is three to four times the WGSL text, because naga writes each stage's full text into every program.

- The start. `budgetProblems` scores each thread mode as its other parts plus the largest start shader module. The other parts are 116 to 119 KB in every mode. The WGSL start module (`js/shaders-wgsl*.js`) is 25.8 to 27.4 KB after Brotli, and the GLSL one (`js/shaders-glsl*.js`) is 40.5 to 42.2 KB. That gap of about 15 KB is the whole overrun, and it is the same in each mode. So the start overrun is a WebGL2 shader-text problem, not general growth: pipelined WebGPU sat at 144.5 KB, 99.7% of the budget before this raise.
- The first-use files. A first-use file holds every build of one feature set, for one target and one value of the bits that a device fixes (`first_use_files` in `crates/null3d-shaders/src/typescript.rs`). `[first_use.*]` then named 31 features. D-56 set the limit at 32 KB, when the largest file was about 20 KB. Since then, area lights, transmission, weighted blending, row values, level-of-detail fade, coverage and hash each added a permutation to the mesh templates. The 32 KB figure had become smaller than a start shader file itself, about 42 KB, so its anchor no longer held.
- The combined files are not the cause. The change that gives a build of several features a file of its own separates builds, and does not merge them. Of the 392 files over, 320 are such combined files. The other 72 are single-feature files that predate that change: `skinning`, `morph`, `area-lights`, `row-values`, `lod-fade`, `coverage`, `hash`, `weighted` and `transmission`.

#### The decision

| Budget | Before | Worst measured | After |
| --- | ---: | ---: | ---: |
| The start, after Brotli | 145 KB | 162,305 B | 160 KB |
| Each first-use shader file, after Brotli | 32 KB | 43,029 B | 48 KB |
| The start, after gzip | 464 KB | 279.6 KB | 448 KB |
| The start, uncompressed | 3,448 KB | 1,326.1 KB | 3,328 KB |
| A first-use shader file, after gzip | 320 KB | 171.9 KB | 320 KB |
| A first-use shader file, uncompressed | 1,536 KB | 1,005.1 KB | 1,536 KB |

`START_BUDGET` and `FIRST_USE_SHADER_BUDGET` in `tools/lib/size-report.ts` hold the figures. At the new figures the worst start mode was 158.5 KB, with 1.5 KB to spare, and the worst first-use file 42.0 KB, with 6 KB to spare. The gzip and uncompressed figures returned to 448 KB and 3,328 KB on 15 October 2026, as the first raise above records.

#### Why not shrink the files

Splitting each first-use module further, by shader template, would put each file under 32 KB. But it only moves bytes between files: a page still downloads the same builds, in more requests. It also needs a new loader key, since the tables are keyed by feature set, and it does nothing for the start.

The start can shrink only by moving builds that a page draws with out of the start module and into a first-use file. That delays the first drawn frame for ordinary materials, which D-56 forbids: no frame draws a feature half done. So the start budget rose instead.

### The third raise, 15 October 2026: the start to 165 KB

Main's own build was over the budget. The pipelined WebGL2 start measured 162.2 KB after Brotli against 160 KB, so a landing failed the size check on main's bundle rather than on its own change: showcase-hud-1, cargo-isolation-1 and ex32-probes-1 each stopped there on 15 October 2026. The WebGPU start measured 147.1 KB and passed. The raise of 14 October had left less than a day of headroom, and the WebGL2 shader text is what filled it, as the section above predicted.

The owner raised the start's Brotli budget from 160 KB to 165 KB, which leaves 2.8 KB of headroom, and chose that figure over trimming the start at once. The owner recorded the trim as a later task: "we can trim later on". The same day's earlier ruling returned the gzip and uncompressed figures to 448 KB and 3,328 KB, which the raise of 14 October had changed with no written words.

### The fourth raise, 18 October 2026: the start to 166 KB

The screen-space reflections of M2-EX22 add about 1.6 KB of real start code. Their settings, their share of the governor's steps and the names of their core calls all load with every page. Main's own start measured 167,351 bytes after Brotli, 163.4 KB. The branch's pipelined WebGL2 start came to 169,010 bytes. That is 50 bytes over the old line of 165 KB, 168,960 bytes.

The owner raised the start's Brotli budget from 165 KB to 166 KB in writing on 18 October 2026. The owner ruled out a trim of the reflections' code. The gzip and uncompressed figures are unchanged at 448 KB and 3,328 KB. `START_BUDGET` in `tools/lib/size-report.ts` holds the new figure, with the reason beside it.

### The fifth raise, 18 October 2026: the start to 176 KB, with a reclaim

The rest of M2's start code arrived after the fourth raise: the still view, the surfaces that let
light through, the skin scatter, and the draw probe back in its worker's script, where every page
downloads it. The pull request's pipelined WebGL2 start measured 170,517 bytes after Brotli,
169,984 bytes being the 166 KB line, so 533 bytes over. The probe's return to the worker adds about
1.1 KB, and the reflection probes still to land add about 1.4 KB in every lit build.

The owner raised the start's Brotli budget to 176 KB, 180,224 bytes, in writing on 18 October 2026,
with about 4 KB of headroom for the features still to land. The gzip and uncompressed figures are
unchanged at 448 KB and 3,328 KB. The owner also asked for the reclaim that this record has named
since 4 October: the frame figures behind `measure()` (about 1.2 KB after Brotli) and the error-fix
table (about 1.7 KB) load on their first use, so the raise is a ceiling for the end of M2 rather
than a new resting size. The reclaim is a task of its own, and the start should come back under the
166 KB line once it lands.

`START_BUDGET` in `tools/lib/size-report.ts` holds the new figure, with the reason beside it.

### The probe's measurement in each start, 18 October 2026

The size report undercounted every start that probes the drawing path. The probe worker's
`draw-path-probe.ts` loads on demand from the probe worker, and every device with WebGPU probes
that path whichever path the page draws with. The report listed the file among those that load
after the start, so no start counted its 1,134 bytes after Brotli.

`DOWNLOADS` in `tools/lib/size-report.ts` now names the part in every start. The report's start
figures rise by that figure, and the later-parts section no longer lists the file.

### The reclaim, 18 October 2026: the start to 161.8 KB

The reclaim that this record has named since 4 October landed on 18 October 2026. Two blocks of
code left the start. Every page downloaded them, but few pages read them:

- The frame figures behind `engine.measure` load at the first measurement, in a file of their own.
  `threadRoles`, the one piece of that module that the start reads, moved to `shared/metrics.ts`,
  which every page already loads.
- The table of error fixes loads in each thread at its first error. Until it arrives the error
  carries its code and detail. The fix then completes the message, so the error reports the whole
  message once the file arrives. A failed start waits for the file before it rejects, so its error
  reports the whole message at once.

The page no longer hands the table to its workers: each thread loads it where it raises its first
error. The sketch worker's first synchronous errors reach the sketch before the text arrives, so
their messages gain the fix shortly after. The sketch worker loads the text once, and later errors
carry it at once.

The split moved three small modules that many files share into files of their own, which every
page loads: the message helper, the GPU constants and the control block. Together they take
913 bytes after Brotli and three requests. The page asks for all three while it loads, so they do
not add a round trip in turn.

The pipelined WebGL2 start fell from 171,526 bytes to 165,632 bytes after Brotli, under the 166 KB
line of 169,984 bytes that the owner named by 4,352 bytes. The budget stays at 176 KB as the
ceiling for the end of M2. The new files measure 1,755 bytes for the frame figures and 5,453 bytes
for the fixes after Brotli, and the sketch worker's copy of the fixes 5,454 bytes.

The two figures count the probe worker's direct-path file in both builds, as [the section
above](#the-probes-measurement-in-each-start-18-october-2026) records.

### The first-use files raised, 15 October 2026: 48 KB to 49 KB

The screen-space reflections work was over budget on two of its device modules rather than on the
start: 49,684 and 49,567 bytes after Brotli against 48 KB, so 532 and 415 bytes over. Both are GLSL
combination builds of main's area-lights feature, and the reflections' lit code sits in every lit
build. That is the same cause that filled the start budget before the raise above.

The owner raised each first-use shader file's Brotli budget from 48 KB to 49 KB. That clears both
files with about half a kilobyte to spare. The alternative was to move the reflections' lit code into
a first-use module of its own, which the branch had recorded as D-134's reflections bit: it would
bring both files under the old figure, at about 900 extra GLSL programs and a rebalance of the Safari
shard guard. The owner chose the raise, as they did for the start, because half a kilobyte is not
worth 900 programs.

`FIRST_USE_SHADER_BUDGET` in `tools/lib/size-report.ts` holds the new figure. The gzip and
uncompressed figures for a first-use file are unchanged at 320 KB and 1,536 KB.

### The combination tables raised, 18 October 2026: 64 KB to 96 KB raw

The M2-EX36 branch's translucency builds grew the four generated combination tables, the lists of
module addresses for the builds that need several features. Each table gains one set of address
lines for each pair of bits that the builds form, so the translucency bit's many pairs took the
largest table from under 64 KB to 84,635 bytes uncompressed after Brotli, past [`LATER_BUDGET`]'s
raw figure. Their compressed figures stayed small: 6.7 to 7.2 KB after Brotli against 16 KB.

The owner's ruling of 18 October 2026 gave the combination tables a raw limit of their own, 96 KB,
matched by the `-combos` part of the file name, and left every compressed limit as it was. A
compressed figure is what a page downloads; the raw one guards the hosts that send files as they
are, and the table is a list of short addresses that compresses far better than code. Splitting
each table into more files would have needed a change to the shader build and to the loader, which
the owner judged not worth it.

`COMBOS_BUDGET` in `tools/lib/size-report.ts` holds the figure. The size check names the four grown
files, and their `Size-Growth:` trailers give the reason on this branch.

### The trend, and the task that tracks it

The start budget rose from 140 KB to 145 KB in the morning and was over again within hours. Hours after the raise to 160 KB, the light probe grid's figures put the pipelined WebGL2 start at 159.6 KB, 99.8% of the new budget ([D-146](D-146-light-probe-grid.md)). Every raise so far went to the GLSL side, and the WebGL2 start module is the binding one. The next landing that adds a mesh-template permutation moves it again.


### The owner's standing ruling, 19 October 2026

The owner accepts about 45 ms of extra cold start and permits raising the start budget when a
feature needs the room. The cost is about 6.5 ms per kilobyte of start download on the Galaxy S24+,
against the 5.5 s cold-start target ([D-83](D-83-gate-rulings-2026-10-06.md)). No raise was needed on this date:
the worst start measured 167.5 KB of the 176 KB budget, so 8.5 KB remained.

The reclaimed code stays out. The frame figures behind `engine.measure()` and the error-fix table
serve measurements and error text, not drawing, so no page loses anything it uses to draw.

### Where the start's bytes are, 22 October 2026

M3-T1 trims the start back under 160 KB. The first step measured the pipelined WebGL2 start of the
milestone branch, 183,810 bytes after Brotli, part by part, with the report's own tooling: a page
build at `target/js-size`, and `downloadSizes` over its parts.

| Part | Bytes after Brotli | Holds |
| --- | --- | --- |
| The WebGL2 shader device file | 51,334 | the largest of the twelve device modules a device may load |
| `sketch-worker.js` | 61,360 | the scene API and its feature modules |
| `page.js` | 30,360 | the page's start, the quality preset tables and the probes |
| `render-worker.js` | 18,245 | the frame loop, the recovery and the protocol |
| `render-worker-webgl2.js` | 14,123 | the WebGL2 renderer |
| `render-worker-gpu-shared.js` | 3,883 | the scene renderer of both paths |
| The other six parts | 4,505 | the probe worker, the job worker, the small shared modules |

The shader file is not the lever it was. Removing whole templates from it, and whole permutation
builds of the standard material, barely changes its compressed size: dropping 193,000 characters of
build text saves 1,096 bytes, because the builds are near copies of each other and Brotli already
holds them once. The device modules are a floor of about 33 KB on WebGPU and 51 KB on WebGL2 until
the shader library itself shrinks.

The code is the lever, and its cost is spread across many modules rather than held in one. The
scene API's own modules are about 24 KB of the sketch worker. Its feature modules are about 37 KB,
and each one is a few kilobytes: the post settings, the assets loader, the texture and mesh array
creators, the queries, the picks, the cameras, the background, the fog, the reflection probes, the
probe grid, the object events and the labels.

A feature module can load on its first use only where its calls can answer later. The loader of
files answers with promises already, so its module moves out of the start with no API change. A
setter that validates its arguments and throws an error code for a bad one cannot: the error must
reach the caller at the call, so the module that holds its checks and its message text stays. That
is why the sprites, lines, particles, area lights, light images, glTF, KTX2 and panorama code could
move, and the setters could not.

`budgetWarnings` in `tools/lib/size-report.ts` now prints a warning for each start past 97% of the
budget, so a start that is about to pass it is named while the build still passes. M3-T1 asked for
that guard.

### What a first-use file costs the report, 22 October 2026

Moving the file loader out of the start showed that a deferral is not free for the size report. The
bundler put the loader's dependencies in files of their own and kept second copies of three shared
modules that the start still needs. The report names one built file for each part. It finds the
file that a part loads by reading the text of the part that loads it, one level deep. So a loader
whose dependencies load from the loader's own file needs a part for each of them. Each part must
come after it in the list, and each copy needs a part of its own.

The measurement of that attempt: the sketch worker's file fell from 212,171 to 195,829 bytes. The
page's fell from 93,189 to 90,546, about 4.7 KB and 0.8 KB after Brotli. The change waits until the
report can follow a chunk graph, so that the copies and the nested loaders need no part of their
own. The guard and every other finding of this section stand.

### The file loader's first use, measured, 22 October 2026

The build of the milestone branch with the file loader loading on first use measured these starts,
in bytes after Brotli:

| Start | Before | After |
| --- | --- | --- |
| pipelined, WebGL2 | 183,810 | 178,096 |
| low latency, WebGL2 | 180,422 | 174,848 |
| drawing on the main thread, WebGL2 | 181,689 | 176,007 |
| sketch on the main thread, WebGL2 | 174,261 | 170,842 |
| single-threaded, WebGL2 | 170,426 | 167,039 |
| pipelined, WebGPU | 167,753 | 162,039 |
| drawing on the main thread, WebGPU | 165,801 | 160,165 |
| low latency, WebGPU | 164,452 | 158,817 |
| sketch on the main thread, WebGPU | 158,204 | 154,785 |
| single-threaded, WebGPU | 154,538 | 151,197 |

Every start passes the 176 KB budget, and every WebGPU start passes 160 KB. The WebGL2 starts still
sit above 160 KB, because of the shader file that this section measured.

That build also held an experiment that moved the sky's write out of the start, which measured
about 860 bytes and is not part of the change: without it, the figure above for each start that
loads the sketch worker rises by about that much.

### The files that the first-use loader added, measured, 22 October 2026

The build of the milestone branch names ten files that grew past the limit of the size check. Six
are new files, and four are files that grew. None of the six new files loads at a page's start.
These are their sizes after Brotli:

| File | Base | This build |
| --- | ---: | ---: |
| `js/page-assets.js` | new | 3,865 |
| `js/page-assets-core.js` | new | 302 |
| `js/page-assets-check.js` | new | 188 |
| `js/page-shader-features.js` | new | 960 |
| `js/sketch-worker-assets.js` | new | 3,717 |
| `js/sketch-worker-worker-start.js` | new | 1,033 |
| `js/sketch-worker.js` | 57,489 | 60,220 |
| `js/page-control.js` | 508 | 721 |
| `single/null3d.js` | 17,267 | 18,008 |
| `threaded/null3d.js` | 17,439 | 18,178 |

The loader's file names two shared modules, the core tables and the quality check. Each one needs a
copy of its own there, because the start keeps its own. The report follows that chain, so each copy
holds a part in the list.

The worker's start grew by 2,731 bytes after Brotli, which is the cost of the deferral. The starts
table above shows the other side of it: every start that the loader left fell by between 3,341 and
5,714 bytes. A page that reads no file still downloads the worker's start, so the cost stands.

The WebAssembly bindings grew by about 800 bytes in each mode, from this milestone's new exports.
The control table gained the 3D label's entries.

### The fog, picks and pointer-event move, measured and dropped, 22 October 2026

M3-T1 asked for the start to fall to 155 KB. The sections above show why the shader file cannot give
those bytes back, so the task turned to moving features onto their first use. The three moves were
the fog's write, the picks and the objects' pointer events. The move was built and measured, and it
cost the start more than it saved. It was dropped, and the table is here so that nobody repeats it.

The two builds' size records, read with one report implementation, in bytes after Brotli:

| Start | Before | With the move | Difference |
| --- | --- | --- | --- |
| pipelined, WebGL2 | 182,116 | 183,569 | +1,453 |
| pipelined, WebGPU | 166,159 | 167,612 | +1,453 |
| low latency, WebGL2 | 178,803 | 180,171 | +1,368 |
| low latency, WebGPU | 162,854 | 164,208 | +1,354 |
| drawing on the main thread, WebGL2 | 180,088 | 181,521 | +1,433 |
| drawing on the main thread, WebGPU | 164,326 | 165,794 | +1,468 |
| single-threaded, WebGL2 | 168,992 | 169,558 | +566 |
| single-threaded, WebGPU | 153,230 | 153,831 | +601 |
| sketch on the main thread, WebGL2 | 172,716 | 173,302 | +586 |
| sketch on the main thread, WebGPU | 156,759 | 157,345 | +586 |

The parts say why. The moves themselves did what they should: `page-fog.js` 266 bytes,
`sketch-worker-fog.js` 256, `page-picks.js` 841 and `sketch-worker-picks.js` 811, with
`page-sketch-runner.js` down 298, `sketch-worker.js` down 34 and `sketch-worker-renderer.js` down
133. That is about 1.1 KB out of each threaded start.

Then the deferral made the error class a file of its own: `page-engine-error.js` 789 bytes and
`sketch-worker-engine-error.js` 603. A module that several files share moves into a file of its own
when one of them loads on demand, and each start imports that file. A 1.6 KB file compresses far
worse alone than the same code inside a 90 KB chunk, so the class costs about 1.4 KB more than it
did. Those two parts nearly cancel. The rest of the measured 1,453 bytes is the churn that the new
files put through the page's and the worker's starts.

The pointers' dispatcher was to be the largest saving, about 1.6 KB, but it never split. `queries.ts`
read its hit-field constants, which kept the whole module in the start. Moving those constants into
a module of their own, `scene/pointer-fields.ts`, makes the split possible. That work is written but
not landed. It would save between nothing and about 700 bytes on the threaded starts, since a split
module compresses worse than the same code in a chunk. That is not room for the work still to
land, so the task's target stays unreached.

What would reach it: the start needs code removed, not moved. The scene API's own modules are about
24 KB of the sketch worker, and the feature modules behind them about 37 KB. A trim that pays has to
take a whole feature out of the engine's start, with its shaders, or the shader file has to shrink.

## The core WebAssembly's growth, 23 October 2026

The milestone branch's build grew each core WebAssembly file after Brotli against main's build. The
threaded file went from 485,521 to 500,408 bytes, or 3.1 percent, and the single-threaded file from
484,906 to 499,117 bytes, or 2.9 percent. Both stay inside the 600 KB budget that a core file has.

The growth is the level system: the level table with its switch measures, the distance bands, the
ranges texture that culling reads, and the per-level materials. The commit gate asks for a
`Size-Growth:` line while a file grows by more than 2 percent against main, so the landing carries
one for each core file.

## The start's squeeze, 23 October 2026

The grading controls pushed the engine's start close to its budget. In pipelined WebGL2 mode the
start is 185,857 bytes after Brotli against 186,368, so 511 bytes remain. The small path's low
latency mode reads 182,219 and the main-thread mode 183,497. That puts every threaded start past the
97 percent warning that the owner asked for, so every page build names them while it still passes.

Two files explain the movement. The engine's error type, `errors/engine-error.ts`, is imported by the
page's start, its loader and its checks, so the bundler keeps it in `js/engine-error.js` of its own,
771 bytes after Brotli. The size report had not named that file, which is why the four size jobs
failed on the tip's first runs. And `js/render-worker.js` grew from 17,993 to 18,520 bytes, or
2.9 percent, because the grading table's bake runs on the render worker.

Both need a `Size-Growth:` line, as the commit gate asks. The start's remaining room is the finding
that matters: the next feature that touches the start has nowhere to go, so a trim is due before
another one lands.

## The start's budget rises to 184 KB, 23 October 2026

The first-use fix moved three shared modules out of the loader's file and into the start's own files,
where every page loads them. The work that followed, the levels, the transmission maps and the hero
shadow, added start code of its own. A production page build of the tip then measured 186,587 bytes
after Brotli in pipelined WebGL2 mode, which is 219 over the 182 KB budget.

The budget rises to 184 KB, or 188,416 bytes, leaving 1,829 bytes of room. The owner's rule of
22 October allows the start's budget to rise as needed without asking. This is the smallest step that
keeps the check useful, because a rise of 2 KB cannot hide a feature's cost the way a larger one would.

The squeeze stands. This is the second rise in three days, and M3-T1's target of 160 KB is still far
away. The next change that touches the start needs a trim, not another rise.
## The cluster levels' shader, 23 October 2026

The cluster levels' culling pass is a compute shader of 9,738 bytes of WGSL, 2,736 after Brotli, and
every page's start carries it although only the WebGPU path builds its pipeline. It moved pipelined
WebGL2 mode's start by 650 bytes, where it compresses beside the shader text already there. That
fits the room that this morning's 184 KB line leaves, so it needs no rise of its own and takes none;
the landing's build prints the figure.

The trim it owes is to build the pass with the builds the engine loads on a feature's first use, as
a material's shader does: a page that never draws a cluster tree then downloads none of it, and
WebGL2, which never builds the pass, keeps its start. [D-213](D-213-cluster-levels.md) holds the
drawing method and its numbers.


## The start's budget rises to 186 KB for compute passes, 23 October 2026

E8's compute pass and E9's instance draw, whose count a compute shader writes, put their Rust and
their adapter code into every start. A production page build then measured 189,064 bytes after
Brotli in pipelined WebGL2 mode, which is 648 over the 184 KB budget that this morning's rise set.
The check stopped the build before any picture ran, as it is meant to.

The budget rises to 186 KB, or 190,464 bytes, leaving 1,400 bytes of room. The owner's rule of
22 October allows the start's budget to rise as needed without asking. The previous section asked
for a trim rather than another rise; this change raises instead, because the growth is the feature's
own Rust and the option checks that must run when a sketch adds a compute pass, and a trim large
enough to pay for them means loading code that the call must have before it returns.

The trim now owed is to load the compute pass's option checks and the instance draw's adapter with
their first use, as the cluster levels' shader trim already asks, so a page that adds neither
downloads neither. Until then this is the second rise in two days, and M3-T1's target of 160 KB
stays far away.

## The start's budget rises to 188 KB, 24 October 2026

The half-float helpers that several of the start's own modules read became a file of their own, which
every page loads, and the line rose to 187 KB for them. Later the same day the video textures' page
support and the day's other landings put a production page build at 191,594 bytes after Brotli in
pipelined WebGL2 mode, 106 bytes over that line.

The budget rises to 188 KB, or 192,512 bytes, leaving 918 bytes of room. The owner's rule of
22 October allows the start's budget to rise as needed without asking. A hundred bytes is below the
noise of one module's change, so finding them costs more than the rise does.

The squeeze stands: this is the third rise in two days, and M3-T1's target of 160 KB is still far
away. The trims that the sections above owe, the cluster levels' shader and the compute pass's
option checks, are the next work that touches the start's size, and they come before any feature
that wants room.

## The 160 KB target is closed, 24 October 2026

M3-T1 asked for every start mode at or under 155 KB after Brotli, with the line set back to 160 KB. Its
target was written before the owner's ruling of 22 October that the start's budget may rise as needed,
and the trims it named were measured: the fence is in, and the trim that moved the fog write, the picks
and the events out of the start cost more bytes than it saved and was reverted, as the section above
records.

The owner closed the task as superseded on 24 October 2026. The line stands at 188 KB, and the raises
are recorded above. Two trims still pay the line back: the cluster levels' shader and the compute pass's
option checks. Both stay named here as work rather than as a milestone task.

## The start's budget rises to 190 KB, 24 October 2026

The timed script that hold mode performs (M3-R14, D-250) put its steps, and the scene property
reads and writes that they use, into the sketch runner, and one writer of input records now serves
both the page's own input and a script. A production page build reached 193,396 bytes after Brotli
in pipelined WebGL2 mode, 884 bytes over the 188 KB line, against a base that had 407 bytes of room
left. `js/page-sketch-runner.js` grew 1,275 bytes and `js/page-control.js` grew 81.

The budget rises to 190 KB, or 194,560 bytes, leaving 1,164 bytes of room. The owner's rule of
22 October allows the start's budget to rise as needed without asking. A trim that pays for the
script means loading its performer on hold mode's first use, which is work of its own rather than a
few names to cut; the trims owed above still stand as the next work that touches the start's size.

## The start's budget rises to 191 KB, 25 October 2026

The recording and replay of M3-R15 (D-251) put the page's replay switch, the download and check of
a recording, and the offer to save one into the start: 722 bytes after Brotli across the page and
the sketch runner. The day's other landings had already filled most of the room, so the base
reached 194,126 bytes of the 194,560 line, and the feature landed 288 bytes over at 194,848.

The budget rises to 191 KB, or 195,584 bytes, leaving 736 bytes of room. The owner's rule of
22 October allows the start's budget to rise as needed without asking. The recording's own code,
the format and the save button, loads only for a page that records or replays, and each has its own
first-call budget; the trims owed above still stand as the next work that touches the start's size.

## The start's budget rises to 192 KB, 25 October 2026

The 194,848 bytes above came from a local build measured against a stale base, and CI contradicts
it. CI measured the same commit's pipelined WebGL2 start at 196,106 bytes, 522 over the 191 KB line.
That was run 40127501793, on 130f70795, which changes no engine file after the recording landed. Low
latency measured 192,288 and drawing on the main thread 192,953. The time of a GPU frame as the span
of its passes (ac99af391) had also grown `js/page-frame-stats.js` and the stats overlay. The run
before it measured 194,483, and the one after it 194,677.

The budget rises to 192 KB, or 196,608 bytes, leaving 502 bytes of room. A figure in this record
comes from CI's `wasm-checks` job from now on, not from a local build. The start went from 186 KB to
192 KB in two days, each step reasonable on its own. The owner ruled on 25 October 2026 to keep
raising the line as needed for now, as the rule of 22 October allows. A trim that wins back real
bytes runs beside the raises, and no crossing waits for it.
