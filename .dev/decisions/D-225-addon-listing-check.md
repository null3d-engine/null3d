# D-225: The add-on listing check

Status: decided. Date: 2026-10-23. Task: M3-D9, M3-D9a. This record gives the command that [D-173](D-173-addon-hooks.md) ruling 10 asks for. The allocation gate that ruling names moves to M3-D9a, for the reason under "Not in this task". The addendum of 24 October 2026 builds it.

Summary: `bunx @null3d/cli check-addon [folder]` runs the engine's gates on one add-on package and prints one line per gate. It checks the package, the public imports, the plugin interface range, a build of the WGSL for both GPU paths, the size of first-use files, the page's strict-policy start, and its cost per preset. The page comes from the project's `null3d.json` or `--page`, and the page gates skip with a reason without one.

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
- The `test` command already reads `null3d.json`, which names a page for an image test. The `bench` and `shot` commands open a page from the project's root. The check takes the same page and the same runner.
- The size budget for a file that loads after the start is [D-14](D-14-js-budget.md)'s (`tools/lib/size-report.ts`, `LATER_BUDGET`). The command carries the same figures for the add-on's own files, and a test keeps them equal.
- A file of compiled shader builds is shader data, and D-14 gives such a file its own budget (`FIRST_USE_SHADER_BUDGET`). The plugin writes a custom material's builds to files of their own, which a page loads on the material's first use, so the command holds them to that budget. A test keeps its figures equal to the size report's too.
- The engine's allocation check is not a wrapper: it drives Chrome's debug protocol, attaches to the sketch and render workers, samples their heaps for many seconds and profiles each sample by function. That harness is about 350 lines in `bench/lib/devtools.ts` and `bench/lib/allocation.ts`, and it is not part of the command-line tool.

## Decision

**The command.** `bunx @null3d/cli check-addon [folder]`, in `packages/cli/src/check-addon.js`, with `--page <path>` and `--skip-browser`. It prints one line per gate and exits with 1 when a gate fails, as the `test` command does.

**The gates.**

| Gate | What it does | Without the thing it needs |
| --- | --- | --- |
| package | reads the manifest's name and its entry: `exports`, `module`, `main` or `src/index.ts` | FAIL |
| public API | scans the shipped source for imports of any engine entry point other than `@null3d/engine` and `@null3d/engine/stats`, and of the engine's source | FAIL |
| interface | reads the entry's `checkPluginInterface(name, { min, max })`, or the `pluginInterface` field of its `declareAddonNamespace({ ... })` registration, and holds the range to the engine's interface version; a `@null3d/...` package must call `checkAddonVersion(name, VERSION)` instead | SKIP when no engine sits beside the add-on |
| shaders | builds the entry with the add-on's own Vite and null3D plugin, which compiles every WGSL import for both GPU paths | SKIP when either is not installed |
| sizes | holds each built file to its budget: the later-file budget for code, and the first-use shader budget for a file of compiled shader builds | SKIP with the build |
| page | starts the page from another origin under the strict policy, once threaded and once single-threaded | SKIP without a page, or with `--skip-browser` |
| cost | measures the production build of the page on each quality preset, and prints the GPU time per frame, or the CPU time where the device times no GPU work | SKIP without a page |

**The page.** The first test's `page` in the project's `null3d.json`, or `--page`. An add-on without a page still passes the Node-only gates. This keeps every field as it is: the config already names pages for image tests.

**The cost is measured, not asserted.** The gate prints the figure for each preset. It fails only when the page does not measure, never because a seller's published number differs.

## Consequences

