# D-13: Shader variants

Status: decided by its rule, which T-26's device times met. Built: one shader file for each GPU path and each value of the bits that a device fixes. Each feature's builds sit in files that load on first use ([D-56](D-56-first-use-shader-files.md)). Each device module writes each stage source once, and each shared paragraph once. The owner decides whether to drop each line's indentation too (option D below). Task: M1-A6, with M1-L3 for the compile times. Tests: T-12, T-26.

Summary: Ship the shaders of each GPU path in one file for each value of the permutation bits that a device fixes. A page loads its device's own, and the builds of features that most pages do not use on first use. S4's pipelines held its first frame 115 ms on the S24+ with fresh shaders, against a target of 250 ms.

## Question

How many shader variants does the engine build, and how do they reach a page? A feature that changes what a shader costs is a permutation bit, and a template builds one variant for each combination of its bits. The variants can ship in the file that draws, or in files that load on first use. WebGPU's override constants can also take the place of some WGSL variants. How long does a scene's warm-up then take?

## Rule

Stay within the 60 KB budget for the engine's JavaScript in each thread mode, with M1's permutation bits. Keep S4's warm-up on the S24+ within a target that T-26's data sets. T-26 set it at 250 ms of pipeline wait with fresh shaders, about twice the time measured.

The sizes below compare the options against that 60 KB budget. [D-14](D-14-js-budget.md) sets the engine's JavaScript budgets.

## Data

### Sizes

M1 plans five bits for the standard material: tone mapping in the shader (TONE_MAP), vertex colors, normal maps, alpha masks and shadows. The draw index of WebGL2's multi-draw is a sixth on that path. In the measured build only the draw index had shader code, so stand-in code of each feature's size filled the others:

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

### The download after the core (T-28)

The thread that draws starts the file's download as soon as it knows its GPU path and its fixed bits. If it learns them from its start message, which the page sends after the core has arrived, the file's request waits for the core. Every cold start then waits one more round trip after the core, plus the file's own download. On Slow 4G a round trip takes at least 562 ms.

The page knows both facts as soon as its GPU probe ends. The GPU path comes from the probe. The fixed bits come from the probe's report, the chosen preset and the page's options, never from the core. So the page works out the core device right after the probe, and starts the file's download at once:

- Where the render worker or the sketch worker draws, the page sends it `load-shaders` with the GPU path and the bits. The worker starts the import.
- Where the page draws, it starts the import itself once the renderer's module has loaded.
- Where the probe finds that a worker cannot draw, the page loads the renderer and the file right after the probe too.

The renderer imports the same module again once the core has started. The browser keeps one module for each address, so the file downloads once, and the page downloads the same files in either order. A failed early download stays quiet: the renderer's own import then reports the failure. A browser test holds the core's download back until a thread asks for the shader file, in every thread mode and on both GPU paths. A start order that asks for the file only after the core fails it.

These are cold and warm loads of the engine test page's production build, WebGL2, Slow 4G. They ran in Chrome 154 on the MacBook Pro (M5 Max), with other work on the Mac. The start code that asks for the file after the core and the start code above ran in turns, two runs of five loads each. So each value is the median of 10 loads. The core was 249.4 KB after Brotli, and the WebGL2 shader file about 28.6 KB. The first frame was done at:

| Thread mode | Cold, after the core | Cold, with the core | Change | Warm, after the core | Warm, with the core |
| --- | --- | --- | --- | --- | --- |
| Pipelined | 4,832 ms | 4,258 ms | -574 ms | 696 ms | 706 ms |
| Low latency | 4,826 ms | 4,248 ms | -578 ms | 716 ms | 704 ms |
| Single-threaded | 4,764 ms | 4,196 ms | -568 ms | 682 ms | 678 ms |
| Drawing on the main thread | 4,804 ms | 4,244 ms | -560 ms | 697 ms | 690 ms |
| Sketch on the main thread | 4,809 ms | 4,228 ms | -580 ms | 766 ms | 700 ms |

