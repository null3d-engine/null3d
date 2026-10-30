# D-225: The add-on listing check

Status: decided and built, with the allocation gate of M3-D9a. By the owner's ruling, a size over budget warns. Owed: lowering the heavy check's memory ceiling from 14,336 MiB to 1,536 MiB, since the page gates pass with the linked build. Task: M3-D9, M3-D9a. This record gives the command that [D-173](D-173-addon-hooks.md) ruling 10 asks for.

Summary: `bunx @null3d/cli check-addon [folder]` runs the engine's gates on one add-on package and prints one line per gate. Its gates check the package, the imports, the interface range, the WGSL build for both GPU paths, the sizes, and the page's start, cost and allocation. The page comes from the project's `null3d.json` or `--page`, and a size over budget warns, while every other gate fails the run when it fails.

## Question

An add-on from another developer goes into a listing. What does the listing run on it, where does that run find the add-on's page, and what does it print?

## Rule

- The listing runs the engine's own gates, not a second set ([D-173](D-173-addon-hooks.md) ruling 10). Those gates are the public-API check, WGSL on both paths, the CDN and strict-policy test, the allocation check, the size budgets, and a cost per preset.
- A gate that opens a browser draws as the engine's other browser gates do. A machine without a page or a GPU runs the Node-only gates.
- Every result says how to fix a failure (design principle 10), in the same PASS/FAIL/SKIP form that `bunx @null3d/cli test` prints.
- No new field freezes for the add-on. The page is the one the project config already names.

## Data

- `tools/lib/addon-imports.ts` holds the public-API rule and its scan. `tools/check-addon-imports.ts` runs it over the repository. The command carries the same rule over one folder.
- [D-223](D-223-plugin-interface-version.md) gives `PLUGIN_INTERFACE_VERSION`, `checkPluginInterface` and E1433. An outside add-on declares its range with that call; an engine add-on pins the engine version with `checkAddonVersion` ([D-207](D-207-addon-version-checks.md)).
- The null3D Vite plugin compiles a project's WGSL for WebGPU and for WebGL2 in the same build, and packs the result into the add-on's files. A build of the add-on's entry therefore answers the shader gate and gives the files that the size gate measures.
- The `test` command reads `null3d.json`, which names a page for an image test. The `bench` and `shot` commands open a page from the project's root. The check takes the same page and the same runner.
- The size budget for a file that loads after the start is [D-14](D-14-js-budget.md)'s (`tools/lib/size-report.ts`, `LATER_BUDGET`). The command carries the same figures for the add-on's own files, and a test keeps them equal.
- A file of compiled shader builds is shader data, and D-14 gives such a file its own budget (`FIRST_USE_SHADER_BUDGET`). The plugin writes the builds of a custom material, a custom effect and a custom tone curve to files of their own. A page loads them on first use, so the command holds them to that budget. A test keeps its figures equal to the size report's too.
- The engine's allocation check drives Chrome's debug protocol and attaches to the sketch and render workers. It samples their heaps for many seconds and profiles each sample by function.

## Decision

**The command.** `bunx @null3d/cli check-addon [folder]`, in `packages/cli/src/check-addon.js`, with `--page <path>`, `--skip-browser` and `--skip-cost`. It prints one line per gate and exits with 1 when a gate fails, as the `test` command does.

**The gates.**

| Gate | What it does | Without the thing it needs |
| --- | --- | --- |
| package | reads the manifest's name and its entry: `exports`, `module`, `main` or `src/index.ts` | FAIL |
| public API | scans the shipped source for imports of any engine entry point other than `@null3d/engine` and `@null3d/engine/stats`, and of the engine's source | FAIL |
| interface | reads the entry's `checkPluginInterface(name, { min, max })`, or the `pluginInterface` field of its `declareAddonNamespace({ ... })` registration, and holds the range to the engine's interface version; a `@null3d/...` package must call `checkAddonVersion(name, VERSION)` instead | SKIP when no engine sits beside the add-on |
| shaders | builds the entry with the add-on's own Vite and null3D plugin, which compiles every WGSL import for both GPU paths | SKIP when either is not installed |
| sizes | holds each built file's code to the code budget, and its shader data, inlined or in a set file, to the first-use shader budget; a file over a budget prints WARN | SKIP with the build |
| page | starts the page from another origin under the strict policy, once threaded and once single-threaded | SKIP without a page, or with `--skip-browser` |
| cost | measures the production build of the page on each quality preset, and prints the GPU time per frame, or the CPU time where the device times no GPU work | SKIP without a page, or with `--skip-cost` |
| allocation | samples the sketch and render workers' heaps on each preset, and prints the bytes per frame in the add-on's own code beside the page's own figure | SKIP without a page |