- The command joins the command table, the [`null3d` page](../../docs/cli/null3d.md) and the package README. [Building an add-on](../../docs/guides/add-ons.md) is the add-on author's guide, and it links the command.
- The unit tests cover the refusal of an add-on that imports `@null3d/engine/internal`, the clean case, every interface mismatch in both declaration forms, the page lookup and the size-budget equality.
- M3-D8 gives an add-on one registration call, `declareAddonNamespace`, and its record carries an optional `pluginInterface` range. The namespace's claim runs `checkPluginInterface`, so the static gate reads either form and the two checks cannot disagree. The namespace's name is the add-on's own short name, so only the standalone call's name must equal the package name. The D8 record was numbered D-224 while this one was in flight, so this record is D-225.
- The page gates need a browser and a GPU, so their tests run after the machine's gate window and with the engine's browser rules.

## Recorded run, 24 October 2026

The command ran over every foundation add-on that has a package, from a fresh worktree after
`bun install` and `bun run build`. Each run exited 0.

| Add-on | package | public API | interface | shaders | sizes | page and cost |
| --- | --- | --- | --- | --- | --- | --- |
| `@null3d/controls` | PASS | PASS | PASS | PASS | PASS | SKIP |
| `@null3d/geometry` | PASS | PASS | PASS | PASS | PASS | SKIP |
| `@null3d/impostors` | PASS | PASS | PASS | PASS | PASS | SKIP |
| `@null3d/particles` | PASS | PASS | PASS | PASS | PASS | SKIP |
| `@null3d/splats` | PASS | PASS | PASS | PASS | PASS | SKIP |
| `@null3d/terrain` | PASS | PASS | PASS | PASS | PASS | SKIP |

Every run skipped the page and cost gates with the command's reason: a foundation add-on's package
carries no `null3d.json`, because its page is a demo in `examples/`. The five foundations that no
package holds yet have no run: physics, MSDF text, water, `three-compat` and vegetation
([D-173](D-173-addon-hooks.md) ruling 4; [D-241](D-241-vegetation-foundation.md)).

`tests/fixtures/d9-addon` gave the page and cost gates their run. All seven gates passed on it:

```text
PASS  page: the page starts from another origin under the strict policy, threaded and single-threaded
PASS  cost per preset: low 0.31 ms of GPU time, medium 0.25 ms of GPU time, high 0.25 ms of GPU time, ultra 0.25 ms of GPU time per frame, on Chrome 155.0.8059.85
```

`tests/fixtures/d9-addon-internal` gave the refusal its run: a package whose entry imports
`@null3d/engine/internal`. The command exited 1.

```text
FAIL  public API: 1 import reaches past the engine's public entry points
      src/index.ts imports @null3d/engine/internal, which is not a public entry point
FAIL  shaders: the build failed, so its WGSL compiled for neither GPU path
      "./internal" is not exported under the conditions ["module", "browser", "production", "import"]
```

### The two faults that the run found

**The size gate held shader builds to the code budget.** The first run failed on impostors,
splats and terrain, each with 36 files named `material-glsl-*` and `material-wgsl-*`, from 175 KB
to 907 KB raw. These are the compiled builds of a custom material, which the plugin writes to
files that a page loads on the material's first use. They are shader data, so
[D-14](D-14-js-budget.md) gives them the first-use shader budget, `FIRST_USE_SHADER_BUDGET` in
`tools/lib/size-report.ts`. The largest is 907.5 KB raw and 45.0 KB after Brotli, and every one
passes that budget. The command now takes that budget for a file of compiled shader builds, and
the later-file budget for code. A test keeps both sets of figures equal to the size report's.

**The fixture's page drew no frames.** The cost gate failed with "the engine on webgpu drew no
frame while it was measured". The fixture's sketch never changed the scene, and the engine rests a
still view: once its frames converge it stops submitting draws, so the measurement sees no drawn
frame. The sketch now turns its box, as the project fixtures' sketches animate. The same page then
measured every preset.

## Not in this task

The allocation gate was left out of M3-D9. Porting the engine's profiler harness into the
command-line tool is most of a task of its own. It also measures a page that an outside add-on may
not ship.