- Every cold load is faster with the file's download beside the core's, by 0.56 to 0.58 s at the median. The slowest such load (4,413 ms) was faster than the fastest load that waited for the core (4,749 ms).
- The shader file shares the link with the core, so the core is ready about 0.19 s later: about 4.21 s against 4.02 s, pipelined. The first frame then follows the core by about 50 ms, against about 0.8 s when the file waits for the core.
- Each mode makes the same requests and downloads the same bytes in either order. Single-threaded loads made 11 requests for 363 KB, and the other modes 12 requests for 367 to 371 KB.
- Warm loads make one request, and the files come from the cache, so the order cannot change them. Their medians stayed within the spread between loads.

`bun run bench:startup --runs 5 --gpu webgl2 --modes all --loads cold,warm --network slow-4g`, twice for each start order. The S24+'s own figures come from `bun run bench:startup --android`.

### Warm-up (T-12, T-26)

`KHR_parallel_shader_compile`, which lets WebGL2 compile programs in the background, in the device runs:

| Browser | The extension |
| --- | --- |
| Mac: Chrome, Brave, Safari | Yes |
| Mac: Firefox 156 | No |
| iPad: Safari 26.6, Brave | Yes |
| Galaxy S24+: Chrome 154, Brave | No |
| Pixel 8 (Mali-G715): Chrome 153 | No |
| Redmi Note 13 4G (Adreno 610): Chrome 138 | No |
| iPhone 16 Pro: Safari 26.4 | Yes |

The last three rows come from TestingBot's device cloud ([tested devices](../tested-devices.md)). So Apple's browsers compile WebGL2 programs in the background, and Chrome on the Android phones measured does not.

The warm-up test page builds 10 pipelines on WebGL2, and 11 on WebGPU, where the culling pass is the eleventh. The device runner's checks plan ran it on the MacBook Pro M5 Max. The runs are 20260930-050804-checks and 20260930-052609-checks. `load.warmUpMs` is the time from the first build's start until no build was running. Each browser had compiled these shaders before, so its own shader cache may shorten the times.

| Browser | WebGPU | WebGL2 | WebGL2 with `?compile=wait` |
| --- | --- | --- | --- |
| Chrome 154 | 131 ms | 8 ms | 0: the first draw waits for each program |
| Safari 26.6.2 | 354 ms | 215 ms | 0: the first draw waits for each program |
| Firefox 156 | 848 ms | 0: no extension, so the first draw waits | 0 |

### Device warm-up times (T-26)

The device runner's `warm-up-time` plan loads each benchmark scene and each demo four times on each GPU path, at the preset that the engine chooses. Two loads use fresh shaders: `?shaders=fresh` gives each shader's text a new comment, so the browser compiles every program again, as on a first visit. Two loads use the shaders as they ship, and the second of them reuses the first's compiles, as a repeat visit does. [Device sessions](../devices.md#the-warm-up-time-plan) describes the plan.

The pipeline wait is the warm-up, `load.warmUpMs`, plus the first draw, `load.firstDrawMs`. It is the time that pipelines hold up the first frame on every browser, with or without background compiles. Shown is the time from `createEngine` until the page saw the first frame. Each figure is the median of two loads. In these runs the page saw the first frame only after `createEngine` resolved, which on a first visit waits for the preset check. The check runs after the first frame. So the Shown column holds the check's time too: it gives when `createEngine` resolved, not when the first frame showed. The scenes built 2 to 4 pipelines each.

| Device and path | Pipeline wait, fresh | Pipeline wait, repeat visit | S4, fresh / repeat | Shown |
| --- | --- | --- | --- | --- |
| iPad, Safari 26.6, WebGPU | 21 to 31 ms | 21 to 32 ms | 31 / 32 ms | 1.0 to 1.9 s |
| iPad, Safari 26.6, WebGL2, background compiles | 35 to 53 ms, two scenes more | 35 to 61 ms | 412 / 61 ms | 1.0 to 2.2 s |
| S24+, Chrome 154, WebGL2, no background compiles | 45 to 73 ms, S4 more | 29 to 42 ms, S4 more | 115 / 88 ms | 0.23 to 0.43 s |