**The page.** The first test's `page` in the project's `null3d.json`, or `--page`. An add-on without a page still passes the Node-only gates. This keeps every field as it is: the config already names pages for image tests.

**The cost is measured, not asserted.** The gate prints the figure for each preset. It fails only when the page does not measure, never because a seller's published number differs.

**The cost gate on a loaded machine.** The page and allocation gates measure what the page draws and allocates. A loaded machine does not change those figures. The cost gate measures time, so a figure taken beside a saturated machine reports the load instead of the add-on. `--skip-cost` leaves out the cost gate alone and prints why. The page and allocation gates still run, and the cost gate stays owed until a quiet window. The option is not for CI, which measures on a machine of its own. It is for an author checking a package while other work runs beside it.

## Consequences

- The command is in the command table, the [`null3d` page](../../docs/cli/null3d.md) and the package README. [Building an add-on](../../docs/guides/add-ons.md) is the add-on author's guide, and it links the command.
- The unit tests cover the refusal of an add-on that imports `@null3d/engine/internal`, the clean case, every interface mismatch in both declaration forms, the page lookup and the size-budget equality.
- [D-224](D-224-addon-namespaces.md) (M3-D8) gives an add-on one registration call, `declareAddonNamespace`, and its record carries an optional `pluginInterface` range. The namespace's claim runs `checkPluginInterface`, so the static gate reads either form and the two checks cannot disagree. The namespace's name is the add-on's own short name, so only the standalone call's name must equal the package name.
- The page gates need a browser and a GPU, so their tests run after the machine's gate window and with the engine's browser rules.

## The size gates

**A size over budget warns.** The owner's ruling is "Just warn" when an add-on goes over a size budget. Its reason is "Add-ons are a choice so it's ok if they cause things to go over budget." The ruling covers the three size budgets alone: the code budget, the later-file budget and the shader-data budget. A file over one of them prints as WARN. It names each column over its figure, and the command exits 0. The page, cost and allocation gates keep failing as they do. The engine's own size report prints the same kind of line and exits 1, so every job that builds fails. The engine's own files are not a choice. AGENTS.md holds that rule with the engine's figures.

One function decides the verdict and the status, `sizeOutcome` in `packages/cli/src/check-addon.js`. It returns PASS when every file holds to its budget and WARN when one does not. The print site prints what it returns. Only a FAIL result fails the run, so the printed status and the exit status cannot disagree. WARN is a result status that `test.js` counts beside passed, failed and skipped. A test runs the command on an add-on whose build is over the code budget. It requires the WARN line and an exit status of 0, so a gate that failed the run would fail that test.

**Why the gate splits a file.** Most of an add-on's entry can be shader data, not code. The plugin inlines compiled WGSL in the module that imports it. That is a whole shader's builds with the tables of text that they share, and an effect's pieces. The inlined shader data is 86,592 of the wind entry's 91,607 bytes, or 94.5%. For water it is 97,323 of 111,802, or 87.0%. A gate that charged every built file to one budget by its name would charge those bytes to the 64 KB code budget. The split moves no byte that a page downloads, only the accounting for those bytes.

**The measurement.** `buildAddon` builds the entry twice. The first build is the shaders gate's own. The second answers each `.wgsl` import with an empty module. It holds the add-on's own code alone and compiles no shader. The difference between the two, in each column, is the shader data that the plugin inlined in the file. Each part answers its own budget, and the two parts add up to the file's size in every column. A file that the second build did not write keeps its whole size against the budget that its name gives. Such a file is a set of builds that the plugin writes apart.

