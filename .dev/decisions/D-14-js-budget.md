# D-14: The engine's JavaScript budget through M1

Status: proposed, for the owner to decide. Date: 2026-09-30.

## Question

M1's exit gate holds the engine's JavaScript that a page downloads to 60 KB after Brotli in each thread mode. Only the owner can revise that budget, in writing. A pipelined page downloaded 36.9 KB early on 30 September and 49.5 KB that afternoon. Most of M1 has not merged yet. How does the rest of M1 fit, and what does each way cost?

## Rule

Proposed: take an option when, by the estimate below, it keeps every thread mode on each GPU path within 60 KB at the gate. The estimate may be 20% low, so leave room for that. An option must add no round trip before the first frame of a page that does not use the feature. It may add one round trip at a feature's first use, if the page waits for that feature anyway, as it does for a texture.

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

Proposed, for the owner:

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