- On the iPad's WebGL2 path, two scenes took longer with fresh shaders: S4 412 ms and the layers demo 170 ms. On a repeat visit they took 61 and 35 ms.
- On the iPad's WebGPU path, fresh and repeat loads took the same time. Safari turns WGSL into Metal's shading language, which may drop the comment. Metal may then reuse its own compiled code. So the WebGPU figures may be repeat-visit times.
- The preset check does not delay the first frame (M2-R6). The runner draws the first frame with every pipeline built, and only then loads and runs the check, while the scene keeps drawing (#147). The 1 to 2 s on the iPad is the time until `createEngine` resolved, and so until the sketch's frame loop starts. The warm-up time page times the first frame from the engine's own record of when the GPU finished it. It tabulates `createEngine`'s time beside it. The iPad's first-frame figures wait for a run of that page on the owner's iPad.
- On the iPad, the preset check takes most of the time until `createEngine` resolves. It takes about 1 s for each preset that it measures. By its own timing it takes at least 0.75 s, and on the MacBook Pro about 0.8 s ([D-11](D-11-frames-in-flight.md#the-preset-checks-thresholds-m1-g3)). Loads that lowered the preset once took about 1.9 to 2.2 s.
- With [D-17](D-17-stored-preset-check.md), a repeat visit takes the check's stored result and skips the check. In Safari 26.6.2 on the MacBook Pro, a warm load's `createEngine` then resolved at 28 to 30 ms, against 826 to 837 ms with the check. In Chrome 154 it resolved at 52 ms, against 866 ms. The GPU finished the first frame at 48 to 86 ms either way. In a second run of the warm-up time plan on the iPad, the repeat loads took the stored result. They showed the first frame after 0.25 to 0.52 s, and the first visits after 1.0 to 2.4 s.
- The S24+ starts at Low, which has no lighter preset, so it runs no check. Without WebGPU, the S24+ skipped the 60 WebGPU loads.
- No scene came near the 15 slow seconds of the Godot port that T-26 was written for. The longest pipeline wait was S4's 412 ms on the iPad's WebGL2 path, with fresh shaders.

How the data was produced: `bun tests/real-browsers.ts --plan warm-up-time --lan ipad-safari`, run 20261002-183327-warm-up-time, 120 of 120 pages passed. Then `--plan warm-up-time --allow-no-webgpu --android chrome`, run 20261002-183848-warm-up-time, 60 passed and 60 skipped.

## Decision

(b3): the shaders of each GPU path load as files of their own. There is one file for each value of the bits that a device fixes when the engine starts. A page loads exactly one at its start. The device fixes the draw index (WebGL2 with multi-draw or without) and TONE_MAP (the 8-bit output path or HDR). The start file holds every combination of the material bits for the templates that every page draws with. A feature that most pages do not use has files of its own by the same fixed bits. A page downloads them on the feature's first use ([D-56](D-56-first-use-shader-files.md)). The thread that draws starts the download as soon as the page knows its GPU path and its fixed bits. That is right after the GPU probe, while the core downloads. The first frame waits for its pipelines anyway.

(b3) gives the smallest page on both paths at every bit count, and the least JavaScript to parse. At five bits, a WebGL2 page is 52.0 KB and parses 414 KB of shader text. With every variant in the file that draws, it is 57.6 KB and parses 1,644 KB. (b3) kept 8 KB of the 60 KB budget with M1's five bits, and each more material bit cost about 1 KB. (c) saves 0.6 KB more on a WebGPU page and nothing on WebGL2, but each template needs a second way to write it. So (c) waits until WebGPU warm-up time asks for fewer shader modules. T-26 gives no such reason: on the iPad, no scene's WebGPU pipelines took more than 32 ms.

How many: each file holds 2^m variants of a template with m material bits: 16 for the standard material with M1's four material bits. A scene builds only the variants that its materials use.

Background compiles: the engine uses `KHR_parallel_shader_compile` where the browser has it, and the first draw waits for each program where it does not. Both kinds of device met the target. The iPad has the extension, and its WebGL2 pipeline wait was 35 to 61 ms on a repeat visit. The S24+ lacks it, and its wait was 29 to 115 ms. So the engine needs no other path for browsers without the extension. T-12 and T-26 close with this record.

## How three.js handles it

three.js's WebGL renderer builds a program for each combination of a material's features. It builds it when an object first draws with that material. Its `#define` lines play the part of null3D's permutation bits. The GLSL comes from shader chunks in the download. So a page carries every chunk, whether its scene uses it or not. By default, the first draw of each new material waits while its program compiles. An app can call `renderer.compileAsync` to compile a scene's programs ahead of time. It uses `KHR_parallel_shader_compile` where the browser has it.

null3D does the same work at build time. A page downloads one file with only the variants that its device can use, and the first frame waits for the scene's pipelines. A sketch can call `scene.warmUp()` to build them before its loading screen ends.

## Consequences

- The shader manifest marks the engine's shaders, such as `lit`, `unlit`, `final`, `mipmap` and `cull`, with `by_device = true`. The shader build writes their builds into device modules, plain JavaScript files named `generated/shaders-<target>[-<bit>...].js`. The start modules are `shaders-wgsl.js`, `shaders-glsl.js` and `shaders-glsl-draw-index.js` for HDR devices, and the same three with `-tone-map` for the 8-bit path. Half precision ([D-09](D-09-half-precision.md)) is a third bit that a device fixes, so each of the six has a `-half` twin: twelve start modules in all. A module holds the builds of each shader that a device with its bits asks for. So a shader without device bits, such as `cull`, `mipmap` or the final pass's `final`, is in every module of its target. The main module imports the device modules by address, so one copy of each serves the page's bundle and every worker's.
- The main module, `generated/shaders.ts`, keeps the types, the test shaders and the GPU timer's mark shader. It also keeps the debug lines shader, which only development builds import. It also has the loaders `loadWgslShaders(bits)` and `loadGlslShaders(bits)`. Each loader imports only its own target's modules.
- The core device carries the bits that the device fixes (`shaderBits`). The page works the core device out right after the GPU probe, and tells the thread that draws to start the file's download then (`load-shaders`). The renderer loads the same module again once the core has started, and the browser gives it the module that is already on its way. The renderer then gives the loaded shaders to the backend.
- The size report names each shader file (`SHADER_PARTS` in `tools/lib/size-report.ts`) and counts the largest in each thread mode's download. A new value of the device's bits adds a module, which the report must name.
- A new material bit doubles each start file: check the size report when one is added.
- The warm-up time plan watches the target: S4's pipeline wait with fresh shaders stays under 250 ms on the S24+. A new material bit, or a pass that adds pipelines to S4, reruns it on the S24+.
- T-26's times give the device figures in the loading screens guide.

## The files with M2's features

The decision chose (b3) for the smallest start and the least shader text to parse. Both reasons rest on a 414 KB GLSL file, and through M2 every feature added its variants to every start file. Review R8 (R8-02) and review R6 (R6-03) measured the cost ([the code review](../code-review.md)):

- With every feature in it, each start file was 1.7 to 3.4 MB uncompressed and about 24 KB after Brotli. That is 7 to 8 times the 414 KB above.
- V8 compiled the largest file in 11.5 ms on the Mac (Apple M5 Max). Parsing took 15 to 20 ms for GLSL and 7.5 to 11 ms for WGSL. Phones take several times longer, on the thread that draws, before the first frame.
- Every feature grew every start file. GPU occlusion culling added 8.7 to 8.9%, although it is off by default. AO added 9 to 15%, wide lines 2.0 to 2.9 KB, and sprites and outlines 0.7 KB each.

The owner's rulings set the layout that answers this:

- A feature's shaders may load on first use, in files of their own. [D-14](D-14-js-budget.md#first-use-shader-files) sets their limits.
- The size is fixed at its cause ([D-53](D-53-technique-defaults.md) ruling 23). M2-R11 ([D-56](D-56-first-use-shader-files.md)) stores each unique stage source once per file, with variants as indexes into it. It moves each feature's templates into a first-use file.
- Add-on modules need first-use shader files too ([D-54](D-54-addon-modules.md)).

### Sizes

Main at dc178379 with M2-R14's branch, which writes each stage source once (task M2-R14, from reviews R8-02 and R6-03). Sizes are KB (1,024 bytes), measured on the production build that `bun run build` makes. The device modules without half precision:

| File | Raw | Brotli 11 | Brotli 5 | Brotli 4 | gzip 9 | gzip 6 | gzip 1 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `shaders-glsl-draw-index-tone-map` | 2,659.8 | 25.0 | 29.5 | 33.4 | 299.7 | 394.3 | 635.2 |
| `shaders-glsl` | 2,336.9 | 24.6 | 28.9 | 32.9 | 231.9 | 319.2 | 527.0 |
| `shaders-wgsl-tone-map` | 1,911.7 | 25.3 | 28.6 | 32.8 | 264.8 | 316.0 | 509.8 |
| `shaders-wgsl` | 1,703.1 | 25.8 | 28.3 | 32.4 | 202.9 | 257.9 | 420.0 |

The half-precision twins are 1,711 to 2,776 KB raw. Brotli finds the repeated text across its window of several MB. gzip's window is 32 KB, so it finds only repeats that sit close together. Under (b3) at five bits, a WebGL2 page was 64.0 KB with gzip 9. At dc178379 the shader file alone is 231.9 to 299.7 KB with gzip 9. Hosts that compress on the fly often use gzip 6, which gives up to 394.3 KB. A pipelined page's start, the largest, is 106.9 KB with Brotli 11, 402.7 KB with gzip 9 and 3,040.6 KB uncompressed. With the duplicate sources, review R8 measured that start at 589 KB with gzip 6.

### Duplicate stage sources

35 of the 164 GLSL stage sources in a device module are exact copies of another: a vertex stage that several variants share, for example. The shader build writes each source once per module and points each program at it. That takes a GLSL device module from 2.96 to 2.42 MB raw, and the main module from 1.77 to 1.28 MB. The WGSL modules have no copies. Brotli 11 sizes hardly change, since Brotli already finds the copies.

### Parse time

V8 compiles and runs a shader module when a page imports it. Measured in Node 24 on the M5 Max, each module minified and imported 7 times, each time in a fresh process. The table gives the median, less the 1.6 ms that an empty module takes.

| Module | With the copies | Each source once |
| --- | --- | --- |
| `shaders-glsl` | 10.6 ms | 9.0 ms |
| `shaders-glsl-draw-index-tone-map`, the largest GLSL | 12.1 ms | 9.9 ms |
| `shaders-wgsl` | about 6 ms | about 6 ms |

The 414 KB file of (b3) took 2.2 ms. A phone takes several times as long as the Mac, and the time falls on the thread that draws, before its first frame.

### Features that load on first use

[D-56](D-56-first-use-shader-files.md) keeps out of the start files the builds of features that most pages do not use. These include sprites, lines, skinning with every SKIN build, bloom's steps and the final pass's BLOOM builds, the texture background and the engine's test template. Each feature has files of its own, by the same fixed bits, and a page downloads one the first time it uses the feature. A start shader file then holds 17.7 to 19.4 KB after Brotli and 0.85 to 1.37 MB uncompressed. With those features in it, it held 27.6 to 30.0 KB and 1.8 to 3.6 MB. So a page parses about half the shader text at its start. A permutation bit that a feature's table names adds nothing to the start files. Another material bit still doubles each one.

### What holds for the layout

- (b3)'s split stays: one shader file for each value of the bits that a device fixes, and a page downloads exactly one at its start.
- The start file holds only what every page draws with. Each feature's templates sit in files that load on the feature's first use ([D-56](D-56-first-use-shader-files.md)).
- The size report measures each file raw, with gzip 9 and with Brotli 11. It budgets all three for the start and for the files that load later ([D-14](D-14-js-budget.md#decision)). A start that grows on a gzip host, or on a host that sends files as they are, fails the build.
- The hosting guide tells developers to serve the engine's files with Brotli, and gives the gzip and uncompressed sizes.

## Paragraphs that sources share

### Question

With M2-J5 (specular and ior), two WebGL2 skinning files measured over 1,536 KB uncompressed. That was the limit of a first-use file at that commit ([D-56](D-56-first-use-shader-files.md)). `shaders-skinning-glsl-draw-index-tone-map-half.js` was 1,557.8 KB and `shaders-skinning-glsl-tone-map-half.js` 1,554.8 KB. After gzip and Brotli they used 86% and 65% of their limits. Can the files shrink without a higher limit?

### Data

Stage sources that differ still share most of their text: the same structs, uniforms and functions, with a few that change with the build's bits. In `shaders-skinning-glsl-tone-map-half.js`, the 60 distinct sources held 1,346 KB, but only 108 KB of distinct lines. Split at blank lines, they held 3,049 paragraphs, 335 of them distinct, in 295 KB.

So each device module writes once each paragraph that several of its sources hold. Each is a constant (`PART_0`, `PART_1` and so on) before the shared sources. Each source's template literal names those constants in place of their text, and the page joins them when it evaluates the module. Every one of the 60 device modules gives the same builds as before, string for string.

Sizes from `bun run build:check-size` at the J5 merge commit. Each cell gives the size without shared paragraphs, then with them. Each start file is one of four rows, and each page downloads one:

| File | Uncompressed | gzip 9 | Brotli 11 |
| --- | --- | --- | --- |
| `shaders-skinning-glsl-draw-index-tone-map-half.js`, the largest | 1,557.8 to 538.9 KB | 275.3 to 46.1 KB | 20.8 to 21.4 KB (+2.9%) |
| `shaders-skinning-wgsl-tone-map-half.js` | 1,256.2 to 242.7 KB | 286.6 to 39.0 KB | 18.9 to 19.9 KB (+5.3%) |
| `shaders-glsl-draw-index-tone-map-half.js`, a WebGL2 start file | 1,305.4 to 375.7 KB | 268.1 to 44.6 KB | 20.9 to 21.6 KB (+3.3%) |
| `shaders-wgsl-tone-map-half.js`, a WebGPU start file | 1,222.8 to 265.2 KB | 273.7 to 42.7 KB | 22.6 to 23.6 KB (+4.4%) |
| A pipelined page's start | 1,622.3 to 692.6 KB | 381.7 to 152.6 KB | 117.1 to 118.2 KB |

With shared paragraphs, the largest file that loads on first use takes 35% of the uncompressed limit and 14% of the gzip limit. Brotli already found the repeats, so it gains nothing. Each reference costs it a little. The 62 shader files grow 0 to 7.7% after Brotli, 22 KB in all. A page's start grows 1.1 KB, to 84.4% of its 140 KB budget at that commit.

### Options

| Option | Uncompressed | gzip | Brotli | Cost |
| --- | --- | --- | --- | --- |
| A: raise the limit | unchanged | unchanged | unchanged | The files keep growing with each material bit |
| B: split the skinning files by one more bit | about half for skinning only, estimated | about half, estimated | about the same per build | Twice the skinning files, and a page with both values downloads two |
| C: write each shared paragraph once (chosen) | 65 to 81% less in the large files | 83 to 86% less | +2 to 5% in the large files | A template literal per source with its references |
| D: also drop each line's indentation | a further 26 to 34 KB less | a further 4 to 8 KB less | 0.4 to 0.6 KB less, which takes back most of C's growth | Sources are harder to read in a browser's tools; line numbers stay the same |

D is not built: it changes how the shader text reads, which is the owner's choice.

### Main module

The main module shares whole sources only. A bundle keeps only the exports of `shaders.ts` that it imports. But the minifier keeps a template literal that names a constant, even where nothing reads it. In a trial build with paragraphs there, `page-renderer.js` grew from 27.9 to 39.1 KB after Brotli, with the paragraphs of the test shaders it never imports.