The coordinator moved it to M3-D9a on 23 October 2026, with the profiler port named, so it stays
tracked work rather than a silent deferral. The addendum below records what M3-D9a decided and
built.

## Addendum, 24 October 2026: the three-compat add-on

[M3-F7](../../.dev/decisions/D-179-technique-rulings-2026-10-15.md) landed `@null3d/three-compat` as a
foundation that holds a package, after the run above. The foundations that no package holds are now
physics, MSDF text, water and vegetation.

The command ran over it the same evening, and it is the first add-on the size gate has failed:

| Add-on | package | public API | interface | shaders | sizes | page and cost |
| --- | --- | --- | --- | --- | --- | --- |
| `@null3d/three-compat` | PASS | PASS | PASS | PASS | FAIL | SKIP |

```text
FAIL  sizes: 2 files load more than the budget for a file after the start
      addon.js is 181.9 KB raw, over its 64.0 KB budget
      addon.js is 24.8 KB gzip, over its 24.0 KB gzip budget
```

The package's own sources are 24 KB, so the entry is mostly something else, most likely the compiled
shader builds of its two tone curves and its outline passes. That is the shape that
[D-56](D-56-first-use-shader-files.md) moved out of code for the engine: shader text belongs in a
file that loads on the feature's first use, under the shader budget, not inside the add-on's entry.
The gate did its job: three-compat shipped over budget because nothing had measured it.

## Fixed, 24 October 2026: three-compat's first-use builds

The failure above measured the add-on's entry, and the entry held the compiled builds of its
shaders. Through the plugin's own packing, the five `.wgsl` files of the entry make 184.5 KB, and
the entry itself was 181.9 KB. The two tone curves are 125.6 KB of that (69%), and the three
outline effects 59.0 KB (32%). The add-on's own code is the remaining few KB.

The fix takes the shape that [D-56](D-56-first-use-shader-files.md) gave the engine's own shaders.
A custom effect's and a custom tone curve's builds load on first use, in a set for each GPU path,
as a custom material's already did. The plugin keeps none of their builds in the module. It writes
each set to a file of its own, named `effect-<path>-0-<hash>.js` or `curve-<path>-0-<hash>.js`.
The engine imports a shader's set when the sketch first uses it, and waits for it as it waits for a
custom material's. A caller that imports only the tone curves downloads only their code. It then
downloads the curve's builds for its GPU path when it first sets one. A caller that never imports
the add-on downloads nothing. The outline's builds load when `createOutlinePass` first uses them.

The gate's budget did not change. Its list of compiled-shader-build files now names the effect and
tone-curve sets that the plugin writes, beside the material sets, because all three are the same
kind of file: shader data that a page loads on first use.

The rebuilt add-on passes every size gate. Its 12 files include:

| File | Raw | Gzip | Brotli |
| --- | --- | --- | --- |
| `addon.js` | 27.8 KB | 4.3 KB | 3.7 KB |
| largest curve set | 31.5 KB | 5.7 KB | 4.9 KB |
| largest effect set | 9.2 KB | 2.7 KB | 2.4 KB |

The checks that hold a set file to the shader budget and the plugin's virtual-module names now
cover the effect and tone-curve kinds. [E1424](../../docs/errors/E1424.md) names all three kinds of
build file.

## Addendum, 24 October 2026: the allocation gate (M3-D9a)

M3-D9a held a choice: port the engine's profiling harness into the command-line package, or publish a
form of its sampling that the tool calls. The gate is now built.

**The decision: a port.** The harness drives Chrome's debugging protocol, attaches to a page's
workers and reads their heaps. That is tool code, not engine code. A public form would freeze a
benchmark harness into the engine's public API, which [D-199](D-199-m4-features-and-study-tasks-in-m3.md)
and hard rule 14 keep for engine features. The package already ships the browser that the bench
imports, so the port adds no new direction of dependency.

**Where the one implementation lives.** Three modules in `@null3d/cli`:

