# D-56: Shader files that load on first use

Status: decided, 2026-10-04. Date: 2026-10-04. Task: M2-R11.

## Question

Every M2 feature adds templates or permutation bits to the shader files that a page downloads at its start ([D-13](D-13-shader-variants.md)). So a page that never draws a sprite, a line or a skinned mesh still downloads their builds. It also parses them before its first frame. How do a feature's shader builds reach only the pages that use the feature? And what must a feature's passes do while its builds are on the way?

## Rule

- A feature that a page does not use adds nothing to its start ([D-14](D-14-js-budget.md), the chunk rule for M2). That holds for its shader builds as for its code.
- Each shader file of a feature that loads on first use stays within the limits of one start shader file. Those are 24 KB after Brotli, 224 KB after gzip and 1,536 KB uncompressed. The owner set them on 4 October 2026, and D-14 records them.
- No frame draws a feature half done. A pass whose pipelines wait for their file must not leave the canvas without a frame. And no pass may draw vertices that another pass has not written yet.
- The image tests draw the same images on all three tiers.
- The thread that draws allocates nothing per frame in steady state.

## Data

All sizes are after Brotli at quality 11, after gzip at level 9, and uncompressed. `bun run build` prints them for the engine test page's production build. The feature files' sizes are from main at dc178379.

### The start

Main is at 7f272ddd here, as `bun run build:check-size` built it. Main's size report has no gzip column yet.

| What a page downloads at its start | Main | This record |
| --- | --- | --- |
| Each start shader file, after Brotli | 27.6 to 30.0 KB | 17.7 to 19.4 KB |
| Each start shader file, after gzip | not measured | 109.2 to 214.6 KB |
| Each start shader file, uncompressed | 1,840 to 3,597 KB | 846 to 1,368 KB |
| A pipelined page's start, after Brotli | 113.1 KB | 104.6 KB |
| A pipelined page's start, after gzip | 529 KB, with M2-R14's columns on main | 311.6 KB |
| A pipelined page's start, uncompressed | 3,871 KB | 1,652 KB |

A page parses less than half the shader text of main before its first frame. With main's ambient occlusion, M2-R14's new gzip budget for the start, 448 KB, held only with this record's grouping.

### The files that load on first use

Each feature has one file for each GPU path and each value of the device's fixed bits that its builds vary in. A page downloads one of them, the first time it uses the feature.

| Feature | Files | Brotli | gzip | Uncompressed | What it holds |
| --- | --- | --- | --- | --- | --- |
| `skinning` | 12 | 13.2 to 16.1 KB | 106.0 to 199.4 KB | 822 to 1,325 KB | The skinning pass, and every SKIN build of the mesh templates and the shadow pass |
| `lines` | 6 | 5.6 to 7.6 KB | 6.4 to 10.6 KB | 32 to 73 KB | The `line` and `line_lit` templates ([D-46](D-46-wide-lines.md)) |
| `sprites` | 6 | 2.9 to 4.7 KB | 3.5 to 6.0 KB | 33 to 68 KB | The `sprite` and `sprite_map` templates ([D-37](D-37-sprites.md)) |
| `bloom` | 4 | 4.1 to 4.5 KB | 4.8 to 5.3 KB | 26 to 42 KB | Bloom's steps, and the final pass's BLOOM builds ([D-21](D-21-effect-chain.md)) |
| `ao` | 2 | 2.9 to 3.2 KB | 3.4 to 3.7 KB | 23 KB | Ambient occlusion's depth, horizon and denoise steps |
| `background` | 4 | 1.0 to 2.0 KB | 1.1 to 2.3 KB | 3 to 10 KB | The texture background |
| `texcoords` | 6 | 1.3 to 3.7 KB | 1.5 to 4.3 KB | 5 to 36 KB | The engine's own test template, which only test pages use |

The largest is the skinning file for WebGL2 with the draw index, the 8-bit path and half precision. It takes 67% of the Brotli limit, 89% of the gzip limit and 86% of the uncompressed one.