**A foundation that builds on another.** The build keeps every null3D package external, as it keeps the engine. A foundation add-on may build on another foundation. A page loads that package as a dependency of its own, so the sizes measure the add-on's own files alone. Vegetation builds on impostors for its far trees. The build stopped resolving that package while only the engine stayed external. `ADDON_EXTERNALS` holds the pattern in `packages/cli/src/check-addon.js`. A test holds it to every null3D package and to no other package.

**The two budgets.** A file of code answers `ADDON_FILE_BUDGET`: 64 KB uncompressed, 24 KB after gzip and 18 KB after Brotli. Those are the engine's figures for a file that loads after the start, `LATER_BUDGET`, which [D-14](D-14-js-budget.md) records. The shader data answers `ADDON_SHADER_BUDGET`: 1,792 KB uncompressed, 320 KB after gzip and 56 KB after Brotli. Those are the engine's `FIRST_USE_SHADER_BUDGET` for a first-use shader file, and a test keeps the two equal. The shader figures are far looser than the code budget's, because shader text shrinks more under compression than code does. The Brotli figure holds the water add-on, whose surface function rides every build of the standard material: its largest set measured 53.3 KB after Brotli when the budget was set. The uncompressed figure holds the coat and sheen builds. [D-14](D-14-js-budget.md) holds the figures. Only the owner changes a figure, in writing.

**Raw or compressed.** The gate judges three columns, and a file must hold to each. The figures above are uncompressed, except where a column is named. What a page downloads is the compressed file. The wind entry is 14,832 bytes after gzip (14.5 KB) and 8,890 after Brotli (8.7 KB). Water's is 15,916 (15.5 KB) and 11,042 (10.8 KB). Split by part, wind's code is 2,069 after gzip and 1,861 after Brotli, and its shader data 12,763 and 7,029. For water the code is 5,307 and 4,670, and the shader data 10,609 and 6,372. So the shader data is 86.0% of wind's gzip figure and 79.1% of its Brotli figure. The compressed columns pass with or without the split.

**What the parts hold.** The shader part holds the plugin's own glue as well as the text: the function that rebuilds a pack and the call that holds it. In wind's entry, 1,786 bytes of the part is glue and the small packs, not shader text. WGSL that a module holds as a tagged literal is not split, so those bytes stay in the code part. That is stricter than the gate claims, and not a way past it.

**The figures.** A warm shader cache at `f04f4f188`, with wind's figures repeated in two runs, from `bun packages/cli/bin/null3d.js check-addon <package> --skip-browser`.

| Add-on | File | Raw | Code | Shader data | Share of raw |
| --- | --- | --- | --- | --- | --- |
| wind | `addon.js` | 91,607 | 5,015 | 86,592 | 94.5% |
| water | `addon.js` | 111,802 | 14,479 | 97,323 | 87.0% |

Both add-ons pass with no budget raised. The water add-on's largest set of builds is 54.4 KB after Brotli at commit `f04f4f188`, against its 56 KB budget.

**What guards it.** A test builds a fixture add-on whose entry imports a `.wgsl` file, and requires a shader part in that entry's size. It fails when the second build goes, or when the build stops splitting. A test of `splitShaderData` holds the parts to the file's size. A test of `sizeProblems` fails a file whose inlined shader data is over the shader budget. A gate that stopped counting those bytes therefore cannot pass it. A test of `emptyShaders` holds the stand-in build to `.wgsl` files alone.

### Set files of compiled builds

A custom material's compiled builds are shader data, so the gate holds them to the first-use shader budget, not to the code budget. In the recorded run below, impostors, splats and terrain each carry 36 files named `material-glsl-*` and `material-wgsl-*`, from 175 KB to 907 KB raw. The largest is 907.5 KB raw and 45.0 KB after Brotli, and every one passes the shader budget. Under the code budget each of them would fail.

A custom effect's and a custom tone curve's builds load on first use too, in a set for each GPU path, as a custom material's do. This is the shape that [D-56](D-56-first-use-shader-files.md) gives the engine's own shaders: shader text belongs in a file that loads on the feature's first use, under the shader budget, not inside the add-on's entry. The plugin keeps none of their builds in the module. It writes each set to a file of its own, named `effect-<path>-0-<hash>.js` or `curve-<path>-0-<hash>.js`. The engine imports a shader's set when the sketch first uses it, and waits for it as it waits for a custom material's. A caller that imports only the tone curves downloads only their code. It then downloads the curve's builds for its GPU path when it first sets one. A caller that never imports the add-on downloads nothing. The outline's builds load when `createOutlinePass` first uses them.

