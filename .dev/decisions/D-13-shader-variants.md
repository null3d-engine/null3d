# D-13: Shader variants

Status: proposed on 2026-09-30; decided by its rule on 2026-10-03, when T-26's device times met it. Date: 2026-09-30. Task: M1-A6, with M1-L3 for the compile times. Tests: T-12, T-26.

## Question

How many shader variants does the engine build, and how do they reach a page? A feature that changes what a shader costs is a permutation bit, and a template builds one variant for each combination of its bits. The variants can ship in the file that draws, or in files that load on first use. WebGPU's override constants can also take the place of some WGSL variants. How long does a scene's warm-up then take?

## Rule

Stay within the 60 KB budget for the engine's JavaScript in each thread mode, with M1's permutation bits. Keep S4's warm-up on the S24+ within a target that T-26's data sets. T-26 set it at 250 ms of pipeline wait with fresh shaders, about twice the time measured.

The budget was 60 KB when this rule was set. The owner has since raised it to 100 KB for the features that followed, and for M2 to 140 KB at a page's start ([D-14](D-14-js-budget.md)). The sizes below compare the options at the time, so they keep the 60 KB budget as their measure.

## Data

### Sizes

M1 plans five bits for the standard material: tone mapping in the shader (TONE_MAP), vertex colors, normal maps, alpha masks and shadows. The draw index of WebGL2's multi-draw is a sixth on that path. Only the draw index had shader code when this was measured, so stand-in code of each feature's size filled the others:

- The real tone mapping library of the HDR branch, with ACES, AgX and Khronos PBR Neutral.
- A color attribute that multiplies the base color.
- A tangent attribute, a TBN basis and a normal read from a texture array.
- A base color alpha against a cutoff, with `discard`.
- Four shadow cascades in a depth texture array, with a 3 x 3 filter.
- glTF metallic-roughness lighting in place of Lambert.

The lit template took all five bits and unlit took three. At five bits the build makes 41 WGSL modules and 82 GLSL programs. Each figure is the size report's own measure of a production build of the engine test page, with Brotli at quality 11. The builds start from commit 5612c46, where the pipelined page was 48.6 KB.

| Option at 5 bits | Pipelined page, WebGPU | Pipelined page, WebGL2 | Shader text that a WebGL2 page parses | Extra requests |
| --- | --- | --- | --- | --- |
| (a) Every variant in the file that draws | 57.6 KB (96%) | 57.6 KB (96%) | 1,644 KB | 0 |
| (b1) One file per GPU path, loaded on demand | 50.9 KB (85%) | 54.4 KB (91%) | 1,338 KB | 1 |
| (b2) One file per template and GPU path | 53.6 KB (89%) | 58.7 KB (98%) | 1,338 KB | up to 3 |
| (b3) One file per GPU path and per value of the bits a device fixes | 50.4 KB (84%) | 52.0 KB (87%) | 414 KB | 1 |
| (c) WGSL override constants, one file per GPU path | 49.8 KB (83%) | 54.3 KB (91%) | 1,338 KB | 1 |

The pipelined page at each bit count, for (a) and (b3):

| Bits | (a) | (b3) WebGPU | (b3) WebGL2 |
| --- | --- | --- | --- |
| 0 | 49.4 KB | 47.6 KB | 48.7 KB |
| 1 | 51.6 KB | 48.9 KB | 49.9 KB |
| 2 | 52.4 KB | 49.0 KB | 50.2 KB |
| 3 | 53.5 KB | 49.3 KB | 50.6 KB |
| 4 | 54.6 KB | 49.5 KB | 50.9 KB |
| 5 | 57.6 KB | 50.4 KB | 52.0 KB |

Compression matters. A host that compresses on the fly often uses Brotli at quality 5 or gzip:

| Pipelined page at 5 bits | Brotli 11 | Brotli 5 | gzip 9 |
| --- | --- | --- | --- |
| (a) | 57.6 KB | 63.7 KB | 98.4 KB |
| (b1), WebGL2 page | 54.4 KB | 59.0 KB | 86.9 KB |
| (b3), WebGL2 page | 52.0 KB | 56.3 KB | 64.0 KB |
| (b3), WebGPU page | 50.4 KB | 54.6 KB | 58.2 KB |

