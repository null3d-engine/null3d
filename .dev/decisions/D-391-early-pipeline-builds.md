# D-391: The pipelines of the last start's first frame build while the next start loads

Status: decided and built. The thread that draws lists the pipelines that its first frame built, and the page stores the list for the sketch. The next start of the sketch at the same preset builds them as soon as their shaders are there. Before the first frame, the WebGPU backend also builds in the background the pipelines that a list creates after other commands. The sketch asks for the shader files of the passes that the settings draw over opaque objects with its first opaque material. Pending: a first visit's list shipped with an app (option C).

Summary: The first frame's pipelines are the largest processor cost of a showcase start on Android. They take 1.6 to 5.5 s on a Galaxy S25, and 10 to 24 s on a Galaxy Tab A9 Plus. Chrome builds them in parallel once the first frame names them, and its pipeline cache on Android is too small for a repeat visit. A stored list of the last start's pipelines starts them while the engine loads. The tablet's island repeat then drew its first frame 8.8 to 11.2 s after the setup, against 23.6 s.

## Question

What can the engine do so that a phone spends less of its start waiting for GPU pipelines, without changing the first frame's picture?

## Rule

- The first frame still waits for every pipeline that it draws with, and shows the whole scene. Hold mode and the image tests draw the same pictures.
- No allocation in the frame loop (hard rule 1). The render worker keeps every GPU object (hard rule 2).
- A wrong or stale input may cost time, never a wrong picture or an error that a start without it would not meet.
- Take the change with the largest measured gain for the least risk first.

## Data

### How Chrome builds the pipelines

Read from Chromium's and Dawn's sources:

- Dawn's Vulkan device runs every `createRenderPipelineAsync` and `createComputePipelineAsync` on the platform's worker pool (`DeviceVk.cpp`, `InitializeRenderPipelineAsyncImpl`, with no toggle). Chrome's Dawn platform posts each such task to its thread pool, with no sequence between them (`dawn_platform.cc`). No device lock is held while a pipeline initializes (`CreatePipelineAsyncEvent.cpp`, `RenderPipelineVk.cpp`). The engine issues every pipeline of a list at once, with no wait between them, so Chrome builds them in parallel.
- Chrome's WebGPU blob cache is on by default on Android (`kWebGPUBlobCache`). Its key is the page's network isolation key, and a key that is empty turns the cache off. Nothing in it depends on a certificate error. The GPU process keeps one in-memory cache for each key. It holds 6 MB on desktops, 2 MB on Android, and 128 KB on Android devices that Chrome counts as low-end (`gpu_preferences.h`, `GetDefaultGpuDiskCacheSize`).

### What the phones measured

BrowserStack Automate, Chrome 152, the examples page's production build served through a BrowserStack Local tunnel at `bs-local.com` with the development certificate. A temporary probe in the render worker timed each pipeline build. The baseline is commit cbdd718e4 with the drawing thread's earlier start.

| Measure | Galaxy S25 (Adreno 830) | Galaxy Tab A9 Plus (Adreno 619) |
| --- | --- | --- |
| First-frame pipelines: instances, skyway, island, creek | 17, 54, 62, 46 | 17, 55, 63, no first frame |
| Their build span on a first visit: skyway, island, creek | 1.6 to 2.0 s, 2.7 to 5.3 s, 3.8 to 5.5 s | 10.3 to 11.1 s, 22.8 to 23.8 s, over 26 s with no first frame |
| The same on a repeat visit | 1.5 to 2.0 s, 4.1 to 6.1 s, 5.1 to 6.8 s | 11.2 to 12.1 s, 22.0 to 22.8 s |
| Instances' span, first visit then repeat | 0.43 s, then 0.03 to 0.10 s | 2.8 to 3.0 s, then 0.5 to 0.8 s |