The gate's list of compiled-shader-build files names the effect and tone-curve sets that the plugin writes, beside the material sets, because all three are the same kind of file: shader data that a page loads on first use.

`@null3d/three-compat` shows why. With its builds in the entry, `addon.js` is 181.9 KB raw and 24.8 KB after gzip, over the code budget's 64 KB and 24 KB. The five `.wgsl` files of the entry make 184.5 KB through the plugin's own packing: the two tone curves 125.6 KB (69%), and the three outline effects 59.0 KB (32%). The add-on's own code is the remaining few KB. With its sets on first use, the add-on passes every size gate. Its 12 files include:

| File | Raw | Gzip | Brotli |
| --- | --- | --- | --- |
| `addon.js` | 27.8 KB | 4.3 KB | 3.7 KB |
| largest curve set | 31.5 KB | 5.7 KB | 4.9 KB |
| largest effect set | 9.2 KB | 2.7 KB | 2.4 KB |

The checks that hold a set file to the shader budget and the plugin's virtual-module names cover the effect and tone-curve kinds. [E1424](../../docs/errors/E1424.md) names all three kinds of build file.

### The pieces of an effect that draws alone

A custom effect that reads the scene's depth cannot join the effect before it, so it draws a pass of its own with its builds. Its pieces, the top-level items that a joined effect adds to a host, are data that no host reads. A module's value keeps no pieces for an effect whose `joins` is false, as it keeps none of its builds. Joined effects and tone curves keep their pieces, which their hosts read. Kept, the pieces of the water add-on's effect that draws alone make 93 KB of a 111 KB entry. A test in `material-builds.test.ts` covers both cases.

## Recorded run of the foundation add-ons

The command ran over every foundation add-on that holds a package: the twelve of [D-173](D-173-addon-hooks.md) ruling 4 and vegetation ([D-241](D-241-vegetation-foundation.md)), less physics and MSDF text, which hold no package. The worktree was fresh, after `bun install` and the pages-only build, and every run went through the job queue. Each run exited 0, and the whole job took 647 seconds with a memory peak of 2.6 GB. The run belongs to commit `dc1e9d557`, and this table is its only record.

| Add-on | package | public API | interface | shaders | sizes | page | cost | allocation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `@null3d/controls` | PASS | PASS | PASS | PASS | PASS | SKIP | SKIP | SKIP |
| `@null3d/geometry` | PASS | PASS | PASS | PASS | PASS | SKIP | SKIP | SKIP |
| `@null3d/impostors` | PASS | PASS | PASS | PASS | PASS | SKIP | SKIP | SKIP |
| `@null3d/particles` | PASS | PASS | PASS | PASS | PASS | SKIP | SKIP | SKIP |
| `@null3d/splats` | PASS | PASS | PASS | PASS | PASS | SKIP | SKIP | SKIP |
| `@null3d/terrain` | PASS | PASS | PASS | PASS | PASS | SKIP | SKIP | SKIP |
| `@null3d/three-compat` | PASS | PASS | PASS | PASS | PASS | SKIP | SKIP | SKIP |
| `@null3d/vegetation` | PASS | PASS | PASS | PASS | PASS | SKIP | SKIP | SKIP |
| `@null3d/water` | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| `@null3d/wind` | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS |

The eight packages without a `null3d.json` skipped the page, cost and allocation gates with the command's own reason: a foundation add-on's page is a demo in `examples/`. Water and wind carry a page of their own, so all three gates ran on them: the page started from another origin under the strict policy, and the cost and allocation gates measured each preset.

Vegetation's row in that table predates its import of the impostors foundation. A run on `feat/m3-v4-budgets` passes the package, public API, interface and shaders gates. The page, cost and allocation gates skip because the package has no `null3d.json`. Its sizes gate warns on sixteen material files. The largest, `material-glsl-0-2cd74cc659e5601c-CBpzT5X0.js`, is 64.6 KB after Brotli against the 56 KB budget.