Other findings:

- Compiling the JavaScript of the 1,338 KB GLSL file took 9.6 ms in V8 and 8.0 ms in JavaScriptCore on the Mac. The 414 KB file of (b3) took 2.2 and 1.9 ms.
- naga cannot write GLSL from a module with override constants, so WebGL2 needs one program per combination under every option. GLSL is 80% of the shader text at five bits.
- WebGPU needs every vertex input of an entry point in the pipeline's layout. So a bit that adds a vertex input, such as vertex colors, cannot be an override constant. Under (c) such bits need vertex entry points of their own, four for lit.
- Under (c), a scene of lit and unlit objects with two bits in use made 2 WebGPU shader modules instead of 8. Browsers still turn each pipeline into GPU code on its own.

How the data was produced: a separate worktree of the branch held the stand-ins in the shader folder. A prototype of each option split the variants into files. The repository's build and size report then measured each option at each bit count. The scripts and every run's record are kept with the other maintainer notes of the task.

### The extra request

Cold loads of the engine test page's production build, pipelined, in Chrome 154 on the MacBook Pro. The network was Slow 4G, and the scene had lit and unlit objects. The two builds took turns, five loads each on each GPU path. In (b1) the render worker starts the file's download as soon as it knows its GPU path.

| GPU path | Build | First frame done, median | Fastest to slowest |
| --- | --- | --- | --- |
| WebGPU | (a) | 4,543 ms | 4,251 to 4,653 ms |
| WebGPU | (b1) | 4,511 ms | 4,230 to 4,639 ms |
| WebGL2 | (a) | 4,605 ms | 4,253 to 4,665 ms |
| WebGL2 | (b1) | 4,473 ms | 4,312 to 4,744 ms |

In the same run, the separate file's first frame came 30 ms later on WebGPU and 59 ms later on WebGL2, at the median. Loads of one build vary by about 400 ms, so these runs cannot tell the extra request from no cost. The file arrived within about 0.1 s of the end of the sketch's setup.

### The download after the core (T-28, 5 October 2026)

The decision says that the thread that draws starts the file's download as soon as it knows its GPU path and its fixed bits. Until 5 October 2026 it learned them only from its start message, which the page sends after the core has arrived. So the file's request waited for the core. Every cold start then waited one more round trip after the core, plus the file's own download. On Slow 4G a round trip takes at least 562 ms. In the M1 gate's run on the Galaxy S24+, Chrome on Slow 4G finished a cold start's first frame after 4.90 s. The target of [D-06](D-06-success-targets.md) is 4.5 s.

The page knows both facts as soon as its GPU probe ends. The GPU path comes from the probe. The fixed bits come from the probe's report, the chosen preset and the page's options, never from the core. So the page now works out the core device right after the probe, and starts the file's download at once:

- Where the render worker or the sketch worker draws, the page sends it `load-shaders` with the GPU path and the bits. The worker starts the import.
- Where the page draws, it starts the import itself once the renderer's module has loaded.
- Where the probe finds that a worker cannot draw, the page loads the renderer and the file right after the probe too.

The renderer imports the same module again once the core has started. The browser keeps one module for each address, so the file downloads once, and the page downloads the same files as before. A failed early download stays quiet: the renderer's own import then reports the failure. A browser test holds the core's download back until a thread asks for the shader file, in every thread mode and on both GPU paths. The old start order fails it: the request came only after the core.

These are cold and warm loads of the engine test page's production build, WebGL2, Slow 4G. They ran in Chrome 154 on the MacBook Pro (M5 Max) on 5 October 2026, with other work on the Mac. The old and the new start code ran in turns, two runs of five loads each. So each value is the median of 10 loads. The core was 249.4 KB after Brotli, and the WebGL2 shader file about 28.6 KB. The first frame was done at:

| Thread mode | Cold, old | Cold, new | Change | Warm, old | Warm, new |
| --- | --- | --- | --- | --- | --- |
| Pipelined | 4,832 ms | 4,258 ms | -574 ms | 696 ms | 706 ms |
| Low latency | 4,826 ms | 4,248 ms | -578 ms | 716 ms | 704 ms |
| Single-threaded | 4,764 ms | 4,196 ms | -568 ms | 682 ms | 678 ms |
| Drawing on the main thread | 4,804 ms | 4,244 ms | -560 ms | 697 ms | 690 ms |
| Sketch on the main thread | 4,809 ms | 4,228 ms | -580 ms | 766 ms | 700 ms |

