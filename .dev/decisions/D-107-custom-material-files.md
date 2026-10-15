# D-107: Custom material builds in files by device

Status: decided on 2026-10-08: the owner asked for smaller custom-material sketches, and the coordinator approved (a) with (b) inside each file. Sharing text between the files of separate modules is a possible later step ([below](#a-possible-later-step-one-table-for-the-whole-build)). The [addendum of 2026-10-13](#addendum-2026-10-13-the-builds-travel-as-modules-of-the-sketch) keeps the intent and changes the delivery: the sets of builds are modules in the sketch's graph, which the sketch thread imports and sends on. Built in that form. Date: 2026-10-08. Task: M2-J3.

Summary: Each device gets only its own custom-material builds, on first use, with the text that they share once. The Vite plugin puts each module's builds in modules of their own: one for each GPU path, each value of the bits that a device fixes, and skinning, so 4 for WebGPU and 8 for WebGL2. The sketch thread imports its device's set when it first uses a material and sends it to the thread that draws, which asks for another set when a pipeline needs one. For the battle comparison's 5 materials, the sketch module falls from 1,504 KB to 5 KB, and the shader text that the thread that draws holds falls from 7.4 to 3.6 MB on WebGPU and from 26.9 to 3.0 MB on WebGL2. The sketch thread holds about 0.5 MB in place of 8 to 9 MB.

## Question

The plugin builds each custom material into every variant of the standard material: 80 builds. It writes them all into the user's sketch module as text. The image tests' sketch with 4 custom materials is a 16 MB module, and Safari once failed to import it (E1410). How do custom materials get smaller, and what does each way cost when a page loads?

## Rule

- A page downloads and parses only the builds that its device can use ([D-13](D-13-shader-variants.md)). A feature that a page does not use adds nothing to its start ([D-56](D-56-first-use-shader-files.md)).
- Each file that holds custom material builds stays within the limits of one first-use shader file: 1,536 KB uncompressed, 320 KB after gzip and 32 KB after Brotli ([D-14](D-14-js-budget.md)).
- The thread that draws gets the same builds, string for string, so the image tests give the same images on all three tiers.
- The first frame waits for a custom material's pipelines, as it does now. No frame draws a custom object half built.
- The files load under a strict Content Security Policy, and the offline file list holds them ([D-54](D-54-addon-modules.md), [D-102](D-102-offline-play.md)).
- The sketch thread and the thread that draws allocate nothing per frame in steady state.

## Data

All sizes are KB of 1,024 bytes: uncompressed, after gzip at level 9, and after Brotli at quality 11. The sketch is `tests/pages/sketches/custom-material-sketch.ts`, with 4 custom materials in tagged literals. The builds are from origin/main at 112a2c06.

### Where the size comes from

| Part | Figure |
| --- | --- |
| Builds of one material | 80: 16 for WebGPU and 64 for WebGL2 |
| Bits of the WebGPU builds | TONE_MAP, VERTEX_COLOR, ALPHA_MASK and RECEIVE_SHADOWS: 2^4 |
| Bits of the WebGL2 builds | The same four, and DRAW_INDEX and SKIN: 2^6 |
| Builds that one device can use | 8 on WebGPU and 16 on WebGL2, because the device fixes TONE_MAP and DRAW_INDEX. On the 8-bit path, bloom also asks for the builds without TONE_MAP, so 16 or 32 |
| One material's value in the module | 3,808 to 3,870 uncompressed, 836 to 854 after gzip, 31.3 to 32.2 after Brotli |
| Stage sources of one material | 144 (16 WGSL, and a vertex and a fragment stage for each of the 64 GLSL builds), of which 40 are distinct |
| Distinct paragraphs of one material | 360 to 373, 234 to 237 KB: the 3.8 MB holds each about 16 times |
| Paragraphs in all 4 materials | 332 of 411 distinct paragraphs, 193 of 291 KB, are the same in every material: the template's text. Each material adds 28 to 41 paragraphs of its own, about 41 KB |
| The 4-material module | 15,358 uncompressed, 3,378 after gzip, 37.5 after Brotli. Brotli finds the repeats across the materials, so 4 materials cost little more than 1 after Brotli |

One material's builds, by the bits that a device fixes:

| Device's file | Builds | As now | Sources and paragraphs once |
| --- | --- | --- | --- |
| WebGPU, HDR output | 8 | 305 / 51 / 11.9 | 75 / 16 / 11.5 |
| WebGPU, 8-bit output | 8 | 329 / 80 / 12.8 | 79 / 17 / 12.3 |
| WebGL2, draw index, 8-bit output, the largest | 16 | 825 / 190 / 14.8 | 130 / 23 / 14.6 |

Custom effects and tone curves are small beside a material: an effect's builds are 7.5 to 12.2 KB and its pieces 12.6 to 21.9 KB, and a tone curve's 8 builds are 104 KB. This record leaves them as they are.

### The options for the 4-material sketch

| Option | Sketch module | What a device downloads for the materials | Import of the module | Text that each thread holds: sketch, drawing | Sending the builds to the thread that draws |
| --- | --- | --- | --- | --- | --- |
| Now | 15,358 / 3,378 / 37.5 | In the module | 69 ms | 14.7 MB, 14.7 MB | 12.0 ms |
| (c1) Each distinct source once, per material | 5,537 / 965 / 26.9 | In the module | 40 ms | 14.7 MB, 14.7 MB | about the same |
| (c2) Each source and each paragraph once, per material | 1,393 / 176 / 28.1 | In the module | 20 ms | 14.7 MB, 14.7 MB | about the same |
| (b) One table of sources and paragraphs for all materials of the module | 722 / 56 / 26.3 | In the module | 15 ms | 14.7 MB, 14.7 MB | 9.7 ms |
| (a) A file per device, as now inside | 1.8 / 0.2 / 0.2 | 4 files: 3,299 / 758 / 59 (WebGL2, 8-bit) | 0.6 ms, and each file | 0, 3.2 MB | below 0.5 ms |
| (a) with (b) inside: one file per device for the module's materials (proposed) | 1.8 / 0.2 / 0.2 | 1 file: 224 / 27 / 15.5 (WebGL2, 8-bit), 114 / 17 / 12.3 (WebGPU, HDR) | 0.6 ms, and 2.7 to 4.1 ms for the file | 0, 1.2 to 3.2 MB | below 0.5 ms |

"Import" is a fresh Node 24 process on the M5 Max, the median of 7. A phone takes several times as long. "Text that each thread holds" is the length of the strings that the module's values give: the builds that the thread keeps until the page closes. "Sending" is one `postMessage` of the values to a worker thread in Node, which clones them, the median of 7.

How the data was produced: scripts that compile the sketch's tagged literals with `compileMaterial` from the shader compiler, write each option's values as a JavaScript module in the form of the engine's device modules (each shared paragraph and source a constant, and each source a template literal that names them), and measure the result. 8 October 2026.

## Options

| Option | Size | Load-time cost | Fit with the engine's design | Risk |
| --- | --- | --- | --- | --- |
| (a) Only the device's builds, in files that load on first use | Sketch module 1.8 KB. A device downloads 8 or 16 builds of 80 | One more request for each source file, which starts when the material's shader reaches the thread that draws, during the sketch's setup. The first frame already waits for the material's pipelines | As D-13 and D-56: a page downloads only its device's builds, and a pipeline waits for its file as for a first-use feature's | Medium: the plugin writes files in builds and serves them on the dev server; hot updates; the offline list; a failed download stops the pipeline with a clear error, as a first-use feature's does |
| (b) Share the template's text between materials | 722 KB for 4 materials in one module. Across separate files, a table for the whole build | None at run time | As D-13's paragraphs that sources share | Low within one module. A table for the whole build depends on every material in the build, so the files are written at the build's end, and the dev server needs another form |
| (c) Each source and each paragraph once, at build time | 1,393 KB for 4 materials; Brotli gains nothing | The page joins the text when it evaluates the module: 20 ms against 69 ms | As D-13's addendum of 2026-10-05, which writes the engine's own files so | Low: only the plugin changes, and the engine gets the same strings |
| (d1) Join a material's own code into a host's builds at run time, as custom effects' pieces do ([D-71](D-71-custom-effects.md)) | A few KB for each material | The joiner, and a host file for each combination of the material's functions, uniforms and textures | As D-71 | High: the standard material has two stages, and naga's names must read the same in every build |
| (d2) Fewer bits for custom materials: a branch in the shader in place of RECEIVE_SHADOWS, VERTEX_COLOR or ALPHA_MASK | Half for each bit taken out | GPU time in every draw of the material | Against D-13: a cost in the shader is a bit | Medium: looks and benchmarks change |
| (d3) Compressed text in the module, with `DecompressionStream` at run time | About 1.1 MB for each material as base64 gzip: larger than (c) | Decompression on the sketch thread | None | Not taken: larger than (c), and async |
| (d4) (c), with the joins done on the thread that draws, for only its device's builds | As (c) or (b) | No more requests | Partly: the page still downloads every build | Low to medium: the shader message carries parts, and the backends join them |

## Decision

(a) with (b) inside each file, in place of (c) alone. The coordinator approved it on 2026-10-08, after the owner's request for smaller sketches. Sharing between the files of separate modules waits.

- The plugin writes one file for each module of custom materials and each GPU path and value of the bits that a device fixes: 2 files for WebGPU and 4 for WebGL2. A source is a `.wgsl` file, or one script's tagged literals together. Each file writes each shared source and each shared paragraph once, in the form of the engine's device modules.
- The sketch module keeps each material's record without its builds: its functions, uniforms, textures, vertex inputs and base color, and the address of each file. That is about 0.4 KB for each material.
- The thread that draws starts the download of its device's file as soon as a material's shader arrives, during the sketch's setup. A pipeline whose build is not there yet waits, as a first-use feature's does (`DeviceShaderSet.ready`). The first frame waits for it, as it waits for custom pipelines now. On the 8-bit path, bloom's pipelines ask for the builds without TONE_MAP, and the set loads that file then, as it does for the engine's own start file.
- On the dev server the plugin still compiles all 80 builds when the module loads, so every GPU path's errors show at once, and it serves the files from memory. A hot update carries the new files' addresses.

Why (a) and not (c) alone: (c) makes the module 11 times smaller, but each thread still holds 14.7 MB of builds that the device cannot use, and the page still parses and clones them. (a) gives the device 1.2 to 3.2 MB, and the sketch thread none. Phones, Safari above all, run short of memory ([D-92](D-92-safari-removed-frames.md), [D-98](D-98-memory-pool.md)).

Why (b) only within one module: see the next section.

### A possible later step: one table for the whole build

A table for the whole build would also share text between modules, such as several `.wgsl` files. For 4 materials in 4 files, a WebGL2 device would download about 224 KB in place of 4 × 130 = 520 KB, and 16 KB in place of 58 KB after Brotli. But the table depends on every material in the build, so the plugin could write the files only at the build's end, and the dev server would need a second form. A project with many `.wgsl` files gains the most. Not built now: the coordinator chose to wait until a project shows the need.

## Consequences

The plugin:

- Compiles each module's custom materials as before, then sends their builds back to the shader compiler, whose `material_files` call writes the files. It reuses the code that writes the engine's own device modules, so each file holds each shared source and paragraph once. Each file lists every material of the module in order, and a material without builds for the file's bits keeps its place with an empty entry.
- Puts each material's value in the module without its builds. The value holds `files`: the material's place in the lists, and each file's address by GPU path and fixed bits.
- In `vite build`, emits each file as an asset named `material-<target and bits>-<hash>.js`, and the module names it through Rollup's file address, as for any asset. The offline list ([D-102](D-102-offline-play.md)) puts the files in the `start` group, as the sketch's chunk names them. A unit test builds a project and checks the list.
- On the dev server, keeps the files in memory and serves them under `null3d-materials/`, named by a hash of their text, with `no-cache`. A module's new compile replaces its old files, so memory does not grow with each edit, and a file that is gone answers 404, not the page that Vite falls back to. The address is a plain path from the server's root: Vite rewrites `new URL('<path>', import.meta.url)` with a string as if the path named a file on disk.
- Sends a hot update of a custom material with the addresses of new files, in place of its 80 builds. The page then downloads only its device's file, as at the start.

The engine:

- `DeviceShaderSet.custom()` notes a custom material's files when its shader reaches the thread that draws, and starts to download the device's file at once. `ready()` waits for it, as for the engine's first-use shader files, so the first frame waits for the material's pipelines as before. On the 8-bit path, bloom's pipelines ask for the builds without TONE_MAP, and the set loads that file then.
- A hot update on the dev server swaps a material's pipelines only once the new shader's file has arrived. Before, the backends rebuilt the pipelines from the new shader in the next frame. With empty builds that failed, and the old shader stayed. In the first browser run, the hot reload test's first edit never showed in compatibility mode, where the download was slower than a frame.
- A file that does not download, or that does not list the material (a file left from another build), stops the drawing with E1424, a new code. E1406 stays the code of the engine's own files, whose fix differs: there the engine's package files are missing, here the project's own build files. A failed download of the engine's first-use shader file now reports E1406 too, in place of E1404 with a plain message.
- The thread that draws throws the coded message, such as `E1424: ...`, and the page turns it into the engine error with its fix and link. So the drawing code does not load the error class. When it did, the bundler split the error class into a chunk of its own, which the size report does not name.
- The sketch's import of a material file is not retried. The engine's own first-use shader files are not retried either. A retry for every on-demand file, as the sketch module has (E1410), would be a change of its own.

Docs: the custom shaders guide ("Where a custom material's builds go", hot reload), the hosting page's offline list, the engine page's `onFailure`, the E1406 and E1424 error texts, and the develop skill's troubleshooting table.

## Addendum, 2026-10-13: the builds travel as modules of the sketch

The intent of the ruling stays: each device gets only its own builds, on first use, with the text that they share once. Only the delivery changes. The coordinator approved the change on 2026-10-13. The plugin writes no files and serves none. It puts each set of builds in a virtual module, which the sketch module imports on demand, as any module imports another. The thread that draws downloads nothing: the sketch thread imports the set and sends it through the channel that already carries the material's shader.

### Why the delivery changed

- The battle demo's work on skinned crowds (M2-EX41) needed a custom material's WebGPU builds that skin to load on first use, before this record was built. It made them a virtual module of the sketch, which the sketch thread imports when the thread that draws asks for them. Two ways to load a material's builds on first use would be one too many. This addendum makes the skin builds one more split of the sets, so one way remains.
- A module in the sketch's graph needs nothing new from the plugin. Vite serves it on the dev server, a build writes it as a file with a hashed name, the offline list finds it through the sketch's file, and a strict Content Security Policy allows it as it allows the sketch. The paused branch of 2026-10-08 needed a writer of files in the shader compiler, a route on the dev server, files emitted as assets, a list of their addresses in each material, and a loader in the thread that draws. All of these go.
- The thread that draws cannot know the addresses of the sketch's modules: only the sketch's own code can import them. So the sketch thread imports, and the thread that draws asks.
- Since the main merge of PR #507, the sketch module already keeps the shared text once, so the download gain of D-107 was mostly taken. What remained was the text that each thread holds, and the time to parse and send it. Both fall with the sets.

### What was built

- The plugin compiles each module's custom materials as before. It keeps each material's record in the module without its builds, with the joined permutation bits of the builds and a function that imports a set. It puts the builds of all the module's materials in one virtual module for each set, with the shared text once, as PR #507 packs it.
- A set is a GPU path and a value of the permutation bits that pick builds: the draw index (WebGL2 only), tone mapping and skinning. A build that lacks a fixed bit, and whose twin with the bit does not exist, such as a shadow caster's build, goes into the sets with and without the bit. So a pipeline finds its build in the set of its own bits.
- The sketch thread imports its device's set that does not skin when it first uses a material, and sends it. The thread that draws asks for another set, by template and set, when a pipeline needs a build that it lacks: the builds that skin for a skinned mesh, or the builds without tone mapping once bloom or depth of field moves the 8-bit path to HDR color. The sketch thread imports and sends each set of a template once.
- The thread that draws keeps each distinct text of the sets once. A message gives each build its own copy of the text that WebGL2's builds share, so without this the text would be held several times.
- The sketch module's getters build each text when the sketch reads it, and keep none: the sketch reads each text once, when it sends a set.
- A set that does not load stops the drawing with E1424, with the fix text of 2026-10-08.
- A hot update on the dev server still carries the new shader with all its builds. So the backends swap a material's pipelines only once its new builds are there, and a set of the old shader that comes later is dropped.
- The compiler's split of the WebGPU builds that skin, from M2-EX41, goes: the plugin splits every material's builds.

### Figures

All sizes are KB of 1,024 bytes: uncompressed, after gzip at level 9, and after Brotli at quality 11. Text is millions of characters, which V8 keeps as one byte each. "Before" is the battle demo's branch (commit 43f8c9d03), which this work starts from; "main" is main before it (3ed5e6c61), for reference. The device is this Mac: WebGPU with HDR color (set 0), and WebGL2 with multi-draw and HDR color (set 1). A script compiled each module with the plugin's code, and counted the text that each thread receives and keeps, on 13 October 2026.

What each thread holds after a material's first use, without skinned meshes:

| Module | Thread | Main | Before | After |
| --- | --- | --- | --- | --- |
| Battle, 5 materials | Drawing, WebGPU | 38.1 (both paths) | 7.38 | 3.61 |
| Battle | Drawing, WebGL2 | 38.1 (both paths) | 26.86 | 3.03 |
| Battle | Sketch, WebGPU | 19.6 | 9.10 | about 0.5 |
| Battle | Sketch, WebGL2 | 19.6 | 8.39 | about 0.7 |
| Creek's water, 1 material | Drawing, WebGPU | 11.4 (both paths) | 2.06 | 1.02 |
| Creek's water | Drawing, WebGL2 | 11.4 (both paths) | 8.07 | 1.05 |
| Creek's water | Sketch, either path | 6.6 | 3.0 to 3.3 | about 0.4 |
| Test sketch, 4 materials | Drawing, WebGPU | 28.0 (both paths) | 5.45 | 2.63 |
| Test sketch | Drawing, WebGL2 | 28.0 (both paths) | 19.73 | 2.55 |

A skinned mesh adds its set: 1.87 on WebGPU and 1.53 on WebGL2 for Battle. The sketch thread's figure after is the set's file and the sketch module, about 0.25 to 0.35 for Battle, and about as much again for the tables that it parses from the file. Before, it kept every text of its GPU path that it read once. On WebGL2 the drawing thread's figure counts each distinct text once (the clone of Battle's set carries 4.33, as WebGL2's builds share stages). On main, the shader message carried the builds of both paths.

The modules, uncompressed / gzip / Brotli:

| Module | Main | Before | After: sketch module | After: the device's set |
| --- | --- | --- | --- | --- |
| Battle | 1,682.9 / 93.1 / 43.2 | 1,503.6 / 83.6 / 40.8 | 4.9 / 1.2 / 1.1 | WebGPU 234.9 / 27.5 / 17.9, WebGL2 335.6 / 31.3 / 19.7 |
| Creek's water | 882.9 / 95.6 / 38.2 | 754.7 / 85.1 / 36.1 | 2.6 / 1.0 / 0.9 | WebGPU 182.7 / 31.5 / 17.6, WebGL2 212.2 / 33.9 / 18.9 |
| Test sketch | 1,132.2 / 71.8 / 32.4 | 1,006.6 / 63.5 / 30.5 | 3.1 / 1.0 / 0.8 | WebGPU 156.8 / 20.6 / 13.9, WebGL2 224.0 / 24.6 / 15.3 |

Every set of these modules stays within the limits of one first-use shader file: 1,536 KB uncompressed, 320 KB after gzip and 32 KB after Brotli. The largest is Battle's WebGL2 set with tone mapping, 345.6 / 32.8 / 20.8.

### First-use delay

The first frame waits for a custom material's pipelines, as it did before, so a set adds no wait of its own. The sketch imports its device's set as the material's first shader arrives, and the pipelines build once it is there. The wait to measure is one where a material appears later, such as Creek's water or a battle soldier. The probe page times the page's message to the frame after `scene.warmUp()`. It runs in a parked Chrome window on this Mac: 3 rounds per case, after one warm-up round.

The table gives the median of the three rounds, in ms. "Before" is the battle demo's branch (43f8c9d03), the point this work starts from. "After" is this branch.

| Material appears | Path | Before | After |
| --- | --- | --- | --- |
| Creek's water | WebGPU | 128 | 129 |
| Creek's water | WebGL2 | 208 | 67 |
| Battle skin | WebGPU | 54 | 54 |
| Battle skin | WebGL2 | 34 | 42 |

The engine's start to its first frame was 897 to 1,071 ms before and 881 to 1,051 ms after. On WebGL2, a set is far smaller than the whole path's builds of the old shader message. So the water's first use takes about a third of the time. A skinned mesh's set is one more import on WebGL2, about 8 ms. On WebGPU the builds that skin were already a set of their own (M2-EX41), so they do not change.