- Parallel: on the S25, skyway's 54 builds summed to 38.8 s of build time inside a 4.6 s span, about eight at once. Their completions came in batches.
- The slowest pipelines are custom materials. Each custom material's shader holds the whole lit shading code around its own function. That is 65 to 82 thousand characters in skyway, and up to 128 thousand in creek. Skyway's 13 custom materials took 0.5 to 1.3 s each on the S25. Creek's longest pipeline took 3.7 s, and set its first frame.
- The repeat visit does not hit Chrome's cache for the large scenes: their pipelines outgrow the 2 MB cache. Instances, whose 17 pipelines fit, builds four to five times faster on a repeat visit, through the same tunnel and certificate.
- The builds wait for the setup. On the S25's repeat visit of skyway, the thread that draws had its renderer at 1.4 s. The first frame's first build started at 4.35 s, after the setup.
- A pipeline whose shader file loads on first use waits for the file, which is asked for only when the first frame names the pipeline. On the S25, island's last pipeline waited 5 s for a file of builds that need two features, after three downloads one after another.
- Island's ocean creates 17 compute pipelines in the middle of its list, after other commands. The backend built them with the blocking call inside the first frame's replay. On the S25, island's first frame finished 0.37 s after it was drawn, and 0.18 s with option E below (one load each). On the Mac it finished about 0.44 s after it was drawn either way, against 55 to 70 ms for the other showcase scenes. So other work of that frame holds it there.

### The stored list on the S25

The same production build, with the list on, and with `?builds=fresh` on the next session, through the same tunnel. Each session is one first visit, which stores the list, and two repeat visits. The table gives the time from the end of the setup until the GPU finished the first frame, the part that the builds hold up. The total start depends on the tunnel's speed, which swung from 0.7 to 62 Mbit/s between sessions.

| Load | List on | `?builds=fresh` | Earlier build, no list |
| --- | --- | --- | --- |
| Skyway, first visit | 1.83 s | 2.36 s | 1.89 s |
| Skyway, repeat 1 | 1.47 s | 1.88 s | 2.29 s |
| Skyway, repeat 2 | 1.61 s | 2.04 s | |

On the repeat visits with the list, the engine's own pipelines built from 2.9 s, before the setup started at 3.8 s. The custom materials started at 4.5 s, once their sets of builds had downloaded during the setup. The tunnel serves them with no HTTP cache, as it does for every certificate exception.

Creek on the S25, the same sessions: 3.07 and 3.01 s with the list on its repeat visits. They took 4.24 and 4.74 s with `?builds=fresh`, and 4.78 s on the earlier build. Creek makes its heaviest custom material at the end of its setup, so that one build, 2.9 s long, still sets the first frame.

The final build on the S25, one session each: island's repeat visit took 1.56 s, against 3.81 s on the earlier build. Its first visit took 3.77 s, against 5.79 s. Skyway's repeat visit took 1.43 s.

### The stored list on the Galaxy Tab A9 Plus

The same method, from the end of the setup to the first frame. The island's repeat visits on this tablet failed after their first frame with E1404, "CreateGraphicsPipelines failed with VK_ERROR_UNKNOWN". They failed with the list and without it, as they did before this work. [D-390](D-390-refused-pipelines.md) now draws on past such a refusal.

| Load | List on | `?builds=fresh` |
| --- | --- | --- |
| Island, repeat 1 | 9.8 s; 8.8 s on the final build | 23.6 s |
| Island, repeat 2 | 11.2 s | 23.7 s |
| Skyway, repeat 1 | 8.5 s | 12.0 s |
| Skyway, repeat 2 | 13.1 s | 11.5 s |

### The passes' shader files on the Mac

The examples page's production build ran cold, on the timing helper's phone profile, in Chrome for Testing on the MacBook Pro. That profile is a link of 150 ms round trip and 10 Mbit/s, with the page's processor four times slower. The time from the end of the setup until the GPU finished the first frame, the median of four loads in two rounds:

| Demo | Files asked for by the first frame | Files asked for by the first opaque material |
| --- | --- | --- |
| Instances | 378 ms | 294 ms |
| Skyway | 854 ms | 865 ms |

Skyway's custom materials set its first frame there, so its pass files arriving sooner changes nothing.

### Pipelines in the middle of a list on the tablet

Before this work, the island's first visit took 29.0 to 30.3 s in three loads. That is from the end of the setup until the GPU finished the first frame. The first version of option E started each of the ocean's 15 equal compute pipelines as a build of its own, all at once. That took 32.1 and 33.9 s. Built one after another with the blocking call, Dawn's cache of equal pipelines had answered every one after the first. Started together, each compiled the shader again on a tablet already out of processor time. With equal commands sharing one build, the final build took 28.6 s.

The island's pipelines are mostly the engine's own, which the list starts while the core downloads. Skyway's slowest are its custom materials, which start only once the setup has made them and their builds have downloaded. The tablet builds about 17 pipelines at once and runs out of processor time, so skyway's gain varies from load to load.