- `packages/cli/src/heap-profile.js` reads a heap profile into the bytes that each place allocated,
  sets aside the burst that the browser makes when it installs code it has just optimized, and gives
  each place's bytes per frame across the samples.
- `packages/cli/src/devtools.js` is the debugging-protocol client, the worker attach, `HeapSampler`,
  which starts and stops a sample in every worker, and the free port that the browser listens on.
- `packages/cli/src/source-names.js` names a built function by its source file through the build's
  source map.

The benchmarks import these modules, and there is one copy of the profiler. The bench keeps only
what belongs to the repository's own tools: the phone's entry, `connectPhoneChrome`, and the load
address that the startup tool serves a build under.

**What the gate does.** For each preset it opens the page's production build with `?bench&preset=`,
waits for the engine, attaches to the sketch and render workers, warms up for 20 s and 1,200 frames,
and samples each worker's heap twice for 4 s. It also samples the workers' call stacks for a second,
to learn which of the add-on's functions ran. It names each function through the build's source maps.
Then it sums the places whose source file is the add-on's own: in the add-on's folder, or in its copy
under `node_modules`. It prints the page's own figure beside it. A page that runs the add-on and
allocates nothing reports zero.

**Why the build carries source maps, and no source text.** A production build's frames name bundled
chunks, so without maps the gate could not tell the add-on's code from the engine's. The check builds
with `sourcemap: 'hidden'`, which writes the maps and adds no address to a built file, so the page
loads nothing more. The maps carry little source text: a page that imports the engine from source
holds the generated shaders, hundreds of megabytes of it, and a map that embeds its sources copies
them again. With that text in the maps, the build of the fixture's page held 9.6 GB before the
sampling began, and one run of the check on 24 October 2026 reached 16.7 GB, which took a build from
another job on the same machine. The check sets `sourcemapExcludeSources`, so a map holds the
mappings and the source paths, which are all that the gate reads. A few maps that the plugin writes
itself keep their text, and the maps of the build made 10 MB in all. The cost gate measures the same
build.

**The memory of a run.** The check's peak is its page build, not the profiler. Measured on the
fixture's page on 24 October 2026:

| Build | Peak during the build | Held after it |
| --- | --- | --- |
| maps that carried each source's text | 16.7 GB, in the run that the coordinator measured | 9.6 GB |
| maps that carry no source text | 10.5 GB | 7.3 GB |
| no maps | not measured | 7.5 GB |

Without maps the build held about the same as with maps that carry no source text, so the maps were
not its main cost: the page build holds the engine's generated shader modules, which a checkout
resolves from source.

The profiles themselves are small: a sample of the allocating fixture held 1,544 objects in the
sketch worker and 410 in the render worker. The page build of a checkout resolves the engine to its
source and holds the generated shaders, so it costs several gigabytes whatever the profiler does. A
page of a project that installs the published engine holds far less.

The profiler records one sample for each stretch of bytes that a page allocates, so a page that
allocates fast would grow a profile until the memory ran out. The gate first samples 250 ms at a
coarse interval to learn the page's rate, then sets the interval so that one worker's profile holds
at most 250,000 objects in a sample, which is about 20 MB. A page that allocates faster than any
browser page is sampled less finely, and its places are coarser. The command's page states the
figure, and the heavy check `packages/cli/src/add-on-page-build.test.ts` builds the fixture's page
under a ceiling of 12,288 MiB and holds its maps under 64 MB, so both figures are stated.

**The verdict, and why it has no threshold.** The gate prints figures and passes once it has
measured them. It fails only when it cannot measure. That covers no production build, no answer on
the browser's debugging socket, and no worker target. It also covers a page that drew no frame while
it sampled, a worker whose profile held nothing, and a page that ran none of the add-on's own code.
The last of these is not a budget. It separates a working profiler from one that attached and
watched other code. The heap profile alone cannot tell them apart, because it lists only the places
that allocated.