The first limits that this record proposed kept the start budget's proportions: 80 KB after gzip and 576 KB uncompressed. The skinning files took more than twice that, though they take two thirds of the Brotli limit. Shader text compresses far better than code. A start shader file is about 70 times smaller after Brotli, and the engine's code 3 to 4 times. So the owner gave each first-use file the limits of one start shader file.

### Copies in a production build

Review finding R8-09 found that a production build wrote each shader file twice: for the page's renderer and for the render worker. A fresh project held 24 such files of 1.7 to 3.4 MB, about 60 MB in all. Vite bundles each worker on its own. So a module that two bundles load with `import()` becomes a file in each. The two copies differed in 2 bytes.

The shader build now writes each device module as plain JavaScript. The main module imports it by its address: `new URL('./shaders-wgsl.js?no-inline', import.meta.url)`. A bundler copies a file that an address names once, however many bundles name it. It does the same for the core's glue.

| Engine test page's production build | Shader files | Their size | Every file, without source maps |
| --- | --- | --- | --- |
| Before, with this record's grouping | 100 | 51.7 MB | 55.0 MB |
| One copy of each | 50 | 26.5 MB | 29.8 MB |

`bun run test:packages --keep` builds a fresh Vite project from the packed packages. The review measured 65 MB in 70 files there, about 60 MB of it in 24 shader files. Its `dist/` now holds 30 MB in 103 files. Of that, 26.5 MB is in 50 shader files: one copy of each start file and of each feature's files. The engine's tarball is 5.7 MB, from 6.9 MB. It unpacks to 36 MB, from 44.2 MB, and `lib/generated/` holds 28 MB of it, from 35.8 MB.

### A feature turned on during play

These are the bloom switch test's figures, in Chrome 154 on the Mac's GPU. Bloom's file downloads and its pipelines build, while the frames keep the final pass without bloom:

| Tier | Frames until bloom drew | Milliseconds | Longest frame interval across the change, 99th percentile | Skipped draws |
| --- | --- | --- | --- | --- |
| WebGPU | 4 to 11 | 64 to 180 | 16.67 ms | 0 |
| Compatibility mode | 2 | 98 to 295 | 88.7 ms, from the move to HDR color that bloom needs there, as D-21 measured | 0 |
| WebGL2 | 3 to 4 | 63 | 16.67 to 21.0 ms | 0 |

The ranges span runs with the Mac idle and runs beside other test suites. D-21 measured 3 frames and 46 to 48 ms before bloom's builds left the start file.

The skinning test adds skinned meshes during play, on all three tiers. No frame skips a draw across the change, and the page downloads the skinning file once. The frame after the change matches the same scene whose meshes stand from the start, within 0.2% of the pixels.

## Options

| Option | The start | When a feature first runs | Cost |
| --- | --- | --- | --- |
| A: every build in the start files (D-13) | Grows with every feature | Nothing to wait for | Every page pays for every feature, and parses it before its first frame |
| B: a file for each feature, which the shader manifest declares | Only the builds that every scene can use | One download, of 1 to 16 KB, then the pipelines build | Each feature's passes must wait for their pipelines without a gap in the frame |
| C: a file for each template | Each template the page draws is a request | As B | Many requests at the start, each with its round trip: every scene draws several templates |
| D: WGSL text and a translator in the page | The translator, about 844 KB after Brotli | Translate, then build | Far over the budget, as D-13 found |

## Decision

Option B.

### How a feature declares its shader file

A table in the shader manifest, `crates/null3d-shaders/shaders.toml`, names a feature and what loads with it:

```toml
[first_use.lines]
shaders = ["line", "line_lit"]

[first_use.skinning]
shaders = ["skin"]
bits = ["SKIN"]
```

- `shaders` lists templates whose every build belongs to the feature.
- `bits` lists permutation bits that a device does not fix. Every build of any template with one of them belongs to the feature. Examples are the final pass's BLOOM builds and every template's SKIN builds.
- A build belongs to its template's feature, or else to the feature of its lowest bit that a table names. Every other build stays in the start files.

