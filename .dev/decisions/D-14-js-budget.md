# D-14: The engine's JavaScript budget

Status: decided by the owner and built into the size check (`tools/lib/size-report.ts`). Only the owner raises a budget, in writing. For the start's Brotli figure, the owner gives standing permission to raise it when a feature needs the room. The start's 256 KB is a figure for now: the owner placed its reduction, and the trims that pay it back, in M4. Tasks: M2-R5, M2-R14, M3-K9.

Summary: The engine's JavaScript that a page downloads at its start may take 256 KB after Brotli, 448 KB after gzip and 3,328 KB uncompressed, in each thread mode on each GPU path. Each file that loads on first use or after the first frame may take 18 KB after Brotli, and each first-use shader file 56 KB. A feature that a page does not use loads its code on first use; Draco's decoder module and the area-light tables are recorded exceptions.

## Question

How much of the engine's JavaScript may a page download at its start, in each thread mode on each GPU path? How much may each file take that loads on a feature's first use or after the first frame? And what holds the sizes on hosts that compress with gzip, or not at all?

## Rule

- A budget holds every thread mode on each GPU path.
- Code that a page does not use adds nothing to its start. It loads on first use, in a file that the size report lists apart from the start. That file has a budget of its own.
- A trim adds no round trip before the first frame of a page that does not use the feature. It may add one round trip at a feature's first use, if the page waits for that feature anyway, as it does for a texture.
- Each budget has a size for each way a host can send a file: as it is, after gzip at level 9 and after Brotli at quality 11. A file over its budget in any column fails the build.
- Only the owner raises a budget, in writing. A raise given in chat, with no words kept, does not stand.

## Decision

| Budget | Uncompressed | gzip 9 | Brotli 11 |
| --- | --- | --- | --- |
| The start, in the thread mode and GPU path that download the most | 3,328 KB | 448 KB | 256 KB |
| Each JavaScript file that loads later | 64 KB | 24 KB | 18 KB |
| Each generated combination table, whose name holds `-combos` | 96 KB | 24 KB | 16 KB |
| Each shader file that loads on a feature's first use | 1,792 KB | 320 KB | 56 KB |

The size report prints a warning for each column of each start and each budgeted file past 97% of its budget. So a start or a file that is about to pass its budget is named while the build still passes. Under GitHub Actions the size check prints its warnings as annotations, which the run's page shows.

### The start

The start counts every file that a thread mode downloads before its first frame: the page's and the workers' files, its GPU path's renderers and the largest shader file of that path. A page needs its shader file to draw, so the start counts it ([D-13](D-13-shader-variants.md)).

The Brotli figure, 256 KB, is the owner's figure for now. It is headroom, not a target: the work that closes M3's feature list does not stop for a crossing while the trims run beside it. The owner placed the reduction in M4: the line comes down there, and the trims are done as part of that milestone. M3-T1's target of 160 KB is closed as superseded by the owner. The trims that it named stay as work ([Trims still owed](#trims-still-owed)).

The owner's standing ruling lets the start's Brotli figure rise when a feature needs the room, and accepts about 45 ms of extra cold start. Each kilobyte of start download costs about 6.5 ms on the Galaxy S24+, against its 5.5 s cold-start target ([D-83](D-83-m1-gate-rulings.md)).