The shader and size gates ran on every add-on, which the run's own lines show:

```text
controls
PASS  shaders: 2 files built with WGSL for WebGPU and WebGL2
PASS  sizes: the largest file is 48.2 KB raw, 12.6 KB gzip, 11.0 KB brotli, within budget

geometry
PASS  shaders: 2 files built with WGSL for WebGPU and WebGL2
PASS  sizes: the largest file is 41.0 KB raw, 12.0 KB gzip, 10.5 KB brotli, within budget

impostors
PASS  shaders: 14 files built with WGSL for WebGPU and WebGL2
PASS  sizes: 14 files within budget, the largest code file at 26.8 KB raw, 7.6 KB gzip, 6.0 KB brotli, the largest shader build at 830.1 KB raw, 152.1 KB gzip, 42.3 KB brotli, 2.2 KB of shader data inlined in 1 code file, within the shader budget

particles
PASS  shaders: 2 files built with WGSL for WebGPU and WebGL2
PASS  sizes: the largest file is 26.8 KB raw, 7.6 KB gzip, 6.1 KB brotli, within budget

splats
PASS  shaders: 22 files built with WGSL for WebGPU and WebGL2
PASS  sizes: 22 files within budget, the largest code file at 31.6 KB raw, 10.6 KB gzip, 9.3 KB brotli, the largest shader build at 914.0 KB raw, 167.8 KB gzip, 45.2 KB brotli, 3.8 KB of shader data inlined in 1 code file, within the shader budget

terrain
PASS  shaders: 14 files built with WGSL for WebGPU and WebGL2
PASS  sizes: 14 files within budget, the largest code file at 26.8 KB raw, 7.6 KB gzip, 6.0 KB brotli, the largest shader build at 725.3 KB raw, 136.7 KB gzip, 35.9 KB brotli, 2.5 KB of shader data inlined in 1 code file, within the shader budget

three-compat
PASS  shaders: 12 files built with WGSL for WebGPU and WebGL2
PASS  sizes: 12 files within budget, the largest code file at 26.8 KB raw, 7.6 KB gzip, 6.0 KB brotli, the largest shader build at 32.4 KB raw, 5.8 KB gzip, 5.0 KB brotli, 23.9 KB of shader data inlined in 1 code file, within the shader budget

vegetation
PASS  shaders: 16 files built with WGSL for WebGPU and WebGL2
PASS  sizes: 16 files within budget, the largest code file at 52.6 KB raw, 14.7 KB gzip, 12.6 KB brotli, the largest shader build at 729.5 KB raw, 138.4 KB gzip, 36.2 KB brotli, 2.5 KB of shader data inlined in 1 code file, within the shader budget

water
PASS  shaders: 16 files built with WGSL for WebGPU and WebGL2
PASS  sizes: 16 files within budget, the largest code file at 26.8 KB raw, 7.6 KB gzip, 6.0 KB brotli, the largest shader build at 1216.1 KB raw, 234.9 KB gzip, 53.6 KB brotli, 95.1 KB of shader data inlined in 1 code file, within the shader budget

wind
PASS  shaders: 4 files built with WGSL for WebGPU and WebGL2
PASS  sizes: 4 files within budget, the largest code file at 26.8 KB raw, 7.6 KB gzip, 6.0 KB brotli, the largest shader build at 20.7 KB raw, 5.0 KB gzip, 3.9 KB brotli, 84.6 KB of shader data inlined in 1 code file, within the shader budget
```

Water's largest shader build is the closest to a budget: 53.6 KB after Brotli against 56 KB. No add-on needed a raised budget.

Water's and wind's browser gates printed these lines:

```text
water
PASS  page: the page starts from another origin under the strict policy, threaded and single-threaded
PASS  cost per preset: low 2.88 ms of GPU time, medium 4.73 ms of GPU time, high 3.45 ms of GPU time, ultra 2.63 ms of GPU time per frame, on Chrome 156.0.8078.48
PASS  allocation per preset: low 0 bytes, medium 0 bytes, high 0 bytes, ultra 0 bytes per frame in the add-on's own code, on Chrome 156.0.8078.48

wind
PASS  page: the page starts from another origin under the strict policy, threaded and single-threaded
PASS  cost per preset: low 0.45 ms of GPU time, medium 0.70 ms of GPU time, high 1.04 ms of GPU time, ultra 2.12 ms of GPU time per frame, on Chrome 156.0.8078.48
PASS  allocation per preset: low 210 bytes, medium 208 bytes, high 203 bytes, ultra 196 bytes per frame in the add-on's own code, on Chrome 156.0.8078.48
```

Wind's allocation gate names the places in the add-on's own code: `write src/wind.ts` allocated 148 bytes per frame on Low, falling to 136 on Ultra, and `now` and `turn` in the same file allocated about a byte or none. Water's measured no allocation in its own code.

`tests/fixtures/d9-addon` gave the page and cost gates their run. All seven gates passed on it:

```text
PASS  page: the page starts from another origin under the strict policy, threaded and single-threaded
PASS  cost per preset: low 0.31 ms of GPU time, medium 0.25 ms of GPU time, high 0.25 ms of GPU time, ultra 0.25 ms of GPU time per frame, on Chrome 155.0.8059.85
```

The engine rests a still view: once its frames converge, it stops submitting draws. A cost run of a still page then fails with "the engine on webgpu drew no frame while it was measured". The fixture's sketch turns its box, as the project fixtures' sketches animate, so the page measures every preset.

`tests/fixtures/d9-addon-internal` gave the refusal its run: a package whose entry imports `@null3d/engine/internal`. The command exited 1.

```text
FAIL  public API: 1 import reaches past the engine's public entry points
      src/index.ts imports @null3d/engine/internal, which is not a public entry point
FAIL  shaders: the build failed, so its WGSL compiled for neither GPU path
      "./internal" is not exported under the conditions ["module", "browser", "production", "import"]
```

The refusal's tests are load-bearing. With the branch that refuses a non-public engine entry point taken out of `importProblem`, five tests of `check-addon.test.ts` fail: the three `publicApiProblems` cases that name `@null3d/engine/internal` and `@null3d/engine/scene`, and the two `run` cases that require exit 1 for the broken fixture.

## The allocation gate (M3-D9a)

**The decision: a port.** M3-D9a chose between porting the engine's profiling harness into the command-line package and publishing a form of its sampling that the tool calls. The harness drives Chrome's debugging protocol, attaches to a page's workers and reads their heaps. That is tool code, not engine code. A public form would freeze a benchmark harness into the engine's public API, which [D-199](D-199-m4-features-and-study-tasks-in-m3.md) and hard rule 14 keep for engine features. The package ships the browser that the bench imports, so the port adds no new direction of dependency.

**Where the one implementation lives.** Three modules in `@null3d/cli`:

- `packages/cli/src/heap-profile.js` reads a heap profile into the bytes that each place allocated, sets aside the burst that the browser makes when it installs code it has just optimized, and gives each place's bytes per frame across the samples.
- `packages/cli/src/devtools.js` is the debugging-protocol client, the worker attach, `HeapSampler`, which starts and stops a sample in every worker, and the free port that the browser listens on.
- `packages/cli/src/source-names.js` names a built function by its source file through the build's source map.

The benchmarks import these modules, and there is one copy of the profiler. The bench keeps only what belongs to the repository's own tools: the phone's entry, `connectPhoneChrome`, and the load address that the startup tool serves a build under.

**What the gate does.** For each preset it opens the page's production build with `?bench&preset=`, waits for the engine, attaches to the sketch and render workers, warms up for 20 s and 1,200 frames, and samples each worker's heap twice for 4 s. It also samples the workers' call stacks for a second, to learn which of the add-on's functions ran. It names each function through the build's source maps. Then it sums the places whose source file is the add-on's own: in the add-on's folder, or in its copy under `node_modules`. It prints the page's own figure beside it. A page that runs the add-on and allocates nothing reports zero.