Each feature gets a file, such as `generated/shaders-skinning-wgsl.js`, for each value of the device's fixed bits that its builds vary in. Then `DeviceShaderSet` loads one the first time a pipeline asks for one of its builds. It adds the file's builds to the variants that the backends hold. Meanwhile the pipeline waits, as a custom material's pipeline waits for its shader. Before the first frame, the frame waits with it. After it, frames go on, and the pipeline's draws draw nothing until it is built. On WebGPU, a compute pipeline whose file has not arrived waits in the same way.

### Draw once built

A draw that waits for its pipeline draws nothing. That is right for an object of its own, such as a sprite batch or a line batch. It appears once it is built, as a texture appears once its texels arrive. It is wrong in two cases. There, the passes keep to what they had until every pipeline they need is built. `PipelineCache::built` says when. It compares the frame that created a pipeline with the newest frame drawn with every pipeline built.

- A full-screen pass. A final pass whose pipeline waits leaves the canvas without its frame. So the frame graph keeps the final pass without bloom until bloom's steps and the final pass's BLOOM build are built. Ambient occlusion's steps write a target that the opaque pass reads. So the frame graph adds the steps only once their pipelines are built, and only then does the opaque pass read their result. The depth prepass that they read runs as soon as the sketch turns ambient occlusion on, so its pipelines build meanwhile.
- A pass whose output another pass reads. On WebGPU the skinning pass writes the vertices that the shadow, prepass, opaque and transparent passes draw. A draw before the skinning pass first runs would read vertices that it has not written. So `SkinnedGate` leaves skinned objects out of every layout until their pipelines are built: the skinning pass's, and every one that draws them. The layouts still ask for those pipelines, so the file loads and they build. Then the layouts take the skinned objects in. The main pass, the depth prepass, the shadow passes and the transparent pass show them in the same frame. On WebGL2, each pass skins in its own vertex shader with the SKIN builds. The same gate keeps those passes in step.

Before the first frame neither case waits: that frame waits for every pipeline.

### What stays in the start files

- The mesh templates without SKIN: `lit`, `standard_maps`, `unlit` and `unlit_map`. Every scene draws with them, and custom materials build on `lit`.
- The shadow pass, the culling pass, light clustering and the mip levels, which most scenes run.
- The final pass without BLOOM.
- The opaque pass's reading of ambient occlusion. It is a branch on the frame's settings in the mesh templates, not a bit, as color grading is in the final pass.
- Color grading and the vignette. Their code is a branch on the final pass's settings, not a permutation bit. It adds 0.1 to 0.3 KB after Brotli, and 2.2 to 2.5 KB uncompressed, to each start shader file. That is the difference between the files built with it and without it. A file of its own would need a bit on the final pass. That bit would double the pass's builds in every start file, at about 2 KB after Brotli. And a page that turns grading on would show ungraded frames until the file arrived and the pipeline built. The code that reads grading tables already loads on first use (`page-lut.js`, D-14).

### Loading everything up front

The owner decided on 4 October 2026 that a game can have every shader it needs before play starts, and fetch nothing during play.

- `createEngine({ preload: ['skinning', 'bloom', 'lines'] })` names features by their tables' names. The page checks each name against the generated `shader-features.ts`, which holds no shader text, and throws E1421 for one it does not know. The thread that draws starts each listed file's download beside the start's file, and the renderer starts once all have arrived. So the first frame comes after them, and no listed file downloads during play.
- On the 8-bit path, bloom moves the scene to HDR color, and its pipelines ask for builds without the tone mapping bit. Preloading bloom there also loads the start's builds and bloom's builds without that bit.
- Loaders and calls that know a feature is coming ask for its file at once, through `ShaderPreloads` (`scene/shader-preloads.ts`). A glTF file with skins asks for skinning as soon as it is parsed, while its textures decode. The first sprite or line batch, a texture background, and `post.set` with bloom or ambient occlusion ask for theirs. The request travels to the thread that draws with the images and custom materials' shaders, and that thread loads the file at once. A model that the setup adds is then in the first frame, which waits for its pipelines. One that comes during play appears once its pipelines are built.
- A preloaded file's shaders start to build as soon as it arrives, so the feature's first objects need not wait for a compile during play. Before the first frame, that frame waits for them.
  - WebGL2 compiles a program for each build of the file, in the background where the browser can. A program depends only on its template and its build, so the feature's first objects draw with it at once. The file holds only the builds for the device's fixed bits: 1 to 4 programs for each feature.
  - WebGPU creates each build's shader module, which the feature's pipelines then share, and builds the skinning pass's pipeline. A render pipeline also needs the targets, the vertex format and the state of the objects that draw with it. Only the scene gives those, so `scene.warmUp()` builds them, as for any material.
  - Skinning's builds vary in every material bit: 34 to 37 builds for each device. A scene's materials draw with a few of them, so the preload compiles none of them, and `scene.warmUp()` builds the ones the scene uses.