The WebGL2 start is the binding one. Its GLSL shader text is three to four times the WGSL text, because naga writes each stage's full text into every program. The device modules are a floor of about 33 KB on WebGPU and 51 KB on WebGL2 ([Where the start's bytes are](#where-the-starts-bytes-are)).

The gzip and uncompressed figures stop a start that grows on a gzip host, or on a host that sends files as they are. The owner approved them in writing, and they stay at those figures.

### Files that load later

Each file of engine code that no thread mode downloads at its start may take 18 KB after Brotli, 24 KB after gzip and 64 KB uncompressed. Such a file loads on a feature's first use, after the first frame, or at the first call that reads it. The size report lists each one apart from the start, with its share of the budget.

The glTF worker is the only file near the line. It holds the thin film's and the stretched lobe's options of [D-215](D-215-iridescence-and-anisotropy.md), and the mapping of the texture-transform pointers that three.js moves. The only way under 17 KB is to drop the loader's checks for a malformed transform and for a material that moves two of them. So the owner set the figure a kilobyte higher. This is headroom, not a target: the first trim that wins bytes back takes them. The add-on check follows the same figure.

Third-party builds that the engine ships as they are keep a section of their own with no budget: the KTX2 transcoder's module (361 KB) and meshopt's module. The engine builds the transcoder itself, without code made from strings (M2-R18). Its script goes into the KTX2 task's file.

### First-use shader files

Each shader file that loads on a feature's first use may take 56 KB after Brotli, 320 KB after gzip and 1,792 KB uncompressed. The size report lists these files apart from the start, with their share of the limit. A first-use file holds every build of one feature set, for one target and one value of the bits that a device fixes (`first_use_files` in `crates/null3d-shaders/src/typescript.rs`). Each `[first_use.<feature>]` table of the shader manifest declares one feature's files ([D-56](D-56-first-use-shader-files.md)). The morph builds of [D-51](D-51-morph-targets.md) and the room's generator of [D-19](D-19-environment-maps.md) are such files.

Shader text compresses far better than code, so the JavaScript files' proportions do not fit the shader files:

- Brotli, 56 KB. A feature's surface function rides every build of the standard material, as the engine's own material families do. The figure was set 5% above the largest set that the water add-on's builds measured when it was set, 53.3 KB after Brotli ([D-225](D-225-addon-listing-check.md)). That set has since grown past the figure: the alpha-to-coverage, alpha-hash and masked shadow and motion builds, each carrying the add-on's surface function, take the largest set to 79.5 KB, and the Creek's move onto the add-on makes it 79.9 KB. The owner's ruling makes an add-on over the figure a warning rather than a block, so the listing check warns and the build goes on. The size gate still holds an add-on's files to these same figures, and a test keeps the two Brotli figures equal. A first-use file that a page never opens costs it nothing, so the figure costs only the devices that draw the feature.
- gzip, 320 KB. Browsers download over HTTPS with Brotli wherever the host offers it, so the Brotli limit binds. Only a host without Brotli sends gzip, and a feature's file loads only on that feature's first use.
- Uncompressed, 1,792 KB. The coat and sheen family's largest file fills it, since that family's code rides over a hundred builds ([D-215](D-215-iridescence-and-anisotropy.md)). That file, `js/shaders-area-lights-and-coat-sheen-and-displacement-and-row-values-glsl-draw-index-tone-map-half.js`, measures 1,788.5 KB at commits `4a3eceaea` and `c7f0868e6`, 99.8% of the figure, and five of its siblings are past 97%. A line in the lit shader repeats once for each build that the file holds. So a few lines that a branch counts at one to three kilobytes cost the file about 13 KB, and take it past its budget.

The owner raised the uncompressed figure for two files by 16,384 bytes, in writing: `js/shaders-area-lights-and-coat-sheen-and-displacement-and-row-values-glsl-draw-index-tone-map-half.js` and its twin with no draw index, `js/shaders-area-lights-and-coat-sheen-and-displacement-and-row-values-glsl-tone-map-half.js`. The directional lights' task (M3-K9) lets a surface take up to four directional lights. The loop that fills them repeats in every build that a file holds, so the generated GLSL of these two files passes the standard figure, while their gzip and Brotli figures stay inside theirs. The raise covers these two files alone, and every other first-use shader file keeps 1,792 KB uncompressed. `FIRST_USE_SHADER_RAW_RAISE` in `tools/lib/size-report.ts` holds the two figures.

A texture that a sketch gives a light costs no first-use shader file: the frame copies it into the light's image with the mip shader's scale pipeline, which loads with the device's shaders.


### Combination tables

The four generated combination tables list the module addresses for the builds that need several features. Each table gains one set of address lines for each pair of bits that the builds form. So its uncompressed size grows with the engine's features, while its compressed size, which a page downloads, stays small: 6.7 to 7.2 KB after Brotli at their largest. The raw figure guards the hosts that send files as they are. A table is a list of short addresses that compresses far better than code. So the owner gave the tables a raw limit of their own, 96 KB, matched by the `-combos` part of the file name, and left their compressed limits at 24 KB and 16 KB.

### Recorded exceptions

| File | After Brotli | Loads | Why it may pass its limit |
| --- | --- | --- | --- |
| Draco's glTF-only decoder: its WebAssembly module | 48,764 B | On first use, only for files that hold Draco data, in the glTF worker, once per page ([D-54](D-54-addon-modules.md)) | The owner decided that the engine reads Draco files. Draco's authors build the decoder, and no smaller build reads glTF's Draco data |
| The two fitted tables of area lights, as half floats | 19.3 KB, a gzip file that Brotli cannot shrink further ([D-145](D-145-area-lights.md)) | On first use, with the first area light. Built in M2-EX28 ([D-142](D-142-more-techniques-before-1-0.md)) | Every engine with rectangle lights uses fitted tables, and they cannot be made at load at a sensible cost ([D-53](D-53-technique-defaults.md) ruling 20). The tables are data, so they are also an exception to the rule that built-in assets are made at run time |

Draco's official script makes no code from strings, so the engine ships the release's files unchanged ([D-112](D-112-draco-decoding.md)). Draco's script (9,480 B) and the engine's Draco code (1,775 B) each stay within the limit for files that load later. So the exception covers the module alone, which the size report lists among the first-use WebAssembly modules with this record's name. A page that reads no Draco file never downloads it.

### How the figures are measured

- Sizes are bytes after Brotli at quality 11, after gzip at level 9 and uncompressed, from a production build of the engine test page. A KB is 1,024 bytes.
- A figure in this record comes from CI's `wasm-checks` job, not from a local build. A local build against a stale base can read low: one read 194,848 bytes where CI read 196,106 for the same commit's pipelined WebGL2 start (run 40127501793).
- gzip is measured at level 9. A host that compresses its files once, when it deploys them, sends them so. Hosts that compress on the fly at a lower level send more: the start's shader file is about a third larger with gzip 6.
- The budgets hold for Vite with the null3D plugin, the one supported build ([D-54](D-54-addon-modules.md#bundlers)). Without the plugin, Vite builds each engine worker as one classic script with every shader file in it. Each worker is then about 34 MB, which no budget can hold (review R8, R8-07). The plugin builds workers as ES modules and warns when another setting replaces that.

## Data

### Hosts that compress with gzip

Many hosts compress with gzip instead of Brotli: GitHub Pages and nginx's defaults among them. Review R8 (R8-02, [the library code review](../code-review.md)) measured what a pipelined WebGL2 page of a fresh project's production build downloads at its start:

| Compression | The page's shader file (GLSL) | The rest of the start | The start |
| --- | --- | --- | --- |
| Brotli 11, which the budget measures | 23.4 KB | 82.4 KB | 105.8 KB |
| Brotli 5, a common setting for compression on the fly | 27.6 KB | 87.9 KB | 115.5 KB |
| gzip 9 | 402.6 KB | 93.5 KB | 496 KB |
| gzip 6 | 495.2 KB | 94.1 KB | 589 KB |
| None | 3,368 KB | 264 KB | 3.6 MB |

Each shader file held every variant of every template as a full text. Brotli at quality 11 finds the repeats across its 4 MB window, and gzip's 32 KB window cannot. Per-feature shader files ([D-56](D-56-first-use-shader-files.md)) and one copy of each unique shader stage ([D-13](D-13-shader-variants.md)) move most of that text out of the start. At commit `2166104f7` the largest start takes 196,092 bytes after Brotli, 365,692 after gzip and 1,847,734 uncompressed ([Where the start's bytes are](#where-the-starts-bytes-are)).

The owner's decision (ruling 23 of [D-53](D-53-technique-defaults.md)): the size report has a gzip column and an uncompressed column beside Brotli, for the start and for each file that loads later. The size is fixed at its cause, not by a budget. The cure is per-feature shader files, and one copy of each unique shader stage per file, with variants as indexes into it.

### Where the start's bytes are

`bun run build` at the milestone branch's commit `2166104f7`, then the report's own `downloadSizes` over its parts. The start in pipelined WebGL2 mode, in bytes:

| Part | Brotli | gzip | Uncompressed | Holds |
| --- | ---: | ---: | ---: | --- |
| `js/sketch-worker.js` | 68,127 | 78,727 | 239,741 | the sketch runner and the scene API with every feature module that it imports |
| the WebGL2 shader device file | 53,283 | | | the shader text of a device with the draw index, tone mapping and half precision |
| `js/page.js` | 31,563 | 35,408 | 97,903 | engine creation, the device probe, the preset tables, the input capture |
| `js/render-worker.js` | 18,614 | 22,907 | 110,536 | the frame loop, the recovery and the first-use shader tables |
| `js/render-worker-webgl2.js` | 14,379 | 16,242 | 53,198 | the WebGL2 renderer |
| `js/render-worker-gpu-shared.js` | 3,902 | 4,308 | 10,802 | the code both GPU paths use |
| `js/job-worker.js` | 1,717 | 1,871 | 4,262 | the core loader in a job worker |
| `js/probe-worker.js` | 1,458 | 1,654 | 3,512 | the probe of the drawing path |
| seven small shared modules | 2,726 | | | the control block, the error type, the GPU and core constants, the half-float helpers and the message helper |
| Total | 196,092 | 365,692 | 1,847,734 | |

The rest of the modes, in bytes after Brotli: drawing on the main thread WebGL2 193,016, low latency WebGL2 192,408, sketch on the main thread WebGL2 185,480, pipelined WebGPU 180,795, single-threaded WebGL2 180,687, drawing on the main thread WebGPU 177,804, low latency WebGPU 176,994, sketch on the main thread WebGPU 170,183, single-threaded WebGPU 165,475. [The governor out of the page's start](#the-governor-out-of-the-pages-start) takes about 2.9 KB off each threaded start.

The shader file is not the lever. Removing whole templates from it, and whole permutation builds of the standard material, barely changes its compressed size. Dropping 193,000 characters of build text saves 1,096 bytes, because the builds are near copies of each other and Brotli already holds them once. The device modules are a floor of about 33 KB on WebGPU and 51 KB on WebGL2 until the shader library itself shrinks.

The code is the lever, and its cost is spread across many modules. The scene API's own modules are about 24 KB of the sketch worker. Its feature modules are about 37 KB, and each one is a few kilobytes: the post settings, the assets loader, the texture and mesh array creators, the queries, the picks, the cameras, the background, the fog, the reflection probes, the probe grid, the object events and the labels.

A feature module can load on its first use only where its calls can answer later. The loader of files answers with promises already, so its module moves out of the start with no API change. A setter that validates its arguments and throws an error code for a bad one cannot: the error must reach the caller at the call. So the module that holds its checks and its message text stays. That is why the sprites, lines, particles, area lights, light images, glTF, KTX2 and panorama code can load later, and the setters cannot. A trim that pays has to take a whole feature out of the engine's start, with its shaders, or the shader file has to shrink.

A deferral is not free. The bundler puts a deferred module's dependencies in files of their own, and keeps second copies of shared modules that the start still needs. A module that several files share moves into a file of its own when one of them loads on demand, and each start imports that file. A small file compresses far worse alone than the same code inside a large chunk. The size report names one built file for each part, and follows a loader's chain of dependencies, so each such file and each copy needs a part of its own. The engine's error type (`js/engine-error.js`, 771 bytes after Brotli) is one: the page's start, its loader and its checks all import it.

### What a download costs in time

The startup benchmark's Slow 4G profile downloads 157,500 bytes per second, so each kilobyte of start download adds about 6.5 ms to a cold start. A page's JavaScript shares the link with the core's WebAssembly. A file of 16 KB that loads on first use takes about 0.1 s on the same link. Its round trip of at least 562 ms comes on top. Where the loader starts both downloads at once, as the glTF loader does, that round trip overlaps the download of the feature's own data.

### One GPU path's renderers for each page

Each GPU path's renderers sit in a module of their own: `render/webgpu-renderers.ts` and `render/webgl2-renderers.ts`. `createRenderer` imports the one of its path. The rest of the drawing code stays in the render worker's file: the frame loops, the GPU loss recovery, the shader loaders and the renderer interface. With both paths in one file, a WebGPU page downloads about 9 KB of WebGL2 code that it never runs, and a WebGL2 page about 9 KB of WebGPU code.

Right after the probe, the page tells the thread that draws its GPU path. The message (`load-shaders`) starts the download of the device's shader file and of the path's renderers (`preloadDeviceFiles`). So they download beside the shader file while the core downloads.

The bundler puts the code that both paths' renderers use into a third file, which each path's file imports. It holds the frame replay, the completion trackers, the readback, the GPU memory count, joined effects and the vertex format helpers. On the page, Vite loads a file's imports together with the file. In a worker it does not, so a worker would ask for the third file only once its path's file had arrived, one round trip later. That round trip falls while the core downloads, where each round trip that the start waits for costs at least 562 ms on Slow 4G ([Start order](../implementation-notes.md#start-order)). So the null3D Vite plugin does in each worker build what Vite does on the page (`worker-preload.ts`). An import on demand also starts the downloads of the files that its file imports and the worker lacks.

The WebGPU pipelines and the WebGL2 programs read the development constant themselves, as the KTX2 loader does. Their development builds add the debug views' templates. With a shared constant, the bundler keeps the debug views' shaders in the start file of a production build, because the check that drops them folds only inside the file that holds it. That costs about 13 KB after Brotli in the render worker's file.

`bun run build:check-size`, both paths in one file against one path per page, with depth of field. KB after Brotli at quality 11, and after gzip at level 9:

| Thread mode and GPU path | One file, Brotli | Per path, Brotli | Saved | One file, gzip | Per path, gzip |
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

The rows of one file count the largest shader file of either path, a WebGPU file. The rows per path count each path's own largest shader file. In three files, a path's code takes about 1 KB more than in one file, because each file compresses alone.

The start makes two more requests: the path's renderers and the shared file. It is not slower. `bun run bench:startup --modes all` made three cold loads of each mode on Slow 4G, in Chrome 155 on a MacBook Pro at a load below 8. The medians of the first frame done, in ms:

| Thread mode | WebGPU, one file | WebGPU, per path | WebGL2, one file | WebGL2, per path |
| --- | --- | --- | --- | --- |
| pipelined | 4,834 | 4,797 | 4,833 | 4,781 |
| low latency | 4,790 | 4,760 | 4,802 | 4,751 |
| single-threaded | 4,731 | 4,693 | 4,719 | 4,682 |
| drawing on the main thread | 5,080 | 5,052 | 5,066 | 5,019 |
| sketch on the main thread | 4,783 | 4,749 | 4,784 | 4,723 |

Every mode on both paths drew its first frame 28 to 61 ms sooner, with 8.3 to 9.4 KB less to download after compression.

The renderers draw the same commands with the same shaders. `bun run bench:gpu-check` found no page slower than its rule allows. At Medium, S4's GPU time was 3.91 ms both ways, and S6's 4.84 ms per path against 4.95 ms. At High the runs spread by 9 to 19%, and the check judged both scenes the same. The lowest S4 run was 2.76 ms with one file and 2.77 ms per path.

### Frame figures and error fixes on first use

Two blocks of code stay out of the start. Every page would download them, but few pages read them:

- The frame figures behind `engine.measure` load at the first measurement, in a file of their own. `threadRoles`, the one piece of that module that the start reads, sits in `shared/metrics.ts`, which every page loads.
- The table of error fixes loads in each thread at its first error. Until it arrives the error carries its code and detail. The fix then completes the message, so the error reports the whole message once the file arrives. A failed start waits for the file before it rejects, so its error reports the whole message at once.

Each thread loads the table where it raises its first error. The sketch worker's first synchronous errors reach the sketch before the text arrives, so their messages gain the fix shortly after. The sketch worker loads the text once, and later errors carry it at once.

The split puts three small modules that many files share into files of their own, which every page loads: the message helper, the GPU constants and the control block. Together they take 913 bytes after Brotli and three requests. The page asks for all three while it loads, so they do not add a round trip in turn.

The split takes the pipelined WebGL2 start from 171,526 bytes to 165,632 bytes after Brotli. The new files measure 1,755 bytes for the frame figures and 5,453 bytes for the fixes after Brotli, and the sketch worker's copy of the fixes 5,454 bytes. Both figures count the probe worker's direct-path file.

The frame figures and the error-fix table serve measurements and error text, not drawing, so no page loses anything that it uses to draw.

### The file loader on first use

The loader of files loads on first use. With it, every start that the loader leaves falls by 3,341 to 5,714 bytes after Brotli:

| Start | The loader in the start | The loader on first use |
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

That build also held an experiment that moved the sky's write out of the start, which measured about 860 bytes and is not part of the change. Without it, the figure for each start that loads the sketch worker rises by about that much.

The worker's start grows by 2,731 bytes after Brotli, which is the cost of the deferral. A page that reads no file still downloads the worker's start, so the cost stands. The loader's files load later: `js/page-assets.js` takes 3,865 bytes and `js/sketch-worker-assets.js` 3,717. The loader's file names two shared modules, the core tables and the quality check. Each one needs a copy of its own there, because the start keeps its own, and each copy holds a part in the report's list.

### The governor out of the page's start

The page's own file held the frame-budget governor, `quality/governor.ts`, at 8,792 of its 97,903 uncompressed bytes: a tenth of the file. The page never runs it. A page keeps the quality preset's values and hands the settings to the threads, and the governor runs in the thread that runs the sketch. The module came in through one number: `scene/features.ts` read `BUDGET_STEPS`, the budgets' step count, to work out a feature's scale from its quality setting. The bundler keeps the whole module, because the governor computes constants from the preset table as it loads, which the bundler cannot prove has no side effects.

So the render scale and the budgets' scale sit in `quality/budget.ts`: `FULL_SCALE`, `SCALE_STEP`, `BUDGET_STEP`, `BUDGET_STEPS`, `thousandths`, `budgetSteps` and `budgetScale`. Each is a number or a function of numbers, and the module computes nothing else as it loads. `scene/features.ts`, `sketch/quality.ts` and `sketch/runner.ts` read them from there. The governor and its loop stay in the thread that runs the sketch. The rule: a module that one file reads for one number stays out of every file that reads none of it. The split changes no behavior and no public API.

The same build without and with the split, in bytes after Brotli:

| Start | Without the split | With it | Change |
| --- | ---: | ---: | ---: |
| pipelined, WebGL2 | 196,092 | 193,201 | -2,891 |
| drawing on the main thread, WebGL2 | 193,016 | 190,142 | -2,874 |
| low latency, WebGL2 | 192,408 | 189,463 | -2,945 |
| pipelined, WebGPU | 180,795 | 177,904 | -2,891 |
| drawing on the main thread, WebGPU | 177,804 | 174,935 | -2,869 |
| low latency, WebGPU | 176,994 | 174,072 | -2,922 |
| sketch on the main thread, WebGL2 | 185,480 | 185,194 | -286 |
| single-threaded, WebGL2 | 180,687 | 180,418 | -269 |
| sketch on the main thread, WebGPU | 170,183 | 169,897 | -286 |
| single-threaded, WebGPU | 165,475 | 165,211 | -264 |

The parts of the largest start that moved: `js/page.js` falls from 31,563 to 28,925 bytes, `js/sketch-worker.js` from 68,127 to 68,062, and `js/page-check.js` (188 bytes) joins `page.js`.

The modes that run the sketch on the page change little. Their sketch runner sits in `js/page-sketch-runner.js` rather than in the worker, and the engine gives the governor and its settings to the thread that draws in that mode too, so the page still loads the module.

### Trims still owed

Each of these trims returns start bytes to every page that does not use the feature:

- The cluster levels' culling pass. Its compute shader takes 9,738 bytes of WGSL, 2,736 after Brotli, in every page's start, although only the WebGPU path builds its pipeline. In pipelined WebGL2 mode it adds 650 bytes, where it compresses beside the shader text already there. The trim builds the pass with the builds that load on a feature's first use, as a material's shader does. A page that never draws a cluster tree then downloads none of it, and WebGL2 keeps its start. [D-213](D-213-cluster-levels.md) holds the drawing method and its numbers.
- The compute pass's option checks and the instance draw's adapter. They put their Rust and their adapter code into every start. The trim loads both with their first use, so a page that adds neither downloads neither.
- `scene/light-probes.ts` in the page's start: 1,638 bytes uncompressed, about 780 after Brotli. The page's own code reaches none of it. Two chunks that a page may load later both read it, so the bundler keeps it in the start for them. Its pieces cannot simply move, because the constants that both halves read would then sit in the start instead, so the split needs three modules for under a kilobyte.
- One copy of the shared helpers for the page and every worker. `shared/images.ts` sits in three start files at 4,465, 4,603 and about 3,700 uncompressed bytes, and `shared/metrics.ts` in the same three at 5,828, 3,710 and about 2,400. That is about 25 KB uncompressed. The trim ships the engine's workers prebuilt beside shared files, so each worker takes the shared file from the browser's cache, as the page loaded it first. It is a change to how the package builds, not a change to the engine's code.

## Rejected options

- The fog write, the picks and the objects' pointer events on first use. The moves themselves take about 1.1 KB out of each threaded start. But the error class then becomes a file of its own in each start (789 and 603 bytes), and a 1.6 KB file compresses far worse alone than inside a 90 KB chunk. With the churn in the page's and the worker's starts, the move costs each start more than it saves:

  | Start | Without the move | With the move | Difference |
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

- The pointers' dispatcher on first use. `queries.ts` reads its hit-field constants, which keeps the whole module in the start. A module of its own for those constants, `scene/pointer-fields.ts`, makes the split possible. It would save between nothing and about 700 bytes on the threaded starts, since a split module compresses worse than the same code in a chunk.
- A smaller shader device file. It is 28% of the start, and Brotli already holds its near copies once ([Where the start's bytes are](#where-the-starts-bytes-are)).
- The combination key tables out of the render worker: 29,374 bytes uncompressed, about 2.3 KB alone after Brotli. One reader takes them as the renderer starts, so moving them adds a download to the path that builds its first pipelines. Splitting them needs a change to the shader build and a rebuild of every shader module.
- The combination tables split into more files, to keep them under 64 KB uncompressed. That needs a change to the shader build and to the loader, which the owner judged not worth it.
- The hold-mode script performer and the page's replay code on first use, about 1.5 KB uncompressed each. Both run only in a test page. A part that leaves a start pays for its own file, and at this size it pays about what it saves.
- First-use modules split further, by shader template. It only moves bytes between files: a page still downloads the same builds, in more requests. It also needs a new loader key, since the tables are keyed by feature set, and it does nothing for the start.
- Builds that a page draws with moved out of the start's shader module into a first-use file. That delays the first drawn frame for ordinary materials, which [D-56](D-56-first-use-shader-files.md) forbids: no frame draws a feature half done.
- A first-use module of its own for the screen-space reflections' lit code. It would add about 900 GLSL programs and a rebalance of the Safari shard guard, for half a kilobyte.
- The error fix text in development builds only. A release build's message would then say where to read the fix, not the fix itself, which bends design principle 10. The table loads at the first error instead.
- An entry file of the render worker for each GPU path. The page starts its workers before it probes the GPU, so their scripts and the core's loader download while the core does. A worker for one path could start only after the probe, about a round trip later.
- Steering the bundler to keep the renderers' shared code in the start file. A bare import keeps a module only when the bundler finds side effects in it, which held for one of the eight modules. Re-exports through one module change nothing, since the bundler follows them to each name's own module. A module of re-exports that loads beside the path's file split the page's start file into four.

## Consequences

- `tools/lib/size-report.ts` holds the budgets: `START_BUDGET`, `LATER_BUDGET`, `COMBOS_BUDGET` and `FIRST_USE_SHADER_BUDGET`. It measures each file in three columns (`COLUMNS`, `measure`), and each budget is a `Budget` with a size for each column. `budgetProblems` gives one problem for each column over its budget. `budgetWarnings` reads the same starts and files, and warns for each column of each one past `NEAR_BUDGET_SHARE` of its budget without passing it. The size report prints every column with its share of the budget.
- `DOWNLOADS` in `tools/lib/size-report.ts` holds each thread mode on each GPU path, and `drawingParts` names the files that each thread that draws loads on demand. A path's start counts its own renderers, the shared file and its own largest shader file. Every start counts the probe worker's `draw-path-probe.ts` (1,134 bytes after Brotli), since every device with WebGPU probes that path whichever path the page draws with.
- A feature that a page does not use loads its code in a part that `ENGINE_PARTS` names with the part that loads it. `LATER_PARTS` names the parts that load later, and the report prints them in a section of their own. The engine test "a page that uses no feature that loads on first use downloads none of their files" checks every such part. It runs in every thread mode on both GPU paths, on the dev server and in a production build. It also checks that a page downloads its own GPU path's renderers and not the other path's.
- A file that loads on demand must not keep code of the start's files alive through a development check. It reads the development constant itself.
- The offline file list (`null3d-files.json`, D-102) puts both paths' renderers and the shared file in `start`. So a cached game also starts offline on the path that its first visit did not draw with. A unit test of `offline.ts` checks the list, and `bun run test:packages` starts the fresh project offline on both paths. A page that switches paths, such as a benchmark page, runs each path in a load of its own. It downloads each path's renderers the first time it draws with that path.
- `ADDON_SHADER_BUDGET` in the add-on check equals `FIRST_USE_SHADER_BUDGET.brotli`, and a test keeps the two equal.
- A pull request that moves code to first use states how the code loads, and the round trip that its first use costs.
- AGENTS.md, the README and [Benchmarks](../benchmarks.md#download-size) give the budgets in all three columns. The hosting guide tells developers to serve the engine's files with Brotli, and gives the gzip and uncompressed sizes of the start.