- Every cold load got faster, by 0.56 to 0.58 s at the median. The slowest new cold load (4,413 ms) was faster than the fastest old one (4,749 ms).
- The shader file now shares the link with the core. So the core was ready about 0.19 s later: about 4.21 s against 4.02 s, pipelined. The first frame then followed the core by about 50 ms, against about 0.8 s before.
- Each mode made the same requests and downloaded the same bytes as before. Single-threaded loads made 11 requests for 363 KB, and the other modes 12 requests for 367 to 371 KB.
- Warm loads make one request, and the files come from the cache, so the order cannot change them. Their medians stayed within the spread between loads.

`bun run bench:startup --runs 5 --gpu webgl2 --modes all --loads cold,warm --network slow-4g`, twice for each version. The S24+'s own figures come from `bun run bench:startup --android`.

### Warm-up (T-12, T-26)

`KHR_parallel_shader_compile`, which lets WebGL2 compile programs in the background, in the device runs recorded before this task:

| Browser | The extension |
| --- | --- |
| Mac: Chrome, Brave, Safari | Yes |
| Mac: Firefox 156 | No |
| iPad: Safari 26.6, Brave | Yes |
| Galaxy S24+: Chrome 154, Brave | No |
| Pixel 8 (Mali-G715): Chrome 153 | No |
| Redmi Note 13 4G (Adreno 610): Chrome 138 | No |
| iPhone 16 Pro: Safari 26.4 | Yes |

The last three rows come from TestingBot's device cloud on 3 October 2026 ([tested devices](../tested-devices.md)). So Apple's browsers compile WebGL2 programs in the background, and Chrome on the Android phones measured does not.

The warm-up test page builds 10 pipelines on WebGL2, and 11 on WebGPU, where the culling pass is the eleventh. The device runner's checks plan ran it on the MacBook Pro M5 Max. The runs are 20260930-050804-checks and 20260930-052609-checks. `load.warmUpMs` is the time from the first build's start until no build was running. Each browser had compiled these shaders before, so its own shader cache may shorten the times.

| Browser | WebGPU | WebGL2 | WebGL2 with `?compile=wait` |
| --- | --- | --- | --- |
| Chrome 154 | 131 ms | 8 ms | 0: the first draw waits for each program |
| Safari 26.6.2 | 354 ms | 215 ms | 0: the first draw waits for each program |
| Firefox 156 | 848 ms | 0: no extension, so the first draw waits | 0 |

### Device warm-up times (T-26)

The device runner's `warm-up-time` plan loads each benchmark scene and each demo four times on each GPU path, at the preset that the engine chooses. Two loads use fresh shaders: `?shaders=fresh` gives each shader's text a new comment, so the browser compiles every program again, as on a first visit. Two loads use the shaders as they ship, and the second of them reuses the first's compiles, as a repeat visit does. [Device sessions](../devices.md#the-warm-up-time-plan) describes the plan.

The pipeline wait is the warm-up, `load.warmUpMs`, plus the first draw, `load.firstDrawMs`. It is the time that pipelines hold up the first frame on every browser, with or without background compiles. Shown is the time from `createEngine` until the first frame was on screen. Each figure is the median of two loads. The scenes built 2 to 4 pipelines each.

| Device and path | Pipeline wait, fresh | Pipeline wait, repeat visit | S4, fresh / repeat | Shown |
| --- | --- | --- | --- | --- |
| iPad, Safari 26.6, WebGPU | 21 to 31 ms | 21 to 32 ms | 31 / 32 ms | 1.0 to 1.9 s |
| iPad, Safari 26.6, WebGL2, background compiles | 35 to 53 ms, two scenes more | 35 to 61 ms | 412 / 61 ms | 1.0 to 2.2 s |
| S24+, Chrome 154, WebGL2, no background compiles | 45 to 73 ms, S4 more | 29 to 42 ms, S4 more | 115 / 88 ms | 0.23 to 0.43 s |