The gate has no per-add-on allocation budget, and must not gain one by accident. The add-on check has
no basis for such a figure. The engine's own check measures the engine, whose frame code must
allocate nothing, and it keeps its named budgets and its four bytes per frame allowance precisely
because it has that basis. An honest add-on's page allocates a little by itself. A short probe of
`tests/fixtures/d9-addon` read 8.9 bytes per frame in the fixture's own `onUpdate`, from the browser
boxing a fraction that a setter takes. A gate that failed on any byte, or on a budget written from
one run, would fail honest add-ons first. A listing that wants a budget for one add-on writes it from
the figures this gate prints. The gate never fails because a figure differs from one that an add-on
publishes.

**The run.** `tests/fixtures/d9-addon` passed every gate, and the allocation gate printed:

```text
PASS  allocation per preset: low 0 bytes, medium 0 bytes, high 0 bytes, ultra 0 bytes per frame in the add-on's own code, on Chrome 155.0.8059.85
      low: 774 bytes per frame in the page's threads, 0 bytes of it in the add-on's own code
      medium: 778 bytes per frame in the page's threads, 0 bytes of it in the add-on's own code
      high: 765 bytes per frame in the page's threads, 0 bytes of it in the add-on's own code
      ultra: 800 bytes per frame in the page's threads, 0 bytes of it in the add-on's own code
```

A first probe of the same page, with a warm-up of 8 s, read 8.9 bytes per frame in the fixture's
`onUpdate`. With the gate's longer warm-up, the browser inlines the setter, and the boxing stops.
The budget of the engine's own check would have failed that first probe's figure.

`tests/fixtures/d9-addon-allocating` is the fixture that shows the gate catching allocation: its
page calls the add-on's step in every frame, and the step makes objects there. The gate printed:

```text
PASS  allocation per preset: low 5.9 KB, medium 6.0 KB, high 5.9 KB, ultra 5.8 KB per frame in the add-on's own code, on Chrome 155.0.8059.85
      low: 5.9 KB per frame in trail src/index.ts (sketch-worker)
      medium: 6.0 KB per frame in trail src/index.ts (sketch-worker)
      high: 5.9 KB per frame in trail src/index.ts (sketch-worker)
      ultra: 5.8 KB per frame in trail src/index.ts (sketch-worker)
```

The place is the add-on's own step, in the sketch worker, and the page's other threads allocate the
rest. The gate passes with those figures rather than failing, as its verdict says. A listing that
wants a budget for the add-on's own code adds one; the gate's figures are what such a budget reads.

## Addendum, 24 October 2026: the pieces of an effect that draws alone

M3-F5's water add-on was the first package to carry a custom effect that reads the scene's depth.
Such an effect cannot join the effect before it, so it draws a pass of its own with its builds. The
plugin kept its pieces, the top-level items that a joined effect adds to a host, in the module
anyway. They were 93 KB of the 111 KB entry, for data that no host reads, and the size gate failed
the entry's raw figure.

A module's value now keeps no pieces for an effect whose `joins` is false, as it keeps none of its
builds. The add-on's entry fell to 18 KB, within the 64 KB budget. Joined effects and tone curves
keep their pieces, which their hosts read. A test in `material-builds.test.ts` covers both cases.

## Addendum, 25 October 2026: the cost gate left out on a loaded machine

The water add-on's first browser runs came when the machine held a load of 90 to 155, with six
jobs ahead in the shared browser lane. The page and allocation gates measure what the page draws
and allocates. A loaded machine does not change those figures. The cost gate measures time. A
figure taken beside a saturated machine would report the load instead of the add-on.

`check-addon` takes `--skip-cost`, which leaves out the cost gate alone and prints why. The page
and allocation gates still run, and the cost gate stays owed until a quiet window. The option is
not for CI, which measures on a machine of its own. It is for an author checking a package while
other work runs beside it.
