# D-225: The add-on listing check

Status: decided. Date: 2026-10-23. Task: M3-D9. This record gives the command that [D-173](D-173-addon-hooks.md) ruling 10 asks for. The allocation gate that ruling names moves to M3-D9a, for the reason under "Not in this task".

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

The allocation gate is not built. Porting the engine's profiler harness into the command-line tool is most of a task of its own. It also measures a page that an outside add-on may not ship.

The coordinator moved it to M3-D9a on 23 October 2026, with the profiler port named, so it stays tracked work rather than a silent deferral. M3-D9a decides between a port of the harness and a public form of its sampling.

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