- The cost was measured on the Mac in Chrome, with the preload test's scene. It started 5 times with the list of skinning, bloom and lines, and 5 times without, on the dev server. With the list, the first frame came at a median of 1,247 ms on WebGL2, against 1,176 ms without. On WebGPU it came at 1,207 ms, against 1,149 ms. So the list adds about 60 to 70 ms to the start. When the sketch then turned the three features on, WebGL2 skipped no draw in 5 runs of 5. WebGPU skipped 1 draw in each run, the line batch's first frame while its pipeline built.
- `ShaderPreloads.needAll` takes a list of features. M2-B5's list of what each asset needs, which the asset tool will record, can feed it.
- Bundling every feature into the start's file is not the default: it would grow every page's start, also the pages that never use a feature. A preload list puts the cost on the games that ask for it.

### Limits and copies

- Each file of a feature that loads on first use has the limits of one start shader file (`FIRST_USE_SHADER_BUDGET` in `tools/lib/size-report.ts`). The size report lists each such file in a section of its own, and no start counts it.
- One copy of each shader file serves every bundle of a build, as "Copies in a production build" says.
- A page that imports the engine but draws nothing still gets the files. Vite emits each worker and each address while it transforms the page's module, before it drops unused code. That needs the add-on and package work of [D-52](D-52-intent-parity.md), and stays open.
- The engine's own test template, `texcoords`, loads on first use too, so no page downloads it. That settles review findings R7-04 and R5-16.

## Consequences

- The shader manifest holds a `[first_use.<feature>]` table for `skinning`, `lines`, `sprites`, `bloom`, `ao`, `background` and `texcoords`. The manifest's header says how to add one.
- The test "a preload list fetches every feature's shader file before the first frame" turns skinning, bloom and lines on during play. No shader file may download after the first frame. The line batch may skip draws until its pipeline is built, as any new object does.
- The test "a glTF file with skins fetches the skinning file before its model is added" checks the order of the request and the instantiation. It also checks that the first frame shows the model in its pose.
- A third test checks E1421.
- [Loading screens](../../docs/guides/loading-screens.md#loading-everything-up-front) tells developers how to load everything up front, and the develop skill gives the option.
- The engine test "a page that uses no feature that loads on first use downloads none of their files" checks every feature's shader files too.
- The engine test "the first use of lines, sprites and background downloads its shader file once" checks those features' files. The bloom switch test checks bloom's file, and the skinning test checks skinning's.
- [Implementation notes](../implementation-notes.md#shader-files-that-load-on-first-use) say how a feature declares its file and which passes keep to the draw-once-built rule.
- D-13 and D-14 point here for the new grouping and its figures.
- Later branches move their own builds when they land:
  - Outlines (M2-F4) are a full-screen pass. Their branch declares a table with their templates. Their pass keeps the frame as it was until its pipelines are built, as bloom's and ambient occlusion's do in `FrameGraph::request_pipelines`. Ambient occlusion (M2-F2) landed during this task, and moved here.
  - Morph targets (M2-C5) add a bit, as SKIN does. Where the GPU blends them, they add a pass whose output the drawing passes read. Their table names the bit. Their objects keep out of the layouts until their pipelines are built, as `SkinnedGate` keeps skinned objects out.
  - GPU occlusion culling (M2-I1) adds compute templates, which wait for their file as the skinning pass's does. Its culling must keep the previous frame's results, or none, until its pipelines are built.
- The record is in the table in README.md.