**Why the build carries source maps, and no source text.** A production build's frames name bundled chunks, so without maps the gate could not tell the add-on's code from the engine's. The check builds with `sourcemap: 'hidden'`, which writes the maps and adds no address to a built file, so the page loads nothing more. The check sets `sourcemapExcludeSources`, so a map holds the mappings and the source paths, which are all that the gate reads. A page that imports the engine from source holds the generated shaders, hundreds of megabytes of them. A map that embeds its sources copies them again. With that text in the maps, a build of the fixture's page that bundles the shader files holds 9.6 GB before the sampling begins. One run of the check, which the coordinator measured, reached 16.7 GB and took a build from another job on the same machine (commit `dc101decb` records it). A few maps that the plugin writes itself keep their text, and the maps of the build make 10 MB in all. The cost gate measures the same build.

**The size of a profile.** The profiles themselves are small: a sample of the allocating fixture held 1,544 objects in the sketch worker and 410 in the render worker. The profiler records one sample for each stretch of bytes that a page allocates, so a page that allocates fast would grow a profile until the memory ran out. The gate first samples 250 ms at a coarse interval to learn the page's rate, then sets the interval so that one worker's profile holds at most 250,000 objects in a sample, which is about 20 MB. A page that allocates faster than any browser page is sampled less finely, and its places are coarser. The command's page states the figure. The heavy check `packages/cli/src/add-on-page-build.test.ts` builds the fixture's page under a memory ceiling and holds its maps under 64 MB.

**The verdict, and why it has no threshold.** The gate prints figures and passes once it has measured them. It fails only when it cannot measure. That covers no production build, no answer on the browser's debugging socket, and no worker target. It also covers a page that drew no frame while it sampled, a worker whose profile held nothing, and a page that ran none of the add-on's own code. The last of these is not a budget. It separates a working profiler from one that attached and watched other code. The heap profile alone cannot tell them apart, because it lists only the places that allocated.

The gate has no per-add-on allocation budget, and must not gain one by accident. The add-on check has no basis for such a figure. The engine's own check measures the engine, whose frame code must allocate nothing, and it keeps its named budgets and its four bytes per frame allowance precisely because it has that basis. An honest add-on's page allocates a little by itself. A probe of `tests/fixtures/d9-addon` with a warm-up of 8 s reads 8.9 bytes per frame in the fixture's own `onUpdate`, from the browser boxing a fraction that a setter takes. With the gate's longer warm-up, the browser inlines the setter, and the boxing stops. The budget of the engine's own check would fail the short probe's figure. A gate that failed on any byte, or on a budget written from one run, would fail honest add-ons first. A listing that wants a budget for one add-on writes it from the figures this gate prints. The gate never fails because a figure differs from one that an add-on publishes.

**The runs.** `tests/fixtures/d9-addon` passed every gate, and the allocation gate printed this, in the run that commit `223ee1331` records:

```text
PASS  allocation per preset: low 0 bytes, medium 0 bytes, high 0 bytes, ultra 0 bytes per frame in the add-on's own code, on Chrome 155.0.8059.85
      low: 774 bytes per frame in the page's threads, 0 bytes of it in the add-on's own code
      medium: 778 bytes per frame in the page's threads, 0 bytes of it in the add-on's own code
      high: 765 bytes per frame in the page's threads, 0 bytes of it in the add-on's own code
      ultra: 800 bytes per frame in the page's threads, 0 bytes of it in the add-on's own code
```

`tests/fixtures/d9-addon-allocating` is the fixture that shows the gate catching allocation: its page calls the add-on's step in every frame, and the step makes objects there. The gate printed this, in the run that commit `dc101decb` records:

```text
PASS  allocation per preset: low 5.9 KB, medium 6.0 KB, high 5.9 KB, ultra 5.8 KB per frame in the add-on's own code, on Chrome 155.0.8059.85
      low: 5.9 KB per frame in trail src/index.ts (sketch-worker)
      medium: 6.0 KB per frame in trail src/index.ts (sketch-worker)
      high: 5.9 KB per frame in trail src/index.ts (sketch-worker)
      ultra: 5.8 KB per frame in trail src/index.ts (sketch-worker)
```

The place is the add-on's own step, in the sketch worker, and the page's other threads allocate the rest. The gate passes with those figures rather than failing, as its verdict says. A listing that wants a budget for the add-on's own code adds one; the gate's figures are what such a budget reads.