- On the iPad's WebGL2 path, two scenes took longer with fresh shaders: S4 412 ms and the layers demo 170 ms. On a repeat visit they took 61 and 35 ms.
- On the iPad's WebGPU path, fresh and repeat loads took the same time. Safari turns WGSL into Metal's shading language, which may drop the comment. Metal may then reuse its own compiled code. So the WebGPU figures may be repeat-visit times.
- On the iPad, the preset check takes most of the time until the first frame shows. It takes about 1 s for each preset that it measures. By its own timing it takes at least 0.75 s, and on the MacBook Pro about 0.8 s ([D-11](D-11-frames-in-flight.md#the-preset-checks-thresholds-m1-g3)). Loads that lowered the preset once took about 1.9 to 2.2 s. Since [D-17](D-17-stored-preset-check.md), a repeat visit takes the check's stored result and skips it. In Safari 26.6.2 on the MacBook Pro, a warm load's `createEngine` then resolved at 28 to 30 ms, against 826 to 837 ms with the check. In Chrome 154 it resolved at 52 ms, against 866 ms. The GPU finished the first frame at 48 to 86 ms either way. The warm-up time plan ran on the iPad again on 3 October. Its repeat loads took the stored result, and showed the first frame after 0.25 to 0.52 s. Its first visits took 1.0 to 2.4 s. The S24+ starts at Low, which has no lighter preset, so it runs no check. Without WebGPU, the S24+ skipped the 60 WebGPU loads.
- No scene came near the 15 slow seconds of the Godot port that T-26 was written for. The longest pipeline wait was S4's 412 ms on the iPad's WebGL2 path, with fresh shaders.

How the data was produced: on 2026-10-02, `bun tests/real-browsers.ts --plan warm-up-time --lan ipad-safari`, run 20261002-183327-warm-up-time, 120 of 120 pages passed. Then `--plan warm-up-time --allow-no-webgpu --android chrome`, run 20261002-183848-warm-up-time, 60 passed and 60 skipped.

## Decision

(b3): the shaders of each GPU path load as files of their own. There is one file for each value of the bits that a device fixes when the engine starts, and a page loads exactly one. The device fixes the draw index (WebGL2 with multi-draw or without) and TONE_MAP (the 8-bit output path or HDR). Each file holds every template's variants for every combination of the material bits. The thread that draws starts the download as soon as the page knows its GPU path and its fixed bits. That is right after the GPU probe, while the core downloads. The first frame waits for its pipelines anyway.

(b3) gives the smallest page on both paths at every bit count, and the least JavaScript to parse. At five bits, a WebGL2 page is 52.0 KB and parses 414 KB of shader text. With every variant in the file that draws, it is 57.6 KB and parses 1,644 KB. (b3) keeps 8 KB of the budget with M1's five bits, and each more material bit costs about 1 KB. (c) saves 0.6 KB more on a WebGPU page and nothing on WebGL2, but each template needs a second way to write it. So (c) waits until WebGPU warm-up time asks for fewer shader modules. T-26 gives no such reason: on the iPad, no scene's WebGPU pipelines took more than 32 ms.

How many: each file holds 2^m variants of a template with m material bits: 16 for the standard material with M1's four material bits. A scene builds only the variants that its materials use.

Background compiles: the engine uses `KHR_parallel_shader_compile` where the browser has it, and the first draw waits for each program where it does not. Both kinds of device met the target. The iPad has the extension, and its WebGL2 pipeline wait was 35 to 61 ms on a repeat visit. The S24+ lacks it, and its wait was 29 to 115 ms. So the engine needs no other path for browsers without the extension. T-12 and T-26 close with this record.

## How three.js handles it

three.js's WebGL renderer builds a program for each combination of a material's features. It builds it when an object first draws with that material. Its `#define` lines play the part of null3D's permutation bits. The GLSL comes from shader chunks in the download. So a page carries every chunk, whether its scene uses it or not. By default, the first draw of each new material waits while its program compiles. An app can call `renderer.compileAsync` to compile a scene's programs ahead of time. It uses `KHR_parallel_shader_compile` where the browser has it.

null3D does the same work at build time. A page downloads one file with only the variants that its device can use, and the first frame waits for the scene's pipelines. A sketch can call `scene.warmUp()` to build them before its loading screen ends.

## Consequences

- The shader manifest marks the engine's shaders (`lit`, `unlit`, `unlit_map`, `texcoords`, `final`, `mipmap` and `cull`) with `by_device = true`. The shader build writes their builds into `generated/shaders-<target>[-<bit>...].ts`. These are `shaders-wgsl.ts`, `shaders-glsl.ts` and `shaders-glsl-draw-index.ts` for HDR devices, and the same three with `-tone-map` for the 8-bit path. Half precision ([D-09](D-09-half-precision.md)) is a third bit that a device fixes, so each of the six has a `-half` twin: twelve modules in all. A module holds the builds of each shader that a device with its bits asks for. So a shader without device bits, such as `cull`, `mipmap` or the final pass's `final`, is in every module of its target. The main module, `generated/shaders.ts`, keeps the types, the test shaders and the GPU timer's mark shader. It also keeps the debug lines shader, which only development builds import. It also has the loaders `loadWgslShaders(bits)` and `loadGlslShaders(bits)`. Each loader imports only its own target's modules.
- The core device carries the bits that the device fixes (`shaderBits`). The page works the core device out right after the GPU probe, and tells the thread that draws to start the file's download then (`load-shaders`). The renderer loads the same module again once the core has started, and the browser gives it the module that is already on its way. The renderer then gives the loaded shaders to the backend.
- The size report names each shader file (`SHADER_PARTS` in `tools/lib/size-report.ts`) and counts the largest in each thread mode's download. A new value of the device's bits adds a module, which the report must name.
- A new material bit doubles each file: check the size report when one is added.
- The warm-up time plan watches the target: S4's pipeline wait with fresh shaders stays under 250 ms on the S24+. A new material bit, or a pass that adds pipelines to S4, reruns it on the S24+.
- T-26's times give the device figures in the loading screens guide.
- The record is in the table in README.md.

## Addendum, 2026-10-04: the figures are out of date, and features move to first-use files

The library code review of 4 October 2026 measured the shader files again (R6-03, R8-02 in [Code review, October 2026](../code-review-2026-10.md)):

- Each file is now 1.7 to 3.4 MB uncompressed and about 24 KB after Brotli. That is 7 to 8 times the 414 KB that this record measured.
- V8 compiles the largest file in 11.5 ms on the Mac (Apple M5 Max). Parsing takes 15 to 20 ms for GLSL and 7.5 to 11 ms for WGSL. This record measured 2.2 ms. Phones take several times longer, on the thread that draws, before the first frame.
- 35 of the 164 GLSL stage sources are exact copies, 543 KB in all.
- With gzip, a WebGL2 page downloads 496 KB at its start ([D-14](D-14-js-budget.md#hosts-that-compress-with-gzip)).
- Every feature grows every start file. GPU occlusion culling adds 8.7 to 8.9%, although it is off by default. AO adds 9 to 15%, wide lines 2.0 to 2.9 KB, and sprites and outlines 0.7 KB each.

The owner's decisions of 4 October 2026 change the layout:

- A feature's shaders may load on first use, in a file of their own, of up to about 24 KB after Brotli ([D-14](D-14-js-budget.md#first-use-shader-files)). The morph builds and the room's generator do so first.
- The size is fixed at its cause ([D-53](D-53-technique-defaults.md) ruling 23). M2-R11, whose own record is D-56, comes before any new feature that adds shader code; branches already built move their shaders in a follow-up. It stores each unique stage source once per file, with variants as indexes into it, and moves each feature's templates into a first-use file. It then measures `bench:startup` on BrowserStack's Galaxy S25 and Pixel 9, and decides whether the `standard_maps` builds (1.72 MB, 32 builds) split by a second fixed bit. Its figures replace this record's.
- Add-on modules need first-use shader files too ([D-54](D-54-addon-modules.md)).

## Addendum, 2026-10-04: measured again, after the duplicate sources went

Task: M2-R14, from review R8 (R8-02) and R6 (R6-03).

The decision chose (b3) for the smallest start and the least shader text to parse. Both reasons rested on a 414 KB GLSL file. Through M2 every feature added its variants to every file. This addendum gives the figures after M2-R14 removed the duplicate stage sources, the first step of the addendum above.

### Sizes

On 2026-10-04, main at dc178379 with this task's branch. Sizes are KB (1,024 bytes), measured on the production build that `bun run build` makes. The device modules without half precision:

| File | Raw | Brotli 11 | Brotli 5 | Brotli 4 | gzip 9 | gzip 6 | gzip 1 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `shaders-glsl-draw-index-tone-map` | 2,659.8 | 25.0 | 29.5 | 33.4 | 299.7 | 394.3 | 635.2 |
| `shaders-glsl` | 2,336.9 | 24.6 | 28.9 | 32.9 | 231.9 | 319.2 | 527.0 |
| `shaders-wgsl-tone-map` | 1,911.7 | 25.3 | 28.6 | 32.8 | 264.8 | 316.0 | 509.8 |
| `shaders-wgsl` | 1,703.1 | 25.8 | 28.3 | 32.4 | 202.9 | 257.9 | 420.0 |

The half-precision twins are 1,711 to 2,776 KB raw. Brotli finds the repeated text across its window of several MB. gzip's window is 32 KB, so it finds only repeats that sit close together. At the decision, a WebGL2 page was 64.0 KB with gzip 9. Today the shader file alone is 231.9 to 299.7 KB with gzip 9. Hosts that compress on the fly often use gzip 6, which gives up to 394.3 KB. A pipelined page's start, the largest, is 106.9 KB with Brotli 11, 402.7 KB with gzip 9 and 3,040.6 KB uncompressed. Before the duplicate sources went, review R8 measured that start at 589 KB with gzip 6.

### Duplicate stage sources

35 of the 164 GLSL stage sources in a device module were exact copies of another: a vertex stage that several variants share, for example. The shader build now writes each source once per module and points each program at it. A GLSL device module went from 2.96 to 2.42 MB raw, and the main module from 1.77 to 1.28 MB. The WGSL modules had no copies. Brotli 11 sizes hardly changed, since Brotli already found the copies.

### Parse time

V8 compiles and runs a shader module when a page imports it. Measured in Node 24 on the M5 Max, each module minified and imported 7 times, each time in a fresh process. The table gives the median, less the 1.6 ms that an empty module takes.

| Module | Before the copies went | After |
| --- | --- | --- |
| `shaders-glsl` | 10.6 ms | 9.0 ms |
| `shaders-glsl-draw-index-tone-map`, the largest GLSL | 12.1 ms | 9.9 ms |
| `shaders-wgsl` | about 6 ms | about 6 ms |

At the decision the 414 KB file took 2.2 ms. A phone takes several times as long as the Mac, and the time falls on the thread that draws, before its first frame.

### What changes

- (b3)'s split stays: one shader file for each value of the bits that a device fixes, and a page downloads exactly one at its start.
- That file no longer holds every feature. Each feature's templates move into files that load on the feature's first use, as M2-R11 builds them (record D-56). The start's file keeps only what every page draws with.
- The size report measures each file raw, with gzip 9 and with Brotli 11. It budgets all three for the start and for the files that load later ([D-14](D-14-js-budget.md#m2-gzip-and-uncompressed-budgets)). A start that grows on a gzip host, or on a host that sends files as they are, now fails the build.
- The hosting guide tells developers to serve the engine's files with Brotli, and gives the gzip and uncompressed sizes.

## Addendum, 2026-10-04: features that load on first use

[D-56](D-56-first-use-shader-files.md) takes out of this record's files the builds of features that most pages do not use. Those are sprites, lines, skinning with every SKIN build, bloom's steps and the final pass's BLOOM builds, the texture background and the engine's test template. Each feature has files of its own, by the same fixed bits. A page downloads one the first time it uses the feature. A start shader file now holds 17.7 to 19.4 KB after Brotli and 0.85 to 1.37 MB uncompressed. On main it held 27.6 to 30.0 KB and 1.8 to 3.6 MB. So a page parses about half the shader text of before at its start. A permutation bit that a feature's table names adds nothing to the start files. Another material bit still doubles each one.

Device modules are now plain JavaScript files, `generated/shaders-<target>-<bits>.js`, which the main module imports by address. So one copy of each serves the page's bundle and every worker's.