How the data was produced: the phones helper's `phones.ts`, one Automate session per row group. The probe and the analysis scripts are kept with the maintainers' notes of the work.

## Look

The options draw the same pictures: each changes when a pipeline builds, not what it draws.

## Decision

Built:

- **B. A stored list of the first frame's pipelines.** The backend lists each create command before its first frame. The page keeps the list in `localStorage` for the sketch. Its key holds the engine's version, the GPU path, the device's fixed shader bits, the preset and the canvas format. The next start hands it to the thread that draws, which starts each build once its shader is there. An engine template's starts at once, a feature file's once the file arrives, and a custom material's once the setup sends it. The first frame's commands take the builds whose operands are equal. Equal operands make an equal descriptor, so a stale list costs builds that no command takes and never draws wrongly. On WebGL2 the list compiles programs ahead, and no frame waits for a program that no pipeline took. Hold mode, replays and the permutation recording neither read nor store a list. `?builds=fresh` turns the list off.
- **E. Background builds for pipelines in the middle of a list.** Until the first frame has drawn, the WebGPU backend walks the rest of each list that it prepares. It starts the builds of create commands that come after other commands. The frame waits for them as for the others, and its replay takes them instead of building them with the blocking call. The WebGL2 backend compiles such programs in the background where the context can, instead of letting their first draws wait.
- **F. The passes' shader files with the first opaque material.** Some passes draw over every opaque object as the device and the settings decide. They are GPU occlusion culling on WebGPU, and the screen-space bounce light on the HDR path, which reads ambient occlusion's steps and the color copy. The sketch's first opaque material asks for their files, and a sky with clouds asks for the cloud tier's where the settings march it. Each file was asked for only when the first frame named its pipelines before. The page cannot ask at its start, with the device's fixed bits and the preset alone. A page whose scene holds no material must download no feature file. A setup may also turn the bounce light off before it makes its materials. The settings are read when the material or the sky is made.

Rejected or not built:

- **A. An automatic warm-up during the setup**, which records frames while the setup runs, so the builds start as objects appear. The renderer would have to replay such frames into a hidden target, or the screen would show the scene half made. Such frames also run the work that a frame does once, such as a probe's capture, with half the scene. The temporal passes would keep those frames in their history. Not built: the risk to the first frame's picture is too high for the gain. The gain is at most the part of the setup after the objects exist: 0.5 of 1.8 s for skyway on the S25.
- **C. A pipeline list that ships with the app**, recorded at build time as the permutation words are (D-276), so a first visit gains too. It needs a list for each GPU path and preset, and an option of `createEngine`. Not built here; the stored list is its repeat-visit half.
- **D. Fewer or smaller pipelines.** The custom materials are the slowest builds, and each copies the whole lit shading code. Sharing one module among custom materials, or a smaller shading core for them, would cut every visit's builds. A custom material that moves no vertex could also draw its depth prepass with the engine's depth template. That would remove 11 of skyway's 54 pipelines. The prepass then needs the same depth to the last bit from two shader modules, which no compiler promises. These are changes to the shader system and to the demos, not made here.
- **Building the pipelines one after another, or reordering them**: Chrome already builds them in parallel, so neither helps.

## Consequences

- `gpu/early-builds.ts` holds the listing and the early builds, and `page/pipeline-store.ts` the store. Both backends take a list (`buildEarly`) and give theirs (`takeListing`). The scene renderers pass `earlyBuilds` and `listBuilds` from their options to the frame replay (`FrameReplay`). The replay hands the backend the list and ends the listing at the first frame.
- The WebGPU backend's `buildAhead` builds the pipelines in the middle of a list before the first frame, one build for equal commands. The WebGL2 backend's `compileAhead` compiles their programs.
- `scene/shader-preloads.ts` names the passes' features (`passFeatures`) and asks for them (`needPasses`, `needClouds`); the sketch runner gives it the GPU path, the device and the live settings. The first-use table (`tools/lib/first-use-docs.ts`) says when those files download.
- The worker protocol carries `earlyBuilds` and `keepBuilds` in the renderer's setup, and a `pipeline-list` reply.
- `docs/guides/loading-screens.md` ("Repeat visits"), `docs/getting-started/hosting.md` (the caches table), `docs/guides/testing.md` and the skill's references name the list and `?builds=fresh`.
- `.dev/implementation-notes.md` ("Pipelines and warm-up") gives the rules of the three changes.