## The page build links the engine's shader files

The owner ruled that the page build stops building the engine inside the add-on check's page process. The build that meets the ruling links the engine's shader files rather than bundling them, and it still bundles the engine's code. Bundled, they make the heavy check that reads the page's source maps peak at 12,930 MiB and 13,120 MiB on CI's 16 GB runners.

**What the peak is.** The engine's shader set. The engine's generated TypeScript modules are about 3 MB, and the shader compile runs in the shader build. The set is about 6,000 files and 2.8 GB. It holds a device module for each GPU path, each value of the device's fixed bits and each feature. It also holds tables of shared paragraphs. A page loads a few of those files at run time, and the bundler never holds their code. Vite's asset handling reads every file and writes a hashed copy into the build, for the page and again for each worker. Bundled, a finished page of the fixture holds 2.8 GB of files, all of them shader files. The build holds them before it writes them. The source maps are not the main cost: a build without maps holds about as much as one with maps that carry no source text.

**The plugin.** `packages/cli/src/shader-files.js` is a Vite plugin that the add-on check's page build runs, for the page and for each worker. It marks each shader address of an engine module with Vite's ignore marker, so Vite leaves the address as it is rather than reading the file. After the build it links the shader files that the shader build wrote beside each script that names one. A page then fetches the same file at the same relative address that the bundle would have written. The set stays one copy in the machine's cache, and the build folder holds links to it. The option that turns this on is `linkedShaders`, which the page gates of `check-addon` set. The bundle holds no shader bytes, by design: each linked name carries the set's stamp.

**The figures.** Measured on the fixture's page in a checkout, with `/usr/bin/time -l`:

| Build | Peak | Time |
| --- | --- | --- |
| a page build that bundles the shader files | 10,520 MiB here, and 12,930 to 13,120 MiB on CI | minutes |
| the page build that links them | 790 MiB | 8 s |

Runs of the linked build measured 720 to 818 MiB. The heavy check's ceiling is 14,336 MiB. The page gates pass with the linked build, so the drop to 1,536 MiB is owed.

**What it keeps.** The page is built from the project's own sources with the same Vite config, and the same page runs in the same gates. The `page` gate starts it from another origin under the strict policy, in both thread modes. The `cost` and `allocation` gates measure it on every preset, and the allocation gate names the add-on's own code through the build's source maps. The `public API`, `interface` and `shaders` gates do not depend on it, so a refused add-on fails with the same lines that name it. A run on the fixture for commit `8c9c981c0`, whose log is not kept, passed the page gate in both thread modes, cost at 0.32, 0.26, 0.26 and 0.20 ms of GPU time per frame, and 0 bytes per frame in the add-on's own code. The `shaders` and `sizes` gates skipped in that run for the reason below. Run with `bun packages/cli/bin/null3d.js`, they pass: the add-on built with WGSL for both GPU paths, and its file within budget. The wrongly packed fixture fails the public-API gate and the shader-build gate, with the same lines that name it, and exits 1.

**The addresses keep a hash.** A shader file's name carries the stamp of the shader set: a hash of each file's name, size and time of change. The stamp costs a listing and a stat of each file, never a read of its bytes. The name changes whenever any file of the set changes, so a page or a CDN may keep it for a long time, and a copy of an older set can never answer for a newer one. The file's bytes, its folder, its origin and the way a script names it stay as a bundled build has them.

**A fault that remains: Node skips two gates in a checkout.** `bunx @null3d/cli check-addon` runs the command under Node, as the command's `node` line asks. In a checkout the plugin sits there as TypeScript source, and Node cannot load it, so the `shaders` and `sizes` gates skip with a reason. A project that installs the packages from npm has the plugin's built files, so its run takes both gates. A run of the repository uses `bun packages/cli/bin/null3d.js`, which loads the source. This touches neither the page build nor the page gates.

**What it does not do.** The repository's production test pages, the examples and a project's own `vite build` write their own copies of the shader set. Those builds are meant to be what a project ships, and the linked build is scoped to the page that the check measures. The same lever could serve them, and that is a change of its own with its own measurements.
